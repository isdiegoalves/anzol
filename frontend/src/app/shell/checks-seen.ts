import { Injectable, computed, inject, signal } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';

const KEY = 'checksSeenAt';

interface Visit {
  at: string;
  /** O `seq` mais novo que a Entrada tinha carregado; `null` sem ele. */
  seq: number | null;
}

/**
 * As requisições carregadas com assinatura ou schema inválidos que chegaram depois da última visita
 * a Verificações (ou à Entrada filtrada pela assinatura inválida). Sem visita, todas.
 */
@Injectable({ providedIn: 'root' })
export class ChecksSeen {
  private readonly requests = inject(RequestStore);
  private readonly visits = signal<Readonly<Record<string, Visit>>>(read());

  readonly unseen = computed<readonly CapturedRequest[]>(() => {
    const tokenId = this.requests.tokenId();
    const visit = tokenId ? this.visits()[tokenId] : undefined;
    const since = visit ? Math.floor(Date.parse(visit.at) / 1000) * 1000 : 0;
    const after = (request: CapturedRequest) =>
      !visit ||
      (visit.seq !== null && request.seq != null
        ? request.seq > visit.seq
        : utc(request.created_at) >= since);
    return this.requests
      .requests()
      .filter(
        (request) =>
          (request.signature?.valid === false || request.schema?.valid === false) && after(request),
      );
  });

  markSeen(tokenId: string): void {
    const loaded = this.requests.tokenId() === tokenId ? this.requests.requests() : [];
    const seqs = loaded.flatMap((request) => (request.seq == null ? [] : [request.seq]));
    const visit: Visit = {
      at: new Date().toISOString(),
      seq: seqs.length ? Math.max(...seqs) : null,
    };
    const visits = { ...this.visits(), [tokenId]: visit };
    this.visits.set(visits);
    try {
      localStorage.setItem(KEY, JSON.stringify(visits));
    } catch {
      // Sem localStorage (navegação privada): vale só nesta aba.
    }
  }
}

function read(): Record<string, Visit> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' ? (value as Record<string, Visit>) : {};
  } catch {
    return {};
  }
}

/** A API grava datas como "Y-m-d H:i:s" em UTC. */
function utc(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}
