import { Component, ElementRef, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { JsonSchema, Token } from '../token/token';
import { TokenStore } from '../token/token-store';
import { ChecksStore, jsonBody } from './checks-store';
import { inferSchema } from './infer-schema';
import { SaveBar, SaveNotice } from './save-bar';
import {
  PendingField,
  fieldErrors,
  pendingSummary,
  schemaOf,
  schemaText,
  schemaValidator,
  saveErrorNotice,
} from './url-settings';

/**
 * Checks › Schema validation (C §2.6): o schema em `textarea` com número de linha (sem editor de
 * código, fora de escopo), o tamanho contra o limite do servidor, "Clear schema", "Generate from a
 * message" com o `inferSchema` e as regras do jogo. Com `schemaFrom` (a rota
 * `?schema-from={requestId}`, "Create schema from this request"), o campo já vem com o schema
 * inferido daquela mensagem, sem salvar.
 */
@Component({
  selector: 'app-schema-card',
  imports: [ReactiveFormsModule, MatButton, MatFormField, MatLabel, MatOption, MatSelect, SaveBar],
  templateUrl: './schema-card.html',
  styleUrls: ['./card.scss', './schema-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'schema-title' },
})
export class SchemaCard {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** Mensagem de onde inferir o schema (`?schema-from=`). */
  readonly schemaFrom = input<string | null>(null);

  protected readonly saved = signal<JsonSchema | null>(this.tokens.token()?.schema ?? null);
  /** A URL como este cartão a leu: o save confere se o schema mudou lá fora. */
  private readonly base = signal(this.tokens.token());
  protected readonly form = this.formBuilder.group({
    schema: [schemaText(this.saved()), schemaValidator],
    source: [''],
  });
  protected readonly attempted = signal(false);
  protected readonly saving = signal(false);
  protected readonly notice = signal<SaveNotice | null>(null);
  /** Mensagens JSON recentes para "Generate from a message"; `null` enquanto carrega. */
  protected readonly recent = signal<readonly WebhookRequest[] | null>(null);
  /** Aviso sobre o schema inferido (de onde veio, ou por que não deu). */
  protected readonly inferred = signal<SaveNotice | null>(null);

  constructor() {
    const tokenId = this.tokens.token()?.uuid;
    if (tokenId) {
      this.checks
        .recentJson(tokenId)
        .then((requests) => {
          this.recent.set(requests);
          this.form.controls.source.setValue(requests[0]?.uuid ?? '');
        })
        .catch(() => this.recent.set([]));
    }
    effect(() => {
      const requestId = this.schemaFrom();
      if (requestId && tokenId) {
        untracked(() => void this.inferFrom(tokenId, requestId));
      }
    });
  }

  protected size(): string {
    const bytes = new TextEncoder().encode(this.form.controls.schema.value).length;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  protected lineNumbers(): string {
    const lines = this.form.controls.schema.value.split('\n').length;
    return Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }

  protected error(): string | null {
    const control = this.form.controls.schema;
    if (!control.invalid || !(control.touched || this.attempted())) {
      return null;
    }
    return (control.errors?.['json'] ?? control.errors?.['server']) as string;
  }

  protected syncGutter(textarea: HTMLTextAreaElement, gutter: HTMLElement): void {
    gutter.scrollTop = textarea.scrollTop;
  }

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  /** "Clear schema": sem schema, a URL deixa de validar ao salvar. */
  protected clearSchema(): void {
    this.setDraft('');
  }

  /** "Reload" depois de "changed elsewhere": o cartão volta à URL como está no servidor. */
  protected async reloadCard(): Promise<void> {
    const base = this.base();
    if (base) {
      const token = await this.checks.reload(base.uuid);
      this.base.set(token);
      this.saved.set(token.schema ?? null);
      this.discard();
      this.notice.set(null);
    }
  }

  protected discard(): void {
    this.form.controls.schema.reset(schemaText(this.saved()));
    this.attempted.set(false);
    this.inferred.set(null);
  }

  /** "Generate schema": o schema inferido da mensagem escolhida entra no campo, para revisar. */
  protected generate(): void {
    const request = this.recent()?.find((r) => r.uuid === this.form.controls.source.value);
    if (request) {
      this.useRequest(request);
    }
  }

  protected label(request: WebhookRequest): string {
    return `#${request.uuid.slice(0, 5)} ${request.method} · ${fromNow(request.created_at)}`;
  }

  protected async saveSchema(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.notice.set(null);
    const control = this.form.controls.schema;
    if (control.invalid) {
      this.showPending();
      return;
    }
    const base = this.base();
    if (!base) {
      return;
    }
    this.saving.set(true);
    try {
      const token: Token = await this.checks.save({ schema: schemaOf(control.value) }, base);
      this.base.set(token);
      this.saved.set(token.schema ?? null);
      control.reset(schemaText(this.saved()));
      this.attempted.set(false);
      this.inferred.set(null);
      this.notice.set({ text: 'Saved.', error: false });
    } catch (error) {
      const messages = fieldErrors(error, 'schema');
      if (messages.length > 0) {
        control.setErrors({ server: messages.join(' ') });
        control.markAsTouched();
      } else {
        this.notice.set(saveErrorNotice(error));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private async inferFrom(tokenId: string, requestId: string): Promise<void> {
    try {
      this.useRequest(await this.checks.request(tokenId, requestId));
    } catch {
      this.inferred.set({ text: 'Could not load that request.', error: true });
    }
  }

  private useRequest(request: WebhookRequest): void {
    const body = jsonBody(request);
    if (!body) {
      this.inferred.set({ text: 'That request has no JSON body to infer from.', error: true });
      return;
    }
    this.setDraft(schemaText(inferSchema(body.value)));
    this.inferred.set({
      text: `Inferred from request ${request.uuid.slice(0, 8)}. Every key present became required; review it and save.`,
      error: false,
    });
  }

  private setDraft(text: string): void {
    const control = this.form.controls.schema;
    control.setValue(text);
    control.markAsDirty();
    this.notice.set(null);
  }

  private showPending(): void {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    this.host.nativeElement.querySelector<HTMLElement>('textarea')?.focus();
  }

  private fields(): readonly PendingField[] {
    return [[this.form.controls.schema, 'schema', 'JSON Schema']];
  }
}
