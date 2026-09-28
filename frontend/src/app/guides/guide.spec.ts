import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subject } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { RequestStream } from '../realtime/request-stream';
import { RequestStore } from '../requests/request-store';
import { RequestCreated, WebhookRequest } from '../requests/webhook-request';
import { Rule } from '../rules/rule';
import { Guide, GuideName } from './guide';
import { CHECK_SETTLE_MS } from './retry-guide';

const URL_RULES = `/token/${TOKEN_ID}/rules`;
const URL_REQUESTS = `/token/${TOKEN_ID}/requests?page=1&sorting=newest`;

describe('Dado um roteiro (R1)', () => {
  let http: HttpTestingController;
  let arrivals: Subject<RequestCreated>;

  /** Abre o roteiro numa URL com estas requisições e estas regras. */
  const show = async (name: GuideName, requests: WebhookRequest[] = [], rules: Rule[] = []) => {
    arrivals = new Subject<RequestCreated>();
    const connect = vi.fn(() => arrivals);
    const result = await render(Guide, {
      inputs: { name, tokenId: TOKEN_ID },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: RequestStream, useValue: { connect } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const loaded = TestBed.inject(RequestStore).load(TOKEN_ID);
    http.expectOne(URL_REQUESTS).flush(requestPage(requests));
    await loaded;
    http.expectOne({ method: 'GET', url: URL_RULES }).flush(rules);
    await result.fixture.whenStable();
    return { ...result, connect };
  };
  const step = (name: string) =>
    screen
      .getAllByRole('listitem')
      .find((item) => item.querySelector('.name')?.textContent === name) as HTMLElement;
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
    localStorage.clear();
  });

  describe('Dado o "First webhook"', () => {
    it('deve ser a região "Guide: First webhook", com os passos e o estado de cada um', async () => {
      const { container } = await show('first');

      expect(screen.getByRole('region', { name: 'Guide: First webhook' })).toBeTruthy();
      expect(
        screen
          .getAllByRole('listitem')
          .map((item) => text(item.querySelector('h3')))
          .filter(Boolean),
      ).toEqual([
        '1 Send a request, to do',
        '2 See it arrive, to do',
        "3 Check the provider's signature, optional",
        '4 Choose the answer, optional',
        '5 Test a retry, optional',
      ]);
      expect(screen.queryByRole('button', { name: /^(Next|Continue)$/ })).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve emitir o fechamento Quando "Close guide" é clicado', async () => {
      const { fixture } = await show('first');
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);

      await userEvent.click(screen.getByRole('button', { name: 'Close guide' }));

      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('deve copiar o comando curl e avisar que ele tem a URL', async () => {
      await show('first');
      const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy');
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      await userEvent.click(screen.getByRole('button', { name: 'Copy curl command' }));

      expect(copy.mock.calls[0][0]).toMatch(new RegExp(`^curl .*/${TOKEN_ID}$`));
      expect(announce).toHaveBeenCalledWith('Command copied. It has this URL, which is a secret.');
    });

    it('deve dar por feito o que a URL tem e abrir a requisição que chegou', async () => {
      const request = webhookRequest(1, {
        url: `http://localhost:8084/${TOKEN_ID}/primeira`,
        created_at: '2026-09-28 21:30:00',
      });
      const { fixture } = await show('first', [request], [rule(1)]);
      const opened = vi.fn();
      fixture.componentInstance.openRequest.subscribe(opened);

      expect(text(step('Send a request').querySelector('.state'))).toBe('done');
      expect(text(step('Choose the answer').querySelector('.state'))).toBe('done');
      expect(text(step('See it arrive'))).toMatch(/POST \/primeira, at \d{2}:30\./);
      await userEvent.click(within(step('See it arrive')).getByRole('button', { name: 'Open it' }));

      expect(opened).toHaveBeenCalledWith(request);
    });

    it('deve levar os passos opcionais a Verificações, à regra nova e ao roteiro de retry', async () => {
      await show('first');

      const href = (name: string) => within(step(name)).getByRole('link').getAttribute('href');
      expect(href("Check the provider's signature")).toBe(`/${TOKEN_ID}/checks?section=signature`);
      expect(href('Choose the answer')).toBe(`/${TOKEN_ID}/rules/new`);
      expect(href('Test a retry')).toBe(`/${TOKEN_ID}?guide=retry`);
    });
  });

  describe('Dado o "Test a retry"', () => {
    const check = () =>
      within(screen.getByRole('group', { name: 'Retry check' })).getByRole('status');
    const field = (name: string, index = 0) =>
      screen.getAllByRole('spinbutton', { name })[index] as HTMLInputElement;
    /** As três regras como o servidor as devolve depois do PUT. */
    const saved = (body: Rule[]) => body.map((r, i) => ({ ...r, id: r.id ?? `n${i}` }));

    /** Preenche o caminho e a espera, e cria as regras. */
    const create = async (retryAfter: string) => {
      await userEvent.type(screen.getByRole('textbox', { name: 'Path' }), '/cobrancas');
      await userEvent.clear(field('Status'));
      await userEvent.type(field('Status'), '429');
      if (retryAfter) {
        await userEvent.type(field('Retry-After (s)'), retryAfter);
      }
      await userEvent.click(screen.getByRole('button', { name: 'Create 3 rules' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_RULES }).flush([]));
      const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_RULES }));
      const rules = saved(put.request.body as Rule[]);
      put.flush(rules);
      await vi.waitFor(() => expect(text(step('Create'))).toContain('3 rules created'));
      return rules;
    };
    /** Uma requisição que chega pelo tempo real, respondida pela regra `index` da sequência. */
    const arrive = (rules: Rule[], index: number, second: number, n = index + 1) =>
      arrivals.next({
        request: webhookRequest(n, {
          url: `http://localhost:8084/${TOKEN_ID}/cobrancas`,
          created_at: `2026-09-28 21:40:${String(second).padStart(2, '0')}`,
          rule: { id: rules[index].id ?? '', name: rules[index].name },
          response: { status: rules[index].response?.status },
        }),
        total: n,
        truncated: false,
      });
    /** A espera da leva e a volta da tela. */
    const settle = () => vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100);

    it('deve ser a região "Guide: Test a retry", com todos os passos à vista e os padrões do assistente', async () => {
      const { container, connect } = await show('retry');

      expect(screen.getByRole('region', { name: 'Guide: Test a retry' })).toBeTruthy();
      expect(text(container)).toContain(
        'Make this URL refuse a few times and then accept, and see what your sender does.',
      );
      expect(
        screen
          .getAllByRole('listitem')
          .map((item) => text(item.querySelector('h3')))
          .filter(Boolean),
      ).toEqual([
        '1 Which requests, to do',
        '2 What to answer first, to do',
        '3 What to answer after, to do',
        '4 Create, to do',
        '5 Send and check, to do',
      ]);
      expect([field('Status').value, field('Times').value, field('Status', 1).value]).toEqual([
        '503',
        '2',
        '200',
      ]);
      expect(field('Retry-After (s)').value).toBe('');
      expect(text(step('What to answer after'))).toContain('stays');
      // A região viva da conferência existe desde a carga, vazia e sem nome.
      expect(check().textContent?.trim()).toBe('');
      expect(check().hasAttribute('aria-label')).toBe(false);
      expect(connect).toHaveBeenCalledWith(TOKEN_ID, { quiet: true });
      await expectNoAxeViolations(container);
    });

    it('deve começar no método mais comum da URL, dizendo quantas, e em POST sem requisição', async () => {
      await show('retry', [
        webhookRequest(1, { method: 'PUT' }),
        webhookRequest(2, { method: 'PUT' }),
        webhookRequest(3, { method: 'POST' }),
      ]);
      const pressed = () =>
        within(screen.getByRole('group', { name: 'Methods' }))
          .getAllByRole('button', { pressed: true })
          .map((button) => text(button));

      expect(pressed()).toEqual(['PUT']);
      expect(text(step('Which requests'))).toContain('Starts at the most common: PUT, 2 of 3.');

      // Um método só: clicar no escolhido o mantém.
      await userEvent.click(screen.getByRole('button', { name: 'PUT' }));
      expect(pressed()).toEqual(['PUT']);
      await userEvent.click(screen.getByRole('button', { name: 'DELETE' }));
      expect(pressed()).toEqual(['DELETE']);
    });

    it('deve criar as regras com o Retry-After, anunciar quantas e esperar as requisições', async () => {
      await show('retry');
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      const rules = await create('5');

      expect(rules.map((r) => [r.name, r.match?.method, r.match?.path, r.response])).toEqual([
        [
          'cobrancas 1/3',
          ['POST'],
          { equals: '/cobrancas' },
          { status: 429, headers: { 'Retry-After': '5' }, body: '' },
        ],
        [
          'cobrancas 2/3',
          ['POST'],
          { equals: '/cobrancas' },
          { status: 429, headers: { 'Retry-After': '5' }, body: '' },
        ],
        [
          'cobrancas 3/3',
          ['POST'],
          { equals: '/cobrancas' },
          { status: 200, headers: {}, body: '' },
        ],
      ]);
      expect(announce).toHaveBeenCalledWith('3 rules created.');
      expect(text(step('Create'))).toContain('3 rules created · scenario "cobrancas"');
      expect(text(step('Create').querySelector('.state'))).toBe('done');
      expect(text(check())).toBe('Waiting for POST /cobrancas. Nothing arrived yet.');
    });

    it('deve dizer o que corrigir, sem gravar, Quando um campo é inválido', async () => {
      await show('retry');

      await userEvent.clear(field('Times'));
      await userEvent.type(field('Times'), '30');
      await userEvent.click(screen.getByRole('button', { name: /^Create/ }));

      expect(screen.getByRole('alert').textContent).toContain('To create, fix: Times (1–20)');
      expect(document.activeElement).toBe(field('Times'));
    });

    it('deve mostrar o erro do servidor e manter os campos Quando criar falha', async () => {
      await show('retry');
      await userEvent.type(screen.getByRole('textbox', { name: 'Path' }), '/cobrancas');

      await userEvent.click(screen.getByRole('button', { name: 'Create 3 rules' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_RULES }).flush([]));
      (await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_RULES }))).flush(
        { rules: ['too many rules'] },
        { status: 422, statusText: 'Unprocessable' },
      );

      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('too many'));
      expect((screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe(
        '/cobrancas',
      );
      expect(screen.getByRole('button', { name: 'Create 3 rules' })).toBeTruthy();
    });

    it('deve falar uma vez por leva de chegadas e dizer "as programmed" com a espera respeitada', async () => {
      await show('retry');
      const rules = await create('5');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const said: string[] = [];
      new MutationObserver(() => said.push(text(check()) ?? '')).observe(check(), {
        childList: true,
        characterData: true,
        subtree: true,
      });

      arrive(rules, 0, 2);
      arrive(rules, 1, 7);
      await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS - 100);
      // A trilha à vista cresce na hora, fora da fala; a região ainda não mudou.
      expect(text(screen.getByRole('group', { name: 'Retry check' }))).toContain(
        'Arriving: 429 · 429',
      );
      expect(said).toEqual([]);
      await settle();
      expect(text(check())).toContain('2 requests arrived. Answers: 429, 429.');
      arrive(rules, 2, 13);
      await settle();

      expect(text(check())).toContain('3 requests arrived. Answers: 429, 429, 200, as programmed.');
      expect(text(check())).toContain('Came about 5 s after.');
      expect(text(check())).toContain('Waited 6 s. It asked to wait 5 s.');
      expect(text(check())).toContain(
        'Wait asked: Retry-After: 5, as configured now. Times are kept to the second.',
      );
      expect(new Set(said.map((phrase) => phrase.slice(0, 20))).size).toBe(2);
      expect(text(step('Send and check').querySelector('.state'))).toBe('done');
    });

    it('nunca deve dizer "as programmed" Quando as requisições chegaram antes da espera pedida', async () => {
      const { container } = await show('retry');
      const rules = await create('5');
      vi.useFakeTimers({ shouldAdvanceTime: true });

      arrive(rules, 0, 2);
      arrive(rules, 1, 2);
      arrive(rules, 2, 3);
      await settle();

      expect(text(check())).toContain('3 requests arrived. Answers: 429, 429, 200.');
      expect(text(check())).toContain('2 requests came before the asked wait of 5 s.');
      expect(text(check())).toContain('Came 0 s after the previous answer. It asked to wait 5 s.');
      expect(text(container)).not.toMatch(/as programmed/i);
      vi.useRealTimers();
      await expectNoAxeViolations(container);
    });

    it('não deve contar a requisição de outro método ou de outro caminho', async () => {
      await show('retry');
      const rules = await create('5');
      vi.useFakeTimers({ shouldAdvanceTime: true });

      arrivals.next({
        request: webhookRequest(8, { url: `http://localhost:8084/${TOKEN_ID}/outra` }),
        total: 1,
        truncated: false,
      });
      arrivals.next({
        request: webhookRequest(9, {
          method: 'GET',
          url: `http://localhost:8084/${TOKEN_ID}/cobrancas`,
        }),
        total: 2,
        truncated: false,
      });
      arrive(rules, 0, 2);
      await settle();

      expect(text(check())).toContain('1 request arrived. Answers: 429.');
    });

    it('deve voltar o cenário ao começo e esvaziar a conferência Quando "Start over" é clicado', async () => {
      await show('retry');
      const rules = await create('5');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      arrive(rules, 0, 2);
      await settle();
      vi.useRealTimers();
      const scenarios = `/token/${TOKEN_ID}/scenarios`;

      await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: scenarios }).flush([]));
      await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: scenarios }).flush(null));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: scenarios }).flush([]));

      await vi.waitFor(() =>
        expect(text(check())).toBe('Waiting for POST /cobrancas. Nothing arrived yet.'),
      );
    });

    it('deve mandar as requisições de teste do navegador e dizer que confere as regras, não o remetente', async () => {
      await show('retry');
      await create('1');
      const sent = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status: 429 }));

      await userEvent.click(screen.getByRole('button', { name: 'Send 3 test requests' }));

      expect(text(step('Send and check'))).toContain(
        'Sent from this browser, 1 s apart. This checks the rules, not your sender.',
      );
      await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(3), { timeout: 4000 });
      expect(sent.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual(
        Array.from({ length: 3 }, () => [`${location.origin}/${TOKEN_ID}/cobrancas`, 'POST']),
      );
      sent.mockRestore();
    });

    it('deve copiar o laço de curl com o método, o caminho e o intervalo', async () => {
      await show('retry');
      await create('5');
      const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy');

      await userEvent.click(screen.getByRole('button', { name: 'Copy curl loop' }));

      expect(copy).toHaveBeenCalledWith(
        `for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}\\n' -X POST ${location.origin}/${TOKEN_ID}/cobrancas; sleep 5; done`,
      );
    });

    it('deve dar o passo de criar por feito Quando a URL já tem as regras do cenário', async () => {
      const sequence = [1, 2, 3].map((n) =>
        rule(n, { name: `sequence ${n}/3`, scenario: { name: 'sequence' } }),
      );

      await show('retry', [], sequence);

      expect(text(step('Create'))).toContain('3 rules created · scenario "sequence"');
      expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull();
    });
  });
});
