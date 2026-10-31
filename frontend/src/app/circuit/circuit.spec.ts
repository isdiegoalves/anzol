import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { translations } from '../../locale/pt-BR';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Circuit } from './circuit';

const REGRAS = [
  rule(1, {
    id: 'p1',
    name: 'Assinatura inválida',
    priority: 1,
    match: { signature: 'invalid' },
    response: { status: 401 },
  }),
  rule(3, { id: 'p3', name: 'Pedido inexistente', priority: 3, response: { status: 404 } }),
];
const valida = { provider: 'generic', valid: true, reason: null } as const;
const PELA_PADRAO = webhookRequest(10, {
  url: `http://localhost:8084/${TOKEN_ID}/webhooks/pagamentos`,
  signature: valida,
  schema: { valid: true, errors: [] },
  rule: null,
  near_miss: {
    id: 'p1',
    name: 'Assinatura inválida',
    failed: ['signature: expected invalid, got valid'],
  },
  response: { status: 200 },
});
const DA_P1 = webhookRequest(7, {
  url: `http://localhost:8084/${TOKEN_ID}/webhooks/pagamentos`,
  signature: { provider: 'generic', valid: false, reason: 'signature mismatch' },
  schema: { valid: true, errors: [] },
  rule: { id: 'p1', name: 'Assinatura inválida' },
  response: { status: 401 },
});

