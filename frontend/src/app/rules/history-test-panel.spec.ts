import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { HistoryTestPanel } from './history-test-panel';
import { HistoryTest } from './rule';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

/** 3 testadas: A casa; B falha em 2 condições (mais nova), C em 1. */
const RESULTADO: HistoryTest = {
  tested: 3,
  matched: 1,
  matches: [A],
  matchList: [{ uuid: A, seq: 30, page: 1 }],
  misses: [
    { uuid: B, seq: 20, failed: ['method: expected POST, got GET', 'path: x'], page: 1 },
    { uuid: C, seq: 10, failed: ['header x-signature: absent'], page: 1 },
  ],
  windowFull: false,
};

describe('Dado o resultado do teste contra o histórico (aba Test, RULES-20)', () => {
  const show = (
    result: HistoryTest,
    requests = new Map<string, WebhookRequest>(),
    extra: { testing?: boolean; outOfDate?: boolean } = {},
  ) => render(HistoryTestPanel, { inputs: { result, tokenId: TOKEN_ID, requests, ...extra } });
  const clean = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

  it('deve dizer quantas das mais recentes casariam, com a nota e o "Test again"', async () => {
    const { container, fixture } = await show(RESULTADO);
    const again = vi.fn();
    fixture.componentInstance.testAgain.subscribe(again);

    const status = screen.getByRole('status', { name: 'History test' });
    expect(clean(status.querySelector('.summary'))).toBe(
      '1 of the 3 most recent requests would match',
    );
    expect(status.querySelector('.summary strong')?.textContent).toBe('1');
    expect(clean(status.querySelector('.note'))).toBe(
      'Unsaved rule as in the editor · scenario state not considered',
    );
    await userEvent.click(within(status).getByRole('button', { name: 'Test again' }));
    expect(again).toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('deve descrever cada mensagem por método, caminho e hora, com o trecho do corpo e quem respondeu na época (WM-22)', async () => {
    const corpo = JSON.stringify({ id: 42, texto: 'x'.repeat(150) });
    const pedido = webhookRequest(1, {
      uuid: A,
      url: `http://localhost/${TOKEN_ID}/pedidos`,
      content: corpo,
      rule: { id: 'r1', name: 'Antiga' },
      response: { status: 201 },
    });
    const { container, fixture } = await show(RESULTADO, new Map([[A, pedido]]));
    const aberta = vi.fn();
    fixture.componentInstance.openRequest.subscribe(aberta);

    const status = screen.getByRole('status', { name: 'History test' });
    const casam = within(status).getByRole('heading', { name: 'Would match (1)' }).parentElement;
    const link = within(casam as HTMLElement).getByRole('link', { name: /^POST \/pedidos · .+/ });
    expect(link.getAttribute('href')).toBe(`#/${TOKEN_ID}/${A}/1`);
    expect(link.getAttribute('target')).toBeNull();
    const linha = link.closest('li') as HTMLElement;
    expect(linha.querySelector('.snippet')?.textContent).toBe(`${corpo.slice(0, 80)}…`);
    expect(clean(linha.querySelector('.answered'))).toBe('answered 201 by Antiga at the time');
    await expectNoAxeViolations(container);

    await userEvent.click(link);
    expect(aberta).toHaveBeenCalledWith(A);
  });

  it('deve cair no id da mensagem Quando ela não está entre as lidas', async () => {
    await show(RESULTADO);

    const status = screen.getByRole('status', { name: 'History test' });
    expect(clean(status.querySelector('.misses > li'))).toBe(
      `#${C.substring(0, 5)} 1 condition header x-signature: absent`,
    );
    expect(within(status).getByRole('link', { name: `Open request ${A}` })).toBeTruthy();
  });

  it('deve marcar "Out of date" e dizer "Testing…" ocupado Quando as condições mudaram e o teste roda de novo', async () => {
    await show(RESULTADO, new Map(), { outOfDate: true, testing: true });

    const status = screen.getByRole('status', { name: 'History test' });
    expect(within(status).getByText('Out of date')).toBeTruthy();
    const botao = within(status).getByRole('button', { name: 'Testing…' });
    expect(botao.getAttribute('aria-busy')).toBe('true');
  });

  it('deve pôr as que não casariam das mais próximas para as mais longes, com a contagem, e voltar à ordem com "Closest first"', async () => {
    await show(RESULTADO);

    const lista = () =>
      [...document.querySelectorAll('.misses > li')].map((li) => [
        li.querySelector('a')?.getAttribute('aria-label'),
        clean(li.querySelector('.count')),
        li.classList.contains('near'),
      ]);
    expect(screen.getByRole('heading', { name: 'Would not match (2)' })).toBeTruthy();
    const ordem = screen.getByRole('button', { name: 'Closest first' });
    expect(ordem.getAttribute('aria-pressed')).toBe('true');
    expect(lista()).toEqual([
      [`Open request ${C}`, '1 condition', true],
      [`Open request ${B}`, '2 conditions', false],
    ]);
    expect(clean(document.querySelector('.misses .failed'))).toBe('header x-signature: absent');

    await userEvent.click(ordem);

    expect(ordem.getAttribute('aria-pressed')).toBe('false');
    expect(lista().map(([label]) => label)).toEqual([`Open request ${B}`, `Open request ${C}`]);
  });

  it('deve pedir a prévia da resposta pelo "Preview response" (C4)', async () => {
    const { fixture } = await show(RESULTADO);
    const previa = vi.fn();
    fixture.componentInstance.previewResponse.subscribe(previa);

    await userEvent.click(screen.getByRole('button', { name: 'Preview response' }));
    expect(previa).toHaveBeenCalled();
  });

  it('deve desabilitar "Preview response" com a dica Quando nada casaria (C4)', async () => {
    await show({ ...RESULTADO, matched: 0, matches: [], matchList: [] });

    const previa = screen.getByRole('button', { name: 'Preview response' }) as HTMLButtonElement;
    expect(previa.disabled).toBe(true);
    expect(previa.parentElement?.getAttribute('title')).toBe('Nothing would match yet');
  });

  it('deve manter o título "Would not match (0)" sem lista vazia Quando todas casariam', async () => {
    await show({ ...RESULTADO, tested: 1, misses: [] });

    const status = screen.getByRole('status', { name: 'History test' });
    expect(within(status).getByRole('heading', { name: 'Would not match (0)' })).toBeTruthy();
    expect(status.querySelector('.misses')).toBeNull();
  });

  it('deve dizer que não há mensagens Quando a URL ainda não recebeu nenhuma', async () => {
    await show({ ...RESULTADO, tested: 0, matched: 0, matches: [], matchList: [], misses: [] });

    expect(clean(document.querySelector('.summary'))).toBe('No recorded requests to test against.');
    expect(screen.queryByRole('heading', { name: /Would/ })).toBeNull();
  });

  it('deve avisar que só as 500 mais recentes entraram Quando o teste cobriu 500 mensagens', async () => {
    await show({ ...RESULTADO, tested: 500, windowFull: true });

    expect(clean(document.querySelector('.window'))).toBe(
      'Only the 500 most recent requests were tested.',
    );
  });
});
