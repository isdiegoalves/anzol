import { execFileSync } from 'node:child_process';

const CONSTANT = 'export const AGAIN = $localize`Connected again.`;\n';

/**
 * As mensagens da guarda do `$localize` quando `file` tem uma constante de módulo com ele: o ESLint do projeto
 * lê o conteúdo pela entrada padrão, com o caminho do arquivo de verdade (o teste roda na pasta do frontend).
 */
function accused(file: string): string[] {
  const args = ['node_modules/eslint/bin/eslint.js', '--stdin', '--stdin-filename', file];
  let output: string;
  try {
    output = execFileSync(process.execPath, [...args, '--format', 'json'], {
      input: CONSTANT,
      encoding: 'utf8',
    });
  } catch (error) {
    output = (error as { stdout: string }).stdout;
  }
  const [{ messages }] = JSON.parse(output) as [
    { messages: { ruleId: string; message: string }[] },
  ];
  return messages
    .filter(({ ruleId }) => ruleId === 'no-restricted-syntax')
    .map(({ message }) => message);
}

describe('Dado o lint do $localize em constante de módulo', () => {
  it.each([
    'src/app/realtime/connection-store.ts',
    'src/app/requests/request-store.ts',
    'src/app/shell/shell.ts',
  ])('deve acusar a constante em %s, que o main.ts alcança por import estático', (file) => {
    expect(accused(file)).toEqual([
      expect.stringContaining('$localize em constante de módulo alcançada pelo main.ts'),
    ]);
  });

  it.each([
    'src/app/checks/checks-draft.ts',
    'src/app/rules/rule.ts',
    'src/app/pipeline/pipeline.ts',
  ])('não deve acusar a constante em %s, que só roda depois da tradução', (file) => {
    expect(accused(file)).toEqual([]);
  });
});
