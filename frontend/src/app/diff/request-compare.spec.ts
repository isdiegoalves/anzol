import { signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { Viewport, WindowClass } from '../shell/viewport';
import { RuleStatusStore } from '../requests/rule-status-store';
import { CompareStore } from './compare-store';
import { BODY_LIMIT } from './request-diff';
import { RequestCompare } from './request-compare';

const A = webhookRequest(1, {
  method: 'POST',
  headers: { 'Content-Type': ['application/json'], 'X-Retry': ['1'], 'X-Only-A': ['a'] },
  content: '{"id":42,"status":"pending","itens":[1]}',
  schema: { valid: true, errors: [] },
});
const B = webhookRequest(2, {
  method: 'POST',
  headers: { 'content-type': ['application/json'], 'x-retry': ['2'] },
  content: '{"itens":[1],"status":"paid","id":42}',
  schema: { valid: false, errors: [{ path: '/status', message: 'must be one of pending' }] },
});

describe('Dado a comparação de duas mensagens', () => {
  const windowClass = signal<WindowClass>('large');
  const compare = { swap: vi.fn(), close: vi.fn() };

  const show = (
    a: WebhookRequest = A,
    b: WebhookRequest = B,
    ruleStatuses: ReadonlyMap<string, number> = new Map(),
  ) =>
    render(RequestCompare, {
      inputs: { a, b },
      providers: [
        { provide: RuleStatusStore, useValue: { statusOf: (id: string) => ruleStatuses.get(id) } },
        { provide: Viewport, useValue: { windowClass } },
        { provide: CompareStore, useValue: compare },
      ],
    });
  const rows = (name: string) =>
    within(screen.getByRole('table', { name }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()));
  const bodyLines = (container: Element) =>
    [...container.querySelectorAll('table[aria-label="Body"] tbody tr')].map((row) =>
      [row.className, row.textContent?.replace(/\s+/g, ' ').trim()].join(' | '),
    );

  beforeEach(() => windowClass.set('large'));

  it('deve mostrar A e B no cabeçalho, as verificações lado a lado, e passar no axe', async () => {
    const { container } = await show();

    expect(container.querySelector('.id-a')?.textContent).toBe(`#${A.uuid.substring(0, 5)}`);
    expect(container.querySelector('.id-b')?.textContent).toBe(`#${B.uuid.substring(0, 5)}`);
    // RULES-28: o título, o resumo das diferenças e A e B em cartões.
    expect(screen.getByRole('heading', { name: 'Compare' })).toBeTruthy();
    expect(container.querySelector('.summary')?.textContent?.trim()).toBe(
      '1 header changed, 1 only in A · 2 body lines differ',
    );
    // Cada parte é uma palavra no texto da região (o título não cola no resumo).
    expect(container.querySelector('.heading')?.textContent).toMatch(
      /^\s*Compare\s+1 header.* differ\s+Only differences/,
    );
    // RULES-30: A e B com o id nos cabeçalhos, sem a coluna Status; a linha que mudou diz "changed".
    const table = screen.getByRole('table', { name: 'Checks' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim()),
    ).toEqual(['Check', `A · #${A.uuid.substring(0, 5)}`, `B · #${B.uuid.substring(0, 5)}`]);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Signature', 'Schema', 'Rule']);
    // O "changed" fica na célula da B: o nome da linha é o da verificação.
    const schema = within(table).getByRole('rowheader', { name: 'Schema' }).closest('tr');
    expect(schema?.querySelectorAll('td')[1].textContent).toContain('changed');
    await expectNoAxeViolations(container);
  });

  it('deve dizer o status da resposta no selo da regra que respondeu (RULES-30)', async () => {
    const rule = { id: 'r1', name: 'Pagamento' };
    await show(A, webhookRequest(2, { rule }), new Map([['r1', 201]]));

    const table = screen.getByRole('table', { name: 'Checks' });
    expect(table.textContent).toContain('201 · Pagamento');
  });

  // RULES-36: a 390 px, uma linha por lado em vez de três colunas espremidas.
  it('deve empilhar a tabela Checks, com A e B lado a lado embaixo de cada verificação, Quando a janela é compacta', async () => {
    windowClass.set('compact');
    const { container } = await show();

    const table = screen.getByRole('table', { name: 'Checks' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim()),
    ).toEqual([`A · #${A.uuid.substring(0, 5)}`, `B · #${B.uuid.substring(0, 5)}`]);
    const groups = [...table.querySelectorAll('tbody')].map((group) => [
      group.querySelector('th[scope="rowgroup"]')?.textContent?.replace(/\s+/g, ' ').trim(),
      group.querySelectorAll('td').length,
    ]);
    expect(groups).toEqual([
      ['Signature', 2],
      ['Schema', 2],
      ['Rule', 2],
    ]);
    await expectNoAxeViolations(container);
  });

  it('deve dizer o que explica o desfecho (S9) e separar o resto', async () => {
    await show();

    const explains = screen.getByRole('region', { name: '1 change explains the outcome' });
    expect(within(explains).getByRole('listitem').textContent).toBe(
      'Schema /status: A valid here → B must be one of pending',
    );
    const other = screen.getByRole('region', { name: '2 other differences' });
    // RULES-31: recolhidas por padrão (abrem pelo título); o que explica o desfecho fica à vista.
    expect(other.querySelector('details')?.open).toBe(false);
    expect(
      within(other)
        .getAllByRole('listitem', { hidden: true })
        .map((item) => item.textContent),
    ).toEqual(['header x-only-a', 'header x-retry']);
    expect(explains.querySelector('details')).toBeNull();
  });

  it('deve casar headers sem diferenciar maiúsculas e marcar diferente e ausente (A | B | Status)', async () => {
    await show();
    await userEvent.click(screen.getByRole('switch', { name: 'Only differences' }));

    expect(rows('Headers')).toEqual([
      ['Content-Type', 'application/json', 'application/json', 'same'],
      ['X-Only-A', 'a', '', 'only in A'],
      ['X-Retry', '1', '2', 'changed'],
    ]);
  });

  it('deve mostrar o corpo lado a lado, com a linha que mudou na mesma altura', async () => {
    const { container } = await show();

    expect(screen.getByText('JSON bodies, formatted with sorted keys.')).toBeTruthy();
    expect(bodyLines(container).filter((line) => !/^(equal|skipped)/.test(line))).toEqual([
      'added changed removed | 6- "status": "pending" 6+ "status": "paid"',
    ]);
  });

  it('deve mostrar o corpo unificado Quando a janela é compacta', async () => {
    windowClass.set('compact');
    const { container } = await show();

    expect(bodyLines(container).filter((line) => !/^(equal|skipped)/.test(line))).toEqual([
      'removed | 6 - "status": "pending"',
      'added | 6 + "status": "paid"',
    ]);
  });

  // RULES-29/33: abre só com as diferenças, dizendo quantos headers iguais o switch esconde.
  it('deve abrir só com as diferenças e mostrar tudo Quando "Only differences" é desligado', async () => {
    const { container } = await show();
    const only = screen.getByRole('switch', { name: 'Only differences' });

    expect(only.getAttribute('aria-checked')).toBe('true');
    expect(rows('Headers').map((row) => row[0])).toEqual(['X-Only-A', 'X-Retry']);
    expect(screen.getByText('1 identical header hidden')).toBeTruthy();
    expect(bodyLines(container)).toEqual([
      'skipped | ⋯ 5 unchanged lines',
      'added changed removed | 6- "status": "pending" 6+ "status": "paid"',
      'skipped | ⋯ 1 unchanged line',
    ]);

    await userEvent.click(only);

    expect(rows('Headers')).toHaveLength(3);
    expect(screen.getByText('All 3 headers')).toBeTruthy();
    expect(bodyLines(container).some((line) => line.startsWith('skipped'))).toBe(false);
  });

  // RULES-32: a linha da requisição em chips, sem o token; a tabela "Request" sai.
  it('deve resumir a linha da requisição em método, caminho e query', async () => {
    const url = `http://localhost/${A.token_id}/pedidos`;
    await show(webhookRequest(1, { url }), webhookRequest(2, { url }));

    const line = screen.getByRole('heading', { name: 'Request line' }).closest('section');
    expect(line?.textContent).toContain('method, path and query are the same');
    expect(
      [...(line?.querySelectorAll('li') ?? [])].map((chip) => chip.textContent?.trim()),
    ).toEqual(['Method POST', 'Path /pedidos', 'No query']);
    expect(line?.textContent).not.toContain(A.token_id);
    expect(screen.queryByRole('table', { name: 'Request' })).toBeNull();
  });

  // RULES-34: o tipo do evento nas colunas do corpo e as linhas iguais abertas pelo botão.
  it('deve pôr o tipo do evento nas colunas do corpo e mostrar as iguais pelo botão', async () => {
    const common = '"a":1,"b":2,"c":3,"d":4,"e":5,"f":6';
    await show(
      webhookRequest(1, { content: `{${common},"type":"pedido.criado"}` }),
      webhookRequest(2, { content: `{${common},"type":"pedido.pago"}` }),
    );

    const body = screen.getByRole('table', { name: 'Body' });
    expect(
      within(body)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim()),
    ).toEqual(['A · pedido.criado', 'B · pedido.pago']);

    await userEvent.click(
      within(body).getByRole('button', { name: '7 unchanged lines hidden. Show them' }),
    );

    expect(
      screen.getByRole('switch', { name: 'Only differences' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(body.textContent).toContain('"d": 4');
  });

  it('deve trocar A e B e fechar pelo CompareStore Quando os botões são clicados', async () => {
    await show();

    await userEvent.click(screen.getByRole('button', { name: 'Swap A and B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(compare.swap).toHaveBeenCalled();
    expect(compare.close).toHaveBeenCalled();
  });

  it('deve mostrar A e B trocados no mesmo clique, antes da rota nova', async () => {
    const { container } = await show();

    await userEvent.click(screen.getByRole('button', { name: 'Swap A and B' }));

    expect(container.querySelector('.id-a')?.textContent).toBe(`#${B.uuid.substring(0, 5)}`);
    expect(
      rows('Headers')
        .find(([name]) => name?.toLowerCase() === 'x-retry')
        ?.slice(1, 3),
    ).toEqual(['2', '1']);
  });

  it('deve comparar texto por linha Quando um dos corpos não é JSON', async () => {
    windowClass.set('compact');
    const { container } = await show(
      webhookRequest(1, { content: 'a=1\nb=2' }),
      webhookRequest(2, { content: 'a=1\nb=3' }),
    );

    expect(screen.queryByText(/sorted keys/)).toBeNull();
    expect(bodyLines(container)).toEqual([
      'skipped | ⋯ 1 unchanged line',
      'removed | 2 - b=2',
      'added | 2 + b=3',
    ]);
  });

  it('deve avisar e comparar só o primeiro 1 MB Quando um corpo passa do limite', async () => {
    await show(
      webhookRequest(1, { content: 'x'.repeat(BODY_LIMIT + 1) }),
      webhookRequest(2, { content: 'y' }),
    );

    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      'Body larger than 1 MB: comparing only the first 1 MB of each request.',
    );
  });

  it('deve marcar o header que muda a cada entrega do provedor (x-github-delivery)', async () => {
    await show(
      webhookRequest(1, { headers: { 'X-GitHub-Delivery': ['a'] } }),
      webhookRequest(2, { headers: { 'X-GitHub-Delivery': ['b'] } }),
    );

    expect(rows('Headers')).toEqual([
      ['X-GitHub-Delivery', 'a', 'b', 'changed · changes every event'],
    ]);
    expect(
      within(
        screen.getByRole('region', { name: /differences? changes? on every delivery/ }),
      ).getByRole('listitem', { hidden: true }).textContent,
    ).toBe('header x-github-delivery');
  });
});
