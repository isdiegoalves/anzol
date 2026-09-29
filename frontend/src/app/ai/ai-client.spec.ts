import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import {
  AiCancelled,
  AiClient,
  AiTimedOut,
  EXPLANATION_KEY,
  aiErrorMessages,
  aiRetrySeconds,
} from './ai-client';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';

describe('Dado o cliente das rotas de IA', () => {
  let http: HttpTestingController;
  let ai: AiClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    ai = TestBed.inject(AiClient);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    document.documentElement.lang = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  it('deve mandar prompt, o idioma da tela e a mensagem de exemplo Quando pede uma regra', async () => {
    document.documentElement.lang = 'pt-BR';
    const answer = ai.suggestRule(TOKEN_ID, 'responda 429', REQUEST_ID);

    const call = http.expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/rules/suggest` });
    expect(call.request.body).toEqual({
      prompt: 'responda 429',
      lang: 'pt-BR',
      request_id: REQUEST_ID,
    });
    call.flush({ rule: rule(1), explanation: 'ok', attempts: 2 });
    expect(await answer).toEqual({ rule: rule(1), explanation: 'ok', attempts: 2 });
  });

  it('deve omitir request_id Quando não há mensagem de exemplo', () => {
    void ai.suggestRule(TOKEN_ID, 'x');

    const call = http.expectOne(`/token/${TOKEN_ID}/rules/suggest`);
    expect(call.request.body).toEqual({ prompt: 'x', lang: 'en' });
    call.flush({ rule: rule(1), explanation: '', attempts: 1 });
  });

  it('deve mandar o idioma da tela e guardar a explicação na aba, com a hora e a duração', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-28T21:31:00Z') });
    expect(ai.keptExplanation(TOKEN_ID, REQUEST_ID)).toBeNull();
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);

    const call = http.expectOne({
      method: 'POST',
      url: `/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`,
    });
    expect(call.request.body).toEqual({ lang: 'en' });
    vi.advanceTimersByTime(8800);
    call.flush({ explanation: 'texto', facts: {} });

    const kept = await answer;
    expect(kept).toMatchObject({ explanation: 'texto', seconds: 8.8 });
    expect(kept.answeredAt).toBe(new Date('2026-09-28T21:31:08.800Z').getTime());
    expect(sessionStorage.getItem(EXPLANATION_KEY(TOKEN_ID, REQUEST_ID, 'en'))).not.toBeNull();
    expect(ai.keptExplanation(TOKEN_ID, REQUEST_ID)).toEqual(kept);
    // Outro idioma é outra explicação.
    document.documentElement.lang = 'pt-BR';
    expect(ai.keptExplanation(TOKEN_ID, REQUEST_ID)).toBeNull();
  });

  it('deve abortar o pedido e rejeitar com AiCancelled Quando "Cancel"', async () => {
    const cancel = new AbortController();
    const answer = ai.suggestRule(TOKEN_ID, 'x', undefined, cancel.signal);
    const call = http.expectOne(`/token/${TOKEN_ID}/rules/suggest`);

    cancel.abort();

    await expect(answer).rejects.toBeInstanceOf(AiCancelled);
    expect(call.cancelled).toBe(true);
  });

  it('deve desistir em 90 s, abortando o pedido', async () => {
    vi.useFakeTimers();
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);
    const call = http.expectOne(`/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`);
    const failed = expect(answer).rejects.toBeInstanceOf(AiTimedOut);

    vi.advanceTimersByTime(90_000);

    await failed;
    expect(call.cancelled).toBe(true);
    expect(aiErrorMessages(new AiTimedOut())).toEqual(['The local model did not answer in 90 s.']);
  });

  it('deve dizer quanto o pedido costuma levar: o p50 medido sem histórico, a mediana das últimas 5 depois', async () => {
    vi.useFakeTimers();
    expect(ai.usualSeconds('explain')).toBe(9);
    expect(ai.usualSeconds('suggest')).toBe(5);

    for (const seconds of [30, 2, 4, 3, 20, 1]) {
      const answer = ai.suggestRule(TOKEN_ID, 'x');
      vi.advanceTimersByTime(seconds * 1000);
      http
        .expectOne(`/token/${TOKEN_ID}/rules/suggest`)
        .flush({ rule: rule(1), explanation: '', attempts: 1 });
      await answer;
    }

    // As últimas 5: 2, 4, 3, 20, 1 → mediana 3. O Explain não muda.
    expect(ai.usualSeconds('suggest')).toBe(3);
    expect(ai.usualSeconds('explain')).toBe(9);
  });

  it('deve ficar desligado Quando o servidor responde 503', async () => {
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`)
      .flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Unavailable' });

    await expect(answer).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(ai.disabled()).toBe(true);
    // O desligamento vale pelo resto da sessão da aba.
    expect(sessionStorage.getItem('anzol.ai.off')).toBe('1');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    expect(TestBed.inject(AiClient).disabled()).toBe(true);
  });

  it('deve seguir ligado Quando o erro é outro (502)', async () => {
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`)
      .flush({ error: 'LLM down' }, { status: 502, statusText: 'Bad Gateway' });

    await expect(answer).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(ai.disabled()).toBe(false);
  });
});

describe('Dado um erro de uma rota de IA', () => {
  const error = (status: number, body: unknown, headers?: Record<string, string>) =>
    new HttpErrorResponse({ status, error: body, headers: new HttpHeaders(headers) });

  it('deve dizer os segundos do Retry-After do 429, para a contagem regressiva', () => {
    expect(aiRetrySeconds(error(429, {}, { 'Retry-After': '12' }))).toBe(12);
    expect(aiRetrySeconds(error(429, {}))).toBeNull();
    expect(aiRetrySeconds(error(502, {}, { 'Retry-After': '12' }))).toBeNull();
  });

  it('deve dizer que o servidor não tem IA local Quando é 503', () => {
    expect(aiErrorMessages(error(503, { error: 'AI is not configured' }))).toEqual([
      'This server has no local AI.',
    ]);
  });

  it('deve dizer que o modelo não respondeu, com o motivo do servidor Quando é 502', () => {
    expect(aiErrorMessages(error(502, { error: 'connection refused' }))).toEqual([
      'The local model did not answer: connection refused',
      'Check that it is running and reachable from the server, then try again.',
    ]);
  });

  it('deve listar os últimos erros da regra Quando é 422 do suggest', () => {
    expect(
      aiErrorMessages(
        error(422, {
          error: 'No valid rule after 3 attempts',
          errors: { 'response.status': ['must be between 100 and 599'], name: ['is required'] },
        }),
      ),
    ).toEqual([
      'No valid rule after 3 attempts',
      'response.status: must be between 100 and 599',
      'name: is required',
    ]);
  });

  it('deve listar os erros por chave Quando o 422 vem só com o mapa de erros', () => {
    expect(
      aiErrorMessages(error(422, { 'response.status': ['The status must be at most 599.'] })),
    ).toEqual(['response.status: The status must be at most 599.']);
    expect(aiErrorMessages(error(422, null))).toEqual(['The request was not accepted.']);
  });

  it.each([
    ['30', 'Try again in 30 s.'],
    ['Wed, 21 Oct 2026 07:28:00 GMT', 'Try again after Wed, 21 Oct 2026 07:28:00 GMT.'],
  ])('deve dizer quando tentar de novo Quando é 429 com Retry-After %s', (retryAfter, end) => {
    const [message] = aiErrorMessages(error(429, null, { 'Retry-After': retryAfter }));

    expect(message).toContain('Too many AI calls for this URL');
    expect(message.endsWith(end)).toBe(true);
  });

  it('deve dizer "in a moment" Quando o 429 vem sem Retry-After', () => {
    expect(aiErrorMessages(error(429, null))[0]).toContain('Try again in a moment.');
  });

  it.each([404, 410])('deve dizer que a URL ou mensagem sumiu Quando é %s', (status) => {
    expect(aiErrorMessages(error(status, null))).toEqual([
      `This URL or request no longer exists (${status}).`,
    ]);
  });

  it('deve dar o status Quando é outro erro', () => {
    expect(aiErrorMessages(error(500, null))).toEqual(['The AI call failed (500).']);
    expect(aiErrorMessages(error(0, null))).toEqual(['The AI call failed (no answer).']);
    expect(aiErrorMessages(new Error('x'))).toEqual(['The AI call failed (unknown).']);
  });
});
