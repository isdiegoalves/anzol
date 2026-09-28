import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import {
  AI_DOCS_URL,
  AI_OFF_HINT,
  AiCancelled,
  AiClient,
  RuleSuggestion,
  aiErrorMessages,
  aiRetrySeconds,
} from '../ai/ai-client';
import { AiWait } from '../ai/ai-wait';
import { WebhookRequest } from '../requests/webhook-request';
import { Icon } from '../ui/icon';
import { MarkdownView } from '../ui/markdown-view';
import { PathMatcher, RULE_DEFAULT_STATUS, Rule, ValueMatcher } from './rule';
import { RuleStore } from './rule-store';
import { SuggestionApply } from './rule-suggest';
import { ruleInWords } from './rule-words';
import { CheckLine, Verdict, suggestionChecks, suggestionSummary } from './suggestion-checks';

/** Teto do `prompt` no servidor (`rules/suggest`). */
export const PROMPT_MAX_LENGTH = 2000;

function valueText(condition: ValueMatcher | undefined): string {
  if (!condition) {
    return '';
  }
  if ('present' in condition) {
    return condition.present ? $localize`present` : $localize`absent`;
  }
  const [operator, value] = Object.entries(condition)[0] as [string, string];
  return operator === 'equals' ? value : `${operator} ${value}`;
}

function conditionChanges(
  kind: 'header' | 'query',
  before: Record<string, ValueMatcher> = {},
  after: Record<string, ValueMatcher> = {},
): string[] {
  const label = (name: string) =>
    kind === 'header' ? $localize`header ${name}:name:` : $localize`query ${name}:name:`;
  const changes: string[] = [];
  for (const [name, condition] of Object.entries(after)) {
    const old = before[name];
    if (!old) {
      changes.push(`+ ${label(name)} = ${valueText(condition)}`);
    } else if (JSON.stringify(old) !== JSON.stringify(condition)) {
      changes.push(`${label(name)}: ${valueText(old)} → ${valueText(condition)}`);
    }
  }
  for (const name of Object.keys(before).filter((name) => !(name in after))) {
    changes.push(`− ${label(name)}`);
  }
  return changes;
}

