// @ts-check
// Guardas automáticas do padrão Angular (docs/padroes-angular.md, §7).
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const boundaries = require('eslint-plugin-boundaries');

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
        // Ações carregadas por import() (diálogos e fluxos de outra feature).
        { category: 'actions', pattern: 'src/app/*/*-actions.ts' },
        { category: 'actions', pattern: 'src/app/rules/rule-from-request.ts' },
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
        // Legado: componentes que uma feature importava de outra antes do item 14. Cada fatia que
        // reescreve a tela tira os seus daqui (E4: detalhe, lista, busca, opções, tutorial; E7:
        // method-label no Outbound; E8: compare-outlet). Nada novo entra nesta lista.
        {
          category: 'legacy',
          pattern: [
            'src/app/request-detail/request-detail.ts',
            'src/app/request-detail/request-view.ts',
            'src/app/requests/request-list.ts',
            'src/app/requests/request-nav.ts',
            'src/app/requests/method-label.ts',
            'src/app/settings/options-bar.ts',
            'src/app/tutorial/tutorial.ts',
            'src/app/diff/compare-outlet.ts',
            'src/app/ai/explain-panel.ts',
            'src/app/ai/rule-suggest.ts',
            'src/app/search/request-search.ts',
            'src/app/share/share-dialog.ts',
          ],
        },
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
                    file: { categories: ['store', 'actions', 'model', 'legacy'] },
                  },
                },
              ],
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
    },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);
