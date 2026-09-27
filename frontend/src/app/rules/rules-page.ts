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
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { AiClient } from '../ai/ai-client';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { TokenStore } from '../token/token-store';
import { Viewport } from '../shell/viewport';
import { Icon } from '../ui/icon';
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
import {
  NO_FILTER,
  RuleFilter,
  catchAllFlag,
  defaultResponseDetail,
  diagnosisFlag,
  diagnosisLine,
  hitsLine,
  isFiltering,
  listRows,
  offLine,
  orderTitle,
  passesFilter,
  positionLabel,
  priorityTitle,
  wouldBeShadowed,
} from './rule-list';
import { matchLine, ruleInWords, scenarioTransition } from './rule-words';
import { ScenarioStore } from './scenario-store';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { newRule } from './rule-form';
import { CREATED_HIGHLIGHT_MS, RuleIntents } from './rule-intents';
import { RuleItem, RulePosition } from './rule-item';
import { RuleListEmpty } from './rule-list-empty';
import { RuleListFilter } from './rule-list-filter';
import { ruleFromRequest } from './rule-from-request';
import { diffRules, mergeRules } from './rule-diff';
import {
  Diagnosis,
  catchAllPlacement,
  diagnose,
  isCatchAll,
  sameMatch,
  shadowedBy,
} from './rule-shadow';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';
import { RuleTemplate, ruleTemplates } from './rule-templates';

/** Regra na posição em que o servidor a avalia, com o índice dela na lista salva. */
interface OrderedRule {
  rule: Rule;
  index: number;
  /** Posição na ordem de avaliação, entre todas (a das setas e da alça), a partir de 0. */
  order: number;
  /** "#3" entre as ligadas, com o nome e o título (E-01). */
  position: RulePosition;
  flags: RuleFlag[];
  /** Linha 2 do item (RULES-02). */
  match: string;
  /** Transição do cenário, na frente dos hits (RULES-07); `null` fora de cenário. */
  transition: string | null;
  /** Nunca casa, sombreada ou provável sombra (E-01, E-11); só nas ligadas. */
  diagnosis: Diagnosis | null;
  /** Desligada: a regra que a sombrearia se ligada (título do "OFF"). */
  offTitle: string | null;
}

/**
 * O editor aberto pela rota: a regra (ou a nova) e a chave que o recria quando ela muda. A regra
 * nova vem com o lugar onde entra na lista (antes da pega-tudo, ou logo após a original ao
 * duplicar) e, do estado vazio, com o Describe aberto.
 */
