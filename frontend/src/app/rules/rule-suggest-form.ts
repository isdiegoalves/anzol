import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { WebhookRequest } from '../requests/webhook-request';
import { PathMatcher, RULE_DEFAULT_STATUS, Rule, ValueMatcher } from './rule';
import { SuggestionApply } from './rule-suggest';
import {
  AI_OFF_HINT,
  AI_WAIT_HINT,
  AiClient,
  RuleSuggestion,
  aiErrorMessages,
} from '../ai/ai-client';
import { MarkdownView } from '../ui/markdown-view';

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

/**
 * O formulário do "Describe the rule" (carregado quando o `<details>` abre, ver `RuleSuggest`): a descrição em linguagem natural vai para
 * `rules/suggest` e a regra sugerida sai por `suggested`, para o editor preencher. Nada é gravado
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
  ],
  templateUrl: './rule-suggest-form.html',
  styleUrl: './rule-suggest-form.scss',
})
export class RuleSuggestForm {
  private readonly ai = inject(AiClient);

  readonly tokenId = input.required<string>();
  /** Mensagem aberta, oferecida como exemplo ao modelo. */
  readonly example = input<WebhookRequest>();
  /** A regra como está no editor, para a lista de mudanças da proposta (E-13). */
  readonly current = input<Rule>();
  readonly applied = output<SuggestionApply>();

  protected readonly prompt = signal('');
  protected readonly useExample = signal(false);
  protected readonly loading = signal(false);
  protected readonly result = signal<RuleSuggestion | null>(null);
  /** A proposta ainda não foi aplicada: a lista de mudanças e os botões ficam à vista. */
  protected readonly pending = signal(false);
  protected readonly changes = computed(() => {
    const suggestion = this.result();
    return suggestion ? suggestionChanges(this.current() ?? { name: '' }, suggestion.rule) : [];
  });
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly disabled = this.ai.disabled;
  protected readonly canSuggest = computed(() => {
    const length = this.prompt().trim().length;
    return !this.loading() && !this.disabled() && length > 0 && length <= PROMPT_MAX_LENGTH;
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
  protected readonly waitHint = AI_WAIT_HINT;
  protected readonly offHint = AI_OFF_HINT;

  protected async suggest(): Promise<void> {
    if (!this.canSuggest()) {
      return;
    }
    const example = this.useExample() ? this.example()?.uuid : undefined;
    this.loading.set(true);
    this.result.set(null);
    this.errors.set([]);
    try {
      const suggestion = await this.ai.suggestRule(this.tokenId(), this.prompt().trim(), example);
      this.result.set(suggestion);
      this.pending.set(true);
    } catch (error) {
      this.errors.set(aiErrorMessages(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** "Apply all" / "Apply conditions only": o editor aplica; a explicação continua à vista. */
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
    this.result.set(null);
  }
}
