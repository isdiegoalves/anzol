import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import {
  apiDate,
  draftFromRequest,
  headerEntries,
  outboundErrorText,
  pathSuffix,
  requestErrorText,
} from './outbound';

const httpError = (status: number, error: unknown = null, headers: Record<string, string> = {}) =>
  new HttpErrorResponse({ status, error, headers: new HttpHeaders(headers) });

describe('Dado um erro de saída (error.kind)', () => {
  it('deve dizer que foi bloqueado e orientar sobre WEBHOOK_OUTBOUND_ALLOW_PRIVATE Quando é blocked', () => {
    const text = outboundErrorText({ kind: 'blocked', message: 'private address 10.0.0.5' });

    expect(text.title).toBe('Blocked');
    expect(text.detail).toBe('private address 10.0.0.5');
    expect(text.hint).toContain('WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true');
  });

  it.each([
    ['dns', 'DNS lookup failed'],
    ['connect', 'Connection failed'],
    ['timeout', 'Timed out'],
    ['tls', 'TLS error'],
    ['invalid_url', 'Invalid URL'],
  ])('deve dar um título claro e uma orientação Quando é %s', (kind, title) => {
    const text = outboundErrorText({ kind, message: 'detalhe' });

    expect(text.title).toBe(title);
    expect(text.hint).not.toBe('');
  });

  it('deve mostrar o kind como veio Quando o servidor manda um tipo desconhecido', () => {
    expect(outboundErrorText({ kind: 'novo', message: 'm' })).toEqual({
      title: 'novo',
      detail: 'm',
      hint: '',
    });
  });
});

describe('Dado um erro da API ao disparar', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');

  it('deve dizer em quantos segundos tentar de novo Quando é 429 com Retry-After em segundos', () => {
    expect(requestErrorText(httpError(429, null, { 'Retry-After': '42' }), now)).toBe(
      'Too many sends from this URL (30 per minute). Try again in 42 s.',
    );
  });

  it('deve contar os segundos até a data Quando o Retry-After é uma data HTTP', () => {
    const error = httpError(429, null, { 'Retry-After': 'Sat, 26 Sep 2026 12:00:30 GMT' });

    expect(requestErrorText(error, now)).toContain('Try again in 30 s.');
  });

  it('deve sugerir um minuto Quando o 429 vem sem Retry-After', () => {
    expect(requestErrorText(httpError(429), now)).toContain('Try again in a minute.');
  });

  it('deve juntar as mensagens de validação Quando é 422', () => {
    expect(requestErrorText(httpError(422, { url: ['The url must be http or https.'] }))).toBe(
      'Invalid request: The url must be http or https.',
    );
  });

  it.each([404, 410])('deve dizer que a URL ou a mensagem não existe Quando é %s', (status) => {
    expect(requestErrorText(httpError(status))).toBe(
      `This URL or request no longer exists (${status}).`,
    );
  });

  it('deve mostrar o status Quando é outro erro', () => {
    expect(requestErrorText(httpError(500))).toBe('Could not send the request (500).');
  });
});

describe('Dado o "Send as new…" a partir de uma mensagem', () => {
  it('deve levar método, corpo e headers sem os de conexão Quando a mensagem tem host, content-length e x-forwarded', () => {
    const request = webhookRequest(1, {
      method: 'PUT',
      content: '{"a":1}',
      headers: {
        host: ['localhost:8084'],
        'content-length': ['7'],
        'x-forwarded-for': ['1.2.3.4'],
        'cf-ray': ['x'],
        'proxy-authorization': ['p'],
        'content-type': ['application/json'],
        'x-multi': ['a', 'b'],
      },
    });

    expect(draftFromRequest(request, 'http://localhost:3000')).toEqual({
      method: 'PUT',
      url: 'http://localhost:3000',
      headers: [
        ['content-type', 'application/json'],
        ['x-multi', 'a, b'],
      ],
      body: '{"a":1}',
    });
  });

  it('deve usar POST e corpo vazio Quando o método não é aceito pelo send e não há corpo', () => {
    const draft = draftFromRequest(webhookRequest(1, { method: 'PROPFIND', content: null }), '');

    expect([draft.method, draft.body]).toEqual(['POST', '']);
  });
});

describe('Dado o caminho que o "Keep path" acrescenta', () => {
  it.each([
    [
      'caminho e query',
      `http://localhost:8084/${TOKEN_ID}/pedidos/1?x=1&y=2`,
      '/pedidos/1?x=1&y=2',
    ],
    ['só a query', `http://localhost:8084/${TOKEN_ID}?x=1`, '?x=1'],
    ['a raiz', `http://localhost:8084/${TOKEN_ID}`, ''],
  ])('deve ser o que vem depois do token Quando a mensagem tem %s', (_caso, url, esperado) => {
    expect(pathSuffix(webhookRequest(1, { url }))).toBe(esperado);
  });
});

describe('Dado os headers e a data do resultado', () => {
  it('deve juntar lista de valores com vírgula Quando o header vem como lista', () => {
    expect(headerEntries({ a: '1', b: ['2', '3'] })).toEqual([
      ['a', '1'],
      ['b', '2, 3'],
    ]);
  });

  it.each([
    ['ISO com Z', '2026-09-26T10:00:00.123Z', '2026-09-26 10:00:00'],
    ['ISO com fuso', '2026-09-26T07:00:00-03:00', '2026-09-26 10:00:00'],
    ['formato da API', '2026-09-26 10:00:00', '2026-09-26 10:00:00'],
  ])('deve virar o formato UTC da API Quando o at é %s', (_caso, at, esperado) => {
    expect(apiDate(at)).toBe(esperado);
  });
});
