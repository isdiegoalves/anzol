import { Component, Injector, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RequestStream } from '../realtime/request-stream';
import { RequestStore } from '../requests/request-store';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';
import type { TokenActions } from '../token/token-actions';
import { TokenStore } from '../token/token-store';
import { CopyField } from '../ui/copy-field';
import { Icon } from '../ui/icon';
import { LiveState, LiveStatus } from '../ui/live-status';
import { Menu, MenuItem } from '../ui/menu';

/**
 * Cabeçalho fixo da URL aberta, em todo destino: o campo com Copy, o chip do tempo real (só com o
 * stream aberto, isto é, na Inbox), o chip "128 · keeps 1000" e os de assinatura e schema, que levam
 * a Checks, e as ações da URL: "Send" (Send de Outbound), "Lock" (só com a URL protegida) e o menu
 * "More URL actions" do protótipo C, com "Edit URL" (o antigo Edit URL, S2), "Open in new tab",
 * "Copy CLI command" e "Delete URL".
 */
@Component({
  selector: 'app-url-header',
  imports: [CopyField, Icon, LiveStatus, Menu, RouterLink],
  templateUrl: './url-header.html',
  styleUrl: './url-header.scss',
})
export class UrlHeader {
  protected readonly tokens = inject(TokenStore);
  private readonly stream = inject(RequestStream);
  private readonly injector = inject(Injector);
  private readonly requests = inject(RequestStore);
  private readonly router = inject(Router);

  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;
  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly signatureLabel = (provider: string) =>
    $localize`Signature verification: ${provider}:provider:. Open Checks`;

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

  /**
   * Mensagens guardadas e o limite da limpeza automática (INBOX-03): o total é o da lista carregada
   * desta URL (atualizado em tempo real); sem a lista (link direto para outro destino), o chip não
   * aparece, em vez de pedir `stats` a cada página.
   */
  protected readonly count = computed(() => {
    const token = this.tokens.token();
    if (!token || this.requests.tokenId() !== token.uuid) {
      return null;
    }
    const total = this.requests.total();
    const keeps = token.auto_cleanup ?? null;
    const stored = total === 1 ? $localize`1 request` : $localize`${total}:count: requests`;
    return {
      total,
      keeps,
      label:
        keeps === null
          ? stored
          : $localize`${stored}:stored:, auto cleanup keeps the ${keeps}:limit: most recent`,
    };
  });

  /** O menu ⋮ da URL (protótipo C): os fluxos pesados vêm de `TokenActions`, por `import()`. */
  protected readonly urlActions = computed<MenuItem[]>(() => {
    const token = this.tokens.token();
    if (!token) {
      return [];
    }
    return [
      {
        label: $localize`Edit URL`,
        icon: 'settings',
        action: () => void this.router.navigate(['/', token.uuid, 'checks']),
      },
      {
        label: $localize`Open in new tab`,
        icon: 'outbound',
        action: () => window.open(this.tokens.webhookUrl(), '_blank', 'noopener'),
      },
      {
        label: $localize`Copy CLI command`,
        icon: 'copy',
        action: () => void this.withActions((actions) => actions.copyCliCommand()),
      },
      {
        label: $localize`Delete URL`,
        icon: 'trash',
        action: () => void this.withActions((actions) => actions.deleteUrl()),
      },
    ];
  });

  protected lockUrl(): Promise<void> {
    return this.withActions((actions) => actions.lockUrl());
  }

  private async withActions(run: (actions: TokenActions) => unknown): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await run(this.injector.get(TokenActions));
  }
}
