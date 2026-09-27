Anzol response rules. A webhook URL receives HTTP requests at /{token}/{path}; a rule chooses the response.
The first enabled rule whose conditions all match (lowest priority first) answers with its response.

Rule fields:
- name: required, 1 to 100 characters, short and descriptive.
- enabled: boolean, default true. priority: integer >= 1, default 5; lower wins.
- match: conditions, all must hold (AND). A rule without conditions matches every request.
  - method: list of HTTP methods, e.g. ["POST"]. Empty or absent: any method.
  - path: exactly one of {"equals": "/orders"}, {"prefix": "/orders"}, {"regex": "/orders/[0-9]+"}.
    The path is what comes after the token, decoded, starting with "/" and without the trailing slash ("/" when empty).
  - query: object, parameter name -> exactly one of {"equals": text}, {"contains": text}, {"regex": text}, {"present": true|false}.
  - headers: object, header name (any case) -> the same operators as query.
  - body: list of conditions, each exactly one of {"equals": text}, {"contains": text}, {"regex": text},
    {"jsonPath": {"path": "$.status", "equals": <any JSON value>}} (without "equals" the path only has to exist),
    {"equalToJson": <JSON value or text holding JSON>}.
  - signature: "valid", "invalid" or "absent" (HMAC verification configured on the URL).
  - schema: "valid" or "invalid" (JSON Schema validation configured on the URL).
  Every regex is Java syntax and must match the whole value.
- response:
  - status: integer 100..599, default 200.
  - headers: object, header name -> text value (e.g. {"Content-Type": "application/json", "Retry-After": "5"}).
  - body: text, default "". A JSON body is written as a JSON string, e.g. "{\"ok\":true}".
  - template: boolean, default false. When true, body and header values are Handlebars templates:
    {{request.method}}, {{request.path}}, {{request.query.<name>}}, {{request.headers.<lowercase name>}},
    {{request.body}}, {{seq}}, {{jsonPath request.body '$.id'}}, {{now}}, {{randomValue type='UUID'}}.
  - delay: {"fixed": ms} or {"uniform": {"min": ms, "max": ms}} or {"lognormal": {"median": ms, "sigma": s}}; max 60000 ms.
  - dribble: {"chunks": 1..100, "durationMs": 0..60000} sends the body in pieces.
  - fault: "connection_reset", "empty_response", "malformed_chunk" or "random_data_then_close" breaks the connection
    instead of answering.
- scenario (optional): {"name": text, "requiredState": text, "newState": text}; every scenario starts in "Started".

Example: "answer 201 with JSON for POST /payments when the body status is paid":
{"name": "payment paid", "match": {"method": ["POST"], "path": {"equals": "/payments"},
 "body": [{"jsonPath": {"path": "$.status", "equals": "paid"}}]},
 "response": {"status": 201, "headers": {"Content-Type": "application/json"}, "body": "{\"ok\":true}"}}
