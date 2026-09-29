import { provideHttpClient } from '@angular/common/http';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { rule } from '../../testing/rule-fixtures';
import { RuleTrace } from '../rules/rule';
import { RuleTracePanel } from './rule-trace';

const MENSAGEM = webhookRequest(1, { rule: { id: 'r9', name: 'Tudo o resto' } });
const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const URL_TRACE = `/token/${TOKEN_ID}/request/${MENSAGEM.uuid}/rules/trace`;

const PIX = rule(1, { name: 'Pix pago', priority: 1 });
const TUDO = rule(9, { name: 'Tudo o resto', priority: 9, match: undefined });
const PARADA = rule(5, { name: 'Parada', priority: 5, enabled: false });

const TRACE: RuleTrace = {
  request: MENSAGEM.uuid,
  responded_by: { id: 'r9', name: 'Tudo o resto' },
  rules: [
    {
      id: 'r1',
      name: 'Pix pago',
      enabled: true,
      position: 1,
      matches: false,
      failed: ['header x-tenant: expected "acme", got "outra"'],
      conditions: ['match.headers.x-tenant'],
    },
    {
      id: 'r9',
      name: 'Tudo o resto',
      enabled: true,
      position: 2,
      matches: true,
      failed: [],
      conditions: [],
    },
    {
      id: 'r5',
      name: 'Parada',
      enabled: false,
      position: null,
      matches: true,
      failed: [],
      conditions: [],
    },
  ],
};

