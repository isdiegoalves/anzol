// @ts-check
// Guardas automáticas do padrão Angular (docs/padroes-angular.md, §7).
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const boundaries = require('eslint-plugin-boundaries');

/**
 * Atributos que não são texto para o usuário (e ficam fora da guarda de i18n): os técnicos do
 * padrão do angular-eslint mais os do Material, do CDK e dos componentes de `ui/` desta tela.
 */
const I18N_IGNORED_ATTRIBUTES = [
  'autocomplete',
  'charset',
  'class',
  'color',
  'colspan',
  'dir',
  'fill',
  'for',
  'formArrayName',
  'formControlName',
  'formGroupName',
  'height',
  'href',
  'id',
  'lang',
  'list',
  'name',
  'ngClass',
  'ngProjectAs',
  'role',
  'routerLink',
  'routerLinkActive',
  'src',
  'stroke',
  'stroke-width',
  'style',
  'svgIcon',
  'tabindex',
  'target',
  'type',
  'value',
  'viewBox',
  'width',
  'xmlns',
  'rel',
  'mode',
  'diameter',
  'align',
  'appearance',
  'animationDuration',
  'mat-stretch-tabs',
  'inputmode',
  'enterkeyhint',
  'maxlength',
  'minlength',
  'min',
  'max',
  'step',
  'rows',
  'cols',
  'spellcheck',
  'accept',
  'subscriptSizing',
  'size',
  'icon',
  'language',
  'storageKey',
  'itemSize',
  'aria-orientation',
  'aria-hidden',
  'aria-live',
  'aria-haspopup',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'focusable',
  'stroke-linecap',
  'stroke-linejoin',
  'x',
  'y',
  'rx',
  'r',
  'cx',
  'cy',
  'd',
  'text-anchor',
  'dominant-baseline',
  'preserveAspectRatio',
  'matInput',
  'cdkDrag',
  'cdkDropList',
  'cdkDragHandle',
  'mat-dialog-close',
  'mat-dialog-title',
  'matTooltip',
  'data-kind',
  'splitStart',
  'splitEnd',
  'paneActions',
  'viewNav',
  'viewActions',
  'listTools',
  'listOptions',
  'formControl',
  'multiple',
  'hideSingleSelectionIndicator',
  'labelPosition',
  'panelClass',
  'pattern',
  'accesskey',
  'scope',
  'headers',
  'datetime',
  'download',
  'wrap',
  'form',
  'cdkDropListLockAxis',
];

/**
 * As pastas da Inbox, do Compare (usa a mesma lista) e do onboarding (o detalhe da URL vazia), §8
 * do padrão: importam umas das outras.
 */
const INBOX_PARTS = '{inbox,requests,request-detail,search,diff,onboarding}';

