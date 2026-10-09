Anzol response rules. A webhook URL receives HTTP requests at /{token}/{path}; a rule chooses the response.
The first enabled rule whose conditions all match (lowest priority first) answers with its response.

Rule fields:
- name: required, 1 to 100 characters, short and descriptive.
- enabled: boolean, default true. priority: integer >= 1, default 5; lower wins.
- chance (optional): integer 1..100, the percentage of the matching requests the rule answers; the others go on to
  the next rule as if it did not match. The draw is fixed per request and rule.
- active_from, active_until (optional): ISO-8601 date-times with a time zone, e.g. "2026-09-29T12:00:00Z"; the rule
  only answers requests received from active_from (inclusive) until active_until (exclusive). Returned in UTC.
- match: conditions, all must hold (AND). A rule without conditions matches every request.
  - method: list of HTTP methods, e.g. ["POST"]. Empty or absent: any method.
  - path: exactly one of {"equals": "/orders"}, {"prefix": "/orders"}, {"regex": "/orders/[0-9]+"}.
    The path is what comes after the token, decoded, starting with "/" and without the trailing slash ("/" when empty).
  - query: object, parameter name -> exactly one of {"equals": text}, {"contains": text}, {"regex": text}, {"present": true|false}.
  - headers: object, header name (any case) -> the same operators as query.
  - body: list of conditions, each exactly one of {"equals": text}, {"contains": text}, {"regex": text},
    {"jsonPath": {"path": "$.status", "equals": <any JSON value>}} (without "equals" the path only has to exist; the
    path may not use the =~ regex operator, use {"regex": ...} instead),
    {"equalToJson": <JSON value or text holding JSON>}.
  - signature: "valid", "invalid" or "absent" (HMAC verification configured on the URL).
  - schema: "valid" or "invalid" (JSON Schema validation configured on the URL).
  - decryption: "valid", "invalid", "unknown_kid" or "absent" (attribute decryption configured on the URL).
    "invalid" is every refused message, whatever the recorded reason: plaintext, a missing attribute, a body that is
    not JSON, a failed HMAC signature, wrong claims, and so on; no condition picks a single reason.
    "absent" means the attribute arrived in plaintext on a URL that accepts it (required: false); with the default
    (required: true), plaintext is refused and recorded as "invalid" (reason downgrade), never "absent".
    Example: {"match": {"decryption": "unknown_kid"}, "response": {"status": 500}}.
    Example: "answer 401 when the message does not come encrypted", with the default policy (required: true):
    {"match": {"decryption": "invalid"}, "response": {"status": 401}}; it also answers every other refused message.
    Use {"decryption": "absent"} for plaintext only when the URL has required: false.
  Every regex is Java syntax and must match the whole value.
- response:
  - status: integer 100..599, default 200.
  - headers: object, header name -> text value (e.g. {"Content-Type": "application/json", "Retry-After": "5"}).
  - body: text, default "". A JSON body is written as a JSON string, e.g. "{\"ok\":true}".
  - template: boolean, default false. When true, body and header values are Handlebars templates:
    {{request.method}}, {{request.path}}, {{request.query.<name>}}, {{request.headers.<lowercase name>}},
    {{request.body}}, {{seq}}, {{jsonPath request.body '$.id'}}, {{now}}, {{randomValue type='UUID'}}.
    {{hmac request.body algorithm="sha256" encoding="hex"}} signs a value with the signature verification secret
    configured on the URL (algorithm: sha1, sha256 or sha512; encoding: hex or base64; both optional). Without a
    configured secret it outputs nothing. Use it to sign callbacks, e.g. {"X-Signature": "sha256={{hmac request.body}}"}.
    The secret itself is never shown, but anyone who can edit or test rules on the URL can get any value signed with
    it; protect the URL with a read_secret when the signature secret matters.
  - delay: {"fixed": ms} or {"uniform": {"min": ms, "max": ms}} or {"lognormal": {"median": ms, "sigma": s}}; max 60000 ms.
  - dribble: {"chunks": 1..100, "durationMs": 0..60000} sends the body in pieces.
  - fault: "connection_reset", "empty_response", "malformed_chunk" or "random_data_then_close" breaks the connection
    instead of answering. "hang" sends nothing until the client gives up (the server closes after at most 5 minutes);
    "stall_after_headers" sends the status and headers (with the body's Content-Length), then nothing until the client
    gives up; "truncated_body" sends the status, headers and half the body, then closes. Those two need a body. With a
    fault, delay and dribble are ignored.
- scenario (optional): {"name": text, "requiredState": text, "newState": text}; every scenario starts in "Started".

Example: "answer 201 with JSON for POST /payments when the body status is paid":
{"name": "payment paid", "match": {"method": ["POST"], "path": {"equals": "/payments"},
 "body": [{"jsonPath": {"path": "$.status", "equals": "paid"}}]},
 "response": {"status": 201, "headers": {"Content-Type": "application/json"}, "body": "{\"ok\":true}"}}
