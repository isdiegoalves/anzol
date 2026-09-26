import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import { Component, computed, inject, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { CompareStore } from '../diff/compare-store';
import { localDate } from '../request-detail/dates';
import { RequestSearch } from '../search/request-search';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';
import { TokenStore } from '../token/token-store';
import { MethodLabel } from './method-label';
import { RequestStore } from './request-store';
import { SignatureResult, SignatureState, WebhookRequest, signatureState } from './webhook-request';

/** Texto curto do selo na lista: ícone e palavra, nunca só a cor. */
const SEAL_TEXT: Record<SignatureState, string> = {
  valid: '✓ Sig OK',
  invalid: '✕ Bad sig',
  absent: '⊘ No sig',
};

/**
 * Lista lateral: mensagens da URL, busca e filtros, paginação, não lidas e apagar uma. No
 * "Compare with…", clicar escolhe a mensagem B em vez de abrir.
 */
@Component({
  selector: 'app-request-list',
  imports: [
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    MatButton,
    MatProgressSpinner,
    MethodLabel,
    RequestSearch,
  ],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  protected readonly store = inject(RequestStore);
  protected readonly compare = inject(CompareStore);
  private readonly tokens = inject(TokenStore);

  readonly openRequest = output<WebhookRequest>();
  protected readonly localDate = localDate;

  /** Limite da limpeza automática da URL aberta, mostrado ao lado do total. */
  protected readonly limit = computed(() => this.tokens.token()?.auto_cleanup ?? null);
  protected readonly count = computed(() => {
    const limit = this.limit();
    return limit === null ? `${this.store.total()}` : `${this.store.total()} / ${limit}`;
  });
  /** Consulta por linha desenhada: com milhares de não lidas, `includes` na lista pesaria. */
  private readonly unreadIds = computed(() => new Set(this.store.unread()));

  protected isUnread(request: WebhookRequest): boolean {
    return this.unreadIds().has(request.uuid);
  }

  protected choose(request: WebhookRequest): void {
    if (this.compare.picking()) {
      this.compare.choose(request);
    } else {
      this.openRequest.emit(request);
    }
  }

  /** Selo da verificação; o `aria-label` diz por extenso o que o selo resume. */
  protected signatureSeal(signature: SignatureResult) {
    const state = signatureState(signature);
    const label =
      state === 'valid'
        ? `Signature valid — ${SIGNATURE_PROVIDER_LABELS[signature.provider]}`
        : `Signature ${state} — ${signature.reason}`;
    return { state, label, text: SEAL_TEXT[state] };
  }

  protected deleteRequest(request: WebhookRequest): void {
    void this.store.deleteRequest(request);
  }

  protected trackByUuid(_index: number, request: WebhookRequest): string {
    return request.uuid;
  }
}
