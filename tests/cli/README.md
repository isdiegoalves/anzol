# Aceite caixa-preta do CLI

Testes `node --test` (Node 24, sem dependências) que rodam o script do CLI como processo contra o
app real e conferem, por fora, o que chega ao "app local" e o que o CLI imprime. Ninguém edita estes
testes para o CLI passar: o formato das linhas é contrato.

## Como rodar

Pré-requisitos: Node 24+, o app no ar (`docker compose up -d --build` na raiz, porta 8084) e o CLI
instalado.

```bash
cd cli && ./gradlew installDist && cd ..
node --test tests/cli/*.test.mjs        # ou: cd tests/cli && node --test
```

O Node 24 não expande diretório no `--test` (`node --test tests/cli/` procura um módulo com esse
nome); use o glob acima ou rode de dentro da pasta.

| Variável | Padrão | Uso |
|---|---|---|
| `WEBHOOK_CLI` | `cli/build/install/webhook/bin/webhook` (relativo à raiz do repo) | Script do CLI sob teste |
| `WEBHOOK_SERVER` | `http://localhost:8084` | App real (só `http://`); também herdado pelo CLI |

Sem o CLI, cada teste falha com `CLI não encontrado em …; rode ./gradlew installDist`; sem o app,
com `servidor webhook.site não responde em …`.

Cada teste cria os próprios tokens e os apaga ao fim, passe ou falhe (`DELETE /token/{id}/request`
e depois `DELETE /token/{id}`), inclusive a URL que o `listen` sem `--token` cria: todo uuid que esse
CLI imprimiu atrás de uma barra é apagado.

## Infra (`support/`)

- `cli.mjs`: o CLI como processo filho, stdout e stderr linha a linha, espera por regex com prazo
  (a falha traz a saída do CLI), SIGINT/SIGKILL ao fim; regex das linhas da especificação.
- `capturador.mjs`: o app local, servidor HTTP que guarda método, caminho+query, cabeçalhos crus e
  corpo em bytes; leitor de multipart.
- `proxy.mjs`: proxy TCP entre o CLI e o app real; `derrubar()` corta as conexões e fecha a porta,
  `religar()` volta na mesma porta. Ganchos opcionais: `aoEvento(evento)` roda depois de cada evento
  `request.created` entregue ao CLI, com o SSE parado até ele terminar (derrubar ali corta logo depois
  daquele evento); `antesDaResposta(linha)` pode devolver uma função que roda quando a resposta de
  uma requisição da API já saiu do servidor e ainda não chegou ao CLI.
- `servidor.mjs`: API de tokens e mensagens, webhook por HTTP cru (cabeçalho repetido, underscore,
  hop-by-hop, chunked) e assinatura do SSE; `rajada` (N POSTs com no máximo P em voo) e
  `mensagensPorSeq` (todas as mensagens por `after=<seq>` a partir de 0, a ordem que o reenvio deve
  seguir; falha se a API não devolve `seq`).
- `conferencia.mjs`: a regra de reenvio conferida contra a mensagem gravada, lida pela API.

## O que cobre

| Teste | Critério |
|---|---|
| `listen.test.mjs` CA-1 | `listen` sem `--token` imprime URL nova que existe no servidor; POST chunked com query e caminho extra chega com o mesmo método, `<forward>` + caminho após o token + query crua da `url` gravada, corpo idêntico e cabeçalhos gravados, menos `connection`, `keep-alive`, `te`, `trailer`, `upgrade`, `proxy-*` (não chegam com o valor gravado), `host` (vira o do `--forward`) e `content-length` (recalculado, sem `transfer-encoding`); linha com o status do app (201) e ms ≥ o atraso do app |
| `listen.test.mjs` CA-2 | `--token` usa a URL existente; token inexistente → `Token not found` no stderr e saída 1 |
| `robustez.test.mjs` CA-3 | ~1 MB com `/` e não-ASCII (o evento SSE vem `truncated`, conferido): o app recebe o corpo inteiro, byte a byte |
| `robustez.test.mjs` CA-4 | app local fora (porta recusando) → linha `error:`, o CLI segue vivo e a mensagem seguinte chega |
| `reconexao.test.mjs` CA-5 | o proxy cai, 3 mensagens chegam ao servidor na queda, o proxy volta: `Reconnected; forwarding 3 missed request(s)` e o app recebe exatamente `antes, faltou-1..3, depois`, em ordem, sem duplicar |
| `replay.test.mjs` CA-6 | `replay <token> <id> --to <url>` entrega a mesma requisição que o `listen` entregou (e a regra de reenvio), imprime a linha e sai com 0 |
| `robustez.test.mjs` CA-7 | multipart com arquivo → multipart com os campos de texto gravados (boundary coerente), sem arquivo, e o sufixo ` [files were not forwarded: not stored by the server]` |
| `listen.test.mjs` CA-8 | GET, PUT, PATCH, DELETE e HEAD com o método certo; `X-Dup: a` + `X-Dup: b` chega como o servidor grava (`b`), `X_Custom_Under` chega como `x-custom-under` |
| `listen.test.mjs` Ctrl+C | SIGINT no processo → saída 0 (parte observável do CA-9) |
| `ordem.test.mjs` CA-10 | rajada de 60 POSTs com 30 em paralelo; o proxy corta logo depois do primeiro evento SSE que chega antes de outro mais antigo ainda não entregue (ou do 25º, se nada inverter) e volta 1 s depois: o app recebe as 60 exatamente uma vez, na ordem de `seq` |
| `ordem.test.mjs` CA-11 | rajada de 60 com 30 em paralelo, sem queda: o app recebe as 60 uma vez, na ordem de `seq` (não na do SSE) |
| `ordem.test.mjs` CA-12 | 120 mensagens na queda; na primeira listagem da recuperação (resposta já montada, ainda não entregue) as 3 mais novas são apagadas: as outras 117 chegam todas, uma vez, na ordem de `seq` |
| `ordem.test.mjs` CA-13 | 3 mensagens antes do `listen`, no mesmo segundo; na queda a mais nova (o cursor) é apagada e chega `/depois`: o app recebe só `/depois` e a linha diz `forwarding 1` |

## Leituras da especificação assumidas

- `--server` vem depois do subcomando (`webhook listen --server … --forward …`).
- `Listening on …` só aparece com a assinatura do SSE pronta: o teste manda o webhook logo depois.
- Linhas casadas por inteiro (`^…$`), sem prefixo. Em `<caminho?query>` vale qualquer texto sem
  espaço que termine no caminho após o token + query gravada (o CLI pode imprimir o token ou a URL
  inteira). Linhas de mensagem podem sair no stdout ou no stderr; `Token not found`, só no stderr.
- `Reconnected; forwarding <n> …` conta as mensagens gravadas durante a queda.
- `replay` com sucesso sai com 0.
- Ordem de reenvio = ordem de `seq` da API (`after=0` depois da rajada), não a ordem de disparo nem
  a do SSE. Os testes de `ordem.test.mjs` exigem a API com `seq` e `after` (ver
  `tests/contract/README.md`); contra um app sem isso falham em `mensagensPorSeq`.
- CA-12: as mensagens apagadas durante a recuperação podem chegar ou não (o CLI pode já tê-las lido);
  se chegarem, é uma vez e no lugar delas na ordem de `seq`. A recuperação precisa passar por
  `GET /token/{id}/requests` (é onde o proxy apaga).
- CA-13: o cursor apagado não conta como perdido: `Reconnected; forwarding 1 missed request(s)`.
