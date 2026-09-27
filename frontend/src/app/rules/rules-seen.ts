import { Injectable, computed, inject, signal } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';

/** `localStorage.rulesSeenAt`: por URL, a última visita a Regras (quando, e o `seq` mais novo visto). */
const KEY = 'rulesSeenAt';

interface Visit {
  /** ISO do navegador. */
  at: string;
  /** O `seq` da mensagem mais nova que a Entrada tinha na visita; `null` sem a lista. */
  seq: number | null;
}

/**
 * WM-01: as mensagens que chegaram sem regra (com quase acerto e sem `rule`) desde a última visita
 * a Regras, entre as que a Entrada tem carregadas. O rail põe um ponto em "Rules" e a página de
 * Regras diz quantas foram, com o link para a Entrada filtrada. Sem visita registrada, nada.
 * "Desde" é pelo `seq` quando a visita o conhece; senão pela hora, no segundo que a mensagem grava.
 */
@Injectable({ providedIn: 'root' })
export class RulesSeen {
  private readonly requests = inject(RequestStore);
  private readonly visits = signal<Readonly<Record<string, Visit>>>(read());

  /** As mensagens sem regra desde a última visita da URL aberta na Entrada. */
  readonly unseen = computed<readonly CapturedRequest[]>(() => {
    const tokenId = this.requests.tokenId();
    const visit = tokenId ? this.visits()[tokenId] : undefined;
    if (!visit) {
      return [];
    }
    const since = Math.floor(Date.parse(visit.at) / 1000) * 1000;
    const after = (request: CapturedRequest) =>
      visit.seq !== null && request.seq != null
        ? request.seq > visit.seq
        : utc(request.created_at) >= since;
    return this.requests
      .requests()
      .filter((request) => !request.rule && !!request.near_miss && after(request));
  });

  /** Quando Regras foi aberta pela última vez (`null`: nunca). */
  seenAt(tokenId: string): Date | null {
    const visit = this.visits()[tokenId];
    return visit ? new Date(visit.at) : null;
  }

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
    if (!value || typeof value !== 'object') {
      return {};
    }
    // Uma visita gravada só com a hora (texto) vale como hora, sem `seq`.
    return Object.fromEntries(
      Object.entries(value as Record<string, Visit | string>).map(([token, visit]) => [
        token,
        typeof visit === 'string' ? { at: visit, seq: null } : visit,
      ]),
    );
  } catch {
    return {};
  }
}

/** A API grava datas como "Y-m-d H:i:s" em UTC. */
function utc(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}
