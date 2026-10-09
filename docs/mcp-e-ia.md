# MCP e IA local

## MCP

Com `ANZOL_MCP_ENABLED=true` (ligado no `docker-compose.yml`), o app é um servidor
[MCP](https://modelcontextprotocol.io) em `/mcp` (Streamable HTTP, Spring AI 2.0): agentes de IA operam o
Anzol pelas mesmas rotas da API, sem LLM nenhum no app. Para conectar o Claude Code:

```bash
claude mcp add --transport http anzol http://127.0.0.1:8084/mcp
```

São 18 ferramentas:

| Ferramenta | Rota da API |
|---|---|
| `create_url`, `get_url`, `update_url`, `delete_url` | `POST /token`, `GET`/`PUT`/`DELETE /token/{id}` |
| `list_requests`, `get_request`, `search_requests`, `wait_for_request` | `GET /token/{id}/requests`, `GET /token/{id}/request/{rid}`, `POST .../requests/search` (o texto nunca procura no valor decifrado, ver abaixo; `decryption_reason` filtra pelo motivo da decifra recusada), `POST .../requests/wait` |
| `get_rules`, `set_rules`, `test_rule` | `GET`/`PUT /token/{id}/rules`, `POST .../rules/test` |
| `diff_rules` | sem rota: compara a lista proposta (o mesmo argumento do `set_rules`) com as regras salvas, por `id`, e não grava |
| `replay_request`, `send_request`, `get_outbound` | `POST .../request/{rid}/replay`, `POST .../send`, `GET .../outbound` |
| `create_e2ee_lab`, `list_e2ee_scenarios`, `run_e2ee_scenarios` | `POST /e2ee-lab`, `GET /e2ee-lab/scenarios`, `POST /token/{id}/e2ee-lab/run` (ver [Laboratório E2EE](#laboratório-e2ee)) |

O `update_url` muda só o que foi enviado, ao contrário do `PUT /token/{id}` (que troca a configuração inteira): campo
ausente fica como está, e campo enviado como `null` desliga (`signature`, `schema`) ou volta ao padrão. `signature:
null` apaga também o segredo do HMAC: para religar a conferência, o objeto `signature` leva `secret` de novo. Numa URL
que decifra (`e2ee`), `signature: null` tira também a conferência do HMAC que roda antes da decifra: a decifra deixa de
exigir HMAC válido, e os campos do envelope fora dos vínculos (um `amount` ao lado do atributo cifrado, por exemplo)
deixam de ser autenticados; os que os vínculos apontam continuam conferidos contra o `jti`, o `evt` e o `app`
assinados pelo remetente. O resultado avisa em `warnings` (`"signature removed on a URL with e2ee: decryption no
longer requires a valid HMAC"`).

Os argumentos têm os nomes da API (a URL é sempre `token_id`, a mensagem `request_id`), e o resultado é o JSON que a
rota devolveria, com o segredo de assinatura mascarado e sem o atributo decifrado das mensagens (`decrypted`; o
resultado `decryption` vem, ver [Decifra de atributo](api.md#decifra-de-atributo-e2ee)); a pessoa vê o valor
decifrado na tela, com o segredo de leitura, na aba Decifrado da mensagem (Decrypted em inglês). Pelo mesmo motivo,
o texto do `search_requests` nunca procura no valor decifrado, mesmo com o `read_secret`: procura no corpo como chegou,
com o JWE. Se procurasse, cada busca diria ao agente se um texto está dentro do valor que ele não vê, e uma sequência
de buscas o reconstruiria; a busca da API REST e a da tela procuram nele. O `update_url`
mantém o bloco `e2ee`, mas não o muda: a política e as chaves de cifra só pela API e pela tela. Quando `e2ee` vem nos
argumentos do `create_url` ou do `update_url` (inclusive `null`, no `update_url`), ele é ignorado e o resultado traz
`"warnings": ["e2ee ignored: MCP never changes it; ask the person to change it in the UI (Checks › Decryption)."]`;
sem nada ignorado, não há `warnings`. Validação, URL ou mensagem inexistente e limite viram erro de
ferramenta (`isError`) com o status e as mensagens da API: `{"status": 422, "errors": {"timeout": ["The timeout may
not be greater than 10."]}}`, `{"status": 410, "error": "Token not found"}`. Desligado (o padrão), `/mcp` é 404.

Contra DNS rebinding, o `/mcp` confere `Host` e `Origin` com a lista `ANZOL_ALLOWED_HOSTS` (ver [Proteção contra
DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)); com `*` na lista, só o padrão (`localhost`, `127.0.0.1`,
`[::1]` e `host.docker.internal`). URL protegida exige o argumento `read_secret` (ver [Privacidade](privacidade.md#privacidade)).

O servidor não tem autenticação, como o resto da API: quem alcança a porta opera todas as URLs sem segredo de
leitura, inclusive o `send` para a rede local quando `ANZOL_OUTBOUND_ALLOW_PRIVATE=true`. Por isso o compose publica
só em `127.0.0.1`; não ligue o MCP num app publicado.

### Laboratório E2EE

As três ferramentas do laboratório dão a um agente a [decifra de atributo](api.md#decifra-de-atributo-e2ee) em poucos
passos, sem abrir a porta que o `create_url` e o `update_url` fecham (eles ignoram `e2ee`, para que um agente que lê
o payload de terceiros não desligue a decifra nem ponha um remetente dele numa URL que já existe):

- `create_e2ee_lab` só cria URL **nova**, com a marca `lab`, que nenhuma rota troca: segredos gerados (devolvidos só
  aí), chaves de cifra `enc-v1` e `enc-v2`, um remetente de teste cuja privada fica no servidor, a política e as regras
  do laboratório. O agente pode acrescentar JWKs públicas de remetentes (o cliente do convidado, por exemplo).
- `run_e2ee_scenarios` só roda numa URL `lab` (422 nas demais): o servidor gera os 27 vetores, entrega cada um pela
  captura real e devolve esperado × obtido. O resultado nunca traz o texto aberto, só se ele é igual ao enviado.
- `list_e2ee_scenarios` lista o catálogo com o esperado de cada cenário.

Um roteiro para a demonstração, pedido ao agente:

> Crie um laboratório E2EE no Anzol, rode todos os cenários e me mostre quantos conferem e, se algum divergir, qual
> e o que veio no lugar do esperado.

O agente chama `create_e2ee_lab`, depois `run_e2ee_scenarios` com o `token_id` e o `read_secret` devolvidos, e
resume o relatório (`27 de 27 conferem`). Para testar um cliente de fora, passe a JWK pública de assinatura dele em
`trusted_signers` e o cabeçalho do HMAC do canal em `hmac_header`, e entregue as mensagens dele na URL criada.

## IA local

Com `ANZOL_AI_ENABLED=true`, duas rotas usam um LLM local OpenAI-compatível (no `docker-compose.yml`, o
oMLX do Mac, em `host.docker.internal:8000`). Os payloads não saem da máquina, e o
LLM nunca grava nada.

- `POST /token/{id}/rules/suggest` `{"prompt": "responda 429 com Retry-After 5 para POST em /pagamentos", "lang"?:
  "pt-BR", "request_id"?: "<uuid de uma mensagem de exemplo>"}` → `{"rule", "explanation", "attempts", "check"}`. O modelo
  responde com saída estruturada (`json_schema` estrito com a forma da regra) e o mesmo validador do `PUT /rules`
  decide; se a regra for inválida, os erros voltam ao modelo, até 3 tentativas. Sem regra válida: 422
  `{"error", "errors", "attempts"}` com os erros da última. A regra não é gravada: a tela a mostra no editor e quem
  salva é o dono. `prompt` tem de 1 a 2000 caracteres (422 em `prompt`). A resposta traz também `check`, a regra
  conferida pelo servidor, sem o modelo: `example` (a regra contra a mensagem do `request_id`, com as frases do
  `rules/test`; `null` sem ele), `recent` (`{"evaluated", "matched"}` sobre as 500 mensagens mais novas) e `warnings`,
  uma lista de `{"code", "message"}` com `example_not_matched`, `template_disabled` (`{{…}}` com `template` falso),
  `path_never_seen` (nenhuma mensagem recente tem o caminho da regra), `sequence_as_single_rule` (o pedido descreve
  uma sequência e a regra não tem cenário) e `decryption_matches_other_reasons` (`match.decryption: invalid` casa toda
  recusa da decifra: as recentes que a regra casa têm motivo diferente do exemplo, ou mais de um sem exemplo; a
  `message` conta os motivos, os códigos que o servidor gravou na decifra, e nada disso vai ao modelo). Os avisos não
  geram nova tentativa.
- `POST /token/{id}/request/{rid}/explain` `{"lang"?}` → `{"explanation", "facts"}`. O backend monta os fatos (resultado
  da assinatura com o motivo, erros do schema, resultado da decifra com o motivo e as chaves, nunca o valor decifrado;
  regra que respondeu ou near miss com as frases, status dado, cabeçalhos relevantes e até 4 KB do corpo) e o modelo só
  redige, em markdown simples, no idioma de `lang` (padrão `en`). O `kid` de cifra só vai quando é de uma chave que a
  URL tem ou apagou; o de assinatura, só quando é de um signatário confiável, e `signature_kid_trusted` diz se o lido
  era. O `aud` recebido nunca vai: é texto do remetente, e o motivo `aud_mismatch` basta. `attempted` é falso quando o
  HMAC barrou a mensagem antes e a decifra nem foi tentada (`hmac_failed`). Na decifra recusada, `who_fixes` (`sender`,
  `url_configuration` ou `message_altered`) e `advice` dizem quem corrige e o que fazer, escritos pelo servidor a
  partir do motivo e, com `unknown_kid` ou `decrypt_failed`, do `kid_deleted_at` (chave apagada, ou apagada e
  recriada, com a data).

| Variável | Padrão | O que faz |
|---|---|---|
| `ANZOL_AI_ENABLED` | `false` | Liga as rotas; desligada, respondem `503 {"error": "AI is not configured"}` e o resto da API segue igual |
| `ANZOL_AI_BASE_URL` | `http://localhost:8000` | Raiz do servidor, sem o `/v1` (o app chama `{base}/v1/chat/completions`). No compose, `http://host.docker.internal:8000` |
| `ANZOL_AI_API_KEY` | vazia | `Authorization: Bearer`; vazia, o pedido sai sem o cabeçalho. O compose lê de um `.env` ao lado dele, fora do git (permissão 600): **nunca** no compose, no repositório ou no log |
| `ANZOL_AI_MODEL_JSON` | `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit` | Modelo do suggest (saída estruturada) |
| `ANZOL_AI_MODEL_TEXT` | `KAT-Coder-V2.5-Dev-oQ4e-mtp` | Modelo do explain |

```bash
# .env na raiz do repositório (ignorado pelo git): a chave do oMLX
echo 'ANZOL_AI_API_KEY=<chave>' > .env && chmod 600 .env
```

Cada chamada tem até 90 s (temperatura 0, sem retentativa); o app lê só o `content` da resposta (o
`reasoning_content` dos modelos que pensam fica de fora). LLM fora do ar, com erro ou sem resposta no prazo: `502
{"error": "The language model failed: ..."}`, sem afetar a captura nem o resto da API. Por URL, uma chamada de IA por
vez e até 10 por minuto: acima disso, `429` com `Retry-After`. A inicialização não depende da chave nem do LLM.

Riscos:

- **Prompt injection.** O corpo e os cabeçalhos de uma mensagem são escritos por quem mandou o webhook. No explain (e
  na mensagem de exemplo do suggest) eles vão ao modelo fora da mensagem de sistema, entre marcadores com um código
  novo a cada chamada, e o prompt manda tratá-los como dado não confiável e nunca seguir instruções de dentro deles.
  Isso reduz, mas não elimina, o risco de um payload mudar o texto da explicação: os `facts` da resposta, montados
  pelo backend, são a fonte de verdade. O LLM não tem ferramentas nem grava nada, e a regra sugerida só vale depois
  que o dono a salva.
- **Modelo frio.** O oMLX descarrega o modelo ocioso (15 min); a primeira chamada depois disso leva de 9 a 31 s só
  para carregar. O prazo de 90 s cobre isso; acima dele, 502.
- **Memória.** Os modelos dividem a memória unificada do Mac com os outros do dono.
