import { LiveAnnouncer } from '@angular/cdk/a11y';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { TokenStore } from '../token/token-store';
import { StatusCode } from '../ui/status-code';
import {
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  RuleFlag,
  evaluationOrder,
  matchSummary,
  moveInOrder,
  ruleFlags,
} from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { ruleFromRequest } from './rule-from-request';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';
import { ScenarioPanel } from './scenario-panel';

/** Regra na posição em que o servidor a avalia, com o índice dela na lista salva. */
interface OrderedRule {
  rule: Rule;
  index: number;
  flags: RuleFlag[];
}

/** O editor aberto pela rota: a regra (ou a nova) e a chave que o recria quando ela muda. */
type EditorState = RuleEditorData & { key: string };

/** A mensagem de `rules/new?from=`: carregando, lida, ou a leitura falhou. */
type FromRequest = { state: 'loading' } | { state: 'done'; request: WebhookRequest | null };

/**
 * Rules (`#/{tokenId}/rules`, `…/rules/{ruleId}`, `…/rules/new?from={requestId}`): a lista das
 * regras na ordem de avaliação (ligar, reordenar por arrasto ou teclado, editar, apagar, import e
 * export do JSON, hits da janela de `stats`, a resposta padrão no fim) e, com uma regra aberta, o
 * editor ao lado. Toggle, reordenação e apagar mandam a lista inteira e só gravam se a lista do
 * servidor ainda é a que a tela leu.
 */
@Component({
  selector: 'app-rules-page',
  imports: [
    MatButton,
    MatIconButton,
    MatSlideToggle,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    StatusCode,
    ScenarioPanel,
    RuleEditor,
  ],
  templateUrl: './rules-page.html',
  styleUrl: './rules-page.scss',
})
export class RulesPage {
  protected readonly store = inject(RuleStore);
  protected readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();
  /** Id da regra aberta, ou `new`; ausente na lista sozinha. */
  readonly ruleId = input<string>();
  /** `rules/new?from={requestId}`: a regra nova parte da mensagem. */
  readonly from = input<string>();

  protected readonly loaded = signal(false);
  /** Erros do último load, save ou import, uma frase por linha. */
  protected readonly errors = signal<readonly string[]>([]);
  /** A lista do servidor mudou desde a leitura: nada foi gravado. */
  protected readonly changedElsewhere = signal(false);
  private readonly fromRequest = signal<FromRequest>({ state: 'done', request: null });

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

  /**
   * O editor da rota. Depende só da rota e da carga: a lista muda enquanto o editor está aberto
   * (toggle, reordenação) sem recriá-lo.
   */
  protected readonly editor = computed<EditorState[]>(() => {
    const ruleId = this.ruleId();
    const from = this.fromRequest();
    if (!ruleId || !this.loaded() || from.state === 'loading') {
      this.openEditor = null;
      return [];
    }
    const open = this.requests.selected();
    const opened = open?.token_id === this.tokenId() ? open : undefined;
    const key = ruleId === 'new' ? `new:${this.from() ?? ''}` : ruleId;
    const kept = untracked(() => this.openEditor);
    if (kept?.key === key) {
      // Mesmo editor: o mesmo objeto, para o editor não recarregar o formulário.
      return [kept];
    }
    let state: EditorState | null;
    if (ruleId === 'new') {
      const request = from.request ?? undefined;
      const example = request ?? opened;
      state = {
        key,
        index: null,
        ...(request && { draft: ruleFromRequest(request) }),
        ...(example && { example }),
      };
    } else {
      const index = untracked(() => this.store.rules().findIndex((rule) => rule.id === ruleId));
      state = index < 0 ? null : { key, index, ...(opened && { example: opened }) };
    }
    this.openEditor = state;
    return state ? [state] : [];
  });
  private openEditor: EditorState | null = null;
  /**
   * A rota aponta para uma regra que não está na lista e nenhum editor está aberto (com o editor
   * aberto, o aviso é o dele: "Save adds it as a new rule").
   */
  protected readonly missingRule = computed(() => {
    const ruleId = this.ruleId();
    return (
      !!ruleId &&
      ruleId !== 'new' &&
      this.loaded() &&
      this.editor().length === 0 &&
      !this.store.rules().some((rule) => rule.id === ruleId)
    );
  });

