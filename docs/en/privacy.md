# Privacy and security

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](privacy.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../privacidade.md)

## Privacy

Anyone who has the UUID of a URL can read everything on it. With a **read secret**, viewing and managing the URL
requires the secret; **capture stays open** (whoever sends the webhook has no secret).

Limits (the model has no user accounts):

- **Anyone who has the UUID of an OPEN URL can protect it** with a secret of their own, and the owner loses access
  until they learn the secret. It is the same power that UUID already gave (read, delete, change the response):
  protect the URL before the UUID circulates.
- **PBKDF2 has no global limit.** The limit of 10 failures per minute is per URL; anyone who spreads attempts across
  many URLs makes the server compute one PBKDF2 (210,000 iterations) per attempt. Global anti-abuse limits, for
  publishing the app, are a separate topic.

### Isolated capture (CSP sandbox)

Every capture response on `/{id}/...` — the URL's default response, a rule's response and the `malformed_chunk`
failure — goes out with `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`,
**without `allow-same-origin`**. Reason: the web UI, the API and the capture are served from the same address
(`localhost:8084`), and a URL's response is content from whoever configured it (or from whoever knows the UUID of an
open URL). Without the sandbox, a capture that responds with HTML containing a `<script>` would run in the web UI's
origin: it would read `localStorage` (the UUIDs of whoever opens the page) and call the API with the unlock cookie.
With it, the page runs in an opaque origin: the script runs, forms and pop-ups work, but nothing from the app's origin
is within reach. The header comes after the rule's headers and is added, not swapped: a rule that sets its own
`Content-Security-Policy` ends up with both, and the browser applies both. Clients that are not browsers (CLI, SDKs,
providers) ignore the header.

### Read secret

