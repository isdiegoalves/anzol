import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { translations } from '../../locale/pt-BR';
import { RequestStream } from '../realtime/request-stream';
import { RequestStore } from '../requests/request-store';
import { RuleStore } from '../rules/rule-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Circuit, stageFit } from './circuit';

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

  /** O estado do tempo real, para simular a queda e a volta da conexão. */
  const conexao = signal('open');

  const mostrar = async (
    mensagens: WebhookRequest[] = [PELA_PADRAO, DA_P1],
    line = false,
    regras: object | 'falha' = REGRAS,
  ) => {
    conexao.set('open');
    const rendered = await render(Circuit, {
      inputs: { line },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RequestStream, useValue: { status: conexao } },
      ],
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
    const lidas = http.expectOne(`/token/${TOKEN_ID}/rules`);
    if (regras === 'falha') {
      lidas.flush({}, { status: 503, statusText: 'Unavailable' });
    } else {
      lidas.flush(regras);
    }
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
    // Como na demo: cada nó é uma parada do Tab, num grupo "Circuit nodes" (F1-R05).
    expect(nos.every((no) => no.tabIndex === 0)).toBe(true);
    expect(screen.getByRole('group', { name: 'Circuit nodes' })).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
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

    // O Tab anda de nó em nó (como na demo); as setas são atalho a mais.
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Schema/ }));
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Sender/ }));
    await userEvent.keyboard('{Enter}');
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([PELA_PADRAO, DA_P1]));
    await fixture.whenStable();

    expect(store.filter().signature).toBe('any');
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Resend/ }));
  });

  it('deve acompanhar a regra gravada na própria Entrada (folha "Create rule", roteiro), sem trocar de URL (F1-R01)', async () => {
    const { fixture } = await mostrar();
    const regras = TestBed.inject(RuleStore);
    expect(screen.queryByRole('button', { name: /^Rule P2 Nova/ })).toBeNull();

    // O que a folha faz: lê pela store (já na URL) e grava a lista com a regra nova.
    const nova = rule(2, { id: 'p2', name: 'Nova', priority: 2, response: { status: 202 } });
    const gravar = regras.saveIfUnchanged([...REGRAS, nova]);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    await vi.waitFor(() =>
      http.expectOne({ method: 'PUT', url: `/token/${TOKEN_ID}/rules` }).flush([...REGRAS, nova]),
    );
    await gravar;
    await fixture.whenStable();

    expect(screen.getByRole('button', { name: /^Rule P2 Nova: 202\./ })).toBeTruthy();
    http.expectNone(`/token/${TOKEN_ID}/rules`);
  });

  it('deve dizer "rules unavailable" quando a leitura das regras falha, e ler de novo quando a conexão volta (F1-R02)', async () => {
    const { container, fixture } = await mostrar(undefined, false, 'falha');

    const aviso = [...container.querySelectorAll('.lab')].find(
      (lab) => lab.textContent === 'rules unavailable',
    );
    expect(aviso?.classList.contains('muted')).toBe(true);
    expect(container.textContent).not.toContain('no rules');
    expect(screen.queryByRole('button', { name: /^Rule P1/ })).toBeNull();

    conexao.set('reconnecting');
    await fixture.whenStable();
    conexao.set('open');
    await fixture.whenStable();
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Rule P1/ })).toBeTruthy());
    expect(container.textContent).not.toContain('rules unavailable');
    await expectNoAxeViolations(container);
  });

  it('deve contar a lista filtrada Quando a Entrada já abre filtrada (o link), sem contagem anterior (F1-R06)', async () => {
    const rendered = await render(Circuit, {
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RequestStream, useValue: { status: conexao } },
      ],
      configureTestBed: (testBed) => testBed.inject(Preferences).token.set(token()),
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    const filtro = {
      text: '',
      methods: [],
      signature: 'any' as const,
      schema: 'any' as const,
      outcome: { type: 'rule' as const, rule: 'p1', name: 'Assinatura inválida' },
    };
    const loaded = store.load(TOKEN_ID, 1, filtro);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?per_page=1&sorting=newest`)
      .flush(requestPage([DA_P1], { total: 2 }));
    await vi.waitFor(() =>
      http.expectOne(`/token/${TOKEN_ID}/requests/search`).flush(requestPage([DA_P1])),
    );
    await loaded;
    await rendered.fixture.whenStable();

    expect(
      screen.getByRole('button', { name: /^Rule P1 Assinatura inválida: ✗ 401 · 1\./ }),
    ).toBeTruthy();
  });

  it('deve caber o palco na faixa: margem de até 24 px, escala até 10 px de texto e só então rolar (F1-R04)', () => {
    // 1440 × 900 (área útil 1343): palco inteiro, margem de 24 px.
    expect(stageFit(1343)).toEqual({ scale: 1, margin: 24, scrolls: false });
    // 1366 × 768 (1269): a margem cede os 3 px que faltavam; nada rola.
    expect(stageFit(1269)).toEqual({ scale: 1, margin: 21, scrolls: false });
    // 1280 × 800 (1183): o palco encolhe, sem margem, e cabe inteiro.
    expect(stageFit(1183)).toMatchObject({ margin: 0, scrolls: false });
    expect(stageFit(1183).scale).toBeCloseTo(1183 / 1248, 5);
    // No piso, o texto de 11 px fica com 10 px; abaixo dele, a faixa rola por dentro.
    expect(stageFit(1000)).toEqual({ scale: 10 / 11, margin: 0, scrolls: true });
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
      expect(screen.getByRole('group', { name: 'Nós do circuito' })).toBeTruthy();
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
