import { OutboundResult } from '../app/outbound/outbound';

/** Resultado de replay com resposta 201, id derivado de `n`. */
export function outboundResult(n: number, overrides: Partial<OutboundResult> = {}): OutboundResult {
  return {
    id: `out-${n}`,
    kind: 'replay',
    at: '2026-09-26T10:00:00Z',
    target: `http://host.docker.internal:3000/app/pedidos?n=${n}`,
    method: 'POST',
    request_headers: { 'content-type': 'application/json' },
    status: 201,
    headers: { 'content-type': ['application/json'], 'x-app': ['recebido'] },
    body: '{"ok":true}',
    truncated: false,
    duration_ms: 12,
    error: null,
    source_request: '00000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}
