import { Clipboard } from '@angular/cdk/clipboard';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { codeLines } from './code-lines';
import { CodeView } from './code-view';
import { CopyField } from './copy-field';
import { KvTable } from './kv-table';

describe('Dado a tabela nome → valor (app-kv-table)', () => {
  const rows = [
    { name: 'content-type', value: 'application/json' },
    { name: 'stripe-signature', value: 't=1,v1=abc' },
    { name: 'x-vazio', value: '' },
  ];

  it('deve listar as linhas com o nome acessível da tabela e passar no axe', async () => {
    const { container } = await render(KvTable, { inputs: { label: 'Headers', rows } });

    const table = screen.getByRole('table', { name: 'Headers' });
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'content-type',
      'stripe-signature',
      'x-vazio',
    ]);
    expect(table.textContent).toContain('(empty)');
    await expectNoAxeViolations(container);
  });

  it('deve realçar a linha com a frase Quando há nota para o nome', async () => {
    const notes = new Map([
      [
        'stripe-signature',
        { tone: 'bad' as const, text: '✕ Signature invalid — signature mismatch' },
      ],
    ]);
    const { container } = await render(KvTable, { inputs: { label: 'Headers', rows, notes } });

    const row = screen.getByRole('rowheader', { name: 'stripe-signature' }).closest('tr');
    expect(row?.classList).toContain('bad');
    expect(row?.textContent).toContain('signature mismatch');
    await expectNoAxeViolations(container);
  });

  it('deve dizer a frase de vazio, sem tabela, Quando não há linhas', async () => {
    const { container } = await render(KvTable, {
      inputs: { label: 'Query', rows: [], empty: 'No query string.' },
    });

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No query string.')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe('Dado as linhas do bloco de código (codeLines)', () => {
  const text = '{"id":7,"data":{"amount":"10","tags":["a"]},"ok":true,"none":null,"a/b":{}}';
  const lineText = (tokens: { text: string }[]) => tokens.map((token) => token.text).join('');

  it('deve formatar o JSON como o JSON.stringify com 2 espaços', () => {
    const lines = codeLines(text, { json: true, pretty: true });

    expect(lines.map((line) => lineText(line.tokens))).toEqual(
      JSON.stringify(JSON.parse(text), null, 2).split('\n'),
    );
  });

  it('deve marcar a linha do JSON Pointer, subir ao pai quando o caminho não existe e escapar "/"', () => {
    const lines = codeLines(text, {
      json: true,
      pretty: true,
      marks: [
        { pointer: '/data/amount', message: 'must be integer' },
        { pointer: '/data/tags/0', message: 'must be longer' },
        { pointer: '/data/missing', message: 'must have required property missing' },
        { pointer: '/a~1b', message: 'escapado' },
        { pointer: '', message: 'na raiz' },
      ],
    });
    const marked = lines
      .map((line, index) => [index + 1, lineText(line.tokens).trim(), line.marks] as const)
      .filter(([, , marks]) => marks.length > 0);

    expect(marked).toEqual([
      [1, '{', ['na raiz']],
      [3, '"data": {', ['must have required property missing']],
      [4, '"amount": "10",', ['must be integer']],
      [6, '"a"', ['must be longer']],
      [11, '"a/b": {}', ['escapado']],
    ]);
  });

  it('deve dar as classes de realce por tipo de valor', () => {
    const [, second] = codeLines('{"n":1}', { json: true, pretty: true });

    expect(second.tokens.map((token) => [token.kind, token.text])).toEqual([
      ['text', '  '],
      ['key', '"n"'],
      ['punct', ': '],
      ['number', '1'],
    ]);
  });

  it.each([
    ['não é JSON', 'a=1\nb=2', { json: true, pretty: true }],
    ['o "Raw" está ligado', '{"a":1}', { json: true, pretty: false }],
    ['é texto', '<x/>', { json: false, pretty: true }],
  ])(
    'deve mostrar como veio, com as marcas na primeira linha, Quando %s',
    (_caso, source, opts) => {
      const lines = codeLines(source, { ...opts, marks: [{ pointer: '/a', message: 'erro' }] });

      expect(lines.map((line) => lineText(line.tokens))).toEqual(source.split('\n'));
      expect(lines[0].marks).toEqual(['erro']);
    },
  );
});

describe('Dado o bloco de código (app-code-view)', () => {
  it('deve mostrar o JSON formatado, com a marca embaixo da linha, focável e passar no axe', async () => {
    const { container } = await render(CodeView, {
      inputs: {
        label: 'Request body',
        text: '{"amount":"10"}',
        marks: [{ pointer: '/amount', message: 'must be integer' }],
      },
    });

    const block = container.querySelector('pre');
    expect(block?.getAttribute('aria-label')).toBe('Request body');
    expect(block?.getAttribute('tabindex')).toBe('0');
    expect(block?.textContent).toBe('{  "amount": "10"must be integer}');
    expect(container.querySelector('.line.marked')?.textContent).toBe('  "amount": "10"');
    await expectNoAxeViolations(container);
  });

  it('deve mostrar o corpo como veio Quando "pretty" está desligado', async () => {
    const { container } = await render(CodeView, {
      inputs: { label: 'Request body', text: '{"a":1}', pretty: false },
    });

    expect(container.querySelector('pre')?.textContent).toBe('{"a":1}');
    await expectNoAxeViolations(container);
  });

  it('deve dizer que não há corpo Quando o texto é vazio', async () => {
    const { container } = await render(CodeView, { inputs: { label: 'Request body', text: '' } });

    expect(screen.getByText('(no body content)')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe('Dado o campo de copiar (app-copy-field)', () => {
  it('deve mostrar o valor no campo com o nome acessível, copiar pelo botão e passar no axe', async () => {
    const user = userEvent.setup();
    const copied = vi.fn();
    const { container, fixture } = await render(CopyField, {
      inputs: { value: 'http://localhost:8084/abc', label: 'Webhook URL', hint: 'Copy URL (C)' },
      on: { copied },
    });
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);

    const field = screen.getByRole('textbox', { name: 'Webhook URL' }) as HTMLInputElement;
    expect(field.value).toBe('http://localhost:8084/abc');
    expect(field.readOnly).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copy).toHaveBeenCalledWith('http://localhost:8084/abc');
    expect(copied).toHaveBeenCalledWith(true);
    await expectNoAxeViolations(container);
  });

  it('deve selecionar o valor inteiro Quando o campo é clicado', async () => {
    const user = userEvent.setup();
    await render(CopyField, { inputs: { value: 'abcdef', label: 'Webhook URL' } });
    const field = screen.getByRole('textbox', { name: 'Webhook URL' }) as HTMLInputElement;

    await user.click(field);

    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
  });
});
