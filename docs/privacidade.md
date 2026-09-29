# Privacidade e segurança

## Privacidade

Quem tem o UUID de uma URL lê tudo dela. Com um **segredo de leitura**, ver e gerir a URL passa a exigir o segredo;
**capturar continua aberto** (quem manda o webhook não tem segredo).

Limites (o modelo não tem contas de usuário):

- **Quem tem o UUID de uma URL ABERTA pode protegê-la** com um segredo seu, e o dono perde o acesso até saber o
  segredo. É o mesmo poder que esse UUID já dava (ler, apagar, trocar a resposta): proteja a URL antes de o UUID
  circular.
- **O PBKDF2 não tem limite global.** O limite de 10 falhas por minuto é por URL; quem espalha tentativas por muitas
  URLs faz o servidor calcular um PBKDF2 (210.000 iterações) por tentativa. Limites globais anti-abuso, para publicar
  o app, são outro tema.

### Captura isolada (CSP sandbox)

Toda resposta da captura `/{id}/...` — a resposta padrão da URL, a de uma regra e a da falha `malformed_chunk` — sai
com `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`, **sem
`allow-same-origin`**. Motivo: a tela, a API e a captura servem pelo mesmo endereço (`localhost:8084`), e a resposta
de uma URL é conteúdo de quem a configurou (ou de quem conhece o UUID de uma URL aberta). Sem o sandbox, uma captura
que responde HTML com `<script>` rodaria na origem da tela: leria o `localStorage` (os UUIDs de quem abre a página) e
chamaria a API com o cookie de desbloqueio. Com ele, a página roda numa origem opaca: o script roda, formulários e
pop-ups funcionam, mas nada da origem do app fica ao alcance. O cabeçalho vem depois dos cabeçalhos da regra e é
acrescentado, não trocado: uma regra que define o próprio `Content-Security-Policy` fica com os dois, e o navegador
aplica os dois. Clientes que não são navegador (CLI, SDKs, provedores) ignoram o cabeçalho.

### Segredo de leitura

