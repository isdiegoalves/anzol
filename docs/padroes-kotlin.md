# Padrões Kotlin do backend

> Padrão de código do backend (`backend/`), aprovado pelo dono do projeto. Vale para código
> novo e para revisão; mudança de regra entra aqui, com fonte e guarda.
>
> **Referências:** Marcin Moskala (*Effective Kotlin*, 60 itens; *Kotlin Coroutines: Deep Dive* se
> houver corrotinas) e Dave Leeds (*Kotlin: An Illustrated Guide*, typealias.com).
> **Fonte:** **EK n** = item n do *Effective Kotlin* (leanpub, atualizado 2026-06-12);
> **DL cap. n** = capítulo n do *Illustrated Guide*.
> **Guarda:** regra do detekt/ktlint que cobra automaticamente; "revisão" = code review.
> **Critério para uma regra estar aqui:** caso concreto neste backend ou guarda automática.

## 1. Segurança

| Regra | Fonte | Guarda |
|---|---|---|
| `val` por padrão; modelos (`Token`, `CapturedRequest`) imutáveis e com coleções read-only; edição via `copy()` (o `TokenController::update` atual muta o objeto, o novo não) | EK 1 | `VarCouldBeVal` |
| Assinantes do SSE em estrutura concorrente (`ConcurrentHashMap`); nada de `synchronized` manual; atomicidade no Redis via Lua/MULTI | EK 2 | revisão |
| Tipo de plataforma (Servlet, Spring Data Redis) vira tipo Kotlin com nulidade explícita **na borda**: `request.getHeader(x)` é `String?` na primeira linha que o lê | EK 3 | revisão |
| Invariante interna com `require`/`check`/`requireNotNull`; entrada do usuário com validação que responde 422 (contrato) | EK 5 | `UseRequire`, `UseCheckOrError` |
| Só exceções padrão (`IllegalArgumentException`, `IllegalStateException`); sem hierarquia própria | EK 6 | `TooGenericExceptionThrown` |
| Ausência esperada é `null`: `TokenStore.find(id): Token?`; o controller transforma `null` em 410 | EK 7 | revisão |
| Nunca `!!`; nulo tratado com `?:` e retorno antecipado | DL cap. 6 | `UnsafeCallOnNullableType` |

## 2. Legibilidade

| Regra | Fonte | Guarda |
|---|---|---|
| Função de escopo pela intenção — `apply` configura objeto, `also` efeito colateral, `let` transforma nulável, `run`/`with` bloco com receptor — e **nunca aninhada**; cadeia `?.let { } ?: run { }` vira `if`/`when` | DL cap. 11, EK 10, EK 14 | `NestedScopeFunctions` |
| Propriedade é estado barato; o que vai ao Redis é função (`countRequests()`, não `val total`) | EK 15 | revisão |
| Argumento nomeado com booleano ou parâmetros do mesmo tipo: `all(token, page = 1, perPage = 50, sorting = Sorting.NEWEST)` | EK 17 | revisão |
| Estilo oficial do Kotlin | EK 18 | ktlint (`ktlint_official`) |

## 3. Design

