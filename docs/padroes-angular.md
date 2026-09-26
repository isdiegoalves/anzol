# Padrões Angular do frontend

> Padrão de código obrigatório do `frontend/` (Angular 22 + Angular Material). Aprovado em
> 2026-09-25: o dono do projeto escolheu as referências e a biblioteca visual e delegou a revisão
> das regras. As guardas automáticas da §7 estão em `frontend/eslint.config.js` (`npx ng lint`) e
> o formato no Prettier (`npm run format:check`). Mudança de regra se faz neste arquivo, no mesmo
> commit que muda a guarda.
>
> **Referências:** **Time do Angular** (guia de estilo e boas práticas em angular.dev; guia de
> tema do Angular Material) como base; **Armen Vardanyan** (*Modern Angular*, Manning, dez/2024)
> como referência didática; **Tomas Trajan** (*Angular Enterprise Architecture*, v2.5.0,
> jul/2025) de reserva (§8).
> **Desempate:** os livros são anteriores ao Angular 22. Conflito com o guia oficial → vale o
> oficial (ex.: livros declaram `OnPush`; na 22 é padrão e o guia manda não escrever).
> **Fonte:** **EG** = guia de estilo (angular.dev/style-guide); **BP** = boas práticas do time
> (angular.dev/ai/develop-with-ai); **MT** = guia de tema do Material (`guides/theming.md` do
> repositório angular/components); **MA cap. n** = capítulo n do *Modern Angular* (sumário da Manning).
> **Guarda:** regra do angular-eslint 22.5.0 / typescript-eslint; "revisão" = code review.
> **Critério para uma regra estar aqui:** caso concreto nesta tela ou guarda automática.
> **Versões:** Angular 22.2.0, Angular Material e CDK 22.2.0 (npm, 2026-09-25).

## 1. Nomes e estrutura

| Regra | Fonte | Guarda |
|---|---|---|
| Arquivo com hífen e nome da classe, **sem sufixo de tipo**: `token-list.ts` com a classe `TokenList`; `.html`/`.scss`/`.spec.ts` com o mesmo nome base, lado a lado | EG | revisão; desligar `component-class-suffix` e `directive-class-suffix` |
| Pastas por funcionalidade, nunca por tipo: `src/app/token/`, `requests/`, `request-detail/`, `settings/` — nada de `components/` ou `services/` | EG | revisão |

## 2. Componentes

| Regra | Fonte | Guarda |
|---|---|---|
| Standalone, **sem escrever** `standalone: true`; **sem declarar** `OnPush` (padrões na 22) | BP, MA cap. 2 | `prefer-standalone`; desligar `prefer-on-push-component-change-detection` |
| `input()`, `output()`, `model()` em vez de decorators, todos `readonly` | BP, EG | `prefer-signals`, `prefer-output-emitter-ref`, `prefer-output-readonly`, `prefer-signal-model` |
| Membro usado só no template é `protected` | EG | revisão |
| Componente só com lógica de tela; API e regras ficam no serviço da funcionalidade | EG | revisão |
| Handler nomeado pelo que faz: `deleteRequest()`, `copyAsCurl()` — não `onClick()` | EG | revisão |

## 3. Templates

| Regra | Fonte | Guarda |
|---|---|---|
| `@if`/`@for`/`@switch`; `@for` com `track request.uuid`; `@empty` para lista vazia | BP | `template/prefer-control-flow`, `template/use-track-by-function`, `template/prefer-at-empty` |
| `[class.x]`/`[style.x]` em vez de `ngClass`/`ngStyle` (ex.: cor do método HTTP na lista) | EG, BP | `template/prefer-class-binding`, `template/prefer-style-binding` |
| Sinal lido com `()`; sem `!` e sem `any` no template | BP | `no-uncalled-signals`, `template/no-non-null-assertion`, `template/no-any` |
| `type` em todo botão, `label` ligado ao campo nos diálogos, teclado em tudo que é clicável | qualidade | `template/button-has-type`, `template/label-has-associated-control`, `template/click-events-have-key-events` |

## 4. Estado, serviços e injeção

