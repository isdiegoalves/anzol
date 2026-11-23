import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import {
  DefenseLabCreated,
  DefenseReport,
  DefenseRoundStarted,
  DefenseVerdict,
  DefenseVerdictsRecorded,
} from './defense-lab';

/** Chamadas do laboratório de defesa (`docs/api.md`, "Laboratório de defesa"). */
@Injectable({ providedIn: 'root' })
export class DefenseStore {
  private readonly http = inject(HttpClient);

  create(): Promise<DefenseLabCreated> {
    return firstValueFrom(this.http.post<DefenseLabCreated>('/defense-lab', {}));
  }

  /** Abre a rodada; o servidor entrega a onda 1 antes de responder. */
  start(tokenId: string, seed: number | null): Promise<DefenseRoundStarted> {
    return firstValueFrom(
      this.http.post<DefenseRoundStarted>(
        `/token/${tokenId}/defense-lab/rounds`,
        seed === null ? {} : { seed },
      ),
    );
  }

  verdicts(
    tokenId: string,
    roundId: string,
    verdicts: DefenseVerdict[],
  ): Promise<DefenseVerdictsRecorded> {
    return firstValueFrom(
      this.http.post<DefenseVerdictsRecorded>(
        `/token/${tokenId}/defense-lab/rounds/${roundId}/verdicts`,
        { verdicts },
      ),
    );
  }

  /** Entrega a onda 2 contra as regras de agora e devolve o relatório. */
  finish(tokenId: string, roundId: string): Promise<DefenseReport> {
    return firstValueFrom(
      this.http.post<DefenseReport>(`/token/${tokenId}/defense-lab/rounds/${roundId}/finish`, {}),
    );
  }

  /** O relatório da rodada fechada; com ela aberta, 409. */
  report(tokenId: string, roundId: string): Promise<DefenseReport> {
    return firstValueFrom(
      this.http.get<DefenseReport>(
        `/token/${tokenId}/defense-lab/rounds/${encodeURIComponent(roundId)}`,
      ),
    );
  }

  /** O `seq` da mensagem mais nova da URL; 0 sem mensagem. */
  async newestSeq(tokenId: string): Promise<number> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { per_page: 1, sorting: 'newest' },
      }),
    );
    return page.data[0]?.seq ?? 0;
  }

  /** As mensagens gravadas depois de `seq`, da mais antiga para a mais nova. */
  async after(tokenId: string, seq: number): Promise<WebhookRequest[]> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { after: seq, per_page: 100 },
      }),
    );
    return page.data;
  }
}