| Regra | Fonte | Guarda |
|---|---|---|
| Um lugar só para: regex de UUID, regex de status `[1-5][0-9][0-9]`, formato de data `yyyy-MM-dd HH:mm:ss` UTC, nomes das chaves Redis | EK 19 | revisão |
| Um nível de abstração por função: controller orquestra, store fala com o Redis, extensão converte Servlet → modelo | EK 25 | `CyclomaticComplexMethod`, `LongMethod` |
| Redis envolto em classes de store (protege o JSON compartilhado com o app antigo). **Classe concreta, sem interface** até existir segunda implementação; testes com Redis real (Testcontainers) | EK 26, EK 28 | revisão |
| Conversão de borda como extensão de nível superior: `HttpServletRequest.toCapturedRequest()`. É **a** forma de criar `CapturedRequest` (sem fábrica paralela no companion); nada de extensão membro | EK 45, EK 46, DL cap. 10 | revisão |
| Injeção só por construtor; sem `lateinit` em bean, sem injeção por campo | EK 35 | `LateinitUsage` |
| `data class` para modelos e DTOs de página | EK 37, DL cap. 15 | revisão |
| Conjunto fechado de valores é `enum`: `Sorting { OLDEST, NEWEST }`; no plano de features, os limites da limpeza (500/1000/5000/10000) | EK 41, DL cap. 5 | revisão |
| Hierarquia fechada é `sealed`, com `when` exaustivo **sem `else`**; no plano de features, `sealed interface RetryAfter { Seconds; HttpDate }` | EK 39, EK 40, DL cap. 16 | revisão |
| IDs com tipo próprio: `@JvmInline value class TokenId(val value: UUID)` e `RequestId` — os dois são UUID e hoje trocam de lugar sem erro de compilação. O Spring MVC 7 faz o binding de `@PathVariable` e o Jackson 3 (módulo Kotlin) lê e grava a value class como a string do UUID, sem `Converter` | EK 52 | revisão |
| Exceção só no excepcional; capturar tipo específico; tratamento HTTP centralizado no `@RestControllerAdvice` | DL cap. 17 | `TooGenericExceptionCaught` |
| Paginação sempre no Redis, nunca carregando tudo em memória (é o bug medido de 10k mensagens). Exceção vigente: a hash `token:{uuid}:requests` do app antigo não tem índice; enquanto ela for o formato, a página sai de um HGETALL limitado a `WEBHOOK_MAX_REQUESTS` | medição do plano de features; EK 57 | revisão |

## 4. Concorrência

- **Spring MVC + threads virtuais do Java 25, sem corrotinas**: o cliente Redis e o `timeout`
  são bloqueantes, e a thread virtual resolve o custo.
- Se corrotinas entrarem um dia: *Kotlin Coroutines: Deep Dive* (Moskala) e DL cap. 20 —
  concorrência estruturada, nada de `GlobalScope`.

## 5. Guardas automáticas

- `cd backend && ./gradlew check` roda testes, ktlint e detekt; o build falha em violação.
- detekt: `UnsafeCallOnNullableType`, `VarCouldBeVal`, `UseRequire`, `UseCheckOrError`,
  `TooGenericExceptionThrown`, `TooGenericExceptionCaught`, `NestedScopeFunctions`,
  `LateinitUsage`, `CyclomaticComplexMethod`, `LongMethod`.
- **detekt 2.0.0-alpha.6** com resolução de tipos (`detektMain`, `detektTest`), ligado ao `check`.
  O 1.23.8 estável embute o compilador Kotlin 2.0.21, que não roda no JDK 25 (falha ao ler a
  versão `25.0.3`); a alpha é compilada com Kotlin 2.4.10 e dispara todas as regras acima.
  As regras de nulidade, escopo e `val` só funcionam com resolução de tipos.
- **ktlint 1.8.0** (`ktlint_official`, `.editorconfig` de `backend/`).
- As duas ferramentas embutem o compilador Kotlin e rodam com a versão com que foram
  compiladas (2.4.10 e 2.2.21); o `build.gradle.kts` fixa essas versões nas configurações
  delas, porque o plugin de dependências do Spring imporia a do projeto.

## 6. Cortado na revisão (e por quê)

| Regra cortada | Motivo |
|---|---|
| Minimizar escopo de variáveis (EK 4) | Genérica, sem caso concreto; o code review normal pega |
| `use` para fechar o corpo da requisição (EK 8) | O stream é do container Servlet, que fecha sozinho; não há recurso nosso para fechar |
| "Escrever testes" (EK 9) | Já cobrado pelos critérios de cada item e pela skill `pdpj-bdd-tests` |
| Tipo de retorno explícito em função pública (EK 13) | Voltado a bibliotecas; num app de um módulo só não protege ninguém |
| Visibilidade mínima com `internal` (EK 29) | Com um módulo Gradle só, `internal` equivale a `public` |
| Fábrica no companion (EK 32–33) | Duplicava a extensão `toCapturedRequest()`; ficou uma forma só |
| Composição e delegação com `by` (EK 36, DL cap. 13) | Nenhuma herança prevista no backend |
| `Sequence` para coleção grande (EK 54) | A coleção grande (mensagens) é paginada no Redis; a regra que importa ficou na §3 |
| Sem cache sem medição (EK 49) | Regra geral de toda mudança, não específica de Kotlin |
