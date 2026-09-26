import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { EMPTY, switchMap } from 'rxjs';
import { RequestStream } from '../realtime/request-stream';
import { RequestDetail } from '../request-detail/request-detail';
import { RequestList } from '../requests/request-list';
import { RequestNav } from '../requests/request-nav';
import { RequestStore } from '../requests/request-store';
import { RequestCreated, WebhookRequest } from '../requests/webhook-request';
import { OptionsBar } from '../settings/options-bar';
import { Preferences } from '../settings/preferences';
import { Redirector } from '../settings/redirect';
import { TokenStore } from '../token/token-store';
import { Tutorial } from '../tutorial/tutorial';

/**
 * Tela principal. A rota (`/`, `/{tokenId}`, `/{tokenId}/{requestId}/{page}`) é a fonte da
 * verdade: clicar numa mensagem navega, e a navegação abre a mensagem.
 */
@Component({
  selector: 'app-inbox',
  imports: [MatButton, RequestList, RequestNav, RequestDetail, OptionsBar, Tutorial],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
})
export class Inbox {
  protected readonly tokens = inject(TokenStore);
  protected readonly requests = inject(RequestStore);
  protected readonly preferences = inject(Preferences);
  private readonly stream = inject(RequestStream);
  private readonly redirector = inject(Redirector);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input<string>();
  readonly requestId = input<string>();
  readonly page = input<string>();

  private readonly streamTokenId = signal<string | null>(null);
  private loading: { tokenId: string; done: Promise<boolean> } | null = null;

  constructor() {
    effect(() => {
      const unread = this.requests.unread().length;
      this.title.setTitle(unread > 0 ? `(${unread}) Webhook.site` : 'Webhook.site');
    });

    effect(() => {
      const tokenId = this.tokenId();
      const requestId = this.requestId();
      const page = Number(this.page() ?? 1);
      untracked(() => void this.openRoute(tokenId, requestId, page));
    });

    toObservable(this.streamTokenId)
      .pipe(
        switchMap((tokenId) => (tokenId ? this.stream.connect(tokenId) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe((event) => void this.receive(event));
  }

  protected openRequest(request: WebhookRequest, replaceUrl = false): Promise<boolean> {
    const page = this.requests.pageOf(request.uuid);
    return this.router.navigate(['/', request.token_id, request.uuid, page], { replaceUrl });
  }

  protected deleteAllRequests(): void {
    void this.requests.deleteAll();
  }

  private async openRoute(
    tokenId: string | undefined,
    requestId: string | undefined,
    page: number,
  ) {
    if (!tokenId) {
      await this.openSavedOrNewToken();
      return;
    }
    if (this.requests.tokenId() !== tokenId && !(await this.loadToken(tokenId, page))) {
      return;
    }
    const list = this.requests.requests();
    if (requestId && list.some((request) => request.uuid === requestId)) {
      this.requests.select(requestId);
    } else if (list.length > 0) {
      await this.openRequest(list[0], true);
    }
  }

  /** Várias navegações seguidas para o mesmo token esperam a mesma carga. */
  private loadToken(tokenId: string, page: number): Promise<boolean> {
    if (this.loading?.tokenId !== tokenId) {
      const done = this.fetchToken(tokenId, page).finally(() => (this.loading = null));
      this.loading = { tokenId, done };
    }
    return this.loading.done;
  }

  private async fetchToken(tokenId: string, page: number): Promise<boolean> {
    try {
      await this.tokens.load(tokenId);
    } catch (error) {
      await this.replaceMissingToken(error);
      return false;
    }
    try {
      await this.requests.load(tokenId, page);
    } catch {
      this.snackBar.open('Requests not found - invalid ID');
      return false;
    }
    this.streamTokenId.set(tokenId);
    return true;
  }

  private async openSavedOrNewToken(): Promise<void> {
    const saved = this.tokens.token();
    const token = saved ?? (await this.tokens.create());
    if (!saved) {
      this.requests.resetUnread();
    }
    await this.router.navigate(['/', token.uuid], { replaceUrl: true });
  }

  /** URL apagada ou inválida: cria outra e avisa, como o app atual. */
  private async replaceMissingToken(error: unknown): Promise<void> {
    const token = await this.tokens.create();
    this.requests.resetUnread();
    await this.router.navigate(['/', token.uuid], { replaceUrl: true });
    if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
      this.snackBar.open('URL not found. Invalid ID, created new URL', undefined, {
        duration: 10000,
      });
    }
  }

  private async receive({ request, total, truncated, removed }: RequestCreated): Promise<void> {
    // Corpo > 1 MB chega cortado no evento: a mensagem completa vem da API.
    const complete = truncated
      ? await this.requests.fetchOne(request.token_id, request.uuid)
      : request;
    // A limpeza automática pode ter cortado a mensagem aberta: abre a mais próxima que ficou.
    const replacement = this.requests.append(complete, total, removed);
    const list = this.requests.requests();
    if (replacement) {
      await this.openRequest(replacement, true);
    } else if (!this.requests.selected()) {
      await this.openRequest(list[0]);
    }
    if (this.preferences.autoNavEnable() && !this.document.hidden) {
      await this.openRequest(list[list.length - 1]);
    }
    if (this.preferences.redirectEnable()) {
      void this.redirector.redirect(complete);
    }
    this.snackBar.open('Request received');
  }
}
