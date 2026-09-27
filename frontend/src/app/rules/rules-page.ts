import { LiveAnnouncer } from '@angular/cdk/a11y';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { TokenStore } from '../token/token-store';
import { Viewport } from '../shell/viewport';
import { Split } from '../ui/split';
import {
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  RuleFlag,
  evaluationOrder,
  moveInOrder,
  ruleFlags,
} from './rule';
import { defaultResponseDetail, hitsLine, listRows } from './rule-list';
import { matchLine, scenarioTransition } from './rule-words';
import { ScenarioStore } from './scenario-store';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleItem } from './rule-item';
import { ruleFromRequest } from './rule-from-request';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';

/** Regra na posição em que o servidor a avalia, com o índice dela na lista salva. */
interface OrderedRule {
  rule: Rule;
  index: number;
  flags: RuleFlag[];
  /** Linha 2 do item (RULES-02). */
  match: string;
  /** Transição do cenário, na frente dos hits (RULES-07); `null` fora de cenário. */
  transition: string | null;
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
    RouterLink,
    NgTemplateOutlet,
    Split,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    RuleEditor,
    RuleItem,
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
  private readonly viewport = inject(Viewport);
  protected readonly scenarios = inject(ScenarioStore);

  /** Parâmetros da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();
  /** Id da regra aberta, ou `new`; ausente na lista sozinha. */
  readonly ruleId = input<string>();
  /** `rules/new?from={requestId}`: a regra nova parte da mensagem. */
  readonly from = input<string>();

  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly reorderLabel = (name: string) => $localize`Reorder ${name}:rule:`;
  protected readonly loaded = signal(false);
  /** Erros do último load, save ou import, uma frase por linha. */
  protected readonly errors = signal<readonly string[]>([]);
  /** A lista do servidor mudou desde a leitura: nada foi gravado (na store, ver lá). */
  protected readonly changedElsewhere = this.store.changedElsewhere;
  private readonly fromRequest = signal<FromRequest>({ state: 'done', request: null });

