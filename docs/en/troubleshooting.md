# Troubleshooting

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](troubleshooting.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../solucao-de-problemas.md)

Anzol's errors and odd behaviors, grouped by topic, for anyone stuck on one of them. It is a how-to page: each row
says what you see, why it happens and what to do, and ends with the link to the section that has the detail.

**On this page:** [Capture and reading](#capture-and-reading) · [Response and rules](#response-and-rules) ·
[Signature, schema and decryption](#signature-schema-and-decryption) · [CLI](#cli) · [MCP and local AI](#mcp-and-local-ai) ·
[Defense lab](#defense-lab) · [Server and operations](#server-and-operations)

## Capture and reading

What happens when a request arrives at the URL, or when you read the URL on the screen or through the API.

| What you see | Why it happens | What to do |
|---|---|---|
| `410` with `Token not found` on the webhook or on a `/token/{id}/...` route; the screen shows "This URL no longer exists" | The URL was deleted, or it expired: 7 days without use, by default (`ANZOL_EXPIRY`), with the deadline renewed on every use | The screen offers "Create a new URL". [Configuration](operations.md#configuration) |
| `401 {"error":"This URL is protected","protected":true}` on a `/token/{id}/...` route | The URL has a read secret, and the call came without access. Capture on `/{id}/...` does not change | Send the `X-Anzol-Secret: <secret>` header (CLI, scripts), or unlock the URL on the screen (cookie). [Read secret](privacy.md#read-secret) |
| `429` with `Retry-After` and `Too many wrong secrets for this URL; try again later`; the screen says "Too many attempts. Try again in …" | More than 10 wrong secrets per minute on the URL, unlock and header added together (MCP has its own counter). The `429` also applies to the right secret | Wait for the `Retry-After`, until the minute is over. The unlock cookie does not go through this limit. [Read secret](privacy.md#read-secret) |
| The screen says "No signal from the server since …. The list may be incomplete." | The server stopped sending the `ping` the stream carries every 15 s | The screen reconnects by itself: it shows "Trying again in … s" and the "Try again now" button. [Requests](api.md#requests) |
| `GET /share/{sid}` answers `404`; the screen shows "This link is not available" | The link expired, was revoked, belongs to a deleted request or URL, or does not exist. Setting, changing or removing the read secret revokes all of the URL's links | "Ask whoever shared it for a new link." (screen). [Read-only links](privacy.md#read-only-links) |
| `507` with `Storage is full; the request was not stored.`; the screen says "Storage is full since …: new requests are being refused." | Redis reached `--maxmemory 1gb` with `noeviction`: it refuses writes instead of deleting keys. What is already stored stays readable | `ANZOL_MAX_REQUESTS` and `auto_cleanup` limit each URL. Once memory is freed, the warning stays until a request is stored and 30 s pass without another refusal; then the screen says "Storing again." [Redis memory](operations.md#redis-memory) |
| HTML page `413 Request Entity Too Large` | The request body went over 1 MiB | The limit is 1 MiB; `POST /token/{id}/send` accepts up to 2 MiB, because of the JSON around it. [Replay and server-side send](api.md#replay-and-server-side-send) |
| You asked for a status in the path (`/{id}/600`, `/{id}/0/404`) and the URL answered the default status | Only the segment right after the UUID counts, when it is a status from 200 to 599. Otherwise the URL's default applies, and without one, 200 | `/404`, `/404/extra` and `/500/` work; `/600`, `/20`, `/0/404` and free paths use the default. [URL](api.md#url) · [Contract coverage (in pt-BR)](../../tests/contract/README.md#o-que-cobre) |
| An error in an HTML page instead of the JSON envelope | The `{success: false, error: {message, id: null}}` envelope goes only to a JSON client. The `413` is always HTML | A JSON client is one that sends `Accept: application/json`, `X-Requested-With: XMLHttpRequest` or an `application/json` body. [Contract coverage (in pt-BR)](../../tests/contract/README.md#o-que-cobre) |
| `422` with `The timeout may not be greater than 10.` when creating or editing the URL | The URL's `timeout` goes from 0 to 10 s | The limit is 10 s. A response rule's `delay` goes up to 60000 ms. [URL](api.md#url) · [Delays and network failures](api.md#delays-and-network-failures) |

## Response and rules

What the URL answers when it has response rules, scenarios, failure injection or a template.

| What you see | Why it happens | What to do |
|---|---|---|
| The URL answered the default, and your rule did not apply | No active rule matched. The request stores the near miss in `near_miss`: the rule with the fewest failing conditions, with one phrase per condition, such as `method: expected POST, got GET` | Read `near_miss.failed` on the request. `POST /token/{id}/rules/test` says which of the 500 most recent requests the rule would match. [Rule that answered and near miss](api.md#rule-that-answered-and-near-miss) |
| A rule saved with no error, and the response came out `200` | `status` at the rule level, outside `response`: the server accepts it, ignores the field and answers 200 | Put the status in `response`: `{"response": {"status": 400}}`. [Rule-shape pitfalls](defense-lab.md#rule-shape-pitfalls) |
| A rule with `regex` does not match | `regex` is Java syntax and must match the whole value (`.` crosses lines) | Cover the whole value, with `.*` around it: `"body": [{"regex": ".*\"amount\":[0-9]{7,}.*"}]`. [Rule-shape pitfalls](defense-lab.md#rule-shape-pitfalls) |
| `422` when saving a rule with `match.signature` as an object | `match.signature` is text: `valid`, `invalid` or `absent` | Use `"signature": "invalid"`, and another rule with `"signature": "absent"`. [Rule-shape pitfalls](defense-lab.md#rule-shape-pitfalls) |
| The rule with `"signature": "invalid"` lets through the request with no signature header | `invalid` does not cover the missing header: that is `absent` | Save both rules, `invalid` and `absent`. [Rule-shape pitfalls](defense-lab.md#rule-shape-pitfalls) |
| The scenario rule does not match; `near_miss` says `scenario delivery: expected state "delivered", got "Started"` | The URL's scenario is in another state. Every scenario starts in `Started` | `DELETE /token/{id}/scenarios` puts them all back in `Started`; `PUT /token/{id}/scenarios/{name}` with `{"state": "..."}` sets a state. [Scenarios](api.md#scenarios) |
| The URL's `timeout` and `Retry-After` do not show in the response | When a rule answers, they do not apply. `X-Request-Id`, `X-Token-Id` and the CORS headers stay | The rule's response has its own `headers` and `delay`, in `response`. [Response rules](api.md#response-rules) |
| `503` with `X-Fault-Limit` (`16 held connections on this URL` or `128 held connections on this server`) | `hang` and `stall_after_headers` hold at most 16 connections per URL and 128 on the server. Above that, the request is stored with the rule and `response: {"status": 503}` | The limit is 16 per URL and 128 on the server. Each stalled connection closes when the client gives up or at the `ANZOL_FAULT_HOLD_MAX` cap (default 300 s). [Delays and network failures](api.md#delays-and-network-failures) |
| `500` with `The template is invalid: longer than 65536 characters.` on a rule that used to answer | The rule was saved before the template caps that are checked on save. The request is still stored | Save the rule within the caps. [Caps](api.md#caps) |
| `500` with `The rendered template is too large.` (the request stays stored) | Rendering went over a cap: the body, each header, or the headers added together | The caps are 1 MiB for the body, 8 KiB per header and 32 KiB for the rendered headers added together. [Caps](api.md#caps) |
| `500` with `The template took too long to render.` | Rendering the response took more than 1 s, as in a nested `each` that spins without producing output | The cap is 1 s to render the body and the headers, after compiling. [Caps](api.md#caps) |

## Signature, schema and decryption

What the URL's Checks store on each request: signature, schema and decryption.

| What you see | Why it happens | What to do |
|---|---|---|
| Invalid signature with `signature mismatch` | The HMAC does not match: a different secret on each side, or the body was altered on the way. The computation runs over the body bytes as they arrived | "Check that the HMAC secret here is the sender's; if it is, something on the way altered the body." (screen; with a provider, the sentence names it). [Signature verification](api.md#signature-verification) |
| Signature with `header X-Hub-Signature-256 absent` (the name changes with the provider) | A header the check requires is missing; on Slack, the signature or the timestamp | On Generic: "The sender did not sign, or the header configured here is another." (screen). With a provider, the screen says it did not sign (no secret set there). [Signature verification](api.md#signature-verification) |
| Invalid signature with `malformed header` | The header is not in the provider's format: no `t` or `v1`, no `sha256=`, `v0=` or `prefix`, or invalid hex or base64 | On Generic, the screen says to compare the Prefix and the Encoding in Checks › Signature with the header that arrived: off the agreed format, the sender fixes it; otherwise, adjust it here. With a provider, it says to confirm the sender is that provider, or to use Generic. [Signature verification](api.md#signature-verification) |
| Invalid signature with `timestamp outside tolerance (412 s)` | The signature matches, but the timestamp is more than `toleranceSeconds` (default 300) from now. Only on `stripe` and `slack` | The screen points to "late redelivery or a wrong clock; or raise the tolerance". `toleranceSeconds` goes from 1 to 86400. [Signature verification](api.md#signature-verification) |
| `422` with `{"schema": ["The schema is invalid: …."]}` | The schema is not an object, is over 64 KB, has a `$schema` of another dialect, does not follow the meta-schema, or has a `$ref` that does not resolve or is not internal | Valid is an object of up to 64 KB (compact JSON), in 2020-12, 2019-09 or draft-07, with `$ref` only to the document itself (`#`, `#/$defs/…`). [Schema validation](api.md#schema-validation) |
| `format` in the schema rejects nothing | In 2020-12 and 2019-09, `format` is only an annotation | In draft-07, `format` is checked: `$schema` `http://json-schema.org/draft-07/schema#`. [Schema validation](api.md#schema-validation) |
| Decryption `invalid` with `hmac_failed` | The URL checks the HMAC signature before decrypting; with it invalid or missing, decryption is not even attempted | "Check the HMAC signature first: decryption only runs after it." (screen). [Decryption result](api.md#decryption-result) |
| Decryption `invalid` with `downgrade` | With `required` at `true`, the default, an attribute that is not a JWE is a failure, never accepted text | "The sender sent it in plaintext, or the encrypted attribute set here points at another field." (screen). With `required: false`, it passes as `absent`. [Attribute decryption (E2EE)](api.md#attribute-decryption-e2ee) |
| Decryption `unknown_kid` or `decrypt_failed` with `kid_deleted_at` filled in | The sender encrypted to a key the URL deleted, or to the one that had the same `kid` before it was recreated | The sender needs to download the JWKS again (`GET /token/{id}/jwks.json`). [Decryption result](api.md#decryption-result) |
| Decryption `unknown_kid` with `kid_deleted_at` `null` | The URL has no record of deleting that key: the sender encrypted to another recipient | "Check which JWKS the sender uses." (screen). [Decryption result](api.md#decryption-result) |
| `422` with `The e2ee requires a read secret on this URL (read_secret).` | Turning on decryption (`e2ee`) requires a read secret on the URL | Send `read_secret` along with `e2ee`, in `POST /token` or in `PUT /token/{id}`. [Attribute decryption (E2EE)](api.md#attribute-decryption-e2ee) |
| `422` with `The read secret cannot be removed while this URL has decrypted requests; delete them first.` | Some request of the URL keeps the decrypted attribute (`decrypted`), even with decryption already off | Delete those requests first (`DELETE /token/{id}/request/{rid}`, or all of them with `DELETE /token/{id}/request`), or keep the secret. [Read secret](privacy.md#read-secret) |

## CLI

What the `anzol` CLI prints when something goes wrong, with the exit code.

| What you see | Why it happens | What to do |
|---|---|---|
| `This URL is protected: pass --read-secret or set ANZOL_READ_SECRET` on stderr; exit 1 (2 in `wait-for` and `test`) | The URL has a read secret, and the CLI did not send the right one | Pass `--read-secret <secret>` after the subcommand, or the `ANZOL_READ_SECRET` variable. Printable ASCII only. [CLI and MCP](privacy.md#cli-and-mcp) |
| `Too many wrong read secrets for this URL; try again in a minute` | More than 10 wrong secrets per minute on the URL, unlock and header added together | Wait for the minute to end: until then, the block also applies to the right secret. [Read secret](privacy.md#read-secret) |
| A `POST /orders/43 -> error: connection refused` line in `listen` | The local app is down or has a network error. The request is not forwarded again | The CLI keeps listening. To resend the recorded one: `anzol replay <token> <requestId> --to http://localhost:3000`. [Errors](cli.md#errors) |
| `anzol listen` does not deliver what arrived before it started | Only the requests that arrive after `listen` starts are forwarded | `anzol replay` resends recorded requests, in the order given. [`anzol replay`](cli.md#anzol-replay) |
| A `Reconnected; forwarding 2 missed request(s)` line | The connection to the server dropped and came back | `listen` reconnects by itself (waits 1 s, 2 s, 4 s… up to 30 s) and forwards, in order and without repeating, the requests that arrived during the drop. [Errors](cli.md#errors) |
| `Could not reach …: …` | The CLI did not reach the server; in `wait-for` and `test`, exit 2 | The server comes from `--server`, otherwise from `ANZOL_SERVER`, otherwise it is `http://localhost:8084`. [Server](cli.md#server) |
| The line ends in `[files were not forwarded: not stored by the server]` | The server does not keep multipart files or the raw multipart body, only the text fields | It is a limitation: only the multipart text fields are forwarded. [Limitations](cli.md#limitations) |
| `--chaos-abort works only with an http:// target`; exit 2 | The `--chaos-abort` cut is made on the socket, without TLS | Use an `http://` target. [Delivery failures](cli.md#delivery-failures-listen-and-replay) |
| `anzol wait-for` exits with 1 and prints `timed out after … ms: 0/1 matched`, `closest: #<seq> <uuid>` and `- method: expected DELETE, got POST` | The deadline ran out with no matching request. `closest` is the one that came nearest | Read the `- <phrase>` lines under `closest`: one per condition of the `match` that request did not meet. [`anzol wait-for`](cli.md#anzol-wait-for) |
| `anzol test` exits with 3 | The trigger did not start or exited with a code other than 0, and the wait does not begin | The `trigger:` line says how it exited; the trigger's stdout and stderr go to the stderr of `anzol test`. [`anzol test`](cli.md#anzol-test) |
| `anzol rules push` prints `0.match.path.regex: The regex is invalid.` and exits with 1 | The server refused the rules (422), and nothing changes on the URL | Each line is `key: message`, with the key in dot notation from the list index; `rules` when the file is not a list. `--dry-run` does not validate. [`anzol rules pull` and `anzol rules push`](cli.md#anzol-rules-pull-and-anzol-rules-push) |

## MCP and local AI

What the MCP server and the two local AI routes answer when they are off, protected or at their limit.

| What you see | Why it happens | What to do |
|---|---|---|
| `/mcp` answers `404` | MCP comes off (`ANZOL_MCP_ENABLED=false`), in the compose too | Set `ANZOL_MCP_ENABLED=true` in a `docker-compose.override.yml` and run `docker compose up -d` again; `GET /health` shows `"mcp":"on"`. Do not turn on MCP in a published app. [Turning things on in compose](operations.md#turning-things-on-in-compose) |
| A tool returns an error (`isError`) with `{"status":401,"error":"This URL is protected; pass its read_secret"}` | The URL has a read secret, and the `read_secret` argument is missing or wrong | Pass `read_secret` to the tool. In `update_url`, it is only the access: the URL's secret does not change there. [CLI and MCP](privacy.md#cli-and-mcp) |
| A tool returns `429` with `This URL is protected and got too many wrong secrets; try again in … s` | A wrong MCP `read_secret` has its own counter, apart from the screen's and the CLI's: 10 failures per minute on the URL | Wait the seconds in the message. The screen and the CLI keep opening the URL. [Read secret](privacy.md#read-secret) |
| An AI route answers `503 {"error": "AI is not configured"}`; the screen says "This server has no local AI." | `ANZOL_AI_ENABLED` is `false`, the default. The rest of the API stays the same | Set `ANZOL_AI_ENABLED=true` and `ANZOL_AI_BASE_URL` in the `docker-compose.override.yml`; `GET /health` shows `"ai":"on"`. [Variables](mcp-and-ai.md#variables) · [Turning things on in compose](operations.md#turning-things-on-in-compose) |
| An AI route answers `502 {"error": "The language model failed: ..."}`; the screen says "The local model did not answer…" | The LLM is down, returned an error or did not answer within 90 s, with no retry. A cold model on oMLX takes 9 to 31 s just to load | "Check that it is running and reachable from the server, then try again." (screen). Capture and the rest of the API are not affected. [Limits and failures](mcp-and-ai.md#limits-and-failures) · [Risks](mcp-and-ai.md#risks) |
| An AI route answers `429` with `Retry-After`; the screen says "Too many AI calls for this URL (up to 10 per minute, one at a time)." | Per URL, one AI call at a time and up to 10 per minute | Wait for the `Retry-After`. [Limits and failures](mcp-and-ai.md#limits-and-failures) |

## Defense lab

What the defense lab answers when you create the URL and open and finish the round, and what brings containment down.

| What you see | Why it happens | What to do |
|---|---|---|
| The report shows low or zero containment, with the attacks detected | A rule of the wrong shape: `status` outside `response`, a `regex` that does not cover the whole value, an exact wave 1 value, a forgotten `absent` rule | Check the rule with `GET /token/{id}/rules` and test it with `test_rule` (MCP) or `POST /token/{id}/rules/test`. [Rule-shape pitfalls](defense-lab.md#rule-shape-pitfalls) |
| `422` in `defense_lab` with `There are already 20 active defense lab URLs; delete one or wait.` | The server accepts up to 20 active defense labs. The URL counts as active for 30 min after it is created and after each round it opens | Delete a lab or wait for a slot to expire. In 0.9.5, the slot lasts the URL's 24 h of life. [Defense lab](api.md#defense-lab) · [Limits](defense-lab.md#limits) |
| `422` in `defense_lab` with `This is not a defense lab URL: create one with POST /defense-lab.` | The round only runs on a URL created by `POST /defense-lab` | Create the URL with `POST /defense-lab` and open the round on it. [Errors and limits](api.md#errors-and-limits) |
| `409` with `This URL already has an open round; finish it first` | A URL has one open round at a time | Finish the open round with `POST .../rounds/{round}/finish` before opening another. [The round](api.md#the-round) |
| `409` with `This round is still open; finish it to get the report` | The report only comes from a finished round | Finish the round with `POST .../rounds/{round}/finish`, which returns the report. [Report](api.md#report) |
| `409` with `This round is already finished` | `verdicts` and `finish` only work on an open round, and a finished round does not reopen | Its report is at `GET /token/{id}/defense-lab/rounds/{round}`. [Errors and limits](api.md#errors-and-limits) |
| `429` with `Retry-After` and `Too many defense rounds for this URL; try again later` | More than 6 rounds in a minute on the URL | Wait for the `Retry-After`. [Errors and limits](api.md#errors-and-limits) |
| `429` with `Retry-After` and `There are already 20 active defense lab URLs; delete one or wait.` when opening the round | The URL's slot expired, and the server already has 20 active defense labs | Wait for the `Retry-After`, which lasts until the first slot expires. [Errors and limits](api.md#errors-and-limits) |
| `start_defense_round` opened with a seed other than the one asked for | The server accepts fields it does not know: the wrong argument in place of `seed` opens the round with a drawn seed | Check the seed in the report. [Limits](defense-lab.md#limits) |

## Server and operations

What the server answers because of its configuration: health, accepted names and outbound to the network.

| What you see | Why it happens | What to do |
|---|---|---|
| `403 {"error":"host not allowed"}`: the screen opens, but the API answers 403 | The name in `Host` is not in `ANZOL_ALLOWED_HOSTS`, the DNS rebinding protection of the management routes and of `/mcp` | Add the name to the list (in Helm, `anzol.allowedHosts`). `*` turns off the management check and is insecure: any page open in the browser gets to use the API. `/mcp` stays on the default. [DNS rebinding/CSRF protection](privacy.md#dns-rebindingcsrf-protection) |
| `403 {"error":"origin not allowed"}` on a `POST`, `PUT`, `PATCH` or `DELETE` | The `Origin` is not this server: another port, or a name outside the list. On `/mcp`, the `Origin` is checked on every method | For a screen served on another port, write `name:port` in the list, such as `localhost:4200`. [DNS rebinding/CSRF protection](privacy.md#dns-rebindingcsrf-protection) |
| Replay or send returns `200` with `error.kind` `blocked` and `destination not allowed or not resolvable`; the screen shows "Blocked" | By default (`ANZOL_OUTBOUND_ALLOW_PRIVATE=false`), the server only goes out to a public address. A name that does not resolve gives the same message | For an app on your machine: `ANZOL_OUTBOUND_ALLOW_PRIVATE=true` and `ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal` in the compose override. **Do not publish the app like that.** [Replay and server-side send](api.md#replay-and-server-side-send) · [Turning things on in compose](operations.md#turning-things-on-in-compose) |
| Replay or send returns `429` with `Retry-After`; the screen says "Too many sends from this URL (30 per minute)." | More than 30 dispatches per minute on the same URL, replay and send added together | Wait for the `Retry-After`. [Replay and server-side send](api.md#replay-and-server-side-send) |
| `GET /health` answers `503` with `"status": "unavailable"` and `"redis": "down"`; `docker ps` shows `(unhealthy)` | Redis did not answer a `PING` within 2 s. After three reads without the 200, the `HEALTHCHECK` marks `(unhealthy)` | The `PING` deadline is 2 s. `GET /version` answers even with Redis down; on Kubernetes, the pod leaves the Service, and the liveness does not restart it. [Health and version](operations.md#health-and-version) · [What the chart brings up](helm.md#what-the-chart-brings-up) |
