import { Component, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { WebhookRequest } from '../requests/webhook-request';

/**
 * Selo da regra de resposta na mensagem: qual regra respondeu (`rule`) ou, quando havia regras
 * ativas e nenhuma casou, a mais próxima (`near_miss`) com as condições que falharam, a expandir.
 * Mensagem sem regras (ou gravada antes delas) não mostra nada.
 */
@Component({
  selector: 'app-rule-badge',
  imports: [MatButton],
  templateUrl: './rule-badge.html',
  styleUrl: './rule-badge.scss',
})
export class RuleBadge {
  readonly request = input.required<WebhookRequest>();

  protected readonly expanded = signal(false);

  protected toggleFailed(): void {
    this.expanded.update((expanded) => !expanded);
  }
}