describe('Dado o "Why not rule…?" no cartão da regra (C1, WM-23)', () => {
  let http: HttpTestingController;

  const show = async () => {
    const result = await render(RuleTracePanel, {
      inputs: { tokenId: TOKEN_ID, request: MENSAGEM },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    return result;
  };
  /** Abre o menu e escolhe a regra; devolve a região do trace. */
  const escolher = async (nome: string, regras = [PIX, TUDO, PARADA]) => {
    await userEvent.click(screen.getByRole('button', { name: 'Why not rule…?' }));
    await vi.waitFor(() => http.expectOne(URL_REGRAS).flush(regras));
    const menu = await screen.findByRole('menu', { name: 'Rules' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: nome }));
    return screen.getByRole('region', { name: 'Rule trace' });
  };
  const itens = (trace: HTMLElement) =>
    within(trace)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim());

  afterEach(() => http.verify());

  it('deve listar as regras na ordem de avaliação, as desligadas por último com "(off)"', async () => {
    await show();

    await userEvent.click(screen.getByRole('button', { name: 'Why not rule…?' }));
    http.expectOne(URL_REGRAS).flush([TUDO, PARADA, PIX]);

    const menu = await screen.findByRole('menu', { name: 'Rules' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Pix pago', 'Tudo o resto', 'Parada (off)']);
  });

  it('deve explicar cada regra na ordem, com o nome como link, Quando uma é escolhida', async () => {
    const { container } = await show();

    const trace = await escolher('Pix pago');
    expect(trace.getAttribute('aria-busy')).toBe('true');
    expect(trace.textContent).toContain('Checking the rules…');
    http.expectOne(URL_TRACE).flush(TRACE);

    await vi.waitFor(() => expect(trace.textContent).toContain('Answered by: Tudo o resto'));
    expect(trace.getAttribute('aria-busy')).toBe('false');
    expect(itens(trace)).toEqual([
      '#1 Pix pago — did not match: header x-tenant: expected "acme", got "outra"',
      '#2 Tudo o resto — matched · answered',
      'Parada (off) — would match, but it is off',
    ]);
    const link = within(trace).getByRole('link', { name: 'Pix pago' });
    expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/rules/r1?from-request=${MENSAGEM.uuid}`);
    expect(trace.querySelector('li.chosen')?.textContent).toContain('Pix pago');
    await expectNoAxeViolations(container);
  });

  it('não deve oferecer "Show original" Quando a tela está em inglês (WM-05)', async () => {
    await show();
    const trace = await escolher('Pix pago');
    http.expectOne(URL_TRACE).flush(TRACE);

    await vi.waitFor(() => expect(trace.textContent).toContain('Answered by: Tudo o resto'));
    expect(within(trace).queryByRole('button', { name: 'Show original' })).toBeNull();
    expect(trace.querySelector('.verdict[title]')).toBeNull();
  });

  // WM-05: as frases do servidor na língua da tela, com o original no title e em "Ver original".
  // O texto do template é traduzido na primeira criação do componente no processo de teste (a Inbox
  // de outro arquivo pode tê-lo criado em inglês): aqui só se confere o que o código monta.
  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it('deve traduzir as condições que falharam e mostrar o original sob pedido', async () => {
      const { container } = await show();
      await userEvent.click(container.querySelector('button.why-not') as HTMLElement);
      await vi.waitFor(() => http.expectOne(URL_REGRAS).flush([PIX, TUDO, PARADA]));
      const menu = await screen.findByRole('menu');
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Pix pago' }));
      const trace = screen.getByRole('region');
      const failed = ['header x-tenant: expected "acme", got "outra"', 'frobnicate: unknown'];
      http.expectOne(URL_TRACE).flush({
        ...TRACE,
        rules: [{ ...TRACE.rules[0], failed }, ...TRACE.rules.slice(1)],
      });

      await vi.waitFor(() => expect(trace.textContent).toContain('Respondida por: Tudo o resto'));
      const veredito = () => trace.querySelector('li.chosen .verdict');
      expect(veredito()?.textContent).toContain(
        'não casou: cabeçalho x-tenant: esperava "acme", veio "outra" · frobnicate: unknown',
      );
      expect(veredito()?.getAttribute('title')).toBe(
        'Original: header x-tenant: expected "acme", got "outra" · frobnicate: unknown',
      );

      const original = trace.querySelector('button[aria-pressed]') as HTMLElement;
      const rotulo = original.textContent?.trim();
      expect(original.getAttribute('aria-pressed')).toBe('false');
      await userEvent.click(original);

      expect(original.getAttribute('aria-pressed')).toBe('true');
      // R2-L4: o rótulo diz como voltar.
      expect(original.textContent?.trim()).not.toBe(rotulo);
      await userEvent.click(original);
      expect(original.textContent?.trim()).toBe(rotulo);
      expect(original.getAttribute('aria-pressed')).toBe('false');
      await userEvent.click(original);
      expect(veredito()?.textContent).toContain(
        'não casou: header x-tenant: expected "acme", got "outra" · frobnicate: unknown',
      );
      await expectNoAxeViolations(container);
    });
  });

  it('deve dizer "matched, but an earlier rule answered" e "No rule answered"', async () => {
    await show();

    const trace = await escolher('Tudo o resto');
    http.expectOne(URL_TRACE).flush({
      ...TRACE,
      responded_by: null,
      rules: [{ ...TRACE.rules[0], matches: true, failed: [] }, TRACE.rules[1]],
    });

    await vi.waitFor(() => expect(trace.textContent).toContain('No rule answered'));
    expect(itens(trace)).toEqual(['#1 Pix pago — matches now', '#2 Tudo o resto — matches now']);

    await userEvent.click(screen.getByRole('button', { name: 'Why not rule…?' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pix pago' }));
    http.expectOne(URL_TRACE).flush({
      ...TRACE,
      rules: [{ ...TRACE.rules[0], matches: true, failed: [] }, TRACE.rules[1]],
    });
    await vi.waitFor(() =>
      expect(itens(screen.getByRole('region', { name: 'Rule trace' }))[1]).toBe(
        '#2 Tudo o resto — matched · answered',
      ),
    );
    expect(itens(screen.getByRole('region', { name: 'Rule trace' }))[0]).toBe(
      '#1 Pix pago — matched, but an earlier rule answered',
    );
  });

  it('deve avisar que o estado do cenário é o de agora Quando a regra tem cenário', async () => {
    await show();
    const comCenario = { ...PIX, scenario: { name: 'entrega', requiredState: 'pago' } };

    const trace = await escolher('Pix pago', [comCenario, TUDO]);
    http.expectOne(URL_TRACE).flush(TRACE);

    await vi.waitFor(() => expect(trace.textContent).toContain('Scenario state as of now.'));
  });

  it.each([
    [500, 'Could not check the rules (500).'],
    [404, 'This request no longer exists.'],
  ])('deve explicar o erro %i', async (status, frase) => {
    await show();

    const trace = await escolher('Pix pago');
    http.expectOne(URL_TRACE).flush({ error: 'x' }, { status, statusText: 'x' });

    await vi.waitFor(() => expect(within(trace).getByRole('alert').textContent).toContain(frase));
    expect(trace.getAttribute('aria-busy')).toBe('false');
  });
});
