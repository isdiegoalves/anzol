import { CapturedRequest } from '../requests/webhook-request';

const base: CapturedRequest = {
  uuid: '00000000-0000-4000-8000-000000000001',
  ip: '172.18.0.1',
  hostname: 'localhost',
  method: 'POST',
  user_agent: 'Stripe/1.0',
  content: '{}',
  query: null,
  headers: {},
  url: 'http://localhost:8084/[redacted]/webhooks/stripe',
  created_at: '2026-09-26 14:02:07',
  updated_at: '2026-09-26 14:02:07',
};

/** Mensagens que cobrem os estados do selo (válida, mismatch, velha, ausente, sem verificação). */
export function webhookRequestExamples(): CapturedRequest[] {
  return [
    {
      ...base,
      signature: { provider: 'stripe', valid: true, reason: null },
      schema: { valid: true, errors: [] },
      rule: { id: 'r1', name: 'Payment succeeded' },
    },
    {
      ...base,
      signature: { provider: 'stripe', valid: false, reason: 'signature mismatch' },
      schema: { valid: false, errors: [{ path: '/data/amount', message: 'must be integer' }] },
      rule: null,
      near_miss: { id: 'r2', name: 'Refund queued', failed: ['signature: expected valid'] },
    },
    {
      ...base,
      signature: { provider: 'slack', valid: false, reason: 'timestamp outside tolerance (412 s)' },
      schema: null,
      rule: null,
      near_miss: null,
    },
    {
      ...base,
      signature: { provider: 'github', valid: false, reason: 'header X-Hub-Signature-256 absent' },
    },
    { ...base, signature: null, schema: null, rule: null, near_miss: null },
  ];
}
