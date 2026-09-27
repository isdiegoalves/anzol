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
| Componentes do Material no lugar do Bootstrap/jQuery atuais: `MatDialog` só em Create New URL, Share read-only link, configurações de redirect e confirmações (a configuração da URL e os editores viram páginas); filtros da busca como chips de alternância (`button` com `aria-pressed`, no grupo "Filters") e segmentados (`MatButtonToggleGroup`) na limpeza automática, no lugar de `MatSelect`; `MatSlideToggle` (Pretty, Follow new, CORS, redirect); `MatSnackBar` (avisos curtos, com a duração em cada `open()`, §7); `MatPaginator` ou botões de página | — (substituição 1:1) | revisão |
| CDK no lugar das bibliotecas avulsas: `cdk-virtual-scroll-viewport` (lista), `Clipboard` do CDK (no lugar do `clipboard.js`/`copy-to-clipboard`) | — (substituição 1:1) | revisão |
| Tema **só** pelo `mat.theme` (cor, tipografia, densidade), num único arquivo de estilos global (`src/styles.scss`). Tema "Harbor": paletas geradas por `ng generate @angular/material:theme-color` (primária `#1D6A73`, terciária `#8E4D2C`) em `src/_theme-colors.scss`, que não se edita à mão; claro e escuro com `theme-type: color-scheme` (o Material emite `light-dark()`); alto contraste pelo mixin gerado, em `prefers-contrast: more` | MT | revisão |
| Cor que o M3 não tem (sucesso, aviso) é *custom property* `--app-*` com `light-dark()`, no `styles.scss`, no padrão de nome dos tokens de sistema (`--app-success-container`, `--app-on-warning-container`). SCSS de componente **só** com tokens `--mat-sys-*` e `--app-*`: nada de hex, `rgb()` ou cor por nome | MT | Stylelint (`color-no-hex`, `color-named`, `function-disallowed-list` nos `.scss` de `src/app/**`; `npm run lint:styles`, etapa do `ci.sh`) |
| Fontes auto-hospedadas em `public/fonts/` (woff2 variável, subconjunto latino, `font-display: swap`, com a licença OFL ao lado): Google Sans Flex na interface (eixo `ROND` em 100 nos títulos) e Google Sans Code em dado (`--app-code-family`). Nada de CDN: o app roda local e pode ficar offline. `preload` só da Flex | — (estudo C §1.5) | revisão |
| Ajuste fino só via `mat.theme-overrides` ou mixins `overrides` de componente. **Nunca** estilizar classes internas (`.mat-mdc-*`) nem a estrutura do DOM dos componentes: o time do Material as trata como detalhe privado que "pode mudar a qualquer momento" | MT ("Direct Style Overrides") | revisão |
| Um sistema de estilo só: Material + SCSS do componente; sem Tailwind nem Bootstrap junto | — (evitar dois sistemas) | revisão |

## 6. Formulários e TypeScript

| Regra | Fonte | Guarda |
|---|---|---|
| Formulários da URL (cartões de Checks e o diálogo Create New URL) com Reactive Forms tipados e a mesma validação do servidor (`timeout` 0–10, `retry_after`, segredo de 8 a 256) | MA cap. 4 | revisão |
| Botão de salvar **nunca** `disabled`: o que falta fica num `status` ("To save, fill in: …"); clicar marca os campos, foca o primeiro e passa o resumo a `alert` (S12 do item 14) | WCAG 3.3.1/3.3.2; GOV.UK Design System | revisão |
| Escrita na API de gestão só por `HttpClient` com corpo JSON, da própria origem: nada de `<form method="post">` nativo, `_method` ou `application/x-www-form-urlencoded` (item 12 recusa). Como o `PUT /token/{id}` volta ao padrão o campo ausente, cada cartão manda a configuração salva inteira com a sua parte trocada (`savedSettings`) | — (item 12; CA-11 do item 14) | revisão e o E2E de CA-11 |
| `strict` e `strictTemplates` ligados | BP | `tsconfig.json` (o build falha) |
| Sem `any`; `unknown` quando o tipo é incerto (ex.: corpo JSON da mensagem) | BP | `@typescript-eslint/no-explicit-any` |

## 7. Testes e guardas automáticas

- Vitest (padrão do CLI) para componentes e serviços; Playwright para E2E e contrato; skill
  `pdpj-bdd-tests`. Componentes do Material testados pelos harnesses do CDK
  (`TestbedHarnessEnvironment`), não por seletor CSS interno.
