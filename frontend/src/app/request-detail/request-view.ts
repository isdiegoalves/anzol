import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTab, MatTabGroup, MatTabLabel } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { CheckKind, pipelineOf } from '../pipeline/pipeline';
import { RuleStatusStore } from '../requests/rule-status-store';
import { CapturedRequest, FieldValue } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Viewport } from '../shell/viewport';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import { CheckChip, ChipLink } from '../ui/check-chip';
import { EmptyState } from '../ui/empty-state';
import { Icon } from '../ui/icon';
import { CodeMark } from '../ui/code-lines';
import { CodeView } from '../ui/code-view';
import { KvNote, KvRow, KvTable } from '../ui/kv-table';
import { MethodBadge } from '../ui/method-badge';
import { fromNow, localDate } from './dates';
import { detectLanguage, formatContent, highlightXml } from './format-content';

/** As abas do detalhe, na ordem. */
let nextViewId = 0;

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
/** "36 B", "1.5 KB", "3.0 MB": o tamanho do corpo no número do idioma da tela. */
export function sizeText(bytes: number, language: string): string {
  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${number.format(bytes / 1024)} KB`;
  }
  return `${number.format(bytes / (1024 * 1024))} MB`;
}

@Component({
  selector: 'app-request-view',
  imports: [
    CheckChip,
    CodeView,
    EmptyState,
    Icon,
    KvTable,
    MatButton,
    MatSlideToggle,
    MatTab,
    MatTabGroup,
    MatTabLabel,
    MethodBadge,
    NgTemplateOutlet,
    RouterLink,
  ],
  templateUrl: './request-view.html',
  styleUrl: './request-view.scss',
})
export class RequestView {
  protected readonly preferences = inject(Preferences);
  private readonly ruleStatuses = inject(RuleStatusStore);
  private readonly clipboard = inject(Clipboard);
  private readonly document = inject(DOCUMENT);
  private readonly viewport = inject(Viewport);
  private readonly screenLanguage = this.document.documentElement.lang || 'en';

  readonly request = input.required<CapturedRequest>();
  /** URL da mensagem; `null` no link compartilhado, que não expõe a configuração da URL. */
  readonly token = input<Token | null>(null);
  readonly readonly = input(false);

  protected readonly localDate = localDate;
  protected readonly fromNow = fromNow;
  /** Tamanho do corpo como chegou (bytes do UTF-8), na linha de metadados. */
  protected readonly size = computed(() =>
    sizeText(new TextEncoder().encode(this.request().content ?? '').length, this.screenLanguage),
  );

  protected copyId(): void {
    this.clipboard.copy(this.request().uuid);
  }
  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly conditionsLabel = (rule: string) =>
    $localize`Conditions of ${rule}:rule: that failed`;

  protected readonly pipeline = computed(() =>
    pipelineOf(this.request(), {
      token: this.token(),
      ruleStatus: (id) => this.ruleStatuses.statusOf(id),
    }),
  );
  protected readonly checks = computed(() => {
    const { signature, schema, rule } = this.pipeline();
    return [signature, schema, rule];
  });
  /**
   * WM-10: no cartão da regra, o nome da que respondeu (ou da mais próxima) leva a ela, com a
   * mensagem para o "Back to request"; "Default response" leva a Checks › Response. Não na página
   * do link só-leitura (sem `token_id`).
   */
  protected readonly ruleLink = computed<ChipLink | null>(() => {
    const { token_id: tokenId, uuid } = this.request();
    const rule = this.pipeline().rule;
    if (this.readonly() || !tokenId) {
      return null;
    }
    if (rule.ref) {
      const toRule: ChipLink = {
        part: 'detail',
        text: rule.ref.name,
        commands: ['/', tokenId, 'rules', rule.ref.id],
        queryParams: { 'from-request': uuid },
      };
      return toRule;
    }
    const toChecks: ChipLink = {
      part: 'title',
      text: rule.title,
      commands: ['/', tokenId, 'checks'],
      queryParams: { section: 'response' },
    };
    return rule.state === 'default' ? toChecks : null;
  });
  /** Near miss: quem respondeu foi a resposta padrão, e ela também leva a Checks › Response. */
  protected readonly defaultLink = computed(() => {
    const tokenId = this.request().token_id;
    return !this.readonly() && tokenId && this.pipeline().rule.state === 'near-miss'
      ? {
          text: $localize`Default response`,
          commands: ['/', tokenId, 'checks'],
          queryParams: { section: 'response' },
        }
      : null;
  });

  /** Aba aberta; volta ao Body ao abrir outra mensagem. */
  /** Celular (INBOX-33): as abas numa faixa própria, sem a paginação do Material. */
  protected readonly compact = computed(() => this.viewport.windowClass() === 'compact');
  private readonly ids = `request-view-${nextViewId++}`;
  protected readonly panelId = `${this.ids}-panel`;
  protected readonly tabId = (index: number) => `${this.ids}-tab-${index}`;
  /** Os nomes das quatro abas, os mesmos do `mat-tab-group`. */
  protected readonly tabLabels = computed(() => [
    this.bodyTabLabel(),
    $localize`Headers (${this.headers().length}:INTERPOLATION:)`,
    $localize`Query (${this.query().length}:INTERPOLATION:)`,
    $localize`Form (${this.form().length}:INTERPOLATION:)`,
  ]);

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
    // INBOX-24: o título da nota e o link para Checks › Signature (fora da página só-leitura).
    const token = this.token();
    const provider = this.request().signature?.provider;
    const label = provider ? SIGNATURE_PROVIDER_LABELS[provider] : '';
    const link =
      token && !this.readonly()
        ? {
            text: $localize`How ${label}:provider: signatures are checked`,
            commands: ['/', token.uuid, 'checks'],
            section: 'signature',
          }
        : undefined;
    if (check.missing) {
      notes.set(check.missing.name, {
        tone: 'bad',
        text: check.missing.note,
        title: $localize`Expected header missing`,
        link,
      });
    }
    for (const [name, text] of check.rows) {
      const value = this.request().headers[name]?.join(', ') ?? '';
      notes.set(name, {
        tone,
        text,
        parts: value.split(',').map((part) => part.trim()),
        title:
          check.state === 'valid'
            ? $localize`Verified signature header`
            : $localize`Signature header that failed`,
        link,
      });
    }
    return notes;
  });

  protected readonly query = computed(() => rowsOf(this.request().query));
  protected readonly form = computed(() => rowsOf(this.request().request));

  protected readonly language = computed(() => detectLanguage(this.request().content));

  /** "Body · 36 B" ou "Body · empty": o tamanho antes do clique (INBOX-21). */
  protected readonly bodyTabLabel = computed(
    () => `${$localize`Body`} · ${this.request().content ? this.size() : $localize`empty`}`,
  );
  /** O estado vazio do corpo (INBOX-26): o método e, com schema, o que a verificação gravou. */
  protected readonly emptyBodyText = computed(() => {
    const request = this.request();
    const text = $localize`A ${request.method}:method: with an empty body.`;
    return request.schema
      ? `${text} ${$localize`The schema check records it as “body is not JSON”.`}`
      : text;
  });
  /** "2 schema errors marked below" (INBOX-23). */
  protected readonly schemaErrorsText = computed(() =>
    this.schemaErrors() === 1
      ? $localize`1 schema error marked below`
      : $localize`${this.schemaErrors()}:count: schema errors marked below`,
  );
  /** Cabeçalho das colunas da aba Headers (INBOX-24): o valor é o que chegou, sem mudança. */
  protected readonly headerColumns = [$localize`Name`, $localize`Value (as recorded)`] as const;
  /** Quantos erros de schema estão marcados no corpo (a nota acima dele, INBOX-23). */
  protected readonly schemaErrors = computed(() => {
    const schema = this.request().schema;
    return schema?.valid === false ? schema.errors.length : 0;
  });

  /** Erros de schema como marcas na linha do JSON (ou na primeira, se o corpo não é JSON). */
  protected readonly marks = computed<CodeMark[]>(() => {
    const schema = this.request().schema;
    return (schema?.valid === false ? schema.errors : []).map((error) => ({
      pointer: error.path,
      message: `${error.path || $localize`(root)`} ${error.message}`,
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
  /** Setas, Home e End na faixa de abas: abre a aba e leva o foco a ela (WAI-ARIA, ativação automática). */
  protected moveTab(event: KeyboardEvent): void {
    const last = TABS.length - 1;
    const next: Record<string, number> = {
      ArrowRight: this.tab() === last ? 0 : this.tab() + 1,
      ArrowLeft: this.tab() === 0 ? last : this.tab() - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in next)) {
      return;
    }
    event.preventDefault();
    this.tab.set(next[event.key]);
    this.document.getElementById(this.tabId(next[event.key]))?.focus();
  }

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