function pathText(path: PathMatcher | null | undefined): string {
  if (!path) {
    return $localize`any path`;
  }
  const [mode, value] = Object.entries(path)[0] as [string, string];
  return mode === 'equals' ? value : `${mode} ${value}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * O que a sugestão muda na regra do editor (E-13), uma frase por mudança: "+ header x-tenant = acme",
 * "status 200 → 201", "body changed". A proposta só entra quando o dono aplica.
 */
export function suggestionChanges(current: Rule, proposed: Rule): string[] {
  const a = current.match ?? {};
  const b = proposed.match ?? {};
  const changes: string[] = [];
  if (!same(a.method?.length ? a.method : null, b.method?.length ? b.method : null)) {
    const methods = (list: string[] | undefined) =>
      list?.length ? list.join(', ') : $localize`any`;
    changes.push($localize`method ${methods(a.method)}:from: → ${methods(b.method)}:to:`);
  }
  if (!same(a.path, b.path)) {
    changes.push($localize`path ${pathText(a.path)}:from: → ${pathText(b.path)}:to:`);
  }
  changes.push(...conditionChanges('header', a.headers, b.headers));
  changes.push(...conditionChanges('query', a.query, b.query));
  if (!same(a.body?.length ? a.body : null, b.body?.length ? b.body : null)) {
    changes.push($localize`body conditions changed`);
  }
  for (const [key, label] of [
    ['signature', $localize`signature`],
    ['schema', $localize`schema`],
  ] as const) {
    if (!same(a[key], b[key])) {
      changes.push(`${label} ${a[key] ?? $localize`any`} → ${b[key] ?? $localize`any`}`);
    }
  }
  const before = current.response ?? {};
  const after = proposed.response ?? {};
  const status = (response: Rule['response']) => response?.status ?? RULE_DEFAULT_STATUS;
  if (status(before) !== status(after)) {
    changes.push($localize`status ${status(before)}:from: → ${status(after)}:to:`);
  }
  for (const [name, value] of Object.entries(after.headers ?? {})) {
    if (before.headers?.[name] !== value) {
      changes.push($localize`+ response header ${name}:name: = ${value}:value:`);
    }
  }
  if ((before.body ?? '') !== (after.body ?? '')) {
    changes.push($localize`body changed`);
  }
  if (
    !same(before.delay, after.delay) ||
    !same(before.fault, after.fault) ||
    !same(before.dribble, after.dribble) ||
    !same(before.template ?? false, after.template ?? false) ||
    !same(current.scenario, proposed.scenario)
  ) {
    changes.push($localize`other response settings changed`);
  }
  return changes;
}

/** A sugestão como a tela a guarda: com o exemplo que ela usou, se usou. */
interface Proposal {
  suggestion: RuleSuggestion;
  example: WebhookRequest | null;
}

/**
 * O formulário do "Describe the rule" (carregado quando o `<details>` abre, ver `RuleSuggest`): a
 * descrição em linguagem natural vai para `rules/suggest` e a regra sugerida vira proposta. Antes
 * dos botões de aplicar, a tela **confere** a regra sem a IA (B4, UX-41): o que o servidor conferiu
 * (exemplo, histórico) e o que ela mesma sabe (campos, forma, posição), a regra em palavras e a
 * nota fixa do que uma regra não faz; o texto do modelo vem por último, recolhido. Nada é gravado
 * aqui: quem salva é o dono, no "Save" do editor.
 */
@Component({
  selector: 'app-rule-suggest-form',
  imports: [
    FormsModule,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatHint,
    MatLabel,
    MatInput,
    MarkdownView,
    AiWait,
    Icon,
  ],
  templateUrl: './rule-suggest-form.html',
  styleUrl: './rule-suggest-form.scss',
})
export class RuleSuggestForm {
  private readonly ai = inject(AiClient);
  private readonly store = inject(RuleStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly tokenId = input.required<string>();
  /** Mensagem aberta, oferecida como exemplo ao modelo. */
  readonly example = input<WebhookRequest>();
  /** A regra como está no editor, para a lista de mudanças da proposta (E-13). */
  readonly current = input<Rule>();
  readonly applied = output<SuggestionApply>();

  protected readonly prompt = signal('');
  protected readonly useExample = signal(false);
  protected readonly loading = signal(false);
  private readonly proposal = signal<Proposal | null>(null);
  protected readonly result = computed(() => this.proposal()?.suggestion ?? null);
  /** A proposta ainda não foi aplicada: a lista de mudanças e os botões ficam à vista. */
  protected readonly pending = signal(false);
  protected readonly changes = computed(() => {
    const suggestion = this.result();
    return suggestion ? suggestionChanges(this.current() ?? { name: '' }, suggestion.rule) : [];
  });
  /** As conferências da proposta, sem a IA. */
  protected readonly checks = computed((): CheckLine[] => {
    const proposal = this.proposal();
    return proposal
      ? suggestionChecks({
          rule: proposal.suggestion.rule,
          check: proposal.suggestion.check,
          example: proposal.example,
          rules: this.store.rules(),
        })
      : [];
  });
  protected readonly problems = computed(
    () => this.checks().filter(({ verdict }) => verdict === 'problem').length,
  );
  protected readonly summary = computed(() => {
    const proposal = this.proposal();
    return proposal
      ? suggestionSummary(this.checks(), proposal.suggestion.check, proposal.example !== null)
      : '';
  });
  /** O que a regra faz, escrito pela tela e não pelo modelo. */
  protected readonly words = computed(() => {
    const suggestion = this.result();
    return suggestion ? ruleInWords(suggestion.rule) : '';
  });
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly disabled = this.ai.disabled;
  /** Segundos até poder pedir de novo depois do 429 da IA (UX-52); 0 libera. */
  protected readonly retryIn = signal(0);
  protected readonly canSuggest = computed(() => {
    const length = this.prompt().trim().length;
    return (
      !this.loading() &&
      !this.disabled() &&
      this.retryIn() === 0 &&
      length > 0 &&
      length <= PROMPT_MAX_LENGTH
    );
  });
  /**
   * A descrição cita o token da URL (colaram a URL inteira): a regra sugerida tende a trazer o token
   * no caminho, que é relativo à URL e então nunca casaria.
   */
  protected readonly mentionsUrl = computed(() => {
    const tokenId = this.tokenId().toLowerCase();
    return tokenId !== '' && this.prompt().toLowerCase().includes(tokenId);
  });
  protected readonly maxLength = PROMPT_MAX_LENGTH;
  protected readonly offHint = AI_OFF_HINT;
  protected readonly docsUrl = AI_DOCS_URL;
  protected readonly verdicts: Record<Verdict, { label: string; icon: 'ok' | 'info' | 'bad' }> = {
    ok: { label: $localize`:verdict of a check:OK`, icon: 'ok' },
    attention: { label: $localize`:verdict of a check:Attention`, icon: 'info' },
    problem: { label: $localize`:verdict of a check:Problem`, icon: 'bad' },
  };

  /** O pedido em curso, para o "Cancel". */
  private request: AbortController | null = null;
  /** As sugestões desta abertura do editor, pelo texto do pedido (e o exemplo usado). */
  private readonly kept = new Map<string, Proposal>();
  private retryTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request?.abort();
      clearInterval(this.retryTimer);
    });
  }

  /** `Enter` no campo do pedido aciona "Suggest"; `Shift+Enter` quebra a linha. */
  protected suggestByKey(event: Event): void {
    if (!(event as KeyboardEvent).shiftKey) {
      event.preventDefault();
      void this.suggest();
    }
  }

  protected async suggest(): Promise<void> {
    if (!this.canSuggest()) {
      return;
    }
    const prompt = this.prompt().trim();
    const example = (this.useExample() && this.example()) || null;
    const key = `${example?.uuid ?? ''}\n${prompt}`;
    this.errors.set([]);
    const kept = this.kept.get(key);
    if (kept) {
      this.show(kept);
      return;
    }
    this.loading.set(true);
    this.proposal.set(null);
    this.request = new AbortController();
    try {
      const suggestion = await this.ai.suggestRule(
        this.tokenId(),
        prompt,
        example?.uuid,
        this.request.signal,
      );
      const proposal = { suggestion, example };
      this.kept.set(key, proposal);
      this.show(proposal);
    } catch (error) {
      // Cancelado: a tela fica como antes; quem avisa é a região da espera.
      if (!(error instanceof AiCancelled)) {
        this.errors.set(aiErrorMessages(error));
        this.waitToRetry(aiRetrySeconds(error));
      }
    } finally {
      this.request = null;
      this.loading.set(false);
    }
  }

  /** "Cancel" (ou `Esc`) durante a espera: aborta o pedido. */
  protected cancel(): void {
    this.request?.abort();
  }

  /** "Apply all" / "Apply conditions only": o editor aplica; a conferência continua à vista. */
  protected apply(conditionsOnly: boolean): void {
    const suggestion = this.result();
    if (suggestion) {
      this.pending.set(false);
      this.applied.emit({ rule: suggestion.rule, conditionsOnly });
    }
  }

  /** "Dismiss": a proposta sai sem mudar nada. */
  protected dismiss(): void {
    this.pending.set(false);
    this.proposal.set(null);
  }

  /** "Open the sequence assistant": o `dialog "Sequence"` de Regras. */
  protected async openSequence(): Promise<void> {
    const { openSequence } = await import('./scenario-sequence');
    await openSequence(this.injector);
  }

  /** A proposta conferida aparece e o foco vai ao resumo dela. */
  private show(proposal: Proposal): void {
    this.proposal.set(proposal);
    this.pending.set(true);
    afterNextRender(() => this.host.querySelector<HTMLElement>('.summary')?.focus(), {
      injector: this.injector,
    });
  }

  private waitToRetry(seconds: number | null): void {
    clearInterval(this.retryTimer);
    if (!seconds) {
      return;
    }
    this.retryIn.set(seconds);
    this.retryTimer = setInterval(() => {
      this.retryIn.update((left) => Math.max(0, left - 1));
      if (this.retryIn() === 0) {
        clearInterval(this.retryTimer);
      }
    }, 1000);
  }
}