- Componentes de `ui/`, `shell/` e páginas com **Angular Testing Library**
  (`@testing-library/angular` + `@testing-library/user-event`), consultando por papel e nome
  acessível (`getByRole('separator', { name: 'Resize list and detail' })`): o teste cobra a
  acessibilidade junto com o comportamento. Componentes do Material continuam por harness.
  `axe-core` em cada estado dos componentes de `ui/`, pelo helper `expectNoAxeViolations`
  (`src/testing/axe.ts`, WCAG 2.2 A/AA; o contraste fica com o E2E, porque o jsdom não calcula
  cor). Specs com TestBed existentes valem até o componente ser reescrito. Guarda: revisão e o
  helper de axe.
- Catálogo de `ui/` em `#/_catalog`, só em desenvolvimento (`fileReplacements` troca as rotas dele
  por nenhuma no build de produção). Sem Storybook.
- `ng lint` (angular-eslint 22.5.0 + typescript-eslint), Stylelint (`npm run lint:styles`) e
  Prettier no `check`; o build falha em violação.
- **Pacote inicial:** aviso em 500 kB e **erro em 550 kB** (orçamento `initial` do `angular.json`);
  `anyScript` só com aviso, em 310 kB (o maior chunk medido em 2026-09-26). O que é novo nasce em
  chunk lazy (rota com `loadComponent` ou `import()`). Nada de `MatToolbar`, `MatSnackBar`,
  `MatTooltip`, `MatMenu`, `MatDialog` ou `Overlay` no que o `main.ts` alcança estaticamente: o
  `Overlay` do CDK traz o `scrolling` junto (~80 kB). Por isso não há `MAT_SNACK_BAR_DEFAULT_OPTIONS`
  no `app.config.ts`: cada `open()` do snackbar diz a duração. Guarda: `budgets` do `angular.json` e
  `no-restricted-imports` nos arquivos do caminho inicial (`eslint.config.js`).
- Regras ativadas: as da coluna "Guarda". **Desligadas de propósito** por conflitarem com o
  Angular 22: `component-class-suffix`, `directive-class-suffix`,
  `prefer-on-push-component-change-detection`, `template/no-call-expression` (ler signal é chamada).

## 8. Fronteiras (Trajan)

A interface nova (item 14) trouxe as várias telas que a versão anterior desta seção esperava; a
separação do Trajan entre código compartilhado e funcionalidades isoladas vira regra, cobrada pelo
`eslint-plugin-boundaries` (`boundaries/dependencies` no `eslint.config.js`).

| Pasta | O que é | Pode importar |
|---|---|---|
| `src/app/ui/` | Biblioteca interna, só apresentação (selo, tabela, bloco de código, split…) | `ui/`; de `pipeline/` só tipos |
| `src/app/pipeline/` | Funções puras que derivam da mensagem o que a tela mostra (`pipelineOf`) | `pipeline/` e os modelos das features |
| `src/app/shell/` | Rail, cabeçalho da URL, Settings e Help: monta a tela | tudo |
| `src/app/<feature>/` | Uma funcionalidade (`inbox/`, `rules/`, `checks/`…) | a própria feature, `ui/`, `pipeline/`, `shell/` e o que é público das outras: stores e serviços (`*-store.ts`, `Preferences`, `RequestStream`…), `*-actions.ts` e o `openShareDialog` por `import()`, o `request-view` (a mensagem só-leitura que a página do link mostra) e os modelos (`webhook-request.ts`, `token.ts`, `rule.ts`, `stats.ts`…) |
| `src/app/*.ts`, `src/main.ts` | Raiz: rotas e bootstrap | tudo |

A Inbox é feita de quatro pastas que se compõem e se importam entre si: a página (`inbox/`), a
lista (`requests/`), o detalhe (`request-detail/`) e a busca (`search/`); o Compare (`diff/`)
usa a mesma lista e o onboarding (`onboarding/`) ocupa o detalhe da URL vazia, e os dois entram
no grupo (`INBOX_PARTS` no `eslint.config.js`). Componente que duas features usam vai para `ui/`
(como o `app-markdown` da IA) ou para a feature que o mostra (o Explain no detalhe, o Suggest em
Rules); `ai/` guarda só o cliente. A lista "legado" do item 14 zerou na E11: nada importa de
outra feature sem uma regra da tabela acima.

## 9. i18n

Tradução em runtime, um build só: a raiz do servidor é o namespace dos webhooks, então não há
`/pt-BR/`. O inglês é o texto do código; o pt-BR vem de `src/locale/pt-BR.ts`, num chunk próprio.

