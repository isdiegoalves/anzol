# CLAUDE.md

Webhook.site em reescrita sem mudança de comportamento: o app Laravel/AngularJS da raiz segue no ar
até a troca; o código novo vive em `backend/` (Kotlin + Spring Boot) e `frontend/` (Angular).

- Kotlin em `backend/`: siga `docs/padroes-kotlin.md`. A mudança fecha com `cd backend && ./gradlew check`
  verde (testes com Redis em container, ktlint, detekt).
- Angular em `frontend/`: siga `docs/padroes-angular.md`.
- Comportamento observável (API, webhook, evento `request.created`): o juiz é o contrato caixa-preta em
  `tests/contract/`; o código se ajusta a ele, e o contrato só muda por decisão do dono.
- Redis: os dois apps dividem as chaves `token:{uuid}` e `token:{uuid}:requests` com o mesmo JSON;
  qualquer mudança de formato quebra a convivência enquanto o app antigo existir.
