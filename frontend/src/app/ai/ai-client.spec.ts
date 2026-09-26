import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { AiClient, aiErrorMessages } from './ai-client';

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

  afterEach(() => http.verify());

  it('deve mandar prompt, idioma do navegador e a mensagem de exemplo Quando pede uma regra', async () => {
    const answer = ai.suggestRule(TOKEN_ID, 'responda 429', REQUEST_ID);

    const call = http.expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/rules/suggest` });
    expect(call.request.body).toEqual({
      prompt: 'responda 429',
      lang: navigator.language,
      request_id: REQUEST_ID,
    });
    call.flush({ rule: rule(1), explanation: 'ok', attempts: 2 });
    expect(await answer).toEqual({ rule: rule(1), explanation: 'ok', attempts: 2 });
  });

  it('deve omitir request_id Quando não há mensagem de exemplo', () => {
    void ai.suggestRule(TOKEN_ID, 'x');

    const call = http.expectOne(`/token/${TOKEN_ID}/rules/suggest`);
    expect(call.request.body).toEqual({ prompt: 'x', lang: navigator.language });
    call.flush({ rule: rule(1), explanation: '', attempts: 1 });
  });

  it('deve mandar o idioma do navegador Quando pede o diagnóstico da mensagem', async () => {
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);

    const call = http.expectOne({
      method: 'POST',
      url: `/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`,
    });
    expect(call.request.body).toEqual({ lang: navigator.language });
    call.flush({ explanation: 'texto', facts: {} });
    expect((await answer).explanation).toBe('texto');
  });

  it('deve ficar desligado Quando o servidor responde 503', async () => {
    const answer = ai.explain(TOKEN_ID, REQUEST_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`)
      .flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Unavailable' });

    await expect(answer).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(ai.disabled()).toBe(true);
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

  it('deve dar a dica de configuração Quando é 503', () => {
    expect(aiErrorMessages(error(503, { error: 'AI is not configured' }))).toEqual([
      'AI is not configured on this server. Set WEBHOOK_AI_* to enable.',
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
