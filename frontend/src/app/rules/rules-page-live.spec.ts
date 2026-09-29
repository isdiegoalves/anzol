import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { RequestStream } from '../realtime/request-stream';
import { Preferences } from '../settings/preferences';
import { Viewport, WindowClass } from '../shell/viewport';
import { TokenStats } from '../stats/stats';
import { Rule } from './rule';
import { RulesPage } from './rules-page';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const URL_STATS = `/token/${TOKEN_ID}/stats`;
const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;

function stats(answered: number, evaluated: number): Partial<TokenStats> {
  return {
    evaluated,
    rules: { answered: [{ id: 'r1', name: 'Rule 1', count: answered }], near_miss: [], default: 0 },
  };
}

/** Uma mensagem nova pelo SSE. */
const chega = (n: number) =>
  FakeEventSource.latest().emit('request.created', { request: webhookRequest(n), total: n });

describe('Dado a lista de Regras ao vivo (WM-38)', () => {
  let http: HttpTestingController;
  const windowClass = signal<WindowClass>('large');
  let hidden = false;
  const hits = () => document.querySelector('[data-rule-id="r1"] .hits')?.textContent?.trim();

  const open = async (rules: Rule[], inputs: { ruleId?: string } = {}) => {
    const result = await render(RulesPage, {
      inputs: { tokenId: TOKEN_ID, ...inputs },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Viewport, useValue: { windowClass } },
      ],
      configureTestBed: () => TestBed.inject(Preferences).token.set(token()),
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(rules);
    await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats(1, 3)));
    await screen.findByRole('table', { name: 'Rules' });
    return result;
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('deve assinar o SSE da URL sem acender o "Live" do cabeçalho', async () => {
    await open([rule(1)]);

    expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`);
    FakeEventSource.latest().open();
    expect(TestBed.inject(RequestStream).status()).toBe('idle');
  });

  it('deve reler os hits uma vez a cada 5 s (trailing) Quando chegam mensagens', async () => {
    await open([rule(1)]);
    expect(hits()).toBe('Answered 1 of the last 3');

    chega(4);
    chega(5);
    await vi.advanceTimersByTimeAsync(4000);
    http.expectNone(URL_STATS);

    await vi.advanceTimersByTimeAsync(1000);
    http.expectOne(URL_STATS).flush(stats(3, 5));
    await vi.waitFor(() => expect(hits()).toBe('Answered 3 of the last 5'));
    // Os hits não somem enquanto relê (sem piscar "Hits unavailable").
    chega(6);
    await vi.advanceTimersByTimeAsync(5000);
    expect(hits()).toBe('Answered 3 of the last 5');
    http.expectOne(URL_STATS).flush(stats(4, 6));
  });

  it('deve reler também os estados dos cenários', async () => {
    const cenario = rule(1, { scenario: { name: 'e', requiredState: 'Started', newState: 'x' } });
    await open([cenario]);
    await vi.waitFor(() =>
      http.expectOne(URL_CENARIOS).flush([{ name: 'e', state: 'Started', states: [] }]),
    );

    chega(4);
    await vi.advanceTimersByTimeAsync(5000);

    http.expectOne(URL_STATS).flush(stats(2, 4));
    http.expectOne(URL_CENARIOS).flush([{ name: 'e', state: 'x', states: [] }]);
    await vi.waitFor(() =>
      expect(document.querySelector('tr.scenario-group')?.textContent).toContain('state: x'),
    );
  });

  it('não deve reler com a aba em segundo plano, e deve reler ao voltar', async () => {
    await open([rule(1)]);

    hidden = true;
    chega(4);
    await vi.advanceTimersByTimeAsync(5000);
    http.expectNone(URL_STATS);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    http.expectOne(URL_STATS).flush(stats(2, 4));
    await vi.waitFor(() => expect(hits()).toBe('Answered 2 of the last 4'));
  });

  it('não deve reler ao voltar Quando nada chegou em segundo plano', async () => {
    await open([rule(1)]);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    http.expectNone(URL_STATS);
  });

  it('não deve mexer no editor aberto', async () => {
    await open([rule(1)], { ruleId: 'r1' });
    const editor = await screen.findByRole('region', { name: 'Edit rule Rule 1' });
    // O "From this request" do editor (F3) lê a mensagem mais nova: não é o que este teste olha.
    await vi.waitFor(() =>
      http
        .expectOne((req) => req.url === `/token/${TOKEN_ID}/requests`)
        .flush({ data: [], total: 0, is_last_page: true }),
    );
    const nome = within(editor).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Editando');

    chega(4);
    await vi.advanceTimersByTimeAsync(5000);
    http.expectOne(URL_STATS).flush(stats(2, 4));

    await vi.waitFor(() => expect(hits()).toBe('Answered 2 of the last 4'));
    expect(nome.value).toBe('Editando');
    expect(within(editor).getByText('Unsaved changes')).toBeTruthy();
  });

  it('deve fechar o SSE Quando a página sai', async () => {
    const { fixture } = await open([rule(1)]);
    const source = FakeEventSource.latest();

    fixture.destroy();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});
