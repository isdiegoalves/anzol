import { TokenStats } from '../app/stats/stats';

/** O exemplo da §1 do plano (B2), com o que importa para os números. */
export function tokenStats(overrides: Partial<TokenStats> = {}): TokenStats {
  return {
    window: 500,
    evaluated: 128,
    total: 128,
    newest_seq: 1790438428567114,
    oldest_seq: 1790438402000001,
    newest_at: '2026-09-26 14:02:07',
    oldest_at: '2026-09-25 09:13:44',
    methods: { POST: 120, GET: 8 },
    signature: {
      valid: 110,
      invalid: 9,
      absent: 3,
      unchecked: 6,
      reasons: [
        { reason: 'signature mismatch', count: 6 },
        { reason: 'timestamp outside tolerance', count: 3 },
      ],
    },
    schema: { valid: 100, invalid: 20, unchecked: 8, paths: [{ path: '/amount', count: 4 }] },
    rules: {
      answered: [
        { id: 'a', name: 'Refund queued', count: 3 },
        { id: 'b', name: 'Stripe payment OK', count: 41 },
      ],
      near_miss: [{ id: 'a', name: 'Refund queued', count: 2 }],
      default: 84,
    },
    hourly: [
      { hour: '2026-09-26 12:00:00', count: 5, methods: { POST: 5 } },
      { hour: '2026-09-26 14:00:00', count: 12, methods: { POST: 10, GET: 2 } },
    ],
    ...overrides,
  };
}