| Regra | Fonte | Guarda |
|---|---|---|
| Todo texto e atributo legível da tela marcado: `i18n` no elemento que tem a frase inteira (o link ou o `<code>` do meio viram placeholder), `i18n-aria-label`, `i18n-title`, `i18n-placeholder`, `i18n-<input>` nos componentes (`heading`, `label`, `empty`…). Sem `i18n` dentro de `i18n` | angular.dev (i18n) | `@angular-eslint/template/i18n` (atributos técnicos na lista `I18N_IGNORED_ATTRIBUTES` do `eslint.config.js`); o compilador recusa `i18n` aninhado (NG5002) |
| Texto do TypeScript (snackbar, `aria-label` com valor, rótulo de selo, erro) com `` $localize`…` ``; placeholder com nome quando ajuda quem traduz (`` $localize`Delete request ${uuid}:uuid:` ``). Nome acessível com valor sai de um método ou campo com `$localize`: o `aria-label` interpolado no template não vira atributo | angular.dev (i18n) | revisão |
| A tradução entra **antes** do `bootstrapApplication`: `main.ts` chama `loadLocale()`, que faz `import('./pt-BR')` e `loadTranslations()`. Por isso **nada de `$localize` em constante de módulo alcançada estaticamente pelo `main.ts`** (shell, `ui/`, `pipeline/`…): ela roda antes da tradução e fica em inglês. Leve para uma função ou para a instância (`private readonly labels = { … }`) | angular.dev (`loadTranslations`) | `no-restricted-syntax` nos arquivos do caminho inicial (`eslint.config.js`) e o E2E `i18n.spec.ts` |
| Estilo e lógica nunca olham o texto traduzido (`text.startsWith('Fails')`): o texto muda com o idioma. Decida por um campo do modelo (`{ fails, text }`). Botão diz a ação com verbo ("Enviar", não "Envio"); a mesma palavra como substantivo ganha outro id pelo significado (`i18n="action\|…"`) | angular.dev (meaning do i18n) | revisão; `rule-editor.spec.ts` confere a classe `fails` |
| Plural com ICU no template (`{count, plural, =1 {1 request} other {{{ count }} requests}}`) e, no TypeScript, uma frase por forma. Nada de `count === 1 ? 'request' : 'requests'` dentro de frase marcada | angular.dev (ICU) | revisão |
| Data e hora pelo `Intl` do idioma da tela (`localDate`, `fromNow` em `request-detail/dates.ts`); o inglês mantém o formato do app atual ("Sep 25, 2026 9:43 PM", "3 minutes ago") | estudo C §3.5 | `dates.spec.ts` |
| Frases do servidor (`reason` da assinatura, `failed` do near miss, 422) ficam em inglês, como a API devolve; o que a tela diz em volta é traduzido. A reason phrase do HTTP também fica | CA-4 do item 14 | revisão e o E2E `i18n.spec.ts` |
| Mensagem nova: `npx ng extract-i18n` atualiza `src/locale/messages.json` (a fonte, com ids gerados pelo conteúdo); a tradução entra em `pt-BR.ts` com o mesmo id e os mesmos placeholders e ICU. Em Settings, o nome de cada idioma fica na própria língua ("English", "Português (Brasil)") | — | `locale.spec.ts`: toda mensagem traduzida, placeholders iguais, nenhuma tradução órfã; `ci.sh` (etapa "i18n extraído"): `ng extract-i18n` e `git diff --exit-code` no `messages.json` |
| Idioma: o de Settings (`localStorage.language`), senão o do navegador, senão inglês; o `<html lang>` acompanha. Trocar pede recarregar | CA-4 do item 14 | `locale.spec.ts` |

## 10. Cortado na revisão (e por quê)

| Regra cortada | Motivo |
|---|---|
| Um conceito por arquivo; `main.ts` como bootstrap (EG) | O CLI já gera assim; juntei o essencial na regra de nomes |
| Bindings no objeto `host` (BP) | Nenhum componente desta tela precisa de binding no host; a guarda `prefer-host-metadata-property` fica ligada mesmo assim |
| Hooks de ciclo de vida com interface (EG) | Com signals, a tela quase não usa hooks; o lint `use-lifecycle-interface` segue ligado |
| Inferir tipo quando óbvio (BP) | Genérica; o `strict` e o review cobrem |
| `NgOptimizedImage` (BP) | A tela não tem imagem estática |