  protected readonly ordered = computed<OrderedRule[]>(() => {
    const rules = this.store.rules();
    return evaluationOrder(rules).map((index) => ({
      rule: rules[index],
      index,
      flags: ruleFlags(rules[index]),
      match: matchLine(rules[index]),
      transition: scenarioTransition(rules[index]),
    }));
  });
  /** As linhas da tabela: as regras e o cabeçalho de cada sequência de um cenário (RULES-07). */
  protected readonly rows = computed(() => listRows(this.ordered()));
  /** Lista e editor lado a lado a partir de 1200 px; abaixo, só o editor (RULES-10). */
  protected readonly twoPanes = computed(() =>
    ['large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  /** Largura da lista ao lado do editor (C: 440 px), guardada em `rulesListWidth`. */
  protected readonly listWidth = signal(440);
  /** Quantas regras estão ligadas ("9 · 8 on" ao lado do h1, RULES-06). */
  protected readonly enabledCount = computed(
    () => this.store.rules().filter((rule) => rule.enabled !== false).length,
  );
  protected readonly hasScenarios = computed(() =>
    this.store.rules().some((rule) => !!rule.scenario?.name),
  );

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

  protected readonly defaultPriority = RULE_DEFAULT_PRIORITY;
  protected readonly defaultStatus = RULE_DEFAULT_STATUS;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.open(tokenId));
    });
    // O chip "state: …" dos grupos de cenário (RULES-07) lê os estados da URL; o painel com "Set
    // state" fica na aba Scenario do editor (RULES-12).
    effect(() => {
      if (this.loaded() && this.hasScenarios()) {
        untracked(() => this.refreshScenarios());
      }
    });
    effect(() => {
      const [tokenId, ruleId, from] = [this.tokenId(), this.ruleId(), this.from()];
      untracked(() => void this.loadFrom(tokenId, ruleId === 'new' ? from : undefined));
    });
    afterRenderEffect(() => this.moveFocus());
  }

  /** Leva o foco ao destino pendente, depois do render em que ele aparece. */
  private moveFocus(): void {
    const target = this.store.pendingFocus();
    const editing = this.editor().length > 0;
    // Antes da carga, a lista não tem as linhas e "New rule" está desabilitado.
    if (!target || !this.loaded() || editing !== (target === 'editor')) {
      return;
    }
    const element =
      target === 'editor'
        ? this.host.querySelector<HTMLElement>('app-rule-editor .name-input')
        : ((target.rule &&
            this.host.querySelector<HTMLElement>(
              `[data-rule-id="${CSS.escape(target.rule)}"] .open-rule`,
            )) ??
          this.host.querySelector<HTMLElement>('.new-rule'));
    if (element) {
      element.focus();
      this.store.pendingFocus.set(null);
    }
  }

  /**
   * Linha 3 da regra (RULES-01): "Answered 41 of the last 200 · 3 near misses", com a transição do
   * cenário na frente; sem os hits de `stats`, só a transição.
   */
  protected hitsOf(item: OrderedRule): string | null {
    if (item.rule.enabled === false) {
      // Desligada, a regra não é avaliada: "Answered 0" sugeriria que ela roda e não casa (RULES-08).
      return $localize`Not checked while off`;
    }
    const hits = this.store.hits();
    if (!hits) {
      return item.transition;
    }
    const answered = hits.answered.find(({ id }) => id === item.rule.id)?.count ?? 0;
    const near = hits.near_miss.find(({ id }) => id === item.rule.id)?.count ?? 0;
    return hitsLine(answered, near, hits.evaluated, item.transition);
  }

  /** Relê os estados dos cenários (depois de gravar a lista, que pode mudar os cenários). */
  private refreshScenarios(): void {
    if (this.hasScenarios()) {
      this.scenarios.load(this.tokenId()).catch(() => undefined);
    }
  }

  /** Estado atual do cenário (`GET /scenarios`), para o chip do cabeçalho do grupo. */
  protected stateOf(scenario: string): string | null {
    return this.scenarios.scenarios().find(({ name }) => name === scenario)?.state ?? null;
  }

  /** Detalhe da resposta padrão: tipo do corpo e atraso da URL (RULES-09). */
  protected defaultDetail(): string {
    const token = this.tokens.token();
    return defaultResponseDetail(token?.default_content_type ?? null, token?.timeout ?? 0);
  }

  /** Linha 3 da resposta padrão: quantas ela respondeu na janela. */
  protected defaultHits(): string | null {
    const hits = this.store.hits();
    return hits ? $localize`Answered ${hits.default}:answered:` : null;
  }

  /** "Delete rule" no editor: apaga a regra (com Undo) e volta à lista. */
  protected async deleteFromEditor(id: string): Promise<void> {
    const index = this.store.rules().findIndex((rule) => rule.id === id);
    if (index >= 0 && (await this.deleteRule(index))) {
      void this.router.navigate(['/', this.tokenId(), 'rules']);
    }
  }

  protected newRule(): void {
    this.store.pendingFocus.set('editor');
    void this.router.navigate(['/', this.tokenId(), 'rules', 'new']);
  }

  protected editRule(rule: Rule): void {
    if (rule.id) {
      this.store.pendingFocus.set('editor');
      void this.router.navigate(['/', this.tokenId(), 'rules', rule.id]);
    }
  }

  protected closeEditor(saved: boolean): void {
    if (saved) {
      this.snackBar.open($localize`Rule saved`, undefined, { duration: 4000 });
      this.refreshScenarios();
    }
    const ruleId = this.ruleId();
    this.store.pendingFocus.set({ rule: ruleId && ruleId !== 'new' ? ruleId : null });
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
    this.announcer.announce(
      $localize`${moved.name}:rule: moved to position ${to + 1}:position: of ${rules.length}:count:`,
    );
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

  private async deleteRule(index: number): Promise<boolean> {
    const deleted = this.store.rules()[index];
    if (!(await this.saveUnchanged(this.store.rules().filter((_, i) => i !== index)))) {
      return false;
    }
    this.snackBar
      .open($localize`Rule deleted`, $localize`Undo`, { duration: 5000 })
      .onAction()
      .subscribe(() => void this.undoDelete(deleted, index));
    return true;
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
      this.errors.set([$localize`The file is not valid JSON.`]);
      return;
    }
    if (!Array.isArray(rules)) {
      this.errors.set([$localize`The file must contain a JSON list of rules.`]);
      return;
    }
    if (await this.save(rules as Rule[])) {
      this.snackBar.open($localize`Imported ${this.store.rules().length}:count: rules`, undefined, {
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
      this.errors.set([$localize`Could not load the request ${requestId} (${status}).`]);
    }
    if (this.from() === requestId) {
      this.fromRequest.set({ state: 'done', request });
    }
  }

  private async save(rules: readonly Rule[]): Promise<boolean> {
    this.errors.set([]);
    try {
      await this.store.save(rules);
      this.refreshScenarios();
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
      this.refreshScenarios();
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
  return [$localize`Could not load the rules (${status}).`];
}
