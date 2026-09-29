# CLAUDE.md

Anzol: backend em `backend/` (Kotlin + Spring Boot),
tela em `frontend/` (Angular), servidos juntos pela imagem do `Dockerfile` da raiz.

- Kotlin em `backend/`: siga `docs/padroes-kotlin.md`. A mudança fecha com `cd backend && ./gradlew check`
  verde (testes com Redis em container, ktlint, detekt).
- Angular em `frontend/`: siga `docs/padroes-angular.md`.
- Comportamento observável (API, webhook, evento `request.created`): o juiz é o contrato caixa-preta em
  `tests/contract/`; o código se ajusta a ele, e o contrato só muda por decisão do dono.
- Redis: o JSON de `token:{uuid}` e `token:{uuid}:requests` é formato persistido. O volume guarda dados
  gravados pelo app Laravel e por versões anteriores do app; mudança de formato lê também o formato antigo
  (ou migra os dados) para que tokens e mensagens existentes continuem abrindo.
