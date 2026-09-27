import { Injector } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { WebhookRequest } from '../requests/webhook-request';
import { RuleFromRequestDialog } from './rule-from-request-dialog';

/**
 * "Create rule from this request" (WM-31): a folha da regra a partir da mensagem, aberta pelo
 * detalhe da Inbox por `import()` (o pedaço vem com o diálogo). Lateral no desktop, tela cheia
 * no celular.
 */
export function openCreateRuleDialog(injector: Injector, request: WebhookRequest): void {
  injector.get(MatDialog).open(RuleFromRequestDialog, {
    data: request,
    width: 'min(760px, 100vw)',
    maxWidth: '100vw',
    height: '100dvh',
    maxHeight: '100dvh',
    position: { right: '0', top: '0' },
    autoFocus: 'first-tabbable',
  });
}