  protected readonly summary = matchSummary;
  protected readonly defaultPriority = RULE_DEFAULT_PRIORITY;
  protected readonly defaultStatus = RULE_DEFAULT_STATUS;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.open(tokenId));
    });
    effect(() => {
      const [tokenId, ruleId, from] = [this.tokenId(), this.ruleId(), this.from()];
      untracked(() => void this.loadFrom(tokenId, ruleId === 'new' ? from : undefined));
    });
  }

  /** Hits da regra na janela de `stats`: "Answered 41 · 3 near misses". */
  protected hitsOf(rule: Rule): string | null {
    const hits = this.store.hits();
    if (!hits) {
      return null;
    }
    const answered = hits.answered.find(({ id }) => id === rule.id)?.count ?? 0;
    const near = hits.near_miss.find(({ id }) => id === rule.id)?.count ?? 0;
    const nearText = near === 0 ? '' : ` · ${near} near ${near === 1 ? 'miss' : 'misses'}`;
    return `Answered ${answered}${nearText}`;
  }

  protected newRule(): void {
    void this.router.navigate(['/', this.tokenId(), 'rules', 'new']);
  }

  protected editRule(rule: Rule): void {
    if (rule.id) {
      void this.router.navigate(['/', this.tokenId(), 'rules', rule.id]);
    }
  }

  protected closeEditor(saved: boolean): void {
    if (saved) {
      this.snackBar.open('Rule saved', undefined, { duration: 4000 });
      void this.scenarioPanel()?.refresh();
    }
    void this.router.navigate(['/', this.tokenId(), 'rules']);
  }

  protected async setEnabled(
    index: number,
    enabled: boolean,
    toggle: MatSlideToggle,
  ): Promise<void> {
    const saved = await this.saveUnchanged(
      this.store.rules().map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    );
    if (!saved) {
      // A lista não mudou: o switch volta ao que está salvo.
      toggle.checked = !enabled;
    }
  }

  /** Um passo para cima ou para baixo (botões e setas na alça). */
  protected moveRule(position: number, delta: -1 | 1): Promise<void> {
    return this.moveTo(position, position + delta);
  }

  protected dropRule(event: CdkDragDrop<OrderedRule[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      void this.moveTo(event.previousIndex, event.currentIndex);
    }
  }

  /** Setas na alça "Reorder": move a regra e mantém o foco nela. */
  protected moveByKey(event: KeyboardEvent, position: number): void {
    const delta = { ArrowUp: -1, ArrowDown: 1 }[event.key] as -1 | 1 | undefined;
    if (!delta) {
      return;
    }
    event.preventDefault();
    const target = position + delta;
    if (target >= 0 && target < this.ordered().length) {
      void this.moveTo(position, target, true);
    }
  }

  /**
   * Leva a regra da posição `from` a `to` na ordem de avaliação (as prioridades ficam com as
   * posições, `moveInOrder`) e anuncia a posição nova.
   */
  private async moveTo(from: number, to: number, keepFocus = false): Promise<void> {
    const rules = this.ordered().map(({ rule }) => rule);
    const moved = rules[from];
    if (!(await this.saveUnchanged(moveInOrder(this.store.rules(), from, to)))) {
      return;
    }
    this.announcer.announce(`${moved.name} moved to position ${to + 1} of ${rules.length}`);
    if (keepFocus && moved.id) {
      afterNextRender(
        () =>
          this.host
            .querySelector<HTMLElement>(`[data-handle="${CSS.escape(moved.id ?? '')}"]`)
            ?.focus(),
        { injector: this.injector },
      );
    }
  }

  protected async deleteRule(index: number): Promise<void> {
    const deleted = this.store.rules()[index];
    if (!(await this.saveUnchanged(this.store.rules().filter((_, i) => i !== index)))) {
      return;
    }
    this.snackBar
      .open('Rule deleted', 'Undo', { duration: 5000 })
      .onAction()
      .subscribe(() => void this.undoDelete(deleted, index));
  }

  /**
   * Devolve só a regra apagada, na posição de antes (ou no fim), sobre a lista de agora: a lista
   * pode ter sido relida depois do Delete, com regras que outra aba gravou.
   */
  private async undoDelete(deleted: Rule, index: number): Promise<void> {
    const current = this.store.rules();
    if (deleted.id && current.some((rule) => rule.id === deleted.id)) {
      return;
    }
    const restored = [...current];
    restored.splice(Math.min(index, restored.length), 0, deleted);
    await this.saveUnchanged(restored);
  }

  /** Relê a lista depois do aviso "changed elsewhere". */
  protected reload(): void {
    void this.open(this.tokenId());
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
        duration: 4000,
      });
    }
  }

  private async open(tokenId: string): Promise<void> {
    this.loaded.set(false);
    this.errors.set([]);
    this.changedElsewhere.set(false);
    if (this.tokens.token()?.uuid !== tokenId) {
      // Link direto para as regras de outra URL: o cabeçalho passa a mostrar esta.
      this.tokens.load(tokenId).catch(() => undefined);
    }
    try {
      await this.store.load(tokenId);
      this.loaded.set(true);
      void this.store.loadHits(tokenId);
    } catch (error) {
      this.errors.set(loadMessages(error));
    }
  }

  /** A mensagem de `?from=`; sem ela (apagada), o editor abre com a regra em branco. */
  private async loadFrom(tokenId: string, requestId: string | undefined): Promise<void> {
    if (!requestId) {
      this.fromRequest.set({ state: 'done', request: null });
      return;
    }
    this.fromRequest.set({ state: 'loading' });
    let request: WebhookRequest | null = null;
    try {
      request = await this.store.fetchRequest(tokenId, requestId);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.errors.set([`Could not load the request ${requestId} (${status}).`]);
    }
    if (this.from() === requestId) {
      this.fromRequest.set({ state: 'done', request });
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

  /** O `PUT` da lista só se a do servidor não mudou desde a leitura (toggle, ordem, apagar). */
  private async saveUnchanged(rules: readonly Rule[]): Promise<boolean> {
    this.errors.set([]);
    try {
      await this.store.saveIfUnchanged(rules);
      void this.scenarioPanel()?.refresh();
      return true;
    } catch (error) {
      if (error instanceof RulesChangedError) {
        this.changedElsewhere.set(true);
      } else {
        this.errors.set(validationMessages(error));
      }
      return false;
    }
  }
}

function loadMessages(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410)) {
    return validationMessages(error);
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return [`Could not load the rules (${status}).`];
}
