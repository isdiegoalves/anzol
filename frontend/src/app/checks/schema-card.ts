import { Component, ElementRef, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { JsonSchema, Token, TokenSettings } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { CardFold } from './card-fold';
import { CardFoot, CardNotice } from './card-foot';
import { ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import { ChecksStore, isRequestId, jsonBody } from './checks-store';
import { inferSchema } from './infer-schema';
import {
  PendingField,
  changeOf,
  fieldErrors,
  pendingLabels,
  pendingSummary,
  schemaOf,
  schemaText,
  schemaValidator,
} from './url-settings';

/**
 * Checks › Schema validation (C §2.6): o schema em `textarea` com número de linha (sem editor de
 * código, fora de escopo), o tamanho contra o limite do servidor, "Clear schema", "Generate from a
 * message" com o `inferSchema` e as regras do jogo. Com `schemaFrom` (a rota
 * `?schema-from={requestId}`, "Create schema from this request"), o campo já vem com o schema
 * inferido daquela mensagem, sem salvar. O salvar é o da barra da página (B3).
 */
@Component({
  selector: 'app-schema-card',
  imports: [Icon, ReactiveFormsModule, MatButton, MatFormField, MatOption, MatSelect, CardFoot],
  templateUrl: './schema-card.html',
  styleUrls: ['./card.scss', './schema-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'schema-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class SchemaCard implements ChecksSection {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly draft = inject(ChecksDraft);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** Mensagem de onde inferir o schema (`?schema-from=`). */
  readonly schemaFrom = input<string | null>(null);

  readonly id = 'schema';
  protected readonly saved = signal<JsonSchema | null>(
    (this.draft.base() ?? this.tokens.token())?.schema ?? null,
  );
  readonly form = this.formBuilder.group({
    schema: [schemaText(this.saved()), schemaValidator],
    source: [''],
  });
  /** Tentou salvar com o campo inválido: o erro aparece mesmo sem o campo ter sido tocado. */
  protected readonly attempted = signal(false);
  /** Mensagens JSON recentes para "Generate from a message"; `null` enquanto carrega. */
  protected readonly recent = signal<readonly WebhookRequest[] | null>(null);
  /** Aviso sobre o schema inferido (de onde veio, ou por que não deu). */
  protected readonly inferred = signal<CardNotice | null>(null);

  constructor() {
    this.draft.register(this);
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
      if (isRequestId(requestId) && tokenId) {
        untracked(() => void this.inferFrom(tokenId, requestId));
      }
    });
  }

  protected size(): string {
    return sizeOf(this.form.controls.schema.value);
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

  /** Os números acompanham a rolagem da textarea (12 linhas à vista, CHECKS-15). */
  protected syncGutter(textarea: HTMLTextAreaElement, gutter: HTMLElement): void {
    gutter.scrollTop = textarea.scrollTop;
  }

  /** "· valid" ao lado do tamanho: JSON objeto (ou vazio, que desliga). */
  protected validJson(): boolean {
    return !this.form.controls.schema.hasError('json');
  }

  protected unsaved(): boolean {
    return this.draft.dirtySections().includes(this.id);
  }

  /**
   * "To save, fill in: …" desde o começo (S12). Depois de tentar salvar, quem diz o que corrigir é
   * o `alert` da barra, uma vez só: o resumo daqui se cala.
   */
  protected pending(): string {
    return this.draft.alert() ? '' : pendingSummary(this.fields());
  }

  /** "Clear schema": sem schema, a URL deixa de validar ao salvar. */
  protected clearSchema(): void {
    this.setDraft('');
  }

  /** O schema aparece pelo tamanho: o texto inteiro não cabe na barra. */
  changes(): ChangeLine[] {
    const text = this.form.controls.schema.value;
    const saved = schemaText(this.saved());
    if (text.trim() === saved.trim()) {
      return [];
    }
    const size = (value: string) => (value.trim() === '' ? $localize`Off` : sizeOf(value));
    const lines = changeOf('JSON Schema', size(saved), size(text));
    // Mesmo tamanho, outro conteúdo: a linha continua a existir.
    return lines.length > 0
      ? lines
      : [{ label: 'JSON Schema', before: size(saved), after: $localize`edited` }];
  }

  invalid(): string[] {
    return pendingLabels(this.fields());
  }

  settings(): TokenSettings {
    return { schema: schemaOf(this.form.controls.schema.value) };
  }

  showPending(focus: boolean): void {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    if (focus) {
      this.host.nativeElement.querySelector<HTMLElement>('textarea')?.focus();
    }
  }

  load(token: Token): void {
    this.saved.set(token.schema ?? null);
    this.form.controls.schema.reset(schemaText(this.saved()));
    this.attempted.set(false);
    this.inferred.set(null);
  }

  /** O 422 do schema vai para o campo, com a frase do servidor. */
  refused(error: unknown): string[] {
    const messages = fieldErrors(error, 'schema');
    if (messages.length === 0) {
      return [];
    }
    const control = this.form.controls.schema;
    control.setErrors({ server: messages.join(' ') });
    control.markAsTouched();
    return ['JSON Schema'];
  }

  sketch(): Record<string, unknown> {
    return { schema: this.form.controls.schema.value };
  }

  restore(sketch: Record<string, unknown>): void {
    if (typeof sketch['schema'] === 'string') {
      this.setDraft(sketch['schema']);
    }
  }

  /** "Generate schema": o schema inferido da mensagem escolhida entra no campo, para revisar. */
  protected generate(): void {
    const request = this.recent()?.find((r) => r.uuid === this.form.controls.source.value);
    if (request) {
      this.useRequest(request);
    }
  }

  /**
   * A opção da mensagem: `#id` e o tipo do evento do corpo quando há (`type`, `event`), como no
   * protótipo ("#e41b7 payment_intent.succeeded"); senão o método e há quanto tempo.
   */
  protected label(request: WebhookRequest): string {
    const id = `#${request.uuid.slice(0, 5)}`;
    const body = jsonBody(request)?.value;
    const event =
      body && typeof body === 'object' && !Array.isArray(body)
        ? ((body as Record<string, unknown>)['type'] ?? (body as Record<string, unknown>)['event'])
        : undefined;
    return typeof event === 'string'
      ? `${id} ${event}`
      : `${id} ${request.method} · ${fromNow(request.created_at)}`;
  }

  /** O dialeto do schema salvo, lido do `$schema` ("2020-12", "2019-09", "draft-07"). */
  protected dialect(): string | null {
    const declared = this.saved()?.['$schema'];
    if (typeof declared !== 'string') {
      return null;
    }
    return (
      /draft\/(\d{4}-\d{2})\//.exec(declared)?.[1] ?? /(draft-0\d)/.exec(declared)?.[1] ?? null
    );
  }

  private async inferFrom(tokenId: string, requestId: string): Promise<void> {
    try {
      this.useRequest(await this.checks.request(tokenId, requestId));
    } catch {
      this.inferred.set({ text: $localize`Could not load that request.`, error: true });
    }
  }

  private useRequest(request: WebhookRequest): void {
    const body = jsonBody(request);
    if (!body) {
      this.inferred.set({
        text: $localize`That request has no JSON body to infer from.`,
        error: true,
      });
      return;
    }
    this.setDraft(schemaText(inferSchema(body.value)));
    this.inferred.set({
      text: $localize`Inferred from request ${request.uuid.slice(0, 8)}. Every key present became required; review it and save.`,
      error: false,
    });
  }

  private setDraft(text: string): void {
    const control = this.form.controls.schema;
    control.setValue(text);
    control.markAsDirty();
  }

  private fields(): readonly PendingField[] {
    return [[this.form.controls.schema, 'schema', 'JSON Schema']];
  }
}

/** "312 B", "1.4 KB": o tamanho do texto do schema em UTF-8. */
function sizeOf(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
