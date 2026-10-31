import { MediaMatcher } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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
import { FilterChips } from '../search/filter-chips';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Circuit, REREAD_MIN_MS, RULES_RETRY_MS, stageFit } from './circuit';
import { CircuitFlow } from './circuit-flow';

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
    regras: object | 'falha' | 'sem-rede' | ((lidas: TestRequest) => void) = REGRAS,
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
    if (typeof regras === 'function') {
      regras(lidas);
    } else if (regras === 'falha') {
      lidas.flush({}, { status: 503, statusText: 'Unavailable' });
    } else if (regras === 'sem-rede') {
      // Status 0: a chamada não teve resposta (o `connectionInterceptor` derruba o tempo real com isso).
      lidas.error(new ProgressEvent('error'));
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

  /** O tempo real cai e volta (o que o `connectionInterceptor` provoca com um status 0). */
  const quedaEVolta = async (fixture: { whenStable(): Promise<unknown> }) => {
    conexao.set('reconnecting');
    await fixture.whenStable();
    conexao.set('open');
    await fixture.whenStable();
  };

  it('deve mostrar a configuração da URL sem mensagem aberta, com os nós alcançáveis e axe limpo', async () => {
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
    // Cada nó é uma parada do Tab, num grupo "Circuit nodes".
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

  it('deve desenhar o caminho da mensagem aberta e o "quase" de P1', async () => {
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

  it('deve filtrar a lista pelo nó com clique e tirar com outro clique, sem motion', async () => {
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

    // O Tab anda de nó em nó; as setas são atalho a mais.
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

  it('deve acompanhar a regra gravada na própria Entrada (folha "Create rule", roteiro), sem trocar de URL', async () => {
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

  it('deve dizer "rules unavailable" quando a leitura das regras falha, e ler de novo quando a conexão volta', async () => {
    const { container, fixture } = await mostrar(undefined, false, 'falha');

    const aviso = [...container.querySelectorAll('.lab')].find(
      (lab) => lab.textContent === 'rules unavailable',
    );
    expect(aviso?.classList.contains('muted')).toBe(true);
    expect(container.textContent).not.toContain('no rules');
    expect(screen.queryByRole('button', { name: /^Rule P1/ })).toBeNull();

    // Depois da falha, nenhuma leitura antes de 15 s, qualquer que seja o gatilho.
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora + 5_000);
    await quedaEVolta(fixture);
    http.expectNone(`/token/${TOKEN_ID}/rules`);
    relogio.mockReturnValue(agora + RULES_RETRY_MS + 1_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    relogio.mockRestore();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Rule P1/ })).toBeTruthy());
    expect(container.textContent).not.toContain('rules unavailable');
    await expectNoAxeViolations(container);
  });

  it('não deve entrar em laço Quando a leitura das regras falha sem resposta e o tempo real cai e volta', async () => {
    const { fixture, container } = await mostrar(undefined, false, 'sem-rede');
    expect(container.textContent).toContain('rules unavailable');

    // O `connectionInterceptor` derruba o tempo real com o status 0, e ele volta logo: cada volta não relê.
    for (let volta = 0; volta < 5; volta++) {
      await quedaEVolta(fixture);
    }
    http.expectNone(`/token/${TOKEN_ID}/rules`);
  });

  it('deve espaçar as releituras da volta da conexão em 5 s ou mais, com as regras lidas', async () => {
    const { fixture } = await mostrar();
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora + REREAD_MIN_MS + 1_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    await fixture.whenStable();

    relogio.mockReturnValue(agora + REREAD_MIN_MS + 2_000);
    await quedaEVolta(fixture);
    http.expectNone(`/token/${TOKEN_ID}/rules`);

    relogio.mockReturnValue(agora + 2 * REREAD_MIN_MS + 2_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    relogio.mockRestore();
  });

  it('deve esperar 15 s depois de uma releitura que falhou, mesmo com a lista de antes na tela', async () => {
    const { fixture, container } = await mostrar();
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora + REREAD_MIN_MS + 1_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).error(new ProgressEvent('error'));
    // A falha atravessa a store e o circuito antes de o relógio andar.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    // A lista de antes fica: as regras seguem na escada, sem "rules unavailable".
    expect(screen.getByRole('button', { name: /^Rule P1/ })).toBeTruthy();
    expect(container.textContent).not.toContain('rules unavailable');

    // Passados os 5 s dos sinais, mas não os 15 s da falha: nada.
    relogio.mockReturnValue(agora + 2 * REREAD_MIN_MS + 2_000);
    await quedaEVolta(fixture);
    http.expectNone(`/token/${TOKEN_ID}/rules`);

    relogio.mockReturnValue(agora + REREAD_MIN_MS + RULES_RETRY_MS + 2_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    relogio.mockRestore();
  });

  it('deve dizer "rules unavailable" Quando outra leitura da mesma URL troca a do circuito e falha (o roteiro "Test a retry")', async () => {
    const { container } = await mostrar(undefined, false, (lidas) => {
      // O roteiro lê as regras da URL antes de a leitura do circuito chegar, e a dele falha.
      void TestBed.inject(RuleStore)
        .load(TOKEN_ID)
        .catch(() => undefined);
      lidas.flush(REGRAS);
      http
        .expectOne(`/token/${TOKEN_ID}/rules`)
        .flush({}, { status: 503, statusText: 'Unavailable' });
    });
    await new Promise((resolve) => setTimeout(resolve));

    await vi.waitFor(() => expect(container.textContent).toContain('rules unavailable'));
    expect(container.querySelector('.stage')).not.toBeNull();
  });

  it('deve reler as regras da URL aberta Quando a store passa a outra URL por fora, e dizer "rules unavailable" se falha', async () => {
    const { container, fixture } = await mostrar();
    const regras = TestBed.inject(RuleStore);

    void regras.load('outra-url').catch(() => undefined);
    await fixture.whenStable();
    http.expectOne('/token/outra-url/rules').flush([]);
    http
      .expectOne(`/token/${TOKEN_ID}/rules`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(container.textContent).toContain('rules unavailable');
    // A tentativa seguinte, passados os 15 s, traz as regras de volta.
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RULES_RETRY_MS + 1_000);
    await quedaEVolta(fixture);
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush(REGRAS);
    relogio.mockRestore();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Rule P1/ })).toBeTruthy());
  });

  it('deve abrir o painel Filtros pelo nó "+N rules", sem mexer no filtro da lista', async () => {
    const muitas = Array.from({ length: 6 }, (_, i) =>
      rule(i + 1, { id: `r${i + 1}`, priority: i + 1, name: `Regra ${i + 1}` }),
    );
    await mostrar(undefined, false, muitas);
    const chips = TestBed.inject(FilterChips);
    const pedidos = chips.panelAsked();
    const mais = screen.getByRole('button', { name: /^\+4 rules/ });
    expect(mais.getAttribute('aria-label')).toMatch(/Enter opens Filters\.$/);
    expect(mais.hasAttribute('aria-pressed')).toBe(false);

    await userEvent.click(mais);
    expect(chips.panelAsked()).toBe(pedidos + 1);
    mais.focus();
    await userEvent.keyboard('{Enter}');
    expect(chips.panelAsked()).toBe(pedidos + 2);
    http.expectNone({ method: 'POST', url: `/token/${TOKEN_ID}/requests/search` });
  });

  it('deve contar a lista filtrada Quando a Entrada já abre filtrada (o link), sem contagem anterior', async () => {
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

  describe('Dado as chegadas pelo tempo real', () => {
    /** As animações pedidas ao navegador: o jsdom não tem WAAPI. */
    let animations: {
      target: Element;
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
      rate: number;
      state: string;
    }[];
    const NOVA = webhookRequest(30, {
      token_id: TOKEN_ID,
      url: `http://localhost:8084/${TOKEN_ID}/webhooks/novo`,
      signature: valida,
      schema: { valid: true, errors: [] },
      rule: null,
      near_miss: PELA_PADRAO.near_miss,
      response: { status: 200 },
    });
    const daP1 = (n: number) => ({ ...DA_P1, uuid: `p1-${n}`, token_id: TOKEN_ID });
    const animadas = (seletor: string) =>
      animations.filter((animation) => animation.target.matches(seletor));

    beforeEach(() => {
      animations = [];
      Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
          const record = { target: this, keyframes, options, rate: 1, state: 'running' };
          animations.push(record);
          const animation = new EventTarget() as EventTarget & Partial<Animation>;
          Object.assign(animation, {
            updatePlaybackRate: (rate: number) => (record.rate = rate),
            cancel: () => {
              record.state = 'cancelled';
              animation.dispatchEvent(new Event('cancel'));
            },
            finish: () => {
              record.state = 'finished';
              animation.dispatchEvent(new Event('finish'));
            },
          });
          return animation;
        },
      });
    });

    afterEach(() => {
      delete (Element.prototype as { animate?: unknown }).animate;
      TestBed.inject(CircuitFlow).release();
    });

    it('deve lançar o pulso inteiro pelo caminho da chegada isolada e fazer a linha nascer quando ele se desfaz na Resposta', async () => {
      const { container, fixture } = await mostrar();
      const flow = TestBed.inject(CircuitFlow);

      const nasce = flow.arrive(NOVA, { at: 0 });

      expect(nasce).toBeInstanceOf(Promise);
      const ponto = container.querySelector<HTMLElement>('.fx .dot');
      expect(ponto?.style.getPropertyValue('offset-path')).toBe(
        'path("M80,60 H280 H460 H640 H686 Q690,60 690,56 V16 Q690,12 694,12 H856 Q860,12 860,16 V24 V48 V72 H1060 V60 H1140")',
      );
      expect(container.querySelector('.fx .trail')).not.toBeNull();
      // 5 saltos de 180 ms; o ponto se desfaz no tempo de mais um; a linha nasce em 1080 ms.
      expect(animadas('.dot')[0].options).toEqual({ duration: 900, fill: 'forwards' });
      expect(fixture.componentInstance.draw(NOVA, 'full', false)?.born).toBe(1080);
      // Sem a tela abri-la, o desenho segue o de antes (a configuração).
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/No request open\.$/);
    });

    it('deve mostrar a chegada que a tela vai abrir enquanto o pulso passa: cada aresta acende e cada ✓ aparece quando ele chega ao nó', async () => {
      const { container, fixture } = await mostrar();

      void TestBed.inject(CircuitFlow).arrive(NOVA, { at: 0, opens: true });
      await fixture.whenStable();

      expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
        'Open request: POST /webhooks/novo',
      );
      const aparece = (key: string) =>
        animadas(`[data-key="${key}"]`).map(({ options }) => [options.delay, options.duration]);
      expect(aparece('sender:sub')).toEqual([[0, 231]]);
      expect(aparece('signature:gl')).toEqual([[180, 231]]);
      expect(aparece('schema:gl')).toEqual([[360, 231]]);
      expect(aparece('response:data')).toEqual([[900, 231]]);
      expect(animadas('.route path[data-edge="rs"]')[0].options.duration).toBe(180);
      expect(animadas('.route path[data-edge="out"]')[0].options.duration).toBe(900);
      // O caminho fica em tinta cheia até a linha nascer e assenta em 70 % em 1,5 s.
      const assenta = animadas('.route')[0];
      expect(assenta.options.duration).toBe(1080 + 1500);
      expect(assenta.keyframes.map((frame) => frame['opacity'])).toEqual([1, 1, 0.7]);
      expect(container.querySelectorAll('.badge').length).toBeGreaterThan(0);

      // A pessoa abre outra mensagem: o desenho é o dela, já, e o assentar para (sem motion).
      store.select(DA_P1.uuid);
      await fixture.whenStable();
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/P1 ✓ → 401\.$/);
      expect(assenta.state).toBe('cancelled');
    });

    it('deve seguir mostrando a chegada seguinte enquanto o pulso passa Quando a tela abre a anterior, que acabou de nascer', async () => {
      const { fixture } = await mostrar();
      const flow = TestBed.inject(CircuitFlow);
      const SEGUINTE = {
        ...NOVA,
        uuid: 'seguinte',
        url: `http://localhost:8084/${TOKEN_ID}/webhooks/seguinte`,
      };
      void flow.arrive(NOVA, { at: 0, opens: true });
      await fixture.whenStable();
      const antes = animations.length;
      void flow.arrive(SEGUINTE, { at: 1000, opens: true });
      await fixture.whenStable();
      const revelacao = animations.slice(antes).filter(({ target }) => !target.closest('.fx'));
      expect(revelacao.length).toBeGreaterThan(0);

      // Com "Follow new", a anterior nasce na lista e a tela a abre, 80 ms depois.
      store.append(NOVA, 3);
      store.select(NOVA.uuid);
      await fixture.whenStable();

      expect(revelacao.map(({ state }) => state)).toEqual(revelacao.map(() => 'running'));
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
        'Open request: POST /webhooks/seguinte',
      );

      // A pessoa abre outra mensagem: aí o desenho é o dela, já.
      store.select(DA_P1.uuid);
      await fixture.whenStable();
      expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/P1 ✓ → 401\.$/);
      expect(revelacao.some(({ state }) => state === 'running')).toBe(false);
    });

    it('deve rebaixar o pulso inteiro, sem rastro e no dobro da velocidade, e dar pulso curto de 90 ms à segunda da rajada', async () => {
      const { container } = await mostrar();
      const flow = TestBed.inject(CircuitFlow);
      flow.arrive(NOVA, { at: 0 });
      const inteiro = animadas('.dot')[0];

      expect(flow.arrive(daP1(1), { at: 75 })).toBeNull();
      flow.arrive(daP1(2), { at: 90 });
      await new Promise((frame) => requestAnimationFrame(frame));

      expect(inteiro.rate).toBe(2);
      expect(container.querySelectorAll('.fx .trail')).toHaveLength(0);
      // As duas do mesmo caminho no mesmo quadro dividem um pulso curto: 5 saltos de 90 ms.
      const viagens = animadas('.dot').filter(({ options }) => !options.delay);
      expect(viagens.map(({ options }) => options.duration)).toEqual([900, 450]);
    });

    it('deve virar fluxo acima de 5 por segundo: sem pulso, arestas engrossando, o medidor "N/s" e os contadores rolando só pela chegada', async () => {
      const { container, fixture } = await mostrar();
      const flow = TestBed.inject(CircuitFlow);
      for (let n = 1; n <= 7; n++) {
        flow.arrive(daP1(n), { at: performance.now() });
      }
      await new Promise((frame) => requestAnimationFrame(frame));
      store.append(daP1(1), 3);
      flow.land();
      await fixture.whenStable();
      // O passo do fluxo (231 ms): a contagem troca uma vez por passo, para o contador rolar até o número novo.
      const contador = container.querySelector<HTMLElement>('[data-key="rule:p1:ann"] .ctr');
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(contador?.style.getPropertyValue('--n')).toBe('2');
      });

      const espessura = (id: string) =>
        container.querySelector<SVGElement>(`.edge[data-edge="${id}"]`)?.style.strokeWidth;
      expect(espessura('x0')).toBe('1.75px');
      expect(espessura('x1')).toBe('');
      expect(container.querySelector('.meter')?.textContent).toBe('7/s');
      expect(container.querySelector('.band')?.classList.contains('rolls')).toBe(true);
      expect(container.querySelector('[data-key="rule:p1:ann"]')?.textContent).toBe('✗ 401 · 2');
      // Só o pulso inteiro da primeira e um curto (as de 2 a 5 dividem o quadro): da 6.ª em diante, nenhum.
      expect(animadas('.dot').filter(({ options }) => !options.delay)).toHaveLength(2);

      // No mesmo passo, a próxima contagem espera o fim dele (a 60 por segundo, o contador recomeçaria a cada uma e
      // não sairia do lugar); a que muda sem chegada (outra lista, uma apagada) troca sem rolar.
      store.append(daP1(9), 4);
      await fixture.whenStable();
      expect(contador?.style.getPropertyValue('--n')).toBe('2');
      expect(container.querySelector('.band')?.classList.contains('rolls')).toBe(false);
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(contador?.style.getPropertyValue('--n')).toBe('3');
      });
    });

    it('deve dizer quando a linha nasce sem desenhar pulso nem aparecer aos poucos, com movimento reduzido', async () => {
      const reduzido = vi.spyOn(MediaMatcher.prototype, 'matchMedia').mockReturnValue({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as MediaQueryList);
      const { container, fixture } = await mostrar();
      reduzido.mockRestore();

      const nasce = TestBed.inject(CircuitFlow).arrive(NOVA, { at: 0, opens: true });

      expect(nasce).toBeInstanceOf(Promise);
      expect(fixture.componentInstance.draw(NOVA, 'full', true)?.born).toBe(1080);
      expect(container.querySelector('.fx .dot')).toBeNull();
      // Nada aparece aos poucos: as animações só seguram o que espera a linha nascer.
      for (const { keyframes } of animations) {
        expect(new Set(keyframes.map((frame) => JSON.stringify(frame))).size).toBe(1);
      }
      expect(TestBed.inject(CircuitFlow).arrive(daP1(1), { at: 80 })).toBeNull();
    });

    it('deve acender o Remetente com o IP já, e o resto do caminho de uma vez quando a linha nasce, com movimento reduzido', async () => {
      const reduzido = vi.spyOn(MediaMatcher.prototype, 'matchMedia').mockReturnValue({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      } as unknown as MediaQueryList);
      const { container, fixture } = await mostrar();
      reduzido.mockRestore();

      void TestBed.inject(CircuitFlow).arrive(NOVA, { at: 0, opens: true });
      await fixture.whenStable();

      expect(container.querySelector('[data-key="sender:sub"]')?.textContent).toBe(NOVA.ip);
      expect(animadas('[data-key="sender:sub"]')).toHaveLength(0);
      expect(animadas('[data-mark="sender"]')).toHaveLength(0);
      // O resto fica escondido, parado, até a linha nascer (1080 ms), e aparece sem fade.
      const escondido = (seletor: string) =>
        animadas(seletor).map(({ keyframes, options }) => ({
          valores: keyframes.map((frame) => frame['opacity'] ?? frame['stroke']),
          duracao: options.duration,
          atraso: options.delay ?? 0,
        }));
      for (const chave of ['signature:gl', 'schema:gl', 'response:data']) {
        expect(escondido(`[data-key="${chave}"]`)).toEqual([
          { valores: [0, 0], duracao: 1080, atraso: 0 },
        ]);
      }
      expect(escondido('.route path[data-edge="rs"]')).toEqual([
        { valores: [0, 0], duracao: 1080, atraso: 0 },
      ]);
      expect(animadas('.route')).toHaveLength(0);
      expect(container.querySelector('.fx .dot')).toBeNull();
    });

    it('não deve desenhar chegada nenhuma no celular (a linha do caminho)', async () => {
      await mostrar(undefined, true);

      expect(TestBed.inject(CircuitFlow).arrive(NOVA, { at: 0 })).toBeNull();
    });
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

  it('deve falar pt-BR Quando a tradução está carregada', async () => {
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

// Função pura, fora do `describe` acima: o `afterEach` de lá confere o `HttpTestingController` do último teste que
// desenhou o circuito, e um pedido atrasado daquele teste caía na conta deste.
describe('Dado a largura útil da faixa', () => {
  it('deve caber o palco na faixa: margem de até 24 px, escala até 10 px de texto e só então rolar', () => {
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
});
