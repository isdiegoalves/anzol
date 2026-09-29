import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { RequestList } from '../requests/request-list';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest, WebhookRequest } from '../requests/webhook-request';
import { isTyping } from '../shell/hotkeys';
import { Viewport } from '../shell/viewport';
import { TokenStore } from '../token/token-store';
import { isProtectedError } from '../token/url-lock';
import { EmptyState } from '../ui/empty-state';
import { Split } from '../ui/split';
import { CompareStore } from './compare-store';
import { RequestCompare } from './request-compare';

type CompareState =
  | { kind: 'loading' }
  | { kind: 'loaded'; a: WebhookRequest; b: WebhookRequest }
  | { kind: 'missing'; text: string; kept: WebhookRequest | null }
  | { kind: 'failed'; status: number | string };

/**
 * Compare por rota (`#/{token}/compare/{a}/{b}`), com link compartilhável: a lista com A e B
 * marcadas (clicar escolhe outra B) e a comparação ao lado; no compacto, só a comparação. As duas
 * mensagens vêm da API, então o link abre mesmo fora da página carregada da lista. O Esc sai do
 * Compare (RULES-35), de volta à A na Inbox.
 */
@Component({
  selector: 'app-compare-page',
  imports: [EmptyState, RequestCompare, RequestList, Split],
  templateUrl: './compare-page.html',
  styleUrl: './compare-page.scss',
})
export class ComparePage {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly viewport = inject(Viewport);
  private readonly router = inject(Router);

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();
  readonly a = input.required<string>();
  readonly b = input.required<string>();

  protected readonly state = signal<CompareState>({ kind: 'loading' });
  protected readonly twoPanes = computed(() =>
    ['expanded', 'large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  protected readonly listWidth = signal(340);
  constructor() {
    effect(() => {
      const [tokenId, a, b] = [this.tokenId(), this.a(), this.b()];
      untracked(() => void this.open(tokenId, a, b));
    });
    const document = inject(DOCUMENT);
    const leave = (event: KeyboardEvent) => this.leaveOnEscape(event, document);
    document.addEventListener('keydown', leave);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', leave);
      this.compare.forget();
    });
  }

  /** Clicar na lista troca a B. */
  protected chooseB(request: CapturedRequest): void {
    this.compare.compareWith(request);
  }

  /** Esc sai do Compare, salvo num campo ou com um diálogo, menu ou folha aberto (o Esc é deles). */
  private leaveOnEscape(event: KeyboardEvent, document: Document): void {
    const open = document.querySelector('[role="dialog"], [role="menu"], .cdk-overlay-pane');
    if (event.key === 'Escape' && !event.defaultPrevented && !isTyping(event) && !open) {
      this.compare.close();
    }
  }

  private async open(tokenId: string, a: string, b: string): Promise<void> {
    // "Swap A and B" (ou a mesma rota de novo): as duas já estão na tela, sem esperar a API.
    const current = this.state();
    if (current.kind === 'loaded') {
      const known = new Map([current.a, current.b].map((request) => [request.uuid, request]));
      const [knownA, knownB] = [known.get(a), known.get(b)];
      if (knownA && knownB) {
        this.compare.show(knownA, knownB);
        this.state.set({ kind: 'loaded', a: knownA, b: knownB });
        return;
      }
    } else {
      this.state.set({ kind: 'loading' });
    }
    if (this.tokens.token()?.uuid !== tokenId) {
      // 401 de URL protegida tranca a tela pelo interceptor.
      this.tokens.load(tokenId).catch(() => undefined);
    }
    if (this.requests.tokenId() !== tokenId) {
      this.requests.load(tokenId).catch(() => undefined);
    }
    const [resultA, resultB] = await Promise.allSettled([
      this.requests.fetchOne(tokenId, a),
      this.requests.fetchOne(tokenId, b),
    ]);
    if (this.a() !== a || this.b() !== b) {
      return;
    }
    if (resultA.status === 'fulfilled' && resultB.status === 'fulfilled') {
      this.compare.show(resultA.value, resultB.value);
      this.state.set({ kind: 'loaded', a: resultA.value, b: resultB.value });
      return;
    }
    const errors = [resultA, resultB].flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (errors.some(isProtectedError)) {
      return;
    }
    const statusOf = (error: unknown) =>
      error instanceof HttpErrorResponse ? error.status : 'unknown';
    const failed = errors.map(statusOf).find((status) => status !== 404 && status !== 410);
    if (failed !== undefined) {
      this.state.set({ kind: 'failed', status: failed });
      return;
    }
    // Nunca outra requisição no lugar da que falta.
    const sides = [
      resultA.status === 'rejected'
        ? $localize`Request A (#${a.slice(0, 5)}:id:) no longer exists.`
        : '',
      resultB.status === 'rejected'
        ? $localize`Request B (#${b.slice(0, 5)}:id:) no longer exists.`
        : '',
    ].filter(Boolean);
    const kept =
      resultA.status === 'fulfilled'
        ? resultA.value
        : resultB.status === 'fulfilled'
          ? resultB.value
          : null;
    this.state.set({
      kind: 'missing',
      text: [...sides, $localize`Nothing was compared.`].join(' '),
      kept,
    });
  }

  /**
   * "Choose another request": volta à Inbox com o lado que existe aberto e a lista esperando a
   * outra escolha; sem nenhum, só a Inbox.
   */
  protected async chooseAnother(kept: WebhookRequest | null): Promise<void> {
    if (!kept) {
      await this.router.navigate(['/', this.tokenId()]);
      return;
    }
    this.compare.start(kept);
    await this.router.navigate(['/', kept.token_id, kept.uuid, this.requests.pageOf(kept.uuid)]);
  }
}
