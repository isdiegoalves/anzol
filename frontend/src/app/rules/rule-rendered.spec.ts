import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { RenderedResponse } from './rule';
import { RuleRendered } from './rule-rendered';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

/** "Rendered responses" (C4): uma aba por mensagem, com status, cabeçalhos e corpo. */
describe('Dado as respostas renderizadas (C4)', () => {
  const RESPOSTAS: RenderedResponse[] = [
    {
      uuid: A,
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: '{"eco":"pago"}',
    },
    { uuid: B, fault: 'connection_reset' },
    { uuid: C, error: 'timeout' },
  ];
  const pedidos = new Map([
    [A, webhookRequest(1, { uuid: A, url: `http://localhost/${TOKEN_ID}/pagamentos` })],
    [B, webhookRequest(2, { uuid: B, url: `http://localhost/${TOKEN_ID}/b` })],
  ]);

  it('deve mostrar a primeira aba com status, cabeçalhos e corpo, e a ressalva de seq e now', async () => {
    const { container } = await render(RuleRendered, {
      inputs: { responses: RESPOSTAS, requests: pedidos },
    });

    const regiao = screen.getByRole('region', { name: 'Rendered responses' });
    const abas = within(regiao).getAllByRole('tab');
    expect(abas.map((aba) => aba.textContent?.trim().replace(/ · .*/, ''))).toEqual([
      'POST /pagamentos',
      'POST /b',
      `#${C.substring(0, 5)}`,
    ]);
    expect(abas[0].getAttribute('aria-selected')).toBe('true');
    expect(regiao.textContent).toContain('seq and now are from now.');
    expect(regiao.querySelector('.status')?.textContent).toBe('202');
    expect(regiao.textContent).toContain('content-type: application/json');
    expect(regiao.querySelector('pre')?.textContent?.trim()).toBe('{"eco":"pago"}');
    await expectNoAxeViolations(container);
  });

  it('deve dizer "Fault: {type}" e "Timed out (1 s)", e trocar de aba pelas setas', async () => {
    await render(RuleRendered, { inputs: { responses: RESPOSTAS, requests: pedidos } });
    const abas = screen.getAllByRole('tab');

    await userEvent.click(abas[1]);
    expect(screen.getByRole('tabpanel').textContent?.trim()).toBe('Fault: connection_reset');

    abas[1].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(abas[2]);
    expect(screen.getByRole('tabpanel').textContent?.trim()).toBe('Timed out (1 s)');
  });
});