| Regra | Fonte | Guarda |
|---|---|---|
| `inject()` no topo da classe, sem injeção pelo construtor | EG, BP, MA cap. 3 | `prefer-inject`, `inject-at-top` |
| Serviço da funcionalidade com `providedIn: 'root'` | BP | `use-injectable-provided-in` |
| Estado em signals no serviço da funcionalidade (token atual, lista, mensagem aberta); derivado com `computed()`, derivado de várias fontes com `linkedSignal()` (ex.: mensagem aberta a partir da rota + lista). **Sem NgRx** | BP, MA cap. 6–7 | `computed-must-return` |
| RxJS só onde há fluxo de eventos (SSE); encerrado com `takeUntilDestroyed` ou convertido com `toSignal`. `EventSource` encapsulado num serviço, exposto como signal | MA cap. 5–6 | `no-implicit-take-until-destroyed` |

## 5. Angular Material

| Regra | Fonte | Guarda |
|---|---|---|
| Componentes do Material no lugar do Bootstrap/jQuery atuais: `MatDialog` (criar/editar URL, configurações de redirect), `MatSelect` (dropdown da limpeza automática, plano de features), `MatSlideToggle` (formatar JSON, auto-navegar, CORS, redirect), `MatSnackBar` ("Request received", no lugar do bootstrap-notify), `MatPaginator` ou botões de página | — (substituição 1:1) | revisão |
| CDK no lugar das bibliotecas avulsas: `cdk-virtual-scroll-viewport` (lista), `Clipboard` do CDK (no lugar do `clipboard.js`/`copy-to-clipboard`) | — (substituição 1:1) | revisão |
| Tema **só** pelo `mat.theme` (cor, tipografia, densidade), num único arquivo de estilos global | MT | revisão |
| Ajuste fino só via `mat.theme-overrides` ou mixins `overrides` de componente. **Nunca** estilizar classes internas (`.mat-mdc-*`) nem a estrutura do DOM dos componentes: o time do Material as trata como detalhe privado que "pode mudar a qualquer momento" | MT ("Direct Style Overrides") | revisão |
| Um sistema de estilo só: Material + SCSS do componente; sem Tailwind nem Bootstrap junto | — (evitar dois sistemas) | revisão |

## 6. Formulários e TypeScript

| Regra | Fonte | Guarda |
|---|---|---|
| Diálogos criar/editar URL com Reactive Forms tipados e a mesma validação do servidor (`timeout` 0–10) | MA cap. 4 | revisão |
| `strict` e `strictTemplates` ligados | BP | `tsconfig.json` (o build falha) |
| Sem `any`; `unknown` quando o tipo é incerto (ex.: corpo JSON da mensagem) | BP | `@typescript-eslint/no-explicit-any` |

## 7. Testes e guardas automáticas

- Vitest (padrão do CLI) para componentes e serviços; Playwright para E2E e contrato; skill
  `pdpj-bdd-tests`. Componentes do Material testados pelos harnesses do CDK
  (`TestbedHarnessEnvironment`), não por seletor CSS interno.
- `ng lint` (angular-eslint 22.5.0 + typescript-eslint) e Prettier no `check`; o build falha em violação.
- Regras ativadas: as da coluna "Guarda". **Desligadas de propósito** por conflitarem com o
  Angular 22: `component-class-suffix`, `directive-class-suffix`,
  `prefer-on-push-component-change-detection`, `template/no-call-expression` (ler signal é chamada).

## 8. Quando entra o Trajan

Se o plano de features trouxer várias telas novas (busca, exportação, configurações), adotar a
separação dele entre funcionalidades isoladas e código compartilhado, cobrada com
`eslint-plugin-boundaries`. Até lá, a organização por funcionalidade do guia oficial basta.

## 9. Cortado na revisão (e por quê)

| Regra cortada | Motivo |
|---|---|
| Um conceito por arquivo; `main.ts` como bootstrap (EG) | O CLI já gera assim; juntei o essencial na regra de nomes |
| Bindings no objeto `host` (BP) | Nenhum componente desta tela precisa de binding no host; a guarda `prefer-host-metadata-property` fica ligada mesmo assim |
| Hooks de ciclo de vida com interface (EG) | Com signals, a tela quase não usa hooks; o lint `use-lifecycle-interface` segue ligado |
| Inferir tipo quando óbvio (BP) | Genérica; o `strict` e o review cobrem |
| `NgOptimizedImage` (BP) | A tela não tem imagem estática |