type EditorState = RuleEditorData & {
  key: string;
  insertAt?: number;
  placedBefore?: string;
  openSuggest?: boolean;
};

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
    Icon,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    RuleEditor,
    RuleItem,
    RuleListEmpty,
    RuleListFilter,
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
  private readonly intents = inject(RuleIntents);
  protected readonly ai = inject(AiClient);

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

  /** Mensagem → regra que a respondeu, na janela recente (evidência da sombra provável). */
  private readonly answered = signal<ReadonlyMap<string, string | null>>(new Map());
  /** Diagnóstico por índice da lista salva: nunca casa, sombreada, provável sombra. */
  private readonly diagnoses = computed(() => {
    const rules = this.store.rules();
    const token = this.tokens.token();
    const tested = new Map<string, readonly string[]>();
    for (const [id, test] of this.store.tested()) {
      const saved = rules.find((rule) => rule.id === id);
      if (saved && sameMatch(saved.match, test.match)) {
        tested.set(id, test.matches);
      }
    }
    return diagnose(
      rules,
      // Sem a URL carregada, a configuração é desconhecida: nada de "Never matches".
      token?.uuid === this.tokenId() ? token : {},
      this.scenarios.scenarios(),
      { tested, answered: this.answered() },
    );
  });

  protected readonly ordered = computed<OrderedRule[]>(() => {
    const rules = this.store.rules();
    const diagnoses = this.diagnoses();
    const shadowed = shadowedBy(rules);
    const enabled = evaluationOrder(rules).filter((index) => rules[index].enabled !== false);
    const total = enabled.length;
    return evaluationOrder(rules).map((index, order) => {
      const rule = rules[index];
      const on = rule.enabled !== false;
      const priority = rule.priority ?? RULE_DEFAULT_PRIORITY;
      const value = on ? enabled.indexOf(index) + 1 : null;
      const ties = enabled
        .filter((other) => other !== index)
        .map((other) => rules[other])
        .filter((other) => (other.priority ?? RULE_DEFAULT_PRIORITY) === priority)
        .map((other) => other.name);
      const diagnosis = diagnoses.get(index) ?? null;
      const by = on ? undefined : shadowed.get(index);
      return {
        rule,
        index,
        order,
        position: {
          value,
          label: positionLabel(value, total),
          title: on ? orderTitle(ties) : positionLabel(null, total),
        },
        flags: [
          ...ruleFlags(rule),
          ...(isCatchAll(rule) ? [catchAllFlag()] : []),
          ...(diagnosis ? [diagnosisFlag(diagnosis)] : []),
        ],
        match: matchLine(rule),
        transition: scenarioTransition(rule),
        diagnosis,
        offTitle: by ? wouldBeShadowed(by) : null,
      };
    });
  });
  /** Filtro da lista (WM-03). */
  protected readonly filter = signal<RuleFilter>(NO_FILTER);
  protected readonly filtering = computed(() => isFiltering(this.filter()));
  /** As regras que passam no filtro, ainda na ordem de avaliação. */
  protected readonly shown = computed(() => {
    const filter = this.filter();
    const hits = this.store.hits();
    return this.ordered().filter((item) =>
      passesFilter(
        item,
        filter,
        hits ? (hits.answered.find(({ id }) => id === item.rule.id)?.count ?? 0) : null,
      ),
    );
  });
  /** As linhas da tabela: as regras e o cabeçalho de cada sequência de um cenário (RULES-07). */
  protected readonly rows = computed(() => listRows(this.shown()));
  /** A primeira pega-tudo ligada: o aviso de que as mensagens deixam de guardar o "por quê" (WM-30). */
  protected readonly catchAll = computed(
    () =>
      this.ordered().find((item) => item.rule.enabled !== false && isCatchAll(item.rule))?.rule ??
      null,
  );
  /** Regras desligadas nesta visita: a linha 3 diz para onde vai o que elas respondiam (WM-20). */
  private readonly turnedOff = signal<ReadonlySet<string>>(new Set());
  /** Regras recém-criadas, destacadas por 5 s (WM-35). */
  protected readonly createdIds = signal<ReadonlySet<string>>(new Set());
  /** A mensagem mais nova da URL, para o cartão "Create from the latest request" (WM-02). */
  protected readonly latest = signal<WebhookRequest | null>(null);
  protected readonly templates = ruleTemplates().filter((template) => !('sequence' in template));
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
    const intent = ruleId === 'new' ? this.intents.pending() : null;
    const key = ruleId === 'new' ? `new:${this.from() ?? ''}:${intent?.serial ?? 0}` : ruleId;
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
        ...untracked(() =>
          this.newRulePlacement(
            intent?.draft ?? (request && ruleFromRequest(request)),
            intent?.insertAt,
          ),
        ),
        ...(intent?.openSuggest && { openSuggest: true }),
        ...(example && { example }),
      };
      this.idsBeforeNew = new Set(untracked(() => this.store.rules()).map((rule) => rule.id));
    } else {
      const index = untracked(() => this.store.rules().findIndex((rule) => rule.id === ruleId));
      state = index < 0 ? null : { key, index, ...(opened && { example: opened }) };
    }
    this.openEditor = state;
    return state ? [state] : [];
  });
  private openEditor: EditorState | null = null;
  private readonly editorView = viewChild(RuleEditor);
  /** Os ids da lista quando o editor da regra nova abriu: o que sobrar ao salvar é a criada. */
  private idsBeforeNew = new Set<string | undefined>();

  /**
   * Onde a regra nova entra (E-01): com uma pega-tudo ligada, antes dela e com a prioridade dela
   * (empate, vale a ordem da lista), sem mexer nas vizinhas; sem pega-tudo, no fim com P5. Quem
   * pediu com um lugar (duplicar: logo após a original) fica com o lugar pedido.
   */
  private newRulePlacement(
    draft: Rule | undefined,
    insertAt: number | undefined,
  ): Pick<EditorState, 'draft' | 'insertAt' | 'placedBefore'> {
    if (insertAt !== undefined) {
      return { ...(draft && { draft }), insertAt };
    }
    const placement = catchAllPlacement(this.store.rules());
    if (!placement) {
      return draft ? { draft } : {};
    }
    return {
      draft: { ...(draft ?? newRule()), priority: placement.priority },
      insertAt: placement.index,
      placedBefore: placement.before,
    };
  }
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
  /** A regra em palavras, a descrição do item da lista (WM-04; o nome continua o nome acessível). */
  protected readonly inWords = ruleInWords;

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
    // Fora do editor da regra nova, o pedido (modelo, duplicar) já foi usado ou abandonado.
    effect(() => {
      if (this.ruleId() !== 'new') {
        untracked(() => this.intents.clear());
      }
    });
    // Sombra provável (E-01): só depois de um teste, com quem respondeu as mensagens da janela.
    effect(() => {
      if (this.store.tested().size > 0) {
        untracked(() => void this.loadAnswered());
      }
    });
    // Lista vazia, sem editor: o cartão "Create from the latest request" só com mensagens (WM-02).
    effect(() => {
      if (this.loaded() && this.store.rules().length === 0 && this.editor().length === 0) {
        const tokenId = this.tokenId();
        untracked(() => void this.loadLatest(tokenId));
      }
    });
    effect((onCleanup) => {
      const created = this.intents.created();
      if (created && this.loaded()) {
        const left = created.at + CREATED_HIGHLIGHT_MS - Date.now();
        if (left > 0) {
          untracked(() => this.highlight(created.ids));
          const timer = setTimeout(() => this.createdIds.set(new Set()), left);
          onCleanup(() => clearTimeout(timer));
        }
      }
    });
    afterRenderEffect(() => this.moveFocus());
  }

  /**
   * Guarda de rascunho da rota (`canDeactivate`, E-04): outra regra, "New rule", o rail ou a volta
   * do navegador passam pela pergunta do editor quando há alterações não salvas.
   */
  canLeave(): Promise<boolean> {
    return this.editorView()?.confirmLeave() ?? Promise.resolve(true);
  }

  /** Destaca as regras recém-criadas (borda e o selo "New") e rola até a primeira (WM-35). */
  private highlight(ids: readonly string[]): void {
    this.createdIds.set(new Set(ids));
    afterNextRender(
      () =>
        this.host
          .querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(ids[0])}"]`)
          ?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

  private async loadAnswered(): Promise<void> {
    try {
      const recent = await this.store.recentRequests();
      this.answered.set(new Map(recent.map((request) => [request.uuid, request.rule?.id ?? null])));
    } catch {
      // Sem as mensagens, não há evidência: nada de "Likely shadowed".
    }
  }

  /** A mais nova da Entrada já carregada desta URL (sem filtro), senão uma leitura de 1 mensagem. */
  private async loadLatest(tokenId: string): Promise<void> {
    if (this.requests.tokenId() === tokenId && !this.requests.filtering()) {
      this.latest.set(this.requests.newest() ?? null);
      return;
    }
    try {
      const latest = await this.store.latestRequest(tokenId);
      if (this.tokenId() === tokenId) {
        this.latest.set(latest);
      }
    } catch {
      this.latest.set(null);
    }
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
      return offLine(!!item.rule.id && this.turnedOff().has(item.rule.id));
    }
    if (item.diagnosis && item.diagnosis.kind !== 'likely') {
      // Nunca casa ou sombreada: a causa no lugar dos hits, que seriam sempre zero.
      return diagnosisLine(item.diagnosis);
    }
    const hits = this.store.hits();
    if (!hits) {
      const unavailable = this.store.hitsFailed() ? $localize`Hits unavailable` : null;
      return [item.transition, unavailable].filter((part) => part !== null).join(' · ') || null;
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
    if (!hits) {
      return this.store.hitsFailed() ? $localize`Hits unavailable` : null;
    }
    return hits.evaluated === 0
      ? $localize`No requests yet`
      : $localize`Answered ${hits.default}:answered:`;
  }

  /** "Delete rule" no editor: apaga a regra (com Undo) e volta à lista. */
  protected async deleteFromEditor(id: string): Promise<void> {
    const index = this.store.rules().findIndex((rule) => rule.id === id);
    if (index >= 0 && (await this.deleteRule(index))) {
      void this.router.navigate(['/', this.tokenId(), 'rules']);
    }
  }

  protected newRule(): void {
    this.intents.clear();
    this.openNew();
  }

  private openNew(queryParams?: { from: string }): void {
    this.store.pendingFocus.set('editor');
    const path = ['/', this.tokenId(), 'rules', 'new'];
    void (queryParams ? this.router.navigate(path, { queryParams }) : this.router.navigate(path));
  }

  /** Um modelo do menu "Rule templates" (WM-11): rascunho não salvo, com o nome sugerido. */
  protected useTemplate(template: RuleTemplate): void {
    if ('draft' in template) {
      this.intents.request({ draft: template.draft });
      this.openNew();
    }
  }

  /** "Describe it in words" (WM-02): a regra nova com o Describe aberto só desta vez. */
  protected describeInWords(): void {
    this.intents.request({ draft: newRule(), openSuggest: true });
    this.openNew();
  }

  /** "Create from the latest request" (WM-02): o mesmo caminho do "Create rule" da mensagem. */
  protected createFromLatest(): void {
    const latest = this.latest();
    if (latest) {
      this.intents.clear();
      this.openNew({ from: latest.uuid });
    }
  }

  /**
   * "Duplicate" (WM-21): regra nova com a cópia sem id, "{name} (copy)", ligada e com a mesma
   * prioridade; ao salvar, entra logo após a original.
   */
  protected duplicate(rule: Rule): void {
    const index = this.store.rules().findIndex((saved) => saved.id === rule.id);
    const copy: Rule = { ...rule };
    delete copy.id;
    const suffix = $localize`:name of a duplicated rule, after the original name: (copy)`;
    this.intents.request({
      draft: {
        ...copy,
        name: `${rule.name.slice(0, 100 - suffix.length)}${suffix}`,
        enabled: true,
      },
      insertAt: index < 0 ? this.store.rules().length : index + 1,
    });
    this.openNew();
  }

  /** "Delete" no ⋮ da linha: o mesmo apagar do editor, com Undo. */
  protected deleteFromList(index: number): void {
    void this.deleteRule(index);
  }

  /**
   * "Move before {name}" (E-01): leva a regra sombreada para antes da que a sombreia; as
   * prioridades seguem as posições (`moveInOrder`), então as vizinhas mudam, e o aviso diz isso.
   */
  protected async moveBefore(item: OrderedRule, by: Rule): Promise<void> {
    const to = this.ordered().findIndex((other) => other.rule.id === by.id);
    if (to < 0 || to >= item.order) {
      return;
    }
    if (await this.saveUnchanged(moveInOrder(this.store.rules(), item.order, to))) {
      this.snackBar.open($localize`Moved before ${by.name}:name: · priorities updated`, undefined, {
        duration: 4000,
      });
    }
  }

  protected priorityTitleOf(rule: Rule): string {
    return priorityTitle(rule.priority ?? RULE_DEFAULT_PRIORITY);
  }

  protected moveBeforeLabel(name: string): string {
    return $localize`Move before ${name}:name:`;
  }

  protected moreActionsLabel(name: string): string {
    return $localize`More actions for ${name}:name:`;
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
    if (saved && ruleId === 'new') {
      const created = this.store
        .rules()
        .flatMap((rule) => (rule.id && !this.idsBeforeNew.has(rule.id) ? [rule.id] : []));
      this.intents.markCreated(created, false);
    }
    this.store.pendingFocus.set({ rule: ruleId && ruleId !== 'new' ? ruleId : null });
    void this.router.navigate(['/', this.tokenId(), 'rules']);
  }

  protected async setEnabled(
    index: number,
    enabled: boolean,
    toggle: MatSlideToggle,
  ): Promise<void> {
    const id = this.store.rules()[index]?.id;
    const saved = await this.saveUnchanged(
      this.store.rules().map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    );
    if (!saved) {
      // A lista não mudou: o switch volta ao que está salvo.
      toggle.checked = !enabled;
    } else if (id) {
      this.turnedOff.update((ids) => {
        const next = new Set(ids);
        if (enabled) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
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

  /**
   * "Turn all rules off" (WM-37): confirma nomeando quantas param de responder e grava todas
   * desligadas, com Desfazer (volta a lista de antes).
   */
  protected async turnAllOff(): Promise<void> {
    const previous = this.store.rules();
    const count = previous.filter((rule) => rule.enabled !== false).length;
    // O diálogo (e o MatDialog) vêm sob demanda: ficam fora do pedaço de Regras.
    const { confirmAction } = await import('./rule-dialogs');
    const confirmed = await confirmAction(this.injector, {
      title: $localize`Turn all rules off?`,
      message:
        count === 1
          ? $localize`1 rule stops answering until turned on again.`
          : $localize`${count}:count: rules stop answering until turned on again.`,
      confirm: $localize`Turn off`,
      cancel: $localize`Cancel`,
    });
    if (
      !confirmed ||
      !(await this.saveUnchanged(previous.map((rule) => ({ ...rule, enabled: false }))))
    ) {
      return;
    }
    const text =
      count === 1 ? $localize`1 rule turned off` : $localize`${count}:count: rules turned off`;
    this.snackBar
      .open(text, $localize`Undo`, { duration: 5000 })
      .onAction()
      .subscribe(() => void this.saveUnchanged(previous));
  }

  /**
   * O import mostra antes o que muda (WM-19): substituir a lista inteira, ou mesclar as regras de
   * id novo nas salvas. Grava só se a lista do servidor ainda é a comparada, com Desfazer; o
   * servidor valida e responde 422.
   */
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
    const incoming = rules as Rule[];
    const previous = this.store.rules();
    const { chooseImport } = await import('./import-rules-dialog');
    const mode = await chooseImport(this.injector, previous, incoming);
    if (!mode) {
      return;
    }
    const diff = diffRules(previous, incoming);
    const next = mode === 'merge' ? mergeRules(previous, diff) : incoming;
    const count = mode === 'merge' ? diff.added.length : incoming.length;
    if (await this.saveUnchanged(next)) {
      // As que entraram agora (ids que não havia) ficam destacadas (WM-35); o snackbar já anuncia.
      const before = new Set(previous.map(({ id }) => id));
      this.intents.markCreated(
        this.store
          .rules()
          .map(({ id }) => id)
          .filter((id): id is string => !!id && !before.has(id)),
        false,
      );
      this.snackBar
        .open(
          count === 1 ? $localize`Imported 1 rule` : $localize`Imported ${count}:count: rules`,
          $localize`Undo`,
          { duration: 5000 },
        )
        .onAction()
        .subscribe(() => void this.saveUnchanged(previous));
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
