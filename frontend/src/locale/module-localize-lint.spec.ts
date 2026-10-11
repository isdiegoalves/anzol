import { execFileSync } from 'node:child_process';

const CONSTANT = 'export const AGAIN = $localize`Connected again.`;\n';
const REACHED = [
  'src/app/realtime/connection-store.ts',
  'src/app/requests/request-store.ts',
  'src/app/shell/shell.ts',
];
const LAZY = [
  'src/app/checks/checks-draft.ts',
  'src/app/rules/rule.ts',
  'src/app/pipeline/pipeline.ts',
];

/** Lê `code` como se estivesse em cada arquivo e devolve as mensagens da guarda do `$localize`, por arquivo. */
const LINT = `
  const { ESLint } = require('eslint');
  const [files, code] = [JSON.parse(process.argv[1]), process.argv[2]];
  (async () => {
    const eslint = new ESLint();
    const accused = {};
    for (const filePath of files) {
      const [{ messages }] = await eslint.lintText(code, { filePath });
      accused[filePath] = messages
        .filter(({ ruleId }) => ruleId === 'no-restricted-syntax')
        .map(({ message }) => message);
    }
    process.stdout.write(JSON.stringify(accused));
  })();
`;

describe('Dado o lint do $localize em constante de módulo', () => {
  let accused: Record<string, string[]>;

  // O ESLint do projeto roda uma vez só, num processo à parte (o teste roda na pasta do frontend):
  // carregar a configuração é o que custa, e com a máquina carregada passa do prazo de um teste.
  beforeAll(() => {
    const files = JSON.stringify([...REACHED, ...LAZY]);
    accused = JSON.parse(
      execFileSync(process.execPath, ['-e', LINT, files, CONSTANT], { encoding: 'utf8' }),
    ) as Record<string, string[]>;
  }, 120_000);

  it.each(REACHED)(
    'deve acusar a constante em %s, que o main.ts alcança por import estático',
    (file) => {
      expect(accused[file]).toEqual([
        expect.stringContaining('$localize em constante de módulo alcançada pelo main.ts'),
      ]);
    },
  );

  it.each(LAZY)('não deve acusar a constante em %s, que só roda depois da tradução', (file) => {
    expect(accused[file]).toEqual([]);
  });
});
