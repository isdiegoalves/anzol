import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MethodLabel } from '../requests/method-label';
import { FieldValue, WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { COPY_FORMATS, CopyFormat, convertRequest } from './copy-as';
import { fromNow, localDate } from './dates';
import { formatContent, highlightContent } from './format-content';

/** Detalhe da mensagem: dados, headers, query, formulário e corpo (cru ou formatado). */
@Component({
  selector: 'app-request-detail',
  imports: [MatButton, MatMenu, MatMenuItem, MatMenuTrigger, MethodLabel],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  protected readonly preferences = inject(Preferences);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;

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

  protected entries(fields: Record<string, FieldValue> | null | undefined): [string, string][] {
    return Object.entries(fields ?? {}).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]);
  }

  protected copyRequestAs(format: CopyFormat): void {
    this.clipboard.copy(convertRequest(this.request(), format, this.token()));
    this.snackBar.open(`Copied request as ${format}`);
  }
}