`read_secret` (text of 8 to 256 characters) in the body of `POST /token` or `PUT /token/{id}`. It is never returned:
the token gains `"protected": true|false`. On `PUT`, **absent keeps** the secret (a deliberate exception to the rule
"an absent field goes back to the default": deleting the protection by omission would be dangerous), `null` removes it
and text replaces it. In the query string, 422. Removing is refused (422 on `read_secret`) while any message on the URL
holds the decrypted attribute (`decrypted`, see [Attribute decryption](api.md#attribute-decryption-e2ee)): without the
secret, it would be in plain sight of anyone who only has the URL. Delete those messages first, or keep the secret.

Without access, **every** `/token/{id}/...` route (the token, `DELETE`, messages, raw, SSE, search, wait, rules,
scenarios, outbound, replay, send, AI, links) responds `401 {"error":"This URL is protected","protected":true}`; only
`unlock`, `lock` and `jwks.json` (the public encryption keys, which are not secret) respond. The capture `/{id}/...`
does not change. Access is one of these:

- the `X-Anzol-Secret: <secret>` header (CLI, scripts);
- the unlock cookie (the web UI).

Redis holds only the PBKDF2-HMAC-SHA256 hash (random 16-byte salt, 210,000 iterations) and `secret_version`, which
changes on every replacement; comparison is constant-time. Hits stay in memory for 5 minutes (the CLI does not pay for
PBKDF2 on every call). **10 wrong secrets per minute per URL** (unlock and header added together; the MCP's
`read_secret` is counted separately, so an agent making mistakes does not lock out the web UI and the CLI) → `429`
with `Retry-After` until the minute ends, **also for the right secret** (otherwise the 429 for the wrong one and the
200 for the right one would reveal which is the right one); the cookie does not go through this limit. The secret does
not appear in a log, response, metric or error. A token saved before the secret existed opens as unprotected.

### What stays in Redis

In clear text, with the URL: the HMAC secret (`signature.secret`), the private encryption keys (`e2ee_keys[].jwk`,
field `d`), the private key of the lab's test sender and the decrypted value of each message (`decrypted`). Hashed
(PBKDF2): the read secret. The read secret protects reading through the API and the web UI, not storage: whoever has
Redis or the `dump.rdb` of the `anzol_redis-data` volume has all of this. Anzol does not encrypt Redis. The encryption
keys stay on the URL until someone deletes them (`DELETE /token/{id}/keys/{kid}`): turning decryption off or removing
the secret does not remove them.

### Unlock cookie

`POST /token/{id}/unlock {"secret": "..."}` → `204` with
`Set-Cookie: anzol_access=<day>.<HMAC-SHA256(server key, id:version:day)>; Path=/token/{id}; Max-Age=2592000;
HttpOnly; SameSite=Strict` (and `Secure` when the request arrives over HTTPS, directly or with
`X-Forwarded-Proto: https`). Wrong: `401 {"error":"Wrong secret"}`; no `secret`: 422; URL without protection: `204`
without a cookie. The cookie opens every route of the URL, including SSE, without the secret passing through
JavaScript. `POST /token/{id}/lock` deletes the cookie (`204`).

`<day>` is the issue day (days since 1970, UTC), signed along with it: **the server refuses a cookie that is 30 days
old or more**, even if the browser still sends it. It is the day, not the instant, so that two unlocks on the same day
give the same cookie; the lifetime never exceeds 30 days (it shortens by less than a day). Cookies in the previous
format (without the day) stopped being valid: whoever had them unlocks again.

The server key is 32 random bytes in `anzol:server-key` in Redis, created on first use with `SET NX` (two instances end
up with the same one) and without a TTL: it survives a restart. Replacing or removing the secret changes the version,
so old cookies stop being valid (even if the secret is set again), the URL's open SSE connections and waits are closed
(whoever reconnects goes through access again) and **all of the URL's read-only links are revoked** (a link is access;
whoever replaces the secret wants to cut off whoever had it).

### CLI and MCP

In the CLI, `--read-secret <secret>` (after the subcommand, like `--server`) or the `ANZOL_READ_SECRET` variable puts
the header on `listen`, `replay`, `wait-for`, `rules`, `cursor` and `test`. Protected URL without the right secret:
`This URL is protected: pass --read-secret or set ANZOL_READ_SECRET` on stderr and exit 1 (2 on `wait-for` and
`test`). The secret is never printed. Printable ASCII only: Java's HTTP client swaps the other characters for `?` in a
header.

```bash
ANZOL_READ_SECRET='my-secret' anzol listen --token <uuid> --forward http://localhost:3000
anzol rules pull <uuid> --read-secret 'my-secret'
```

In the MCP, every tool of the URL accepts the optional `read_secret` argument; a protected URL without it (or with the
wrong one) is a tool error `{"status":401,"error":"This URL is protected; pass its read_secret"}`. On `create_url`,
`read_secret` is the secret the new URL starts requiring; on `update_url`, it is only the access (the URL's secret does
not change through it).

## Read-only links

A message can be shared through a link that gives access to nothing else on the URL (not even when it is protected):

```bash
curl -X POST localhost:8084/token/<uuid>/request/<rid>/share -H 'Content-Type: application/json' \
  -d '{"expires_in":"1d","redact":true}'
# 201 {"id":"3kQ…","url":"/#/share/3kQ…","expires_at":"2026-09-27 12:00:00","redact":true}
```

- `expires_in`: `1h`, `1d`, `7d` (default) or `30d`; `redact`: `true` (default) or `false`. Any other value: 422.
- `GET /token/{id}/shares` lists the active ones; `DELETE /token/{id}/shares/{sid}` revokes (`204`; a link from another
  URL, 404). At most 50 active per URL (422 above that).
- `GET /share/{sid}` is public: the message as `GET /token/{id}/request/{rid}` returns it, plus `shared_at` and
  `expires_at`, without the decrypted attribute (`decrypted`; see
  [Attribute decryption](api.md#attribute-decryption-e2ee)) and **always without the URL's UUID** (with or without
  `redact`): no `token_id`, and with every occurrence of the UUID in the whole JSON replaced by `[redacted]`
  (`http://localhost:8084/[redacted]/path?x=1`) — in the `url`, in the headers (`referer`), in the query, in the
  `request` and in the body (GitHub's ping carries its own URL). The masking finds the UUID in plain text (with or
  without hyphens, in uppercase or lowercase), with characters as `%hh` (`%2D` in place of the hyphen) or in JSON
  escape (`-`), and inside a one-layer base64 or base64url text. It does not find the UUID encoded in more than
  one layer (`%252D`, base64 of base64), in HTML entities, split across fields, in a hash or in a compressed body: it
  prevents the address from leaking by accident, not a sender from putting it in the message on purpose. The UUID
  belongs to the server, not to the sender's data: from the body, only it is removed. Expired, revoked, of a deleted
  message, of a deleted URL or nonexistent: the same `404`.
- Setting, replacing or removing the URL's read secret revokes all of its links. The link stores the URL's
  `secret_version` at creation and only opens while it is the current one: a link created at the same instant as the
  replacement also dies.
- `redact=true` replaces with `"[redacted]"` the values of the headers `authorization`, `proxy-authorization`,
  `cookie`, `set-cookie`, `x-api-key`, `x-anzol-secret`, of the headers whose name contains `token`, `key`, `secret`,
  `password`, `auth`, `session`, `credential`, `jwt`, `bearer`, `passwd` or `pwd` (case-insensitive: `X-Auth-Token`,
  `X-Api-Keys`, `X-Session-Id`) and of the signature header of the provider configured on the URL, and the values of
  query parameters whose name contains `token`, `key`, `secret`, `password` or `signature` (case-insensitive), also
  inside the stored `url`. The `php-auth-user`/`php-auth-pw` (the decoded `Authorization: Basic` that the message
  stores), the form fields with a sensitive name and the `near_miss` sentences that quote these values are also masked.
  **The body is not masked.**

The id is 128 random bits in base62; in Redis, `share:{sid}` with a TTL equal to the expiry and the
`token:{uuid}:shares` index, deleted along with the URL.

## DNS rebinding/CSRF protection

A malicious page open in the browser can try to use the local API: through DNS rebinding (its name starts pointing to
`127.0.0.1`, and the browser sends `Host: attacker-name`) or through CSRF (a form from another site, including from
another app on another `localhost` port: the cookie's `SameSite` does not separate ports). With `ANZOL_ALLOWED_HOSTS`
(`anzol.allowed-hosts`, comma-separated list; closed default `localhost,127.0.0.1,[::1],host.docker.internal`), the
management routes (`/token`, `/token/...`, `/share/...`) and `/mcp` check:

- `Host` outside the list → `403 {"error":"host not allowed"}` (a name without a port in the list matches any port);
- on methods that change state (POST, PUT, PATCH, DELETE, including through `X-HTTP-Method-Override`), a present
  `Origin` that is not this server's → `403 {"error":"origin not allowed"}`. The `Origin` passes on the **same port as
  the `Host`** with a name from the list (the web UI itself, also opened under another loopback name, or through the
  `ng serve` proxy, which keeps the `Host`) or with `name:port` written in the list (e.g. `localhost:4200` for a web UI
  served on another port). Another port of the same name is another origin. On `/mcp`, the `Origin` is checked on every
  method, as the Streamable HTTP transport requires;
- `_method` on a POST (form field or query, which would turn a `<form>`'s POST into a PUT or DELETE) →
  `403 {"error":"_method not allowed"}`, with or without `Origin`;
- form body (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, the ones a `<form>` sends
  without a preflight) with `Origin` or with the `anzol_access` unlock cookie (which only a browser sends on its own,
  even when it omits the `Origin`) → `403 {"error":"form not allowed"}`. The web UI only sends JSON. Without `Origin`
  and without the cookie (CLI, curl, scripts) the form is still accepted, as in the old app. It is 403, not 415,
  because the type is accepted: what is refused is the form coming from a browser.

A client without `Origin` (CLI, curl, agents) passes on the `Host`. The capture `/{id}/...` and the web UI's files
check nothing (the capture accepts a form, `_method` and any `Origin`). The route is recognized the way Spring matches
it: `/token;x=1/...` or `/%74oken/...` are also checked. An empty list means the default. To reach the app under
another name, add it to the list.

**`*` turns off the management `Host` and `Origin` check, and it is insecure**: any page open in the browser (and any
name that resolves to the app) can use the API. `/mcp` stays on the default, and `_method` and a form with `Origin`
are still refused.