module.exports = defineConfig([
  {
    files: ['src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      // §2 Componentes
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-signal-model': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
      // §3 Templates (leitura de signal sem chamada)
      '@angular-eslint/no-uncalled-signals': 'error',
      // §4 Estado, serviços e injeção
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/inject-at-top': 'error',
      '@angular-eslint/use-injectable-provided-in': 'error',
      '@angular-eslint/computed-must-return': 'error',
      '@angular-eslint/no-implicit-take-until-destroyed': 'error',
      // §6 TypeScript
      '@typescript-eslint/no-explicit-any': 'error',
      // Desligadas de propósito (§7): conflitam com o Angular 22.
      '@angular-eslint/component-class-suffix': 'off',
      '@angular-eslint/directive-class-suffix': 'off',
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
    },
  },
  {
    // §7 Pacote inicial: o que o `main.ts` alcança estaticamente não importa (em valor) o que traz o
    // `Overlay` do CDK ou barras do Material. Esses entram só em chunk lazy, por rota ou `import()`.
    files: [
      'src/main.ts',
      'src/locale/**/*.ts',
      'src/app/app.ts',
      'src/app/app.config.ts',
      'src/app/app.routes.ts',
      'src/app/legacy-hash.ts',
      'src/app/shell/**/*.ts',
      'src/app/ui/**/*.ts',
      'src/app/pipeline/**/*.ts',
      'src/app/token/token-store.ts',
      'src/app/token/url-lock.ts',
      'src/app/settings/preferences.ts',
    ],
    ignores: ['**/*.spec.ts'],
    rules: {
      // § i18n: o módulo destes arquivos roda antes do `loadTranslations` (o `main.ts` os importa
      // estaticamente); `$localize` numa constante de módulo ficaria em inglês.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ":matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > TaggedTemplateExpression[tag.name='$localize'], :matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > :matches(ObjectExpression, ArrayExpression) TaggedTemplateExpression[tag.name='$localize']",
          message:
            '$localize em constante de módulo alcançada pelo main.ts roda antes da tradução (docs/padroes-angular.md, § i18n): leve para uma função ou para a instância.',
        },
      ],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^@angular/(material/(snack-bar|toolbar|tooltip|menu|dialog|select|autocomplete)|cdk/(overlay|dialog|menu))$',
              allowTypeImports: true,
              message:
                'Traz o Overlay ou barra do Material para o pacote inicial (docs/padroes-angular.md §7): carregue por import() ou rota lazy.',
            },
          ],
        },
      ],
    },
  },
  {
    // §8 Fronteiras (Trajan): `ui/` e `pipeline/` não importam feature; feature não importa outra
    // feature, salvo o que é público dela (stores e serviços, `*-actions` por import(), modelos).
    // `app` (raiz), `main.ts` e `shell/` montam a tela e importam tudo.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts', 'src/testing/**'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { node: { extensions: ['.ts', '.js', '.mjs'] } },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'shell', pattern: 'src/app/shell', partialMatch: false },
        { type: 'ui', pattern: 'src/app/ui', partialMatch: false },
        { type: 'pipeline', pattern: 'src/app/pipeline', partialMatch: false },
        { type: 'catalog', pattern: 'src/app/catalog', partialMatch: false },
        { type: 'feature', pattern: 'src/app/*', partialMatch: false, capture: ['feature'] },
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'locale', pattern: 'src/locale', partialMatch: false },
        { type: 'main', pattern: 'src', partialMatch: false },
      ],
      'boundaries/files': [
        // Estado e serviços públicos de uma feature.
        { category: 'store', pattern: 'src/app/*/*-store.ts' },
        {
          category: 'store',
          pattern: [
            'src/app/settings/preferences.ts',
            'src/app/settings/redirect.ts',
            'src/app/realtime/request-stream.ts',
            'src/app/token/url-lock.ts',
            'src/app/ai/ai-client.ts',
          ],
        },
        // Ações carregadas por import() (diálogos e fluxos de outra feature): o `openShareDialog`
        // é o diálogo "Share read-only link…" que o detalhe abre.
        { category: 'actions', pattern: 'src/app/*/*-actions.ts' },
        { category: 'actions', pattern: 'src/app/share/share-dialog.ts' },
        // Tipos e funções puras do domínio.
        {
          category: 'model',
          pattern: [
            'src/app/requests/webhook-request.ts',
            'src/app/token/token.ts',
            'src/app/rules/rule.ts',
            'src/app/stats/stats.ts',
            'src/app/share/share.ts',
            'src/app/outbound/outbound.ts',
            'src/app/search/request-filter.ts',
            'src/app/request-detail/dates.ts',
          ],
        },
        // Componente que uma feature publica para outra: a mensagem só-leitura do detalhe, que a
        // página do link (share/) mostra igual. A lista "legado" do item 14 zerou na E11.
        { category: 'public', pattern: 'src/app/request-detail/request-view.ts' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '{{from.element.types}} não importa {{to.element.types}} {{to.element.captured.feature}} (docs/padroes-angular.md §8)',
          policies: [
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            {
              from: { element: { types: ['main', 'app', 'shell'] } },
              allow: {
                to: {
                  element: {
                    types: [
                      'main',
                      'app',
                      'shell',
                      'ui',
                      'pipeline',
                      'feature',
                      'catalog',
                      'locale',
                    ],
                  },
                },
              },
            },
            {
              from: { element: { type: 'locale' } },
              allow: { to: { element: { type: 'locale' } } },
            },
            {
              from: { element: { type: 'ui' } },
              allow: [
                { to: { element: { type: 'ui' } } },
                { to: { element: { type: 'pipeline' } }, dependency: { kind: 'type' } },
              ],
            },
            {
              from: { element: { type: 'pipeline' } },
              allow: [
                { to: { element: { type: 'pipeline' } } },
                { to: { element: { type: 'feature' }, file: { categories: 'model' } } },
              ],
            },
            {
              from: { element: { type: 'catalog' } },
              allow: [
                { to: { element: { types: ['catalog', 'ui', 'pipeline'] } } },
                { to: { element: { type: 'feature' }, file: { categories: 'model' } } },
              ],
            },
            {
              from: { element: { type: 'feature' } },
              allow: [
                { to: { element: { types: ['ui', 'pipeline', 'shell'] } } },
                {
                  to: {
                    element: {
                      type: 'feature',
                      captured: { feature: '{{from.element.captured.feature}}' },
                    },
                  },
                },
                {
                  to: {
                    element: { type: 'feature' },
                    file: { categories: ['store', 'actions', 'model', 'public'] },
                  },
                },
              ],
            },
            {
              // A Inbox (item 14, E4) é feita de quatro pastas que se compõem: a página (inbox/),
              // a lista (requests/), o detalhe (request-detail/) e a busca (search/); o Compare
              // (diff/, E8) usa a mesma lista e o onboarding (onboarding/, E10) ocupa o detalhe vazio.
              from: { element: { type: 'feature', captured: { feature: INBOX_PARTS } } },
              allow: { to: { element: { type: 'feature', captured: { feature: INBOX_PARTS } } } },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // §3 Templates
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/use-track-by-function': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-class-binding': 'error',
      '@angular-eslint/template/prefer-style-binding': 'error',
      '@angular-eslint/template/no-non-null-assertion': 'error',
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/label-has-associated-control': 'error',
      '@angular-eslint/template/click-events-have-key-events': 'error',
      // Desligada de propósito (§7): ler signal é chamada.
      '@angular-eslint/template/no-call-expression': 'off',
      // Nova § i18n: todo texto e atributo legível da tela marcado com i18n (tradução em runtime).
      // Ids gerados pelo conteúdo (checkId off): o arquivo pt-BR sai do `ng extract-i18n`.
      '@angular-eslint/template/i18n': [
        'error',
        {
          checkId: false,
          checkDuplicateId: false,
          ignoreAttributes: I18N_IGNORED_ATTRIBUTES,
          // Só pontuação, números, símbolos e códigos (HTTP, JSON) não precisam de tradução.
          boundTextAllowedPattern: '^[\\s\\d·…:/()\\[\\]{}"#%+\\-–—=|,.⋯✓✕⊘↑↓×&;?!*@$<>]*$',
        },
      ],
    },
  },
  {
    // O catálogo de `ui/` é só de desenvolvimento, e os templates de spec são hospedeiros de teste.
    // O `index.html` é o documento, não um template (título e metas ficam como estão).
    files: ['src/index.html', 'src/app/catalog/**/*.html', 'src/**/*.spec.ts/*.html'],
    rules: { '@angular-eslint/template/i18n': 'off' },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
