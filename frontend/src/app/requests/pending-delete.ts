import { LiveAnnouncer } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, Injector, inject, signal } from '@angular/core';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { routeOf } from '../pipeline/pipeline';
import { KnownUrls } from '../token/known-urls';
import { ANNOUNCEMENT_MS, afterShownEmpty } from '../ui/live-region';
import { NOTICE_MS, deleteFailedText } from '../ui/notice';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

/** Quanto o "Undo" do apagar fica à mão: tempo de chegar a ele pelo teclado ou pelo leitor de tela. */
export const UNDO_MS = 20_000;

/** O apagar que ainda pode ser desfeito. */
export interface Deleting {
  request: WebhookRequest;
  route: string;
}

/**
 * O apagar de uma requisição, pela lixeira da lista ou pelo detalhe: ela sai da lista na hora e só é
 * apagada no servidor quando o "Undo" vence, ou quando outro apagar toma o lugar dele. Com o aviso da
 * requisição na tela, é ele que fala e o snackbar fica mudo.
 */
@Injectable({ providedIn: 'root' })
export class PendingDelete {
  private readonly store = inject(RequestStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly urls = inject(KnownUrls);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;

  readonly pending = signal<Deleting | null>(null);
  /**
   * O apagar que o aviso diz. Entre um apagar e o seguinte o aviso passa vazio: a mesma frase duas
   * vezes seguidas (o mesmo método e a mesma rota) não seria anunciada de novo.
   */
  readonly said = signal<Deleting | null>(null);
  /** O aviso da requisição está na tela (a Entrada com o detalhe à vista). */
  readonly noticeShown = signal(false);
  private settle: ((undo: boolean) => void) | null = null;
  private cancelSaying: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snack: MatSnackBarRef<TextOnlySnackBar> | null = null;

  constructor() {
    const leave = () => this.confirmOnLeave();
    this.window?.addEventListener('pagehide', leave);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.cancelSaying?.();
      this.window?.removeEventListener('pagehide', leave);
    });
  }

  delete(request: WebhookRequest): void {
    const replaces = this.pending() !== null;
    this.finish(false);
    const deleting = { request, route: routeOf(request.url) };
    const undo = new Promise<boolean>((resolve) => (this.settle = resolve));
    this.timer = setTimeout(() => this.finish(false), UNDO_MS);
    this.pending.set(deleting);
    if (replaces) {
      this.cancelSaying = afterShownEmpty(() => this.said.set(deleting), this.injector);
    } else {
      this.said.set(deleting);
    }
    this.snack = this.snackBar.open($localize`Request deleted`, $localize`Undo`, {
      duration: UNDO_MS,
      politeness: this.noticeShown() ? 'off' : 'polite',
    });
    this.snack.onAction().subscribe(() => this.undo());
    this.store.deleteRequest(request, undo).then(
      (outcome) => {
        if (outcome === 'restored') {
          void this.announcer.announce($localize`Request restored.`, ANNOUNCEMENT_MS);
        } else if (outcome === 'kept') {
          this.snackBar.open(
            $localize`Kept in ${this.urls.nameOf(request.token_id)}:name:`,
            undefined,
            { duration: NOTICE_MS },
          );
        }
      },
      (error: unknown) =>
        this.snackBar.open(
          deleteFailedText(error instanceof HttpErrorResponse ? error.status : 0),
          undefined,
          { duration: NOTICE_MS },
        ),
    );
  }

  undo(): void {
    this.finish(true);
  }

  /**
   * A página sai (fecha, recarrega) com o "Undo" aberto: o apagar segue já, num pedido que sobrevive
   * a ela, e o "Undo" acaba, para não sobrar na tela se ela voltar do cache do navegador.
   */
  private confirmOnLeave(): void {
    const request = this.pending()?.request;
    if (!request) {
      return;
    }
    void this.window?.fetch(`/token/${request.token_id}/request/${request.uuid}`, {
      method: 'DELETE',
      keepalive: true,
    });
    // O DELETE já saiu: sem resolver a espera, o caminho de sempre não o manda de novo.
    this.settle = null;
    this.finish(false);
  }

  private finish(undo: boolean): void {
    clearTimeout(this.timer);
    this.cancelSaying?.();
    this.cancelSaying = null;
    const settle = this.settle;
    this.settle = null;
    this.pending.set(null);
    this.said.set(null);
    this.snack?.dismiss();
    this.snack = null;
    settle?.(undo);
  }
}