describe('Dado o circuito da URL na Entrada', () => {
  let http: HttpTestingController;
  let store: RequestStore;

  const mostrar = async (mensagens: WebhookRequest[] = [PELA_PADRAO, DA_P1], line = false) => {
    const rendered = await render(Circuit, {
      inputs: { line },
      providers: [provideHttpClient(), provideHttpClientTesting()],
      configureTestBed: (testBed) =>
        testBed.inject(Preferences).token.set(
          token({
            signature: { provider: 'generic', header: 'X-PagaFacil-Assinatura' },
            schema: { type: 'object' },
          }),
        ),
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage(mensagens));
    await loaded;
    await rendered.fixture.whenStable();
    return rendered;
  };

  afterEach(() => http.verify());

  it('deve mostrar a configuração da URL sem mensagem aberta, com os nós alcançáveis e axe limpo (CA-3, CA-5)', async () => {
    const { container } = await mostrar();

    expect(screen.getByRole('region', { name: 'URL circuit' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /^URL circuit URL 3dbd6 with 9 nodes\. No request open\.$/ }),
    ).toBeTruthy();
    const nos = screen.getAllByRole('button');
    expect(nos.map((no) => no.getAttribute('aria-label')?.split(':')[0].split('.')[0])).toEqual([
      'Sender',
      'Signature',
      'Schema',
      'Decryption',
      'Rule P1 Assinatura inválida',
      'Rule P3 Pedido inexistente',
      'Default response',
      'Response',
      'Resend',
    ]);
    // Uma parada só do Tab: o primeiro nó.
    expect(nos.filter((no) => no.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('toolbar', { name: 'Circuit nodes' })).toBeTruthy();
    // A contagem das carregadas: P1 com a anomalia (glifo e texto), a padrão neutra.
    expect(
      screen.getByRole('button', { name: /^Rule P1 Assinatura inválida: ✗ 401 · 1\./ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Default response: 200 · 1\./ })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve desenhar o caminho da mensagem aberta e o "quase" de P1 (CA-1, CA-2)', async () => {
    const { container, fixture } = await mostrar();
    store.select(PELA_PADRAO.uuid);
    await fixture.whenStable();

    expect(
      screen.getByRole('img', {
        name: /path: signature ✓ → schema ✓ → P1 ✗ → P3 ✗ → default response 200; near match: P1 Assinatura inválida\.$/,
      }),
    ).toBeTruthy();
    expect(container.querySelector('.near')?.textContent?.trim()).toBe(
      '◔ near · missing: signature invalid',
    );
    expect(container.querySelectorAll('.route path').length).toBeGreaterThan(0);

    store.select(DA_P1.uuid);
    await fixture.whenStable();

    expect(container.querySelector('.near')).toBeNull();
    expect(
      screen.getByRole('img', { name: /path: signature ✗ → schema ✓ → P1 ✓ → 401\.$/ }),
    ).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve filtrar a lista pelo nó com clique e tirar com outro clique, sem motion (CA-4)', async () => {
    const { fixture } = await mostrar();
    const p1 = () => screen.getByRole('button', { name: /^Rule P1 Assinatura inválida/ });
    expect(p1().getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(p1());
    const busca = http.expectOne(`/token/${TOKEN_ID}/requests/search`);
    expect(busca.request.body).toMatchObject({ outcome: { type: 'rule', rule: 'p1' } });
    busca.flush(requestPage([DA_P1]));
    await vi.waitFor(() => expect(store.requests()).toEqual([DA_P1]));
    await fixture.whenStable();

    expect(store.filter().outcome).toEqual({
      type: 'rule',
      rule: 'p1',
      name: 'Assinatura inválida',
    });
    expect(p1().getAttribute('aria-pressed')).toBe('true');
    // As contagens ficam as de antes do filtro, e não as do resultado dele.
    expect(screen.getByRole('button', { name: /^Default response: 200 · 1\./ })).toBeTruthy();

    await userEvent.click(p1());
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([PELA_PADRAO, DA_P1]));
    await fixture.whenStable();

    expect(store.filter().outcome ?? null).toBeNull();
    expect(p1().getAttribute('aria-pressed')).toBe('false');
  });

  it('deve trocar o filtro de um nó pelo do outro e mostrar todas pelo Remetente, pelo teclado', async () => {
    const { fixture } = await mostrar();
    const assinatura = screen.getByRole('button', { name: /^Signature/ });
    assinatura.focus();

    await userEvent.keyboard('{Enter}');
    http.expectOne(`/token/${TOKEN_ID}/requests/search`).flush(requestPage([DA_P1]));
    await fixture.whenStable();
    expect(store.filter().signature).toBe('invalid');
    expect(assinatura.getAttribute('aria-pressed')).toBe('true');

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Sender/ }));
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    await userEvent.keyboard('{Enter}');
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([PELA_PADRAO, DA_P1]));
    await fixture.whenStable();

    expect(store.filter().signature).toBe('any');
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Resend/ }));
  });

  it('deve mostrar no celular só o caminho da mensagem aberta, numa linha que rola', async () => {
    const { container, fixture } = await mostrar(undefined, true);
    expect(screen.queryByRole('region', { name: 'Request path' })).toBeNull();

    store.select(DA_P1.uuid);
    await fixture.whenStable();

    const linha = screen.getByRole('region', { name: 'Request path' });
    expect(linha.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'path: signature ✗ → schema ✓ → P1 ✓ → 401',
    );
    expect(linha.tabIndex).toBe(0);
    expect(screen.queryByRole('img')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve falar pt-BR Quando a tradução está carregada (CA-6)', async () => {
    loadTranslations(translations);
    try {
      const { fixture, container } = await mostrar();
      store.select(PELA_PADRAO.uuid);
      await fixture.whenStable();

      expect(screen.getByRole('region', { name: 'Circuito da URL' })).toBeTruthy();
      expect(screen.getByRole('toolbar', { name: 'Nós do circuito' })).toBeTruthy();
      expect(container.querySelector('.caption')?.textContent?.trim()).toBe('circuito');
      expect(container.querySelector('.near')?.textContent?.trim()).toBe(
        '◔ quase · faltou: assinatura inválida',
      );
      expect(
        screen.getByRole('button', { name: /^Remetente: .*Enter mostra todas na lista\.$/ }),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: /^Regra P1 Assinatura inválida: .*Enter filtra a lista: respondidas por P1\.$/,
        }),
      ).toBeTruthy();
    } finally {
      clearTranslations();
    }
  });
});
