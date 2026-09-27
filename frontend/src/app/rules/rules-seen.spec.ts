import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';
import { RulesSeen } from './rules-seen';

/** Mensagem sem regra, com quase acerto (a que o rail conta). */
const semRegra = (n: number, seq: number, created_at = '2026-09-27 12:00:00'): CapturedRequest =>
  webhookRequest(n, {
    seq,
    created_at,
    rule: null,
    near_miss: { id: 'r1', name: 'Pix', failed: ['x'] },
  });

describe('Dado as mensagens sem regra desde a última visita a Regras (WM-01)', () => {
  const requests = signal<readonly CapturedRequest[]>([]);
  let seen: RulesSeen;

  beforeEach(() => {
    localStorage.clear();
    requests.set([]);
    TestBed.configureTestingModule({
      providers: [{ provide: RequestStore, useValue: { tokenId: signal(TOKEN_ID), requests } }],
    });
    seen = TestBed.inject(RulesSeen);
  });

  afterEach(() => localStorage.clear());

  it('não deve contar nada antes da primeira visita', () => {
    requests.set([semRegra(1, 10)]);

    expect(seen.unseen()).toEqual([]);
  });

  it('deve contar pelo seq as que chegaram depois da visita, só as sem regra e com quase acerto', () => {
    requests.set([semRegra(1, 10)]);
    seen.markSeen(TOKEN_ID);

    requests.set([
      semRegra(1, 10),
      semRegra(2, 11),
      webhookRequest(3, { seq: 12, rule: { id: 'r1', name: 'Pix' } }),
      webhookRequest(4, { seq: 13, rule: null, near_miss: null }),
    ]);

    expect(seen.unseen().map((request) => request.seq)).toEqual([11]);
    expect(JSON.parse(localStorage.getItem('rulesSeenAt') ?? '{}')[TOKEN_ID].seq).toBe(10);
  });

  it('deve ler a visita gravada só com a hora e comparar pelo segundo da mensagem', () => {
    localStorage.setItem('rulesSeenAt', JSON.stringify({ [TOKEN_ID]: '2026-09-27T12:00:00.800Z' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: RequestStore, useValue: { tokenId: signal(TOKEN_ID), requests } }],
    });
    seen = TestBed.inject(RulesSeen);

    requests.set([semRegra(1, 1, '2026-09-27 11:59:59'), semRegra(2, 2, '2026-09-27 12:00:00')]);

    expect(seen.unseen().map((request) => request.seq)).toEqual([2]);
  });
});
