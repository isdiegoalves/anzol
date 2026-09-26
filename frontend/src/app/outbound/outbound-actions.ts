import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { WebhookRequest } from '../requests/webhook-request';
import { TokenStore } from '../token/token-store';
import { draftFromRequest } from './outbound';
import { ReplayDialog, ReplayDialogData } from './replay-dialog';
import { rememberedTarget } from './replay-target';
import { SendDialog, SendDialogData } from './send-dialog';

const DIALOG_SIZE = { width: '760px', maxWidth: '95vw' };

/**
 * "Replay", "Send as new…" (na mensagem) e "Send" (na barra da URL). Fica num pedaço carregado
 * no primeiro clique: diálogos e formulários não pesam na carga inicial.
 */
@Injectable({ providedIn: 'root' })
export class OutboundActions {
  private readonly dialog = inject(MatDialog);
  private readonly tokens = inject(TokenStore);

  replay(request: WebhookRequest): void {
    this.dialog.open<ReplayDialog, ReplayDialogData>(ReplayDialog, {
      data: { request },
      ...DIALOG_SIZE,
    });
  }

  /** Send da URL aberta; com `request`, já preenchido com a mensagem ("Send as new…"). */
  send(request?: WebhookRequest): void {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    const draft = request && draftFromRequest(request, rememberedTarget(token.uuid));
    this.dialog.open<SendDialog, SendDialogData>(SendDialog, {
      data: { token, ...(draft && { draft }) },
      ...DIALOG_SIZE,
    });
  }
}
