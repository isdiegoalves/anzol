# MCP e IA local

## MCP

Com `ANZOL_MCP_ENABLED=true` (ligado no `docker-compose.yml`), o app é um servidor
[MCP](https://modelcontextprotocol.io) em `/mcp` (Streamable HTTP, Spring AI 2.0): agentes de IA operam o
Anzol pelas mesmas rotas da API, sem LLM nenhum no app. Para conectar o Claude Code:

```bash
claude mcp add --transport http anzol http://127.0.0.1:8084/mcp
```

São 15 ferramentas:

| Ferramenta | Rota da API |
|---|---|
| `create_url`, `get_url`, `update_url`, `delete_url` | `POST /token`, `GET`/`PUT`/`DELETE /token/{id}` |
| `list_requests`, `get_request`, `search_requests`, `wait_for_request` | `GET /token/{id}/requests`, `GET /token/{id}/request/{rid}`, `POST .../requests/search`, `POST .../requests/wait` |
| `get_rules`, `set_rules`, `test_rule` | `GET`/`PUT /token/{id}/rules`, `POST .../rules/test` |
| `diff_rules` | sem rota: compara a lista proposta (o mesmo argumento do `set_rules`) com as regras salvas, por `id`, e não grava |
| `replay_request`, `send_request`, `get_outbound` | `POST .../request/{rid}/replay`, `POST .../send`, `GET .../outbound` |

O `update_url` muda só o que foi enviado, ao contrário do `PUT /token/{id}` (que troca a configuração inteira): campo
ausente fica como está, e campo enviado como `null` desliga (`signature`, `schema`) ou volta ao padrão.

Os argumentos têm os nomes da API (a URL é sempre `token_id`, a mensagem `request_id`), e o resultado é o JSON que a
rota devolveria, com o segredo de assinatura mascarado. Validação, URL ou mensagem inexistente e limite viram erro de
ferramenta (`isError`) com o status e as mensagens da API: `{"status": 422, "errors": {"timeout": ["The timeout may
not be greater than 10."]}}`, `{"status": 410, "error": "Token not found"}`. Desligado (o padrão), `/mcp` é 404.

Contra DNS rebinding, o `/mcp` confere `Host` e `Origin` com a lista `ANZOL_ALLOWED_HOSTS` (ver [Proteção contra
DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)); com `*` na lista, só o padrão (`localhost`, `127.0.0.1`,
`[::1]` e `host.docker.internal`). URL protegida exige o argumento `read_secret` (ver [Privacidade](privacidade.md#privacidade)).

O servidor não tem autenticação, como o resto da API: quem alcança a porta opera todas as URLs sem segredo de
leitura, inclusive o `send` para a rede local quando `ANZOL_OUTBOUND_ALLOW_PRIVATE=true`. Por isso o compose publica
só em `127.0.0.1`; não ligue o MCP num app publicado.

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
  `path_never_seen` (nenhuma mensagem recente tem o caminho da regra) e `sequence_as_single_rule` (o pedido descreve
  uma sequência e a regra não tem cenário). Os avisos não geram nova tentativa.
- `POST /token/{id}/request/{rid}/explain` `{"lang"?}` → `{"explanation", "facts"}`. O backend monta os fatos (resultado
  da assinatura com o motivo, erros do schema, regra que respondeu ou near miss com as frases, status dado, cabeçalhos
  relevantes e até 4 KB do corpo) e o modelo só redige, em markdown simples, no idioma de `lang` (padrão `en`).

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