`read_secret` (texto de 8 a 256 caracteres) no corpo do `POST /token` ou do `PUT /token/{id}`. Nunca é devolvido: o
token ganha `"protected": true|false`. No `PUT`, **ausente mantém** o segredo (exceção deliberada à regra "campo
ausente volta ao padrão": apagar a proteção por omissão seria perigoso), `null` remove e texto troca. Na query, 422.

Sem acesso, **toda** rota `/token/{id}/...` (o token, `DELETE`, mensagens, raw, SSE, busca, wait, regras, cenários,
saídas, replay, send, IA, links) responde `401 {"error":"This URL is protected","protected":true}`; só `unlock` e
`lock` respondem. A captura `/{id}/...` não muda. Acesso é um destes:

- cabeçalho `X-Anzol-Secret: <segredo>` (CLI, scripts);
- o cookie de desbloqueio (a tela).

No Redis fica só o PBKDF2-HMAC-SHA256 (sal aleatório de 16 bytes, 210.000 iterações) e `secret_version`, que muda a
cada troca; comparação em tempo constante. Acertos ficam 5 minutos em memória (o CLI não paga o PBKDF2 em toda
chamada). **10 segredos errados por minuto por URL** (unlock e cabeçalho somados; o `read_secret` do MCP conta à parte, para
um agente errando não travar a tela e o CLI) → `429` com `Retry-After`
até o minuto acabar, **também para o segredo certo** (senão o 429 do errado e o 200 do certo diriam qual é o certo);
o cookie não passa por esse limite. O segredo não aparece em log, resposta, métrica nem erro. Token gravado antes do
segredo abre como não protegido.

### Cookie de desbloqueio

`POST /token/{id}/unlock {"secret": "..."}` → `204` com
`Set-Cookie: anzol_access=<dia>.<HMAC-SHA256(chave do servidor, id:versão:dia)>; Path=/token/{id}; Max-Age=2592000;
HttpOnly; SameSite=Strict` (e `Secure` quando a requisição chega em HTTPS, direto ou com `X-Forwarded-Proto: https`).
Errado: `401 {"error":"Wrong secret"}`; sem `secret`: 422; URL sem proteção: `204` sem cookie. O cookie abre toda rota
da URL, inclusive o SSE, sem o segredo passar pelo JavaScript. `POST /token/{id}/lock` apaga o cookie (`204`).

`<dia>` é o dia de emissão (dias desde 1970, UTC), assinado junto: **o servidor recusa o cookie com 30 dias ou mais**,
mesmo que o navegador ainda o mande. É o dia, e não o instante, para que dois desbloqueios no mesmo dia deem o mesmo
cookie; o prazo nunca passa de 30 dias (encurta menos de um dia). Cookies do formato anterior (sem o dia) deixaram de
valer: quem os tinha desbloqueia de novo.

A chave do servidor são 32 bytes aleatórios em `anzol:server-key` no Redis, criados no primeiro uso com `SET NX`
(duas instâncias ficam com a mesma) e sem TTL: sobrevive a restart. Trocar ou remover o segredo muda a versão, então
os cookies antigos param de valer (inclusive se o segredo for definido de novo), as conexões SSE e esperas abertas
da URL são fechadas (quem reconectar passa de novo pelo acesso) e **todos os links só-leitura da URL são revogados**
(um link é acesso; quem troca o segredo quer cortar quem tinha).

### CLI e MCP

No CLI, `--read-secret <segredo>` (depois do subcomando, como o `--server`) ou a variável `ANZOL_READ_SECRET` põe o
cabeçalho em `listen`, `replay`, `wait-for`, `rules`, `cursor` e `test`. URL protegida sem o segredo certo: `This URL is
protected: pass --read-secret or set ANZOL_READ_SECRET` no stderr e saída 1 (2 no `wait-for` e no `test`). O segredo
nunca é impresso. Só ASCII imprimível: o cliente HTTP do Java troca os demais caracteres por `?` num cabeçalho.

```bash
ANZOL_READ_SECRET='meu-segredo' anzol listen --token <uuid> --forward http://localhost:3000
anzol rules pull <uuid> --read-secret 'meu-segredo'
```

No MCP, toda ferramenta da URL aceita o argumento opcional `read_secret`; URL protegida sem ele (ou com ele errado) é
erro de ferramenta `{"status":401,"error":"This URL is protected; pass its read_secret"}`. No `create_url`,
`read_secret` é o segredo que a URL nova passa a exigir; no `update_url`, é só o acesso (o segredo da URL não muda por
ali).

## Links só-leitura

Uma mensagem pode ser compartilhada por um link que não dá acesso a mais nada da URL (nem com ela protegida):

```bash
curl -X POST localhost:8084/token/<uuid>/request/<rid>/share -H 'Content-Type: application/json' \
  -d '{"expires_in":"1d","redact":true}'
# 201 {"id":"3kQ…","url":"/#/share/3kQ…","expires_at":"2026-09-27 12:00:00","redact":true}
```

- `expires_in`: `1h`, `1d`, `7d` (padrão) ou `30d`; `redact`: `true` (padrão) ou `false`. Outro valor: 422.
- `GET /token/{id}/shares` lista os ativos; `DELETE /token/{id}/shares/{sid}` revoga (`204`; link de outra URL, 404).
  No máximo 50 ativos por URL (422 acima).
- `GET /share/{sid}` é público: a mensagem como `GET /token/{id}/request/{rid}` a devolve, mais `shared_at` e
  `expires_at`, **sempre sem o UUID da URL** (com ou sem `redact`): sem `token_id`, e com toda ocorrência do UUID no
  JSON inteiro trocada por `[redacted]` (`http://localhost:8084/[redacted]/caminho?x=1`) — na `url`, nos cabeçalhos
  (`referer`), na query, no `request` e no corpo (o ping do GitHub traz a própria URL) —, também escrito com
  maiúsculas ou com caracteres em `%hh` (`%2D` no lugar do hífen). O UUID é do servidor, não dado do remetente: do
  corpo, só ele sai. Expirado, revogado, de mensagem apagada, de URL apagada ou inexistente: o mesmo `404`.
- Definir, trocar ou remover o segredo de leitura da URL revoga todos os links dela. O link guarda a `secret_version`
  da URL na criação e só abre enquanto ela for a atual: um link criado no mesmo instante da troca também morre.
- `redact=true` troca por `"[redacted]"` os valores dos cabeçalhos `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-api-key`, `x-anzol-secret`, dos cabeçalhos cujo nome contém `token`, `key`, `secret`, `password`,
  `auth`, `session`, `credential`, `jwt`, `bearer`, `passwd` ou `pwd` (sem diferenciar maiúsculas: `X-Auth-Token`,
  `X-Api-Keys`, `X-Session-Id`) e do cabeçalho de assinatura do provedor
  configurado na URL, e os
  valores de query cujo nome contém `token`, `key`, `secret`, `password` ou `signature` (sem diferenciar maiúsculas),
  também dentro da `url` gravada. Os `php-auth-user`/`php-auth-pw` (o `Authorization: Basic` decodificado que a
  mensagem grava), os campos de formulário de nome sensível e as frases do `near_miss` que citam esses valores também
  saem mascarados. **O corpo não é mascarado.**

O id são 128 bits aleatórios em base62; no Redis, `share:{sid}` com TTL igual à expiração e o índice
`token:{uuid}:shares`, apagados junto com a URL.

## Proteção contra DNS rebinding/CSRF

Uma página maliciosa aberta no navegador pode tentar usar a API local: por DNS rebinding (o nome dela passa a apontar
para `127.0.0.1`, e o navegador manda `Host: nome-do-atacante`) ou por CSRF (um formulário de outro site, inclusive de
outro app em outra porta do `localhost`: o `SameSite` do cookie não separa portas). Com `ANZOL_ALLOWED_HOSTS`
(`anzol.allowed-hosts`, lista separada por vírgula; padrão fechado `localhost,127.0.0.1,[::1],host.docker.internal`),
as rotas de gestão (`/token`, `/token/...`, `/share/...`) e o `/mcp` conferem:

- `Host` fora da lista → `403 {"error":"host not allowed"}` (nome sem porta na lista casa qualquer porta);
- nos métodos que mudam estado (POST, PUT, PATCH, DELETE, inclusive por `X-HTTP-Method-Override`), `Origin` presente
  que não seja deste servidor → `403 {"error":"origin not allowed"}`. Passa o `Origin` na **mesma porta do `Host`** com
  nome da lista (a própria tela, também aberta por outro nome do loopback, ou pelo proxy do `ng serve`, que mantém o
  `Host`) ou com `nome:porta` escrito na lista (ex.: `localhost:4200` para uma tela servida noutra porta). Outra porta
  do mesmo nome é outra origem. No `/mcp`, o `Origin` é conferido em todo método, como o transporte Streamable HTTP
  exige;
- `_method` num POST (campo de formulário ou query, que transformaria o POST de um `<form>` em PUT ou DELETE) →
  `403 {"error":"_method not allowed"}`, com ou sem `Origin`;
- corpo de formulário (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, os que um `<form>`
  manda sem preflight) com `Origin` ou com o cookie de desbloqueio `anzol_access` (que só um navegador manda sozinho,
  mesmo quando omite o `Origin`) → `403 {"error":"form not allowed"}`. A tela só manda JSON. Sem `Origin` e sem o
  cookie (CLI, curl, scripts) o formulário continua aceito, como no app antigo. É 403, e não 415, porque o tipo é aceito: o que se
  recusa é o formulário vindo de um navegador.

Cliente sem `Origin` (CLI, curl, agentes) passa pelo `Host`. A captura `/{id}/...` e os arquivos da tela não conferem
nada (a captura aceita formulário, `_method` e qualquer `Origin`). A rota é reconhecida como o Spring a casa:
`/token;x=1/...` ou `/%74oken/...` também são conferidos. Lista vazia vale o padrão. Para chegar ao app por outro
nome, acrescente-o à lista.

**`*` desliga a conferência de `Host` e `Origin` da gestão, e é inseguro**: qualquer página aberta no navegador (e
qualquer nome que resolva para o app) passa a usar a API. O `/mcp` continua no padrão, e `_method` e formulário com
`Origin` continuam recusados.
