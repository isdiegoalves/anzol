import { Component, input } from '@angular/core';
import { CapturedRequest } from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';

/**
 * Selo da verificação de assinatura na mensagem: válida (com o provedor) ou inválida (com o
 * motivo). Mensagem de URL sem verificação, ou gravada antes dela, não mostra nada.
 */
@Component({
  selector: 'app-signature-badge',
  templateUrl: './signature-badge.html',
  styleUrl: './signature-badge.scss',
})
export class SignatureBadge {
  readonly request = input.required<CapturedRequest>();

  protected readonly labels = SIGNATURE_PROVIDER_LABELS;
}
