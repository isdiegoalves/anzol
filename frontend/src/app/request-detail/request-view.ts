import { Component, computed, inject, input } from '@angular/core';
import { MethodLabel } from '../requests/method-label';
import { FieldValue, WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { fromNow, localDate } from './dates';
import { formatContent, highlightContent } from './format-content';
import { RuleBadge } from './rule-badge';
import { SchemaBadge } from './schema-badge';
import { SignatureBadge } from './signature-badge';
import { signatureCheck } from './signature-check';

/**
 * Visualização da mensagem, sem ação nenhuma: selos, dados, headers, query, formulário e corpo
 * (cru ou formatado). As ações entram por projeção: `[detailsActions]` no título "Request
 * Details" e o resto entre as tabelas e o corpo. A página do link compartilhado usa só a
 * visualização.
 */
@Component({
  selector: 'app-request-view',
  imports: [MethodLabel, RuleBadge, SchemaBadge, SignatureBadge],
  templateUrl: './request-view.html',
  styleUrl: './request-view.scss',
})
export class RequestView {
  protected readonly preferences = inject(Preferences);

  readonly request = input.required<WebhookRequest>();
  /** URL da mensagem; `null` no link compartilhado, que não expõe a configuração da URL. */
  readonly token = input<Token | null>(null);

  protected readonly localDate = localDate;
  protected readonly fromNow = fromNow;

  protected readonly body = computed(() => {
    const content = this.request().content ?? '';
    return highlightContent(this.preferences.formatJsonEnable() ? formatContent(content) : content);
  });

  /** Linhas da tabela de headers que a verificação de assinatura leu (ou esperava). */
  protected readonly signature = computed(() => signatureCheck(this.request(), this.token()));

  protected entries(fields: Record<string, FieldValue> | null | undefined): [string, string][] {
    return Object.entries(fields ?? {}).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]);
  }
}
