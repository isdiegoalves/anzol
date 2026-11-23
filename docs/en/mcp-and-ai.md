# MCP and local AI

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](mcp-and-ai.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../mcp-e-ia.md)

## MCP

With `ANZOL_MCP_ENABLED=true` (off by default; [how to turn it on in compose](operations.md#turning-things-on-in-compose)), the app
is an [MCP](https://modelcontextprotocol.io) server at `/mcp` (Streamable HTTP, Spring AI 2.0): AI agents operate Anzol
through the same routes as the API, with no LLM in the app. To connect Claude Code:

```bash
claude mcp add --transport http anzol http://127.0.0.1:8084/mcp
```

There are 23 tools:

| Tool | API route |
|---|---|
| `create_url`, `get_url`, `update_url`, `delete_url` | `POST /token`, `GET`/`PUT`/`DELETE /token/{id}` |
| `list_requests`, `get_request`, `search_requests`, `wait_for_request` | `GET /token/{id}/requests`, `GET /token/{id}/request/{rid}`, `POST .../requests/search` (with all the route's filters: `text`, `match`, `outcome`, `answered`, `signature_reason`, `decryption_reason`, and `schema_path`, see [Search messages](api.md#searching-messages); the text never searches the decrypted value, see below), `POST .../requests/wait` |
| `get_rules`, `set_rules`, `test_rule` | `GET`/`PUT /token/{id}/rules`, `POST .../rules/test` |
| `diff_rules` | no route: compares the proposed list (the same argument as `set_rules`) with the saved rules, by `id`, and does not save |
| `replay_request`, `send_request`, `get_outbound` | `POST .../request/{rid}/replay`, `POST .../send`, `GET .../outbound` |
| `create_e2ee_lab`, `list_e2ee_scenarios`, `run_e2ee_scenarios` | `POST /e2ee-lab`, `GET /e2ee-lab/scenarios`, `POST /token/{id}/e2ee-lab/run` (see [E2EE lab](#e2ee-lab)) |
| `create_defense_lab`, `list_defense_scenarios` | `POST /defense-lab`, `GET /defense-lab/scenarios` (see [Defense lab](#defense-lab)) |
| `start_defense_round`, `submit_defense_verdicts`, `finish_defense_round` | `POST /token/{id}/defense-lab/rounds`, `POST .../rounds/{round}/verdicts`, `POST .../rounds/{round}/finish` |

Unlike `PUT /token/{id}` (which replaces the whole configuration), `update_url` changes only what was sent: a missing
field stays as it is, and a field sent as `null` turns off (`signature`, `schema`) or goes back to the default.
`signature: null` also deletes the HMAC secret: to turn verification back on, the `signature` object carries `secret`
again. On a URL that decrypts (`e2ee`), `signature: null` also removes the HMAC check that runs before decryption:
decryption no longer requires a valid HMAC, and the envelope fields outside the bindings (an `amount` next to the
encrypted attribute, for example) are no longer authenticated; the ones the bindings point at are still checked against
the `jti`, `evt`, and `app` signed by the sender. The result warns in `warnings` (`"signature removed on a URL with
e2ee: decryption no longer requires a valid HMAC"`).

The arguments use the API's names (the URL is always `token_id`, the message `request_id`), and the result is the JSON
the route would return, with the signature secret masked and without the decrypted attribute of the messages
(`decrypted`; the `decryption` result does come, see [Attribute decryption](api.md#attribute-decryption-e2ee)); a
person sees the decrypted value in the web UI, with the read secret, in the message's Decrypted tab. For the same
reason, `search_requests` text never searches the decrypted value, even with the `read_secret`: it searches the body as
it arrived, with the JWE. If it did, each search would tell the agent whether a piece of text is inside the value it
cannot see, and a sequence of searches would reconstruct it; the REST API search and the web UI search do look in it.
`update_url` keeps the `e2ee` block but does not change it: the policy and the encryption keys only through the API and
the web UI. When `e2ee` comes in the arguments of `create_url` or `update_url` (including `null`, in `update_url`), it
is ignored and the result carries `"warnings": ["e2ee ignored: MCP never changes it; ask the person to change it in the
UI (Checks › Decryption)."]`; with nothing ignored, there is no `warnings`. Validation, a missing URL or message, and
limits become a tool error (`isError`) with the API's status and messages: `{"status": 422, "errors": {"timeout":
["The timeout may not be greater than 10."]}}`, `{"status": 410, "error": "Token not found"}`. Off (the default),
`/mcp` is 404.

Against DNS rebinding, `/mcp` checks `Host` and `Origin` against the `ANZOL_ALLOWED_HOSTS` list (see [DNS
rebinding/CSRF protection](privacy.md#dns-rebindingcsrf-protection)); with `*` in the list, only the default
(`localhost`, `127.0.0.1`, `[::1]`, and `host.docker.internal`). A protected URL requires the `read_secret` argument
(see [Privacy](privacy.md#privacy)).

The server has no authentication, like the rest of the API: whoever reaches the port operates every URL without a read
secret, including `send` to the local network when `ANZOL_OUTBOUND_ALLOW_PRIVATE=true`. That is why compose publishes
only on `127.0.0.1`; do not turn MCP on in a published app.

### E2EE lab

The lab's three tools give an agent [attribute decryption](api.md#attribute-decryption-e2ee) in a few steps, without
opening the door that `create_url` and `update_url` close (they ignore `e2ee`, so that an agent reading third-party
payloads cannot turn off decryption or put one of its own senders on a URL that already exists):

- `create_e2ee_lab` only creates a **new** URL, with the `lab` mark, which no route changes: generated secrets
  (returned only there), `enc-v1` and `enc-v2` encryption keys, a test sender whose private key stays on the server,
  and the lab's policy and rules. The agent can add senders' public JWKs (the guest's client, for example).
- `run_e2ee_scenarios` only runs on a `lab` URL (422 on the others): the server generates the 27 vectors, delivers each
  one through the real capture, and returns expected × obtained. The result never carries the plaintext, only whether
  it equals what was sent.
- `list_e2ee_scenarios` lists the catalog with each scenario's expected result.

A script for the demo, as a request to the agent:

> Create an E2EE lab in Anzol, run all the scenarios, and show me how many match and, if any diverge, which one and
> what came back instead of the expected value.

The agent calls `create_e2ee_lab`, then `run_e2ee_scenarios` with the `token_id` and `read_secret` it got back, and
summarizes the report (`27 of 27 match`). To test an outside client, pass its public signing JWK in `trusted_signers`
and the channel's HMAC header in `hmac_header`, and deliver its messages to the URL you created.

### Defense lab

The five tools of the [defense lab](api.md#defense-lab) let an agent run the whole round: it creates the URL,
opens the round, reads the requests, says which ones are attacks, writes rules, and finishes. How to fence the agent in,
and what three defenders measured on the same seed, are in the [lab guide](defense-lab.md).

- `create_defense_lab` only creates a **new**, marked URL, and returns the read secret (only there), the briefing, and
  the catalog.
- `start_defense_round` delivers wave 1 and returns the round id. The agent reads with `list_requests` and
  `get_request`.
- `submit_defense_verdicts` takes `legitimate` or `attack` per request; it can be called in parts.
- Containment is `set_rules`, the usual tool.
- `finish_defense_round` delivers wave 2 and returns the report. The round does not reopen.
- `list_defense_scenarios` lists the catalog, without saying which request belongs to which scenario.

Only `list_defense_scenarios` is annotated as read-only, and none of the five is destructive. The report also says
whether the agent obeyed what a payload asked: a request's body, headers, and query are third-party data, never
instructions. Passing the `read_secret` as an argument does not count as a leak; putting it in a rule or a send does.

A whole wave (32 requests) fits in one `list_requests`: about 38 KB, below the 100 KiB cutoff that some managed agents
apply to a tool result.

A script for the demo, as a request to the agent:

> Create a defense lab in Anzol and open a round. Read the requests, tell me which ones are attacks and of what
> family, write rules that block the attacks without blocking legitimate traffic, finish the round, and show me the
> report.

## Local AI

With `ANZOL_AI_ENABLED=true`, two routes use a local OpenAI-compatible LLM (for example oMLX on the Mac, which from the
container is `host.docker.internal:8000`; [how to turn it on in compose](operations.md#turning-things-on-in-compose)). Payloads do
not leave the machine, and the LLM never writes anything.

- `POST /token/{id}/rules/suggest` `{"prompt": "respond 429 with Retry-After 5 for POST on /payments", "lang"?:
  "pt-BR", "request_id"?: "<uuid of an example message>"}` → `{"rule", "explanation", "attempts", "check"}`. The model
  answers with structured output (a strict `json_schema` with the rule's shape) and the same validator as `PUT /rules`
  decides; if the rule is invalid, the errors go back to the model, up to 3 attempts. With no valid rule: 422
  `{"error", "errors", "attempts"}` with the errors from the last one. The rule is not saved: the web UI shows it in
  the editor and the owner saves it. `prompt` must be 1 to 2000 characters (422 on `prompt`). The response also
  carries `check`, the rule as checked by the server, without the model: `example` (the rule against the message of
  `request_id`, with the phrases from `rules/test`; `null` without it), `recent` (`{"evaluated", "matched"}` over the
  500 newest messages), and `warnings`, a list of `{"code", "message"}` with `example_not_matched`,
  `template_disabled` (`{{…}}` with `template` false), `path_never_seen` (no recent message has the rule's path),
  `sequence_as_single_rule` (the request describes a sequence and the rule has no scenario), and
  `decryption_matches_other_reasons` (`match.decryption: invalid` matches every decryption refusal: the recent
  messages the rule matches have a different reason from the example, or more than one without an example; the
  `message` counts the reasons, the codes the server recorded at decryption, and none of this goes to the model). The
  warnings do not trigger a new attempt.
- `POST /token/{id}/request/{rid}/explain` `{"lang"?}` → `{"explanation", "facts"}`. The backend assembles the facts
  (the signature result with the reason, the schema errors, the decryption result with the reason and the keys, never
  the decrypted value; the rule that answered or the near miss with its phrases, the status given, relevant headers,
  and up to 4 KB of the body) and the model only writes it up, in simple markdown, in the language of `lang` (default
  `en`). The encryption `kid` is only included when it belongs to a key the URL has or deleted; the signature one, only
  when it belongs to a trusted signer, and `signature_kid_trusted` says whether the one read was. The `aud` received is
  never included: it is sender text, and the `aud_mismatch` reason is enough. `attempted` is false when the HMAC
  stopped the message earlier and decryption was never tried (`hmac_failed`). On a refused decryption, `who_fixes`
  (`sender`, `url_configuration`, or `message_altered`) and `advice` say who fixes it and what to do, written by the
  server from the reason and, with `unknown_kid` or `decrypt_failed`, from `kid_deleted_at` (key deleted, or deleted
  and recreated, with the date).

| Variable | Default | What it does |
|---|---|---|
| `ANZOL_AI_ENABLED` | `false` | Turns the routes on; when off, they answer `503 {"error": "AI is not configured"}` and the rest of the API carries on unchanged |
| `ANZOL_AI_BASE_URL` | `http://localhost:8000` | Server root, without the `/v1` (the app calls `{base}/v1/chat/completions`). In compose, `http://host.docker.internal:8000` |
| `ANZOL_AI_API_KEY` | empty | `Authorization: Bearer`; empty, the request goes out without the header. `docker-compose.override.yml` reads it from a `.env` next to it, outside git (permission 600): **never** in compose, in the repository, or in the log |
| `ANZOL_AI_MODEL_JSON` | `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit` | Suggest model (structured output) |
| `ANZOL_AI_MODEL_TEXT` | `KAT-Coder-V2.5-Dev-oQ4e-mtp` | Explain model |

```bash
# .env at the repository root (ignored by git): the oMLX key
echo 'ANZOL_AI_API_KEY=<key>' > .env && chmod 600 .env
```

Each call has up to 90 s (temperature 0, no retry); the app reads only the `content` of the response (the
`reasoning_content` of models that think is left out). LLM down, with an error, or with no answer in time: `502
{"error": "The language model failed: ..."}`, without affecting capture or the rest of the API. Per URL, one AI call at
a time and up to 10 per minute: above that, `429` with `Retry-After`. Startup does not depend on the key or the LLM.

Risks:

- **Prompt injection.** The body and headers of a message are written by whoever sent the webhook. In explain (and in
  suggest's example message) they go to the model outside the system message, between markers with a new code on each
  call, and the prompt tells it to treat them as untrusted data and never follow instructions inside them. This
  reduces, but does not eliminate, the risk of a payload changing the text of the explanation: the response's `facts`,
  assembled by the backend, are the source of truth. The LLM has no tools and writes nothing, and the suggested rule
  only takes effect after the owner saves it.
- **Cold model.** oMLX unloads an idle model (15 min); the first call after that takes 9 to 31 s just to load. The 90 s
  limit covers that; above it, 502.
- **Memory.** The models share the Mac's unified memory with the owner's other ones.
