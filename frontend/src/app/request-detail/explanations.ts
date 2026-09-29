import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AiClient, KeptExplanation } from '../ai/ai-client';
import { RequestStore } from '../requests/request-store';

const READY_NOTICE_MS = 10_000;

/**
 * Os pedidos de explicação em curso, um por requisição. Ficam fora do painel porque trocar de
 * requisição (ou esconder o painel) **não cancela** o pedido: a resposta é guardada para a
 * requisição que a pediu e, sem o painel dela à vista, um aviso com "Open" diz que ficou pronta.
 */
@Injectable({ providedIn: 'root' })
export class Explanations {
  private readonly ai = inject(AiClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly requests = inject(RequestStore);

  private readonly running = new Map<
    string,
    { answer: Promise<KeptExplanation>; abort: AbortController }
  >();
  private watched: string | null = null;
  /**
   * A requisição cuja explicação a pessoa pediu para abrir pelo "Open" do aviso: quem monta o
   * painel (o detalhe) o abre para ela.
   */
  readonly wanted = signal<string | null>(null);

  watch(requestId: string): void {
    this.watched = requestId;
    if (this.wanted() === requestId) {
      this.wanted.set(null);
    }
  }

  unwatch(requestId: string): void {
    if (this.watched === requestId) {
      this.watched = null;
    }
  }

  ask(tokenId: string, requestId: string): Promise<KeptExplanation> {
    const running = this.running.get(requestId);
    if (running) {
      return running.answer;
    }
    const abort = new AbortController();
    const answer = this.ai.explain(tokenId, requestId, abort.signal);
    this.running.set(requestId, { answer, abort });
    void answer
      .then(
        () => this.watched !== requestId && this.notify(tokenId, requestId),
        () => undefined,
      )
      .finally(() => this.running.delete(requestId));
    return answer;
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.abort.abort();
  }

  private notify(tokenId: string, requestId: string): void {
    this.snackBar
      .open(
        $localize`Explanation for #${requestId.slice(0, 5)}:id: is ready.`,
        $localize`:action|Opens the request whose explanation is ready:Open`,
        { duration: READY_NOTICE_MS },
      )
      .onAction()
      .subscribe(() => {
        this.wanted.set(requestId);
        void this.router.navigate(['/', tokenId, requestId, this.requests.pageOf(requestId)]);
      });
  }
}
