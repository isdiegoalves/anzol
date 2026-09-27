import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { CheckKind, pipelineOf } from '../pipeline/pipeline';
import { CapturedRequest, FieldValue } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { CheckChip } from '../ui/check-chip';
import { CodeMark } from '../ui/code-lines';
import { CodeView } from '../ui/code-view';
import { KvNote, KvRow, KvTable } from '../ui/kv-table';
import { MethodBadge } from '../ui/method-badge';
import { fromNow, localDate } from './dates';
import { detectLanguage, formatContent, highlightXml } from './format-content';

/** As abas do detalhe, na ordem. */
export const TABS = ['body', 'headers', 'query', 'form'] as const;
export type Tab = (typeof TABS)[number];

/** O cartão de cada verificação leva à aba onde está o que ela conferiu. */
const TAB_OF_CHECK: Partial<Record<CheckKind, Tab>> = { signature: 'headers', schema: 'body' };

/**
 * A mensagem, sem nenhuma ação que escreva: método e rota, dados da chegada, os cartões das
 * verificações (assinatura, schema, regra, pelo `pipelineOf`) e as abas Body/Headers/Query/Form. As
 * ações entram por projeção: `[viewNav]` no cabeçalho, `[viewActions]` embaixo dos cartões e o
 * resto (o painel do Explain) logo depois. Em `readonly` (página do link só-leitura) nada é
 * clicável além das abas e do Pretty: a rota sai da `url` com `[redacted]`, sem `token_id`.
 */
@Component({
  selector: 'app-request-view',
  imports: [
    CheckChip,
    CodeView,
    KvTable,
    MatButton,
    MatSlideToggle,
    MatTab,
    MatTabGroup,
    MethodBadge,
  ],
  templateUrl: './request-view.html',
  styleUrl: './request-view.scss',
})
export class RequestView {
  protected readonly preferences = inject(Preferences);

  readonly request = input.required<CapturedRequest>();
  /** URL da mensagem; `null` no link compartilhado, que não expõe a configuração da URL. */
  readonly token = input<Token | null>(null);
  readonly readonly = input(false);

  protected readonly localDate = localDate;
  protected readonly fromNow = fromNow;

  protected readonly pipeline = computed(() => pipelineOf(this.request(), { token: this.token() }));
  protected readonly checks = computed(() => {
    const { signature, schema, rule } = this.pipeline();
    return [signature, schema, rule];
  });

  /** Aba aberta; volta ao Body ao abrir outra mensagem. */
  protected readonly tab = linkedSignal<string, number>({
    source: () => this.request().uuid,
    computation: () => 0,
  });
  /** "Why? (n)" do near miss aberto; fecha ao abrir outra mensagem. */
  protected readonly whyOpen = linkedSignal({
    source: () => this.request().uuid,
    computation: () => false,
  });

  protected readonly headers = computed<KvRow[]>(() => {
    const headers = this.request().headers;
    const missing = this.pipeline().signatureHeaders?.missing;
    const rows = Object.keys(headers).map((name) => ({
      name,
      value: headers[name].map((value) => (value === '' ? '(empty)' : value)).join(', '),
    }));
    return missing ? [{ name: missing.name, value: '(not received)' }, ...rows] : rows;
  });

  /** A linha do header de assinatura: o veredito embaixo e o valor em partes (`t=…`, `v1=…`). */
  protected readonly headerNotes = computed(() => {
    const check = this.pipeline().signatureHeaders;
    const notes = new Map<string, KvNote>();
    if (!check) {
      return notes;
    }
    const tone = check.state === 'valid' ? 'ok' : 'bad';
    if (check.missing) {
      notes.set(check.missing.name, { tone: 'bad', text: check.missing.note });
    }
    for (const [name, text] of check.rows) {
      const value = this.request().headers[name]?.join(', ') ?? '';
      notes.set(name, { tone, text, parts: value.split(',').map((part) => part.trim()) });
    }
    return notes;
  });

  protected readonly query = computed(() => rowsOf(this.request().query));
  protected readonly form = computed(() => rowsOf(this.request().request));

  protected readonly language = computed(() => detectLanguage(this.request().content));

  /** Erros de schema como marcas na linha do JSON (ou na primeira, se o corpo não é JSON). */
  protected readonly marks = computed<CodeMark[]>(() => {
    const schema = this.request().schema;
    return (schema?.valid === false ? schema.errors : []).map((error) => ({
      pointer: error.path,
      message: `${error.path || '(root)'} ${error.message}`,
    }));
  });

  /** XML/HTML formatado e realçado pelo highlight.js, que vem sob demanda. */
  protected readonly xmlHtml = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const content = this.request().content ?? '';
      const show = this.language() === 'xml' && this.preferences.formatJsonEnable();
      this.xmlHtml.set(null);
      let current = true;
      onCleanup(() => (current = false));
      if (show) {
        void highlightXml(formatContent(content)).then((html) => current && this.xmlHtml.set(html));
      }
    });
  }

  /** O cartão leva à aba do que ele conferiu (assinatura → Headers, schema → Body). */
  protected showCheck(kind: CheckKind): void {
    const tab = TAB_OF_CHECK[kind];
    if (tab) {
      this.tab.set(TABS.indexOf(tab));
    }
  }

  protected hasTarget(kind: CheckKind): boolean {
    return TAB_OF_CHECK[kind] !== undefined;
  }

  protected toggleWhy(): void {
    this.whyOpen.update((open) => !open);
  }
}

function rowsOf(fields: Record<string, FieldValue> | null | undefined): KvRow[] {
  return Object.entries(fields ?? {}).map(([name, value]) => ({
    name,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}
