import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, Injector, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CompareStore } from '../diff/compare-store';
import { MethodLabel } from '../requests/method-label';
import { FieldValue, WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { COPY_FORMATS, CopyFormat, convertRequest } from './copy-as';
import { fromNow, localDate } from './dates';
import { formatContent, highlightContent } from './format-content';
import { RuleBadge } from './rule-badge';
import { SchemaBadge } from './schema-badge';
import { SignatureBadge } from './signature-badge';

/** Detalhe da mensagem: dados, headers, query, formulário e corpo (cru ou formatado). */
@Component({
  selector: 'app-request-detail',
  imports: [
    MatButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MethodLabel,
    RuleBadge,
    SchemaBadge,
    SignatureBadge,
  ],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  protected readonly preferences = inject(Preferences);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly injector = inject(Injector);
  private readonly compare = inject(CompareStore);

  readonly request = input.required<WebhookRequest>();
  readonly token = input.required<Token>();
  readonly page = input.required<number>();

  protected readonly formats = COPY_FORMATS;
  protected readonly localDate = localDate;
  protected readonly fromNow = fromNow;

  protected readonly permalink = computed(
    () => `${this.origin}/#/${this.token().uuid}/${this.request().uuid}/${this.page()}`,
  );
  protected readonly rawUrl = computed(
    () => `${this.origin}/token/${this.token().uuid}/request/${this.request().uuid}/raw`,
  );
  protected readonly body = computed(() => {
    const content = this.request().content ?? '';
    return highlightContent(this.preferences.formatJsonEnable() ? formatContent(content) : content);
  });

  /** "Create schema from this request" só aparece quando há o que inferir. */
  protected readonly jsonBody = computed(() => isJson(this.request().content));

  protected entries(fields: Record<string, FieldValue> | null | undefined): [string, string][] {
    return Object.entries(fields ?? {}).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]);
  }

  /** Corpo exatamente como chegou, mesmo com "Format JSON/XML" ligado na tela. */
  protected copyPayload(): void {
    this.clipboard.copy(this.request().content ?? '');
    this.snackBar.open('Copied payload');
  }

  protected copyRequestAs(format: CopyFormat): void {
    this.clipboard.copy(convertRequest(this.request(), format, this.token()));
    this.snackBar.open(`Copied request as ${format}`);
  }

  /** A lista entra em modo de escolha da mensagem B. */
  protected compareWith(): void {
    this.compare.start(this.request());
  }

  /** O editor de regras vem sob demanda (no pedaço da aba Rules), fora da carga inicial. */
  protected async createRule(): Promise<void> {
    const { RuleFromRequest } = await import('../rules/rule-from-request');
    await this.injector.get(RuleFromRequest).open(this.request());
  }

  /** O diálogo do Edit URL e a inferência vêm sob demanda (no pedaço do `token-actions`). */
  protected async createSchema(): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await this.injector.get(TokenActions).createSchemaFrom(this.request());
  }
}

function isJson(content: string | null): boolean {
  if (!content) {
    return false;
  }
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}
