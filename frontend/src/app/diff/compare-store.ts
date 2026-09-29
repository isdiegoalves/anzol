import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest, WebhookRequest } from '../requests/webhook-request';

/**
 * "Compare with…" e a página do Compare (`#/{token}/compare/{a}/{b}`, link compartilhável). Na
 * Inbox, a mensagem aberta vira a A e a lista entra em modo de escolha; escolher a B abre a rota.
 * Na página, o par mostrado (as duas mensagens carregadas pela rota) marca A e B na lista, e
 * trocar, escolher outra B e fechar navegam.
 */
@Injectable({ providedIn: 'root' })
export class CompareStore {
  private readonly router = inject(Router);
  private readonly requests = inject(RequestStore);
  private readonly pickingA = signal<WebhookRequest | null>(null);
  private readonly shown = signal<{ a: WebhookRequest; b: WebhookRequest } | null>(null);
  /** A mensagem de onde o "Compare with…" saiu: o "Close" volta a ela, mesmo depois do "Swap". */
  private origin: WebhookRequest | null = null;
  private toPanel = false;
  private readonly panelPair = signal<{ a: WebhookRequest; b: WebhookRequest } | null>(null);
  /** O par da aba Compare do painel de ação, que não muda a rota. */
  readonly inPanel = this.panelPair.asReadonly();

  /** Mensagem A enquanto a lista da Inbox espera a escolha da B. */
  readonly picking = this.pickingA.asReadonly();
  /** As duas mensagens da página do Compare aberta. */
  readonly pair = this.shown.asReadonly();

  start(a: WebhookRequest, where: 'page' | 'panel' = 'page'): void {
    this.toPanel = where === 'panel';
    this.pickingA.set(a);
  }

  /** A B escolhida na lista abre a rota do Compare; escolher a própria A não abre nada. */
  choose(b: CapturedRequest): void {
    const a = this.pickingA();
    if (a && a.uuid !== b.uuid) {
      this.pickingA.set(null);
      if (this.toPanel) {
        this.showInPanel(a, { ...b, token_id: a.token_id });
        return;
      }
      this.origin = a;
      void this.router.navigate(['/', a.token_id, 'compare', a.uuid, b.uuid]);
    }
  }

  showInPanel(a: WebhookRequest, b: WebhookRequest): void {
    this.pickingA.set(null);
    this.panelPair.set({ a, b });
  }

  /**
   * E1: abre a comparação de um par pronto (a tentativa anterior do mesmo evento com a aberta); o
   * "Close" volta à aberta.
   */
  openPair(a: WebhookRequest, b: WebhookRequest): void {
    this.pickingA.set(null);
    this.origin = b;
    void this.router.navigate(['/', a.token_id, 'compare', a.uuid, b.uuid]);
  }

  /** A página do Compare mostra o par que a rota carregou. */
  show(a: WebhookRequest, b: WebhookRequest): void {
    this.shown.set({ a, b });
  }

  /** Na página, outra B escolhida na lista (a própria A não conta). */
  compareWith(b: CapturedRequest): void {
    const pair = this.shown();
    if (pair && pair.a.uuid !== b.uuid && pair.b.uuid !== b.uuid) {
      void this.router.navigate(['/', pair.a.token_id, 'compare', pair.a.uuid, b.uuid]);
    }
  }

  swap(): void {
    const pair = this.shown();
    if (pair) {
      void this.router.navigate(['/', pair.a.token_id, 'compare', pair.b.uuid, pair.a.uuid]);
    }
  }

  /**
   * Fecha: na Inbox, sai do modo de escolha; na página do Compare, volta à Inbox com a mensagem de
   * onde o "Compare with…" saiu aberta (pelo link direto, a A), na página da lista onde ela está.
   */
  close(): void {
    this.pickingA.set(null);
    this.panelPair.set(null);
    const pair = this.shown();
    if (pair) {
      const back = this.origin ?? pair.a;
      this.forget();
      void this.router.navigate(['/', back.token_id, back.uuid, this.requests.pageOf(back.uuid)]);
    }
  }

  /** A página do Compare saiu (outra rota): esquece o par sem navegar. */
  forget(): void {
    this.shown.set(null);
    this.origin = null;
  }
}
