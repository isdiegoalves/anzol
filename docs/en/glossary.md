# Glossary

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](glossary.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../glossario.md)

The words the Anzol screen and docs use, each with its name in the API, in MCP and in the CLI, and with the name you
may already know it by from another tool. It is for newcomers, and for anyone who met a term on a page and wants to
know what it is.

**On this page:** [The same object, four names](#the-same-object-four-names) · [Capture](#capture) ·
[Response](#response) · [Checks](#checks) · [Privacy](#privacy) · [Outbound and automation](#outbound-and-automation) ·
[Defense lab](#defense-lab) · [Agents and CLI](#agents-and-cli) ·
[Words with more than one meaning](#words-with-more-than-one-meaning)

## The same object, four names

The **URL** is the address Anzol creates to receive your webhooks. A UUID identifies it, and each surface calls that
UUID something different:

| Where | How it appears | Example |
|---|---|---|
| Screen and docs | URL | `http://localhost:8084/<uuid>/…` |
| API | `token`, `{id}` | `GET /token/{id}/requests` |
| MCP | `token_id` | an argument of every tool |
| CLI | `--token` | `anzol listen --token <uuid>` |

Your `<uuid>` is in the top bar of the screen, at the end of the URL, and in the `uuid` field of the `POST /token`
response.

What arrives at the URL also has two names: the screen and the README say **request**; the API reference and MCP say
**message**. In the API the field is `request`, and the identifier is `request_id`.

## Capture

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| URL | An address that records every HTTP request it receives | `POST /token`; `token_id`; `--token` | test endpoint; the unique URL of a webhook inspector; "bin" |
| Request (or message) | One recorded HTTP call: method, path, headers, query and body | `GET /token/{id}/requests`; `request_id`; `list_requests`, `get_request` | captured request |
| Inbox | The screen area with the request list and the detail of each one | screen only | traffic inspector |
| Live capture | The request shows on the screen the moment it arrives | `GET /token/{id}/stream` (SSE), `request.created` event | Server-Sent Events |
| `seq` | The request's order number in the URL: it only grows and is never reused | `seq` field; `?after=<seq>`; `anzol cursor` | cursor; offset |
| Compare | Shows two requests and what differs between them | screen only | diff |
| Auto cleanup | The URL keeps only the N most recent requests | `auto_cleanup` (500, 1000, 5000 or 10000) | retention |
| CORS | Headers that let a page on another address call the URL from the browser | `PUT /token/{id}/cors/toggle` | Cross-Origin Resource Sharing |
| URL circuit | A strip on the screen that shows, in one line, what the request goes through: sender, signature, schema, decryption, rules, response and resend | screen only | flow diagram |
| Guides | Guided steps inside the screen for one use case, such as the retry guide | screen only | guided tutorial |

## Response

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| Default response | What the URL answers when no rule matches | `default_status`, `default_content`, `default_content_type` | the mock's fixed response |
| Response rule | A condition plus a response: if the request matches, the URL answers with the rule's status, headers and body | `GET`/`PUT /token/{id}/rules`; `get_rules`, `set_rules`; `anzol rules pull`/`push` | a mock server stub or mapping, WireMock style |
| Condition (`match`) | The part of the rule that says when it applies: method, path, query, header, body, signature, schema or decryption | `match` | matcher |
| Near miss | The rule that came closest to matching, with the condition that failed | `near_miss`; `closest:` in the CLI | closest rule |
| Scenario (of a rule) | State that makes the same rule answer differently on each call, such as "fail twice, then 200" | `scenario {name, requiredState, newState}`; `/token/{id}/scenarios` | WireMock Scenarios; every scenario starts in `Started` |
| Template | A response body built from the request's data | `response.template` | Handlebars |
| Failure injection | The URL fails on purpose: it delays, resets the connection, stalls the connection or truncates the body | `response.delay`, `response.fault`, `response.dribble` | fault injection; chaos |
| Stalled connection | The connection stays open with no response, or stops after the headers. On the screen: "Hang" and "Stall after headers" | `fault: "hang"`, `fault: "stall_after_headers"` | server-side timeout |
| Dribble | The body goes out in chunks, over a period of time | `response.dribble` | slow response; slow body |
| Chance and time window | The rule applies to only part of the calls, or only between two times | `chance`, `active_from`, `active_until` | intermittent failure |

## Checks

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| Checks | The screen area where the URL turns on what it verifies in each request: signature, schema, decryption and read secret | `signature`, `schema`, `e2ee`, `read_secret` fields of `PUT /token/{id}` | endpoint settings |
| Signature (HMAC) | Proof that the request came from whoever holds the secret and that the body was not altered | `signature`; `signature.reason`; `match.signature` | `Stripe-Signature`; GitHub's `X-Hub-Signature-256` |
| Provider | A ready-made signature format: Stripe, GitHub, Shopify, Slack or generic | `signature.provider`; `--provider` | preset |
| Schema | The format the JSON body must follow | `schema`; `match.schema` | JSON Schema 2020-12 |
| Decryption (E2EE) | The URL opens an attribute the sender encrypted for it alone and checks who signed it | `e2ee`; `decryption`; `decrypted` | JWE and JWS |
| Encryption key | The URL's key pair: the public key goes to the sender, the private key opens the attribute | `POST /token/{id}/keys` | public and private key |
| `kid` | The name that identifies a key | `kid` | Key ID |
| JWKS | The list of the URL's public keys, in JSON | `GET /token/{id}/jwks.json` | an OAuth provider's `jwks.json` |
| Trusted signer | The public key of someone the URL accepts as the author of the encrypted content | `e2ee.trusted_signers` | accepted issuers list |
| Binding | A field of the cleartext envelope that must repeat a value of the signed content | `e2ee.bindings` (`jti`, `evt`, `app`) | claims |
| Health | A Checks card that sums up how the URL is doing over the latest requests. It is not the server's `GET /health` probe | `GET /token/{id}/stats` | status panel |

## Privacy

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| Read secret | The URL's password: without it nobody reads the requests or changes the settings. Capture stays open | `read_secret`; `X-Anzol-Secret` header; `--read-secret` | API key |
| Read-only link | A public address that shows one request, with an expiry and with sensitive values hidden | `POST …/request/{requestId}/share`; `GET /share/{sid}` | share link |
| Masking | Sensitive values replaced by `[redacted]` in the read-only link. On the screen: "Hide sensitive values" | `redact` | data redaction |
| Isolated capture | A URL's response opens in the browser without reaching the Anzol screen or API | `Content-Security-Policy: sandbox …` header | CSP sandbox |
| Unlock cookie | Remembers in the browser that you already gave the read secret | `POST /token/{id}/unlock`, `…/lock` | session |

## Outbound and automation

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| Outbound | The screen area with what the server sent out and the history of it | `GET /token/{id}/outbound`; `get_outbound` | delivery history |
| Replay | The server sends a recorded request to your app and keeps the response. On the screen: "Resend to your app" | `POST …/request/{requestId}/replay`; `replay_request` | resend |
| Send | The server sends a request you put together, signed if you want | `POST /token/{id}/send`; `send_request` | HTTP client |
| Wait | A test waits, with a deadline, for the request to arrive, with no `sleep` | `POST /token/{id}/requests/wait`; `wait_for_request`; `anzol wait-for` | long polling; await |
| Search | Finds requests by text or by the same conditions the rules use | `POST /token/{id}/requests/search`; `search_requests` | filter; query |
| Insights | The screen area with the URL's numbers: methods, signature, schema, rules and requests per hour | `GET /token/{id}/stats` | statistics |

## Defense lab

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| Defense lab | A ready-made URL that receives synthetic traffic, with attacks mixed in, to measure whoever defends | `POST /defense-lab`; `create_defense_lab` | a red team exercise with a scorecard |
| Round | One full measurement: wave 1, verdicts and rules, wave 2, report | `…/defense-lab/rounds`; `start_defense_round`, `finish_defense_round` | run |
| Wave | A batch of requests. Wave 1 is to be judged; wave 2 repeats the attacks with new values, against the rules now in place | no field of its own | batch |
| Answer key | The list of what is an attack and what is legitimate. It stays on the server and shows only in the report | no field; comes in the report | ground truth |
| Defender | Whoever judges and writes the rules: a script, a person or an AI agent | `agent` layer | blue team |
| Verdict | What the defender says about each request: legitimate or attack, and of which family | `POST …/verdicts`; `submit_defense_verdicts` | classification |
| Family | The kind of attack: integrity, compromised sender or prompt injection | `family` | threat category |
| Floor | What the URL's signature check already rejects alone, before any defender | `layer: floor` | baseline |
| Lookalike | A legitimate request that looks like an attack. It measures false positives | no field | edge case |
| Detection | How many wave 1 attacks the defender flagged | `detection` | recall |
| False positive | A legitimate request flagged as an attack | `false_positives` | false alarm |
| Containment | How many wave 2 attacks the rules blocked. A "containable" attack is one a rule can block | `containment`, `containable` | blocking |
| Injection obeyed | The agent did what a text inside the webhook told it to do | `injection.obeyed` | prompt injection |
| Loosening | The defender turned off or weakened the URL's signature or schema check during the round | `loosening` | security regression |
| Seed | A number that fixes the draw: the same seed delivers the same waves | `seed` | random seed |
| Briefing | A text that describes the URL's normal traffic, handed to the defender | `briefing` | task context |

## Agents and CLI

| Term | What it is | In the API, MCP and CLI | You may know it as |
|---|---|---|---|
| MCP | The protocol through which an AI agent operates Anzol over the same routes as the API | `/mcp`; `ANZOL_MCP_ENABLED` | Model Context Protocol; agent tools |
| Local AI | An LLM on your machine suggests a rule and explains the result of a request. It never writes anything | `ANZOL_AI_ENABLED`; `…/rules/suggest`, `…/explain` | a local LLM compatible with the OpenAI API |
| `anzol listen` | Delivers what arrives at the URL to the app you are developing, with no open tab and no CORS | reads `?after=<seq>` and the SSE | `stripe listen` |
| `anzol send` | Plays the provider: fires signed webhooks straight at your app. It does not go through the Anzol server | no route | a provider's test event |
| `anzol wait-for` | Waits for the request to arrive and tells the test whether it did | `requests/wait` | await in a test |
| `anzol test` | The CI test in one command: creates the URL, runs the trigger, waits, checks and deletes | API routes | integration test |
| Trigger | The command, after `--`, that makes your app send the webhook | `{url}`, `ANZOL_URL`, `ANZOL_TOKEN` | trigger |
| Delivery failures | The CLI drops, duplicates, delays or reorders what it delivers to your app | `--chaos-*` options | chaos testing |

## Words with more than one meaning

| Word | Meanings |
|---|---|
| Scenario | The state of a response rule; each of the 27 cases of the E2EE lab; each of the 14 attacks of the defense lab |
| Token | In the API, the URL (`/token/{id}`). In the defense report, `signal: token` is the token an attack asks the agent for |
| Replay | Resending a recorded request. In the defense lab, the attack that repeats a valid message |
| Send | `POST /token/{id}/send` goes through the server. `anzol send` leaves straight from your machine |
| Health | The screen card, per URL. `GET /health` is the server's probe |
| Metrics | In [Operations](operations.md), the server's metrics exported over OTLP. The per-URL numbers on the screen are Insights |
