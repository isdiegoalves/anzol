# CLI

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](cli.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../cli.md)

Reference for the `anzol` CLI, for developers of an app that receives webhooks. It delivers to your app what reaches
the [URL](glossary.md#the-same-object-four-names), downloads and uploads the [response rules](api.md#response-rules)
and, with `send`, plays the provider. With `wait-for`, an automated test waits for the webhook with no `sleep`; with
`test`, the whole CI test fits in one command.

**On this page:** [Install](#install) · [`listen`](#anzol-listen) · [`replay`](#anzol-replay) ·
[Delivery failures](#delivery-failures-listen-and-replay) · [`rules`](#anzol-rules-pull-and-anzol-rules-push) ·
[`send`](#anzol-send) · [`wait-for`](#anzol-wait-for) · [`cursor`](#anzol-cursor) · [`test`](#anzol-test) · [Server](#server) ·
[What is forwarded](#what-is-forwarded) · [Limitations](#limitations)

## Install

Runs on Java 21 or newer. To build it, use JDK 25 (Gradle uses it as the toolchain and generates Java 21 classes).

```bash
cd cli && ./gradlew installDist
# the script ends up in cli/build/install/anzol/bin/anzol; put the bin folder on your PATH or call it by path
```

## `anzol listen`

Delivers the webhooks that reach the URL straight to the app you are developing, like `stripe listen`: no open tab and
no CORS. Each stored [request](glossary.md#capture) is sent again to `<forward>` + the path after the token + the
query, one at a time, in the order the server stored them ([`seq`](glossary.md#capture)).

Only the requests that arrive after `listen` starts are forwarded.

### Example

```bash
anzol listen --forward http://localhost:3000             # creates a new URL and prints it
anzol listen --forward http://localhost:3000 --token <uuid>   # uses a URL that already exists
```

### Output

```
Listening on http://localhost:8084/9f3c…e21a (forwarding to http://localhost:3000)
14:02:07 POST /orders/42?source=stripe -> 200 (12 ms)
14:02:09 POST /upload -> 201 (8 ms) [files were not forwarded: not stored by the server]
14:02:15 POST /orders/43 -> error: connection refused
Reconnected; forwarding 2 missed request(s)
```

The line shows the status the local app answered and the time. Whoever sent the webhook already got the response
configured on the URL: the local app's response only shows up in the line.

Ctrl+C exits with 0.

### Errors

- Local app down or with a network error: an `error:` line, and the CLI keeps listening (the request is not forwarded
  again; use `replay`).
- Lost connection to the server: it reconnects by itself (waits 1 s, 2 s, 4 s… up to 30 s) and forwards, in order and
  without repeats, the requests that arrived during the outage. A connection that stops delivering without closing is
  treated as dropped after 45 s with no line at all (the server sends a heartbeat every 15 s).
- Nonexistent token (or deleted during an outage): `Token not found` on stderr and exit 1.

### Order and delivery guarantee

The SSE event is only the notice that a request arrived: the CLI reads the requests from the listing
`after=<seq of the last one handled>`, which returns them whole and in order (even the ones above 1 MB, whose event
arrives truncated, and the ones from simultaneous bursts, whose events come out of order). A request deleted before
it was read is not forwarded; the others are not lost. It needs a server with `seq` and `after` (this version).

## `anzol replay`

Replays stored requests, just like `listen`, and prints the same line for each one.

```bash
anzol replay <token> <requestId> --to http://localhost:3000
anzol replay <token> <id1> <id2> <id3> --to http://localhost:3000   # several, in the order given
```

It exits with 0 when the local app answered (any status) and with 1 on `error:`, `Token not found` or
`Request not found` (in which case nothing is delivered).

## Delivery failures (`listen` and `replay`)

To see what your app does when the webhook arrives badly, `listen --forward` and `replay` inject
[delivery failures](glossary.md#agents-and-cli) into the delivery to the local app: a request that vanishes, arrives
twice, arrives late, arrives out of order, gets cut in the middle of the body, trickles in, or that the "provider" gives
up waiting for and sends again. Without any of these options, nothing changes.

### Example

```bash
# half of the messages arrive twice; the same seed repeats the same duplicates
anzol listen --forward http://localhost:3000 --chaos-duplicate 50 --chaos-seed 7

# delay, truncated body and retry with backoff, the way a provider would
anzol listen --forward http://localhost:3000 --chaos-delay 200..800 --chaos-abort 20 --retries 3

# three stored messages, delivered out of order
anzol replay <token> <id1> <id2> <id3> --to http://localhost:3000 --chaos-reorder 3
```

With an app that answers 409 to a repeated `X-Request-Id`:

```
Listening on http://localhost:8084/9daa…7c10 (forwarding to http://localhost:3000)
Chaos: duplicate 50%; seed 7
12:56:58 POST /orders/1 -> 200 (5 ms)
12:56:59 POST /orders/2 -> 200 (1 ms)
12:56:59 POST /orders/2 -> 409 (0 ms) [chaos: duplicate]
12:56:59 POST /orders/3 -> 200 (1 ms)
12:56:59 POST /orders/3 -> 409 (0 ms) [chaos: duplicate]
12:56:59 POST /orders/4 -> 200 (1 ms)
```

And the second example, with `--chaos-seed 7` and an app that asks for `Retry-After: 1` once:

```
Chaos: delay 200..800 ms, abort 20%, retries 3; seed 7
12:58:49 POST /orders/1 attempt 1/4 -> 200 (5 ms) [chaos: delay 625 ms]
12:58:50 POST /orders/2 attempt 1/4 -> 503 (1 ms), retrying in 1000 ms (Retry-After) [chaos: delay 313 ms]
12:58:51 POST /orders/2 attempt 2/4 -> 200 (1 ms)
12:58:53 POST /orders/7 attempt 1/4 -> cut after 17 of 34 bytes, retrying in 991 ms [chaos: delay 307 ms, abort]
12:58:54 POST /orders/7 attempt 2/4 -> cut after 17 of 34 bytes, retrying in 1447 ms [chaos: abort]
12:58:56 POST /orders/7 attempt 3/4 -> 200 (1 ms)
```

### Options

| Option | What it does |
|---|---|
| `--chaos-drop P` | With a chance of P % (0 to 100, with or without `%`), the request is not delivered: `-> dropped [chaos: drop]` |
| `--chaos-duplicate P` | With a chance of P %, the request is delivered twice in a row; the second line carries `[chaos: duplicate]` |
| `--chaos-delay MIN..MAX` | Waits a random time in the range before each delivery: `200..800`, `1s..3s`, or a single value (`500`); `[chaos: delay 312 ms]` |
| `--chaos-reorder N` | Holds N deliveries (2 to 100), `-> held 1 of 3`, and sends them shuffled, never in arrival order: `[chaos: reordered (arrived 3 of 3)]`. An incomplete batch goes out 2 s after the last one (`listen`) or at the end (`replay`); Ctrl+C discards it |
| `--chaos-abort P` | With a chance of P % on each attempt, sends the headers (with the `Content-Length` of the whole body) and half of the body, then closes the connection without waiting for a response: `-> cut after 500 of 1000 bytes [chaos: abort]`. Only with an `http://` target |
| `--chaos-slow B` | Sends the body at B bytes per second, one chunk every tenth of a second: `[chaos: slow 50 B/s]` |
| `--chaos-timeout T` | Gives up waiting for the app's response T after sending the body (`500`, `2s`; default 30 s): `-> error: timed out after 500 ms [chaos: timeout]` |
| `--retries N` | Retries (0 to 10) after a connection error, timeout, cut, 5xx and 429. Waits 1 s, 2 s, 4 s… up to 30 s, with jitter (between half and the full value for that round), or the app's `Retry-After` (seconds or HTTP date, up to 30 s). The line gains `attempt n/total` and `, retrying in <ms> ms` |
| `--chaos-seed N` | Seed for the draws: the same seed repeats the same failures on the same requests (the nth request draws the same, whatever the app does with the previous ones). Without it, one is drawn and shown on the `Chaos:` line |

A time without a unit is in ms, like in the other CLI options.

The retry and the duplicate repeat the stored headers and body byte for byte (the provider's `X-Request-Id`,
`Idempotency-Key` or `X-GitHub-Delivery` arrive identical), so the app can show that it is idempotent. Deliveries still
go one at a time: while one waits (delay, retry), the next ones wait too, and `listen` does not treat the connection to
the server as dropped.

### Output

The line for each attempt is `HH:mm:ss METHOD path[ attempt n/total] -> result[, retrying in <ms> ms[ (Retry-After)]][ [chaos: …]]`,
with result `<status> (<ms> ms)`, `error: <reason>`, `cut after <n> of <total> bytes` or `dropped`. The
`Chaos: …; seed <n>` line comes out after `Listening on` (in `replay`, before the deliveries).

A chaos option with an invalid value exits with 2, with the reason on stderr, delivering nothing. `replay` exits with 1
when any delivery ended without a response from the app (error, timeout or cut), even after the retries; a request
discarded by `--chaos-drop` does not count.

## `anzol rules pull` and `anzol rules push`

Downloads and uploads the URL's response rules as a JSON file.

### Example

```bash
anzol rules pull <token>                     # the rule list on stdout
anzol rules pull <token> --file rules.json   # into the file (stdout stays empty)
anzol rules push <token> rules.json          # replaces the URL's whole list with the file's
anzol rules push <token> --dry-run rules.json    # only shows what the push would change; does not save
```

### Format and effect

The `pull` writes the list as `GET /token/{id}/rules` returns it, as JSON indented with 2 spaces, UTF-8 and a final
line break, the same format as the Export in the web UI.

The `push` sends the file to `PUT /token/{id}/rules` (the whole list: a rule that is not in the file ceases to exist,
and `[]` deletes them all) and prints `Pushed <n> rule(s)`. A rule with an `id` keeps it; without an `id`, the server
generates one. A round trip `pull` → `push` → `pull` gives the same file.

### `--dry-run`

With `--dry-run`, `push` compares the file with the saved rules, by `id`, and prints a JSON summary on stdout
`{"equal": [id…], "changed": [{"id", "name", "fields"}], "removed": [{"id", "name"}], "added": [{"id"?, "name"}]}`
(a rule without an `id`, or with one the URL does not have, is new), without saving, with exit 0.

It does not validate the rules (a note on stderr reminds you of that): the server validates, on the real push. A file
with a repeated `id` exits with 1.

### Errors

```
$ anzol rules push 9f3c…e21a rules.json
0.match.path.regex: The regex is invalid.
1.priority: The priority must be at least 1.
```

| Situation | Output |
|---|---|
| Rules refused by the server (422) | each `key: message` on a line of stderr (key in dot notation starting from the list; `rules` when the file is not a list); nothing changes on the URL; exit 1 |
| Nonexistent token | `Token not found` on stderr, exit 1 |
| Nonexistent `push` file | `File not found: <file>`, exit 1, without calling the server |
| `push` file that is not JSON | `Invalid JSON in <file>: <reason>`, exit 1, without calling the server |
| Nonexistent `--file` folder | `Could not write <file>: no such directory`, exit 1 |

## `anzol send`

Simulates the provider: fires signed webhooks the way Stripe, GitHub, Shopify or Slack would sign them, straight at
your app's receiver, and tries again when it fails. Use it to test signature verification, idempotency and what the
app does with the retry, without depending on the real provider.

### Example

```bash
# Stripe: 3 retries with exponential backoff (1 s, 2 s, 4 s), same Idempotency-Key on all of them
anzol send --to http://localhost:3000/webhooks/stripe \
  --provider stripe --secret whsec_test \
  --header "Content-Type: application/json" --header "Idempotency-Key: {{uuid}}" \
  --data '{"id":"evt_{{random 24}}","type":"payment_intent.succeeded","created":{{timestamp}}}' \
  --retries 3

# GitHub: body from a file, 5 events with half a second between them
anzol send --to http://localhost:3000/webhooks/github \
  --provider github --secret webhook-secret \
  --header "Content-Type: application/json" --header "X-GitHub-Event: push" \
  --header "X-GitHub-Delivery: {{uuid}}" \
  --data-file push.json --repeat 5 --interval 500
```

### Options

It delivers straight to `--to`, without going through the Anzol API (it does not use `--server`); `--to` can be your
app's receiver or an Anzol URL.

| Option | Default | What it does |
|---|---|---|
| `--to <url>` | required | Receiver (`http://` or `https://`), with path and query |
| `--method`, `-X` | `POST` | Method |
| `--header`, `-H "Name: value"` | — | Repeatable; placeholders in the value. `Host`, `Content-Length`, `Connection`, `Expect` and `Upgrade` are not accepted (the HTTP client controls them); a non-ASCII value is refused |
| `--data`, `-d <text>` / `--data-file <file>` | no body | Body (file read as UTF-8, byte for byte); placeholders work in both; one or the other. No automatic `Content-Type`: send `--header "Content-Type: application/json"` |
| `--provider stripe\|github\|shopify\|slack\|generic` | no signature | Signs like the provider; requires `--secret` |
| `--secret <s>` | — | HMAC secret; never shows up in the output |
| `--sig-header H`, `--algorithm sha1\|sha256\|sha512`, `--encoding hex\|base64`, `--prefix P` | —, `sha256`, `hex`, no prefix | Only with `generic`; `--sig-header` is required there |
| `--retries N` | `0` | Retries after the first attempt, from 0 to 10 |
| `--backoff fixed\|exponential` | `exponential` | Waits `initial` (fixed) or `initial × 2^(n-1)` before attempt n+1, no jitter |
| `--initial-delay ms` / `--max-delay ms` | `1000` / `30000` | First wait and the ceiling for every wait, `Retry-After` included |
| `--timeout ms` | `10000` | Deadline for each attempt (connection and response) |
| `--repeat N` / `--interval ms` | `1` / `0` | How many events, and the pause between the end of one and the start of the next |

#### Signature

The same formulas as the server's [signature verification](api.md#signature-verification): an Anzol URL configured
with the same provider and secret stores `valid: true`.

| Provider | Header | Signed content (HMAC) |
|---|---|---|
| `stripe` | `Stripe-Signature: t=<now>,v1=<hex>` | SHA-256 of `"{t}.{body}"` |
| `github` | `X-Hub-Signature-256: sha256=<hex>` | SHA-256 of the body |
| `shopify` | `X-Shopify-Hmac-Sha256: <base64>` | SHA-256 of the body |
| `slack` | `X-Slack-Signature: v0=<hex>` and `X-Slack-Request-Timestamp: <now>` | SHA-256 of `"v0:{ts}:{body}"` |
| `generic` | `<--sig-header>: <--prefix><hex or base64>` | `--algorithm` of the body |

The signature is redone on every attempt (new timestamp, like Stripe does) and replaces a `--header` with the same
name.

#### Placeholders

In the body and in the `--header` values, resolved once per send: the retries are the same event and carry the same
values (only the signature changes).

| Placeholder | Value |
|---|---|
| `{{uuid}}` | New UUID on every send; the same in every occurrence within the send |
| `{{now}}` | The send instant in ISO-8601 UTC, in seconds (`2026-09-26T14:02:07Z`) |
| `{{timestamp}}` | The same instant in Unix seconds |
| `{{seq}}` | Number of the send within `--repeat`: 1, 2, 3… |
| `{{random N}}` | N random letters and digits, N from 1 to 256; each occurrence draws its own |
| `{{{{` | A literal `{{` (`{{{{uuid}}` arrives as `{{uuid}}`) |

Any other `{{…}}`, or an unclosed `{{`, is refused before sending (`Invalid template in --data: unknown
placeholder {{foo}}`, exit 1).

#### Retry

On connection error, timeout, 5xx and 429; never on 2xx, 3xx and the other 4xx. When the response carries
`Retry-After` (seconds or HTTP date), it replaces the backoff and the line ends in ` (Retry-After)`; the wait never
goes past `--max-delay`.

### Output

```
14:02:07 #1 attempt 1/4 -> 503 (12 ms), retrying in 1000 ms
14:02:08 #1 attempt 2/4 -> 429 (3 ms), retrying in 5000 ms (Retry-After)
14:02:13 #1 attempt 3/4 -> 200 (9 ms)
#1 delivered after 3 attempt(s)
```

One line per attempt, `HH:mm:ss #<seq> attempt <n>/<total> -> <status> (<ms> ms)` or `-> error: <reason>`, with
`, retrying in <ms> ms` when it is going to try again; and one per send, `#<seq> delivered after <n> attempt(s)` (2xx)
or `#<seq> gave up after <n> attempt(s)`.

A send that gives up does not interrupt `--repeat`. It exits with 0 if all sends were delivered and with 1 if any gave
up or if the options are invalid (reason on stderr, nothing is sent). Ctrl+C exits with 130 without sending again.

### Encrypted attribute (E2EE)

Here, E2EE means encrypted from the sender all the way to the Anzol URL: the end that opens it is the Anzol server,
which decrypts on arrival and stores the decrypted value in the request. The CLI does not encrypt, does not generate a
key and does not read a JWKS: `anzol send` only signs with HMAC.

To send a JWE, build it outside (with a JOSE library, in the format of
[attribute decryption](api.md#attribute-decryption-e2ee): an ES256 JWS inside an ECDH-ES/A256GCM JWE for the public
key from the URL's JWKS) and deliver the finished body with `--data-file`.

To just see the decryption working, use the [lab](api.md#e2ee-lab): through the API (`POST /e2ee-lab` and
`POST /token/{id}/e2ee-lab/run`), the web UI or MCP, not the CLI. It generates and delivers the requests through the
server itself; its test sender is no use for signing a JWE built outside, because the private key stays in the URL's
Redis and no route returns it.

On the other side: `listen` and `replay` deliver the body as it arrived, with the JWE; `wait-for` prints the complete
request on stdout, **with the decrypted attribute** (`decrypted`: a URL with decryption is always protected, and the
`--read-secret` that opens it also shows the value), which goes into the CI log.

`test` does the same as `wait-for` when it points with `--token` at a URL that decrypts; the URL it creates itself
does not decrypt.

On a URL with decryption, `--match '{"decryption": "valid"}'` waits only for the decrypted ones.

## `anzol wait-for`

For your app's integration or E2E test: after firing the action that generates the webhook, it waits (with a deadline)
until the URL receives the expected request, and tells you why it did not arrive when it fails. It uses the API's
[`requests/wait`](api.md#waiting-for-messages).

### Example

```bash
# a POST to /orders… with status "paid" in the JSON body, within 10 s; the messages go to jq
anzol wait-for --token <uuid> --method POST --path /orders --json-path '$.status="paid"' --timeout 10000 | jq '.[0].content'

# 3 webhooks that match a rule's match (inline or from a file), only the ones that arrive from now on
anzol wait-for --token <uuid> --match-file match.json --count 3 --new

# in a test: reads the queue position BEFORE firing and waits from it (no race)
CURSOR=$(anzol cursor <uuid>)
curl -s -X POST http://localhost:8084/<uuid>/orders -d '{"status":"paid"}'
anzol wait-for --token <uuid> --after "$CURSOR" --path /orders --timeout 10000
```

### Options

| Option | Default | What it does |
|---|---|---|
| `--token <uuid>` | required | The URL being watched |
| `--match <json>` / `--match-file <file>` | `{}` (matches any request) | The `match` object of a [response rule](api.md#response-rules); one or the other |
| `--method M` | — | Repeatable: matches any of them (`match.method`) |
| `--path <prefix>` | — | The path after the token starts with the prefix (`match.path.prefix`) |
| `--header "Name: value"` | — | Repeatable: the header has exactly that value (`match.headers`, name is case-insensitive) |
| `--body-contains <text>` | — | The body contains the text |
| `--json-path '<path>[=<json>]'` | — | Repeatable: without `=`, the path exists in the JSON body; with `=`, the value there equals what comes after the first `=`, read as JSON (`$.value=10` is the number) or, if it is not JSON, as text (`$.status=paid`) |
| `--count N` | `1` | How many matching requests are needed (1 to 100) |
| `--timeout ms` | `30000` | How long to wait for new requests (0 to 300000; `0` only looks at the history) |
| `--after <seq>` / `--new` | the whole history | Only requests with a greater `seq`; `--new` uses the `seq` of the newest one at the moment the command starts. One or the other |

The shortcuts build the `match` and add to `--match`: a shortcut with the same top-level key replaces the one from
`--match` (`--method` swaps `method`; `--body-contains` and `--json-path` together form the `body`), and all the
conditions apply as AND.

### Output

```
$ anzol wait-for --token 9f3c…e21a --method DELETE --path /event/2 --timeout 1500
[]
timed out after 1506 ms: 0/1 matched
closest: #1790438428567114 bbe0928d-1e7f-4684-961c-9a2e86c4980d
  - method: expected DELETE, got POST
```

The stdout is only the JSON of the requests that matched, an array on one line (complete, like
`GET /token/{id}/request/{requestId}`, in `seq` order), ready for `jq`; on a deadline without a match, the ones that
matched up to that point (or `[]`).

The summary goes to stderr: `matched <n>/<count> in <ms> ms`, or `timed out after <ms> ms: <n>/<count> matched`
followed by `closest: #<seq> <uuid>` and one line `  - <phrase>` for each condition that failed on the request that
came closest (without these lines if no request was evaluated).

| Situation | Output |
|---|---|
| Matched | 0 |
| The deadline passed without a match (or the URL was deleted during the wait) | 1 |
| Invalid usage (unknown option or with a wrong value, `--after` with `--new`, `--match` that is not a JSON object, nonexistent file), `match` refused by the server (422, each `key: message` on a line of stderr), `Token not found` or server down | 2, stdout empty |

The server is what cuts the wait: the CLI's HTTP deadline is `--timeout` plus 10 s.

## `anzol cursor`

`anzol cursor <token>` prints on stdout only the `seq` of the URL's newest request (`0` with no requests), with exit 0;
a nonexistent token gives `Token not found` on stderr and exit 1.

In a test, `--new` misses a trigger that arrives before `wait-for` starts; reading the cursor before firing and waiting
with `--after` has no such race. In [`anzol test`](#anzol-test), that read is step 3.

## `anzol test`

The CI test in a single command: it creates a URL, runs the command that makes your app send the webhook (the
[trigger](glossary.md#agents-and-cli), after the `--`), waits for the request to arrive with the conditions of
[`wait-for`](#anzol-wait-for), checks the status the URL answered with and deletes the URL, pass or fail. It uses the
usual API routes, with no `curl` or `jq`.

### Example

```bash
# {url} in the trigger becomes the created URL; the rule in the file answers 202 to the POST on /orders
anzol test --rules rules.json --method POST --path /orders --json-path '$.status=paid' --status 202 \
  -- ./trigger-order.sh {url}

# no trigger: shows the URL and waits for the webhook sent from outside (another job, a real provider)
anzol test --path /orders --timeout 120000

# on a URL that already exists (it is not deleted at the end)
anzol test --token <uuid> --path /orders -- ./trigger-order.sh {url}
```

### Steps

In order, what it does:

1. Creates the URL, or uses the one from `--token`.
2. With `--rules`, replaces the URL's rules with the file's, like `rules push` (the 422 comes out as in `rules push`).
3. Reads the cursor (the same number as [`anzol cursor`](#anzol-cursor)) **before** the trigger: it only counts what
   arrives after it, and a webhook that arrives before the wait starts is not lost. On a URL created there, the cursor
   is `0`.
4. Asks the server to check the `match` and the `--count` (a `requests/wait` with `timeout` 0, which answers right
   away): if they are refused, the trigger does not even run.
5. Runs the trigger until it exits. `{url}`, in any argument, becomes the URL; its environment gains `ANZOL_URL` and
   `ANZOL_TOKEN`. The trigger's stdout and stderr go to stderr, and only the program name is printed (the arguments
   may hold secrets). Without a trigger, it prints `waiting: send the requests to <url>`.
6. Waits like `wait-for --after <cursor>`.
7. With `--status`, checks that every request that matched was answered with that status (the stored
   `response.status`: the one from the rule that answered or the URL's default).
8. Deletes the URL it created, also on failure, on Ctrl+C and on the SIGTERM of a canceled job.

### Options

| Option | Default | What it does |
|---|---|---|
| `-- <trigger> [arguments]` | none | The command that makes your app send the webhook |
| `--token <uuid>` | creates a URL | Uses a URL that already exists and does not delete it at the end |
| `--rules <file>` | — | JSON file with the rule list, in the format of `rules pull` |
| `--status N` | — | Every request that matched must have been answered with `N` |
| `--match`, `--match-file`, `--method`, `--path`, `--header`, `--body-contains`, `--json-path`, `--count`, `--timeout` | those of `wait-for` | The conditions and the deadline, [as in `wait-for`](#anzol-wait-for) |

The `{url}` URL is the `--server` plus the token: the app that sends the webhook must reach the server at that
address.

In zsh, `{url}` right before a redirection (`… {url} > output.json`) becomes a file descriptor and vanishes from the
line; put it in quotes (`'{url}'`) or read the URL from `ANZOL_URL`.

### Output

```
$ anzol test --rules rules.json --method POST --path /orders --json-path '$.status=paid' --status 202 -- ./trigger-order.sh {url}
url: http://localhost:8084/31c2…f633 (created; deleted at the end)
rules: pushed 1 rule(s) from rules.json
cursor: 0
trigger: ./trigger-order.sh exited with 0 after 202 ms
[{"uuid":"7951…c91b","token_id":"31c2…f633","method":"POST",…,"rule":{"id":"9191…8ab6","name":"Order accepted"},…,"response":{"status":202},"seq":1790640792929422}]
matched 1/1 in 5 ms
status: 1/1 answered 202
url: deleted
```

The stdout is the one from `wait-for`: only the JSON array of the requests that matched. The stderr has one line per
step (`url:`, `rules:`, `cursor:`, `trigger:`, the `wait-for` summary, `status:`), the trigger's output and, on
failure, the `closest` from `wait-for`, which says which condition the closest request did not meet:

```
timed out after 2009 ms: 0/1 matched
closest: #1790640756737566 a47f…6a0
  - body $.status: expected "canceled", got "paid"
url: deleted
```

| Situation | Output |
|---|---|
| The messages arrived (and `--status` matched) | 0 |
| The deadline passed without a match, or one that matched was answered with another status | 1 |
| Invalid usage, `--rules` or `match` refused by the server (422), `Token not found` or server down | 2 |
| The trigger did not start or exited with a code other than 0 (the wait does not begin) | 3 |

### In CI

On GitHub Actions, the server runs as a service with the [published image](../../README.md#quick-start), and the CLI is
built from source at the same version:

```yaml
jobs:
  webhook:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:8.10.2-alpine
      anzol:
        image: ghcr.io/isdiegoalves/anzol:0.5.0
        ports: ["8084:8080"]
        env:
          REDIS_HOST: redis
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: isdiegoalves/anzol
          ref: v0.5.0
          path: .anzol
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "25"
      - name: Anzol CLI
        run: |
          (cd .anzol/cli && ./gradlew --no-daemon -q installDist)
          echo "$PWD/.anzol/cli/build/install/anzol/bin" >> "$GITHUB_PATH"
      # the image has no curl for a health-cmd: the step waits for the web UI to respond
      - name: Anzol is up
        run: timeout 60 sh -c 'until curl -sf -o /dev/null http://localhost:8084/; do sleep 1; done'
      - run: anzol test --rules rules.json --method POST --path /orders --status 202 -- ./trigger-order.sh {url}
```

The services find each other by name (`REDIS_HOST: redis`), and the CLI and the trigger, which run on the runner,
talk to Anzol at `localhost:8084`, the default for `--server`.

## Server

`--server <url>`, else the `ANZOL_SERVER` variable, else `http://localhost:8084`. It applies to `listen`,
`replay`, `rules`, `wait-for`, `cursor` and `test` (`send` talks directly to `--to`) and goes after the subcommand:
`anzol listen --server https://hooks.example --forward …`,
`anzol rules pull <token> --server https://hooks.example`. Protected URL: `--read-secret`, in the same position, or
`ANZOL_READ_SECRET` (see [Privacy](privacy.md#cli-and-mcp)).

## What is forwarded

| Part | Forwarding |
|---|---|
| Method | The stored one (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| URL | `<forward>` without the trailing slash + path after the token + query as it is in the stored `url` (the server stores the query with the pairs in alphabetical order) |
| Headers | The stored ones, each value in the list, **except** `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `proxy-*` (they apply only to the original connection), `host` (becomes the one from `--forward`), `content-length` (recalculated) and `expect` |
| Body | The stored `content`, in UTF-8 |
| Multipart | The stored text fields, reassembled with a new boundary (one that appears in no field) in the forwarded `Content-Type`; name escaped the way the browser does it (`"` CR LF → `%22` `%0D` `%0A`); PHP arrays become `field[0]`, `field[key]` |

## Limitations

- **A binary body arrives different:** the server stores the body as text, and bytes that are not UTF-8
  become U+FFFD (`�`). An image, protobuf or raw gzip does not arrive identical to the original.
- **Multipart files are not forwarded:** the server does not keep files or the raw multipart body, only the text
  fields. The line warns with `[files were not forwarded: not stored by the server]`.
- **As the server stores it, not as it arrived:** a repeated header arrives with the last value, `_` in the
  name becomes `-`, names are lowercase, and an empty `content-type` shows up on requests without a body
  (the server stores them that way).
- **A header with a non-ASCII value** arrives with `?` in place of those characters (a limit of the Java HTTP
  client).
- **A path with a character that is not valid in a URI** (e.g., a raw `"`) is not forwarded: an `error:` line comes
  out with the reason.
- **A long outage with [auto cleanup](glossary.md#capture):** requests that the cleanup deleted during the outage no
  longer exist on the server and are not forwarded.
- Forwarding has a 30 s deadline per request; no `--json`, no filters, no tunnel to the internet and no
  parallel forwarding.
