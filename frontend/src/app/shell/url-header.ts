import { Component, Injector, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RequestStream } from '../realtime/request-stream';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';
import { TokenStore } from '../token/token-store';
import { CopyField } from '../ui/copy-field';
import { Icon } from '../ui/icon';
import { LiveState, LiveStatus } from '../ui/live-status';

/**
 * Cabeçalho fixo da URL aberta, em todo destino: o campo com Copy, o chip do tempo real (só com o
 * stream aberto, isto é, na Inbox), os chips de assinatura e schema que levam a Checks, e as ações
 * da URL. "Edit" leva a Checks (o antigo Edit URL, S2) e "Send" ao Send de Outbound; "Lock" só com a
 * URL protegida.
 */
@Component({
  selector: 'app-url-header',
  imports: [CopyField, Icon, LiveStatus, RouterLink],
  templateUrl: './url-header.html',
  styleUrl: './url-header.scss',
})
export class UrlHeader {
  protected readonly tokens = inject(TokenStore);
  private readonly stream = inject(RequestStream);
  private readonly injector = inject(Injector);

  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;

  /** O estado do SSE na linguagem da tela; `null` sem stream (fora da Inbox). */
  protected readonly live = computed<LiveState | null>(() => {
    const states: Record<string, LiveState | null> = {
      idle: null,
      connecting: 'connecting',
      open: 'live',
      reconnecting: 'reconnecting',
      closed: 'offline',
    };
    return states[this.stream.status()];
  });

  protected readonly lockable = computed(() => this.tokens.token()?.protected === true);

  protected async lockUrl(): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await this.injector.get(TokenActions).lockUrl();
  }
}
