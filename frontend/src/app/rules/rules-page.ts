import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RequestStore } from '../requests/request-store';
import { TokenStore } from '../token/token-store';
import {
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  RuleFlag,
  evaluationOrder,
  matchSummary,
  ruleFlags,
} from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore, validationMessages } from './rule-store';
import { ScenarioPanel } from './scenario-panel';

/** Regra na posição em que o servidor a avalia, com o índice dela na lista salva. */
interface OrderedRule {
  rule: Rule;
  index: number;
  flags: RuleFlag[];
}

/**
 * Aba "Rules" (`/#/{tokenId}/rules`): lista das regras de resposta da URL na ordem de avaliação,
 * com ligar/desligar, reordenar, editar, apagar, import e export do JSON, e o painel de cenários
 * quando alguma regra usa cenário.
 */
@Component({
  selector: 'app-rules-page',
  imports: [MatButton, MatSlideToggle, ScenarioPanel],
  templateUrl: './rules-page.html',
  styleUrl: './rules-page.scss',
})
export class RulesPage {
  protected readonly store = inject(RuleStore);
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  protected readonly loaded = signal(false);
  /** Erros do último load, save ou import, uma frase por linha. */
  protected readonly errors = signal<readonly string[]>([]);

  protected readonly ordered = computed<OrderedRule[]>(() => {
    const rules = this.store.rules();
    return evaluationOrder(rules).map((index) => ({
      rule: rules[index],
      index,
      flags: ruleFlags(rules[index]),
    }));
  });
  protected readonly hasScenarios = computed(() =>
    this.store.rules().some((rule) => !!rule.scenario?.name),
  );
  /** Existe só quando alguma regra usa cenário; recém-criado, ele mesmo carrega os estados. */
  private readonly scenarioPanel = viewChild(ScenarioPanel);

  protected readonly summary = matchSummary;
  protected readonly defaultPriority = RULE_DEFAULT_PRIORITY;
  protected readonly defaultStatus = RULE_DEFAULT_STATUS;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.open(tokenId));
    });
  }

  protected newRule(): void {
    this.openEditor({ index: null });
  }

  protected editRule(index: number): void {
    this.openEditor({ index });
  }

  protected async setEnabled(index: number, enabled: boolean): Promise<void> {
    await this.save(
      this.store.rules().map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    );
  }

  /**
   * Troca a regra com a vizinha na ordem de avaliação. Com prioridades diferentes, as duas trocam
   * de prioridade também, senão a troca na lista não mudaria quem é avaliada primeiro. A lista
   * vai salva na ordem de avaliação.
   */
  protected async moveRule(position: number, delta: -1 | 1): Promise<void> {
    const order = this.ordered();
    const [a, b] = [order[position].rule, order[position + delta].rule];
    const list = order.map(({ rule }) => rule);
    list[position] = { ...b, priority: a.priority ?? RULE_DEFAULT_PRIORITY };
    list[position + delta] = { ...a, priority: b.priority ?? RULE_DEFAULT_PRIORITY };
    await this.save(list);
  }

  protected async deleteRule(index: number): Promise<void> {
    const previous = this.store.rules();
    if (!(await this.save(previous.filter((_, i) => i !== index)))) {
      return;
    }
    this.snackBar
      .open('Rule deleted', 'Undo', { duration: 5000 })
      .onAction()
      .subscribe(() => void this.save(previous));
  }

  /** Baixa o que está salvo no servidor (`GET /rules`), pronto para o import em outra URL. */
  protected async exportRules(): Promise<void> {
    try {
      const rules = await this.store.fetchAll();
      const blob = new Blob([`${JSON.stringify(rules, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = url;
      link.download = `rules-${this.tokenId()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.errors.set(validationMessages(error));
    }
  }

  /** O import substitui a lista inteira (`PUT /rules`); o servidor valida e responde 422. */
  protected async importRules(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    let rules: unknown;
    try {
      rules = JSON.parse(await file.text());
    } catch {
      this.errors.set(['The file is not valid JSON.']);
      return;
    }
    if (!Array.isArray(rules)) {
      this.errors.set(['The file must contain a JSON list of rules.']);
      return;
    }
    if (await this.save(rules as Rule[])) {
      this.snackBar.open(`Imported ${this.store.rules().length} rules`, undefined, {
        duration: 1000,
      });
    }
  }

  private async open(tokenId: string): Promise<void> {
    this.loaded.set(false);
    this.errors.set([]);
    if (this.tokens.token()?.uuid !== tokenId) {
      // Link direto para as regras de outra URL: a barra superior passa a mostrar esta.
      this.tokens.load(tokenId).catch(() => undefined);
    }
    try {
      await this.store.load(tokenId);
      this.loaded.set(true);
    } catch (error) {
      this.errors.set(loadMessages(error));
    }
  }

  private async save(rules: readonly Rule[]): Promise<boolean> {
    this.errors.set([]);
    try {
      await this.store.save(rules);
      void this.scenarioPanel()?.refresh();
      return true;
    } catch (error) {
      this.errors.set(validationMessages(error));
      return false;
    }
  }

  private openEditor(data: RuleEditorData): void {
    this.errors.set([]);
    // A mensagem aberta na caixa de entrada desta URL vira o exemplo do "Describe the rule".
    const open = this.requests.selected();
    const example = open?.token_id === this.tokenId() ? open : undefined;
    this.dialog
      .open<RuleEditor, RuleEditorData, boolean>(RuleEditor, {
        data: { ...data, ...(example && { example }) },
        width: '960px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snackBar.open('Rule saved', undefined, { duration: 1000 });
          void this.scenarioPanel()?.refresh();
        }
      });
  }
}

function loadMessages(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
    return validationMessages(error);
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return [`Could not load the rules (${status}).`];
}
