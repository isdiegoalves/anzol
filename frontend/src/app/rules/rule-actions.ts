import { ComponentRef, Injector, ViewContainerRef } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { WebhookRequest } from '../requests/webhook-request';
import { CreatedRule, RULE_CREATED, RuleFromRequestDialog } from './rule-from-request-dialog';

/**
 * A folha "Create rule from this request", sem diálogo, dentro do painel de ação: criar a regra não
 * sai da requisição; "Cancel" chama `closed`.
 */
export function embedCreateRule(
  host: ViewContainerRef,
  parent: Injector,
  request: WebhookRequest,
  created: (rule: CreatedRule) => void,
  closed: () => void,
): ComponentRef<RuleFromRequestDialog> {
  const injector = Injector.create({
    parent,
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: request },
      { provide: MatDialogRef, useValue: { close: closed } },
      { provide: RULE_CREATED, useValue: created },
    ],
  });
  return host.createComponent(RuleFromRequestDialog, { injector });
}
