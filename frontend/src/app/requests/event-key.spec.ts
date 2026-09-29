import { webhookRequest } from '../../testing/fixtures';
import {
  eventValueOf,
  groupByEvent,
  isEventKey,
  keyCandidates,
  trailOf,
  waitsOf,
} from './event-key';
import { WebhookRequest } from './webhook-request';

/** Requisição com o cabeçalho `x-loja-event-id` (ou sem ele) e o que a URL respondeu. */
function attempt(
  n: number,
  event: string | null,
  extra: Partial<WebhookRequest> = {},
): WebhookRequest {
  return webhookRequest(n, {
    headers: {
      'content-type': ['application/json'],
      ...(event === null ? {} : { 'x-loja-event-id': [event] }),
    },
    content: `{"n":${n},"id":"${event ?? 'solto'}"}`,
    created_at: `2026-09-26 00:43:${String(n * 5).padStart(2, '0')}`,
    response: { status: 429 },
    ...extra,
  });
}

describe('Dado a chave do evento (E1)', () => {
  it.each([
    ['x-loja-event-id', true],
    ['X-GitHub-Delivery', true],
    ['$.id', true],
    ['$.data.pedido[0].numero', true],
    ['isto não é chave', false],
    ['$', false],
    ['$.', false],
    ['', false],
  ])('deve aceitar %j como chave: %s', (text, valid) => {
    expect(isEventKey(text)).toBe(valid);
  });

  it('deve ler o valor do cabeçalho sem olhar a caixa, e o do corpo pelo JSONPath', () => {
    const request = webhookRequest(1, {
      headers: { 'X-Loja-Event-Id': ['evt_1'] },
      content: '{"id":"evt_9","data":{"itens":[{"sku":42}]}}',
    });

    expect(eventValueOf(request, 'x-loja-event-id')).toBe('evt_1');
    expect(eventValueOf(request, '$.id')).toBe('evt_9');
    expect(eventValueOf(request, '$.data.itens[0].sku')).toBe('42');
    expect(eventValueOf(request, '$.data')).toBeNull();
    expect(eventValueOf(request, 'x-outro')).toBeNull();
    expect(eventValueOf(webhookRequest(2, { content: 'não é JSON' }), '$.id')).toBeNull();
  });

  describe('Dado os candidatos da oferta', () => {
    it('deve oferecer o campo com 3 valores repetidos, com a contagem e um exemplo', () => {
      const requests = ['a', 'b', 'a', 'c', 'b', null, 'a', 'c'].map((event, i) =>
        attempt(i + 1, event),
      );

      expect(keyCandidates(requests)).toEqual([
        { key: 'x-loja-event-id', values: 3, example: 'a' },
        { key: '$.id', values: 4, example: 'a' },
      ]);
    });

    it.each([
      ['nenhum valor se repete', ['e1', 'e2', 'e3', 'e4']],
      ['o valor é o mesmo em todas', ['x', 'x', 'x', 'x']],
      ['só dois valores se repetem', ['x', 'y', 'x', 'y', 'x', 'y']],
    ])('não deve oferecer Quando %s', (_caso, events) => {
      const requests = events.map((event, i) => attempt(i + 1, event, { content: null }));

      expect(keyCandidates(requests)).toEqual([]);
    });

    it('não deve oferecer cabeçalho de transporte que se repete', () => {
      const requests = [1, 2, 3, 4, 5, 6].map((n) =>
        webhookRequest(n, { headers: { 'content-length': [String(n % 3)] }, content: null }),
      );

      expect(keyCandidates(requests)).toEqual([]);
    });
  });

  describe('Dado a lista agrupada', () => {
    const [a1, b1, a2, solta, a3, unica] = [
      attempt(1, 'evt_a'),
      attempt(2, 'evt_b'),
      attempt(3, 'evt_a'),
      attempt(4, null),
      attempt(5, 'evt_a'),
      attempt(6, 'evt_u'),
    ];
    const b2 = attempt(7, 'evt_b');
    // Mais nova no topo.
    const shown = [b2, unica, a3, solta, a2, b1, a1];

    it('deve pôr o evento no lugar da tentativa mais nova, e deixar solta a que não tem a chave', () => {
      const grouped = groupByEvent(shown, shown, 'x-loja-event-id');

      expect(
        grouped.map((entry) =>
          entry.kind === 'event'
            ? `${entry.value}: ${entry.attempts.map((r) => r.uuid.slice(-1)).join('')}`
            : `${entry.request.uuid.slice(-1)} ${entry.value ?? '-'}`,
        ),
      ).toEqual(['evt_b: 27', '6 evt_u', 'evt_a: 135', '4 -']);
    });

    it('deve trazer a trilha inteira das carregadas e marcar as que casam com o filtro', () => {
      const grouped = groupByEvent([a2], shown, 'x-loja-event-id');

      expect(grouped).toHaveLength(1);
      const [event] = grouped;
      expect(event.kind === 'event' && event.attempts).toEqual([a1, a2, a3]);
      expect(event.kind === 'event' && [...event.matching]).toEqual([a2.uuid]);
    });

    it('deve ordenar as tentativas pela hora, e pela seq no mesmo segundo', () => {
      const x = attempt(1, 'evt', { created_at: '2026-09-26 00:00:01', seq: 2 });
      const y = attempt(2, 'evt', { created_at: '2026-09-26 00:00:01', seq: 1 });
      const z = attempt(3, 'evt', { created_at: '2026-09-26 00:00:00', seq: 9 });

      const [event] = groupByEvent([x, y, z], [x, y, z], 'x-loja-event-id');

      expect(event.kind === 'event' && event.attempts).toEqual([z, y, x]);
    });
  });

  describe('Dado a trilha de respostas', () => {
    it('deve marcar ✗ a tentativa com assinatura ou schema inválido, e a última', () => {
      const trail = trailOf([
        attempt(1, 'e'),
        attempt(2, 'e', {
          signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
        }),
        attempt(3, 'e', { response: { fault: 'connection_reset' } }),
        attempt(4, 'e', { response: { status: 200 } }),
      ]);

      expect(trail.map(({ text, mark, fault, last }) => [text, mark, fault, last])).toEqual([
        ['429', false, false, false],
        ['429', true, false, false],
        ['—', false, true, false],
        ['200', false, false, true],
      ]);
    });

    it('deve comprimir as sequências iguais acima de 8 tentativas', () => {
      const attempts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => attempt(n, 'e'));
      attempts.push(attempt(10, 'e', { response: { status: 200 } }));

      expect(trailOf(attempts).map(({ text, count }) => [text, count])).toEqual([
        ['429', 9],
        ['200', 1],
      ]);
      expect(trailOf(attempts.slice(0, 8)).map(({ count }) => count)).toEqual([
        1, 1, 1, 1, 1, 1, 1, 1,
      ]);
    });
  });

  describe('Dado o intervalo entre as tentativas e o Retry-After', () => {
    const at = (seconds: number) => `2026-09-26 00:00:${String(seconds).padStart(2, '0')}`;

    it('deve dar os três vereditos contra o que a resposta anterior pedia', () => {
      const attempts = [0, 1, 4, 9].map((s, i) => attempt(i + 1, 'e', { created_at: at(s) }));

      const waits = waitsOf(attempts, () => '3');

      expect(waits.map((wait) => wait && [wait.gap, wait.wait?.verdict])).toEqual([
        null,
        [1, 'before'],
        [3, 'limit'],
        [5, 'waited'],
      ]);
    });

    it('deve dar só o intervalo Quando a espera pedida não é um número fixo', () => {
      const attempts = [0, 2].map((s, i) => attempt(i + 1, 'e', { created_at: at(s) }));

      const [, second] = waitsOf(attempts, () => 'Wed, 21 Oct 2026 07:28:00 GMT');

      expect(second).toEqual({ gap: 2, wait: null, notFixed: true });
      expect(waitsOf(attempts, () => null)[1]).toEqual({ gap: 2, wait: null, notFixed: false });
    });
  });
});
