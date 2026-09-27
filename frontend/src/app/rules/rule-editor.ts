import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Type,
  ViewContainerRef,
  viewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { Subscription, merge } from 'rxjs';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RuleSuggest, SuggestionApply } from './rule-suggest';
import { RouterLink } from '@angular/router';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Viewport } from '../shell/viewport';
import { HistoryTestPanel } from './history-test-panel';
import { PriorityPreview, priorityPreview } from './priority-preview';
import {
  DELAY_MAX_MS,
  DRIBBLE_MAX_CHUNKS,
  FAULT_LABELS,
  HISTORY_TEST_WINDOW,
  HistoryTest,
  RULE_DEFAULT_PRIORITY,
  RenderedResponse,
  RULE_DEFAULT_STATUS,
  RULE_FAULTS,
  Rule,
  pathWithoutToken,
  scenarioNames,
  scenarioStates,
} from './rule';
import { ConditionKey, ConditionTally, tallyConditions } from './rule-conditions';
import {
  BodyRow,
  BodyType,
  ConditionRow,
  DelayType,
  FaultOption,
  FieldRef,
  HeaderRow,
  PathMode,
  RuleFormValue,
  SchemaOption,
  SignatureOption,
  ValueOperator,
  fromFormValue,
  locateError,
  newRule,
  parseRuleJson,
  toFormValue,
} from './rule-form';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';
import { RuleEditorHeader } from './rule-editor-header';
import { RuleBodyTools } from './rule-body-tools';
import { RuleConditionHint } from './rule-condition-hint';
import {
  ExampleField,
  exampleHeader,
  examplePath,
  exampleQuery,
  readAs,
  valueAtPath,
} from './rule-example';
import { RuleFromRequestPanel } from './rule-from-request-panel';
import { EditorTab, RuleTabs } from './rule-tabs';
import { AgainstHistory } from './against-history';
import { ConditionResult, ConditionResultChip } from './condition-result';
import { ruleWordSegments } from './rule-words';
import { ScenarioPanel } from './scenario-panel';
import { RuleDraft, RuleDrafts, withoutSecrets } from './rule-draft';
import { InvalidField, invalidFields } from './rule-validation';

export interface RuleEditorData {
  /** Posição da regra na lista salva; `null` para uma regra nova (entra no fim). */
  index: number | null;
  /** Regra nova já preenchida (ex.: a partir de uma mensagem); sem ela, uma regra em branco. */
  draft?: Rule;
  /** Mensagem aberta: o "Describe the rule" pode mandá-la ao modelo como exemplo. */
  example?: WebhookRequest;
  /** Regra nova: posição na lista salva onde ela entra (antes da pega-tudo, depois da original). */
  insertAt?: number;
  /** Regra nova colocada antes da pega-tudo: o nome dela, para o aviso no topo do editor. */
  placedBefore?: string;
  /** Abre o "Describe the rule" já expandido (só desta vez; RULES-16 o mantém recolhido). */
  openSuggest?: boolean;
}

/** Espera depois da última mudança de condição antes de rerodar o teste (WM-22). */
const RERUN_DELAY_MS = 1000;

/** O que o clique em Save ou em Test achou inválido. */
type Blocked = 'save' | 'test';

/** Campo inválido focável, em ordem de tela: controles com o erro e os segmentados. */
const INVALID_CONTROL =
  'input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid, mat-button-toggle-group.ng-invalid button';

type ConditionGroup = FormGroup<{
  name: FormControl<string>;
  operator: FormControl<ValueOperator>;
  value: FormControl<string>;
}>;
type BodyGroup = FormGroup<{
  type: FormControl<BodyType>;
  value: FormControl<string>;
  path: FormControl<string>;
  equals: FormControl<string>;
}>;
type HeaderGroup = FormGroup<{ name: FormControl<string>; value: FormControl<string> }>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const FORM_VIEW = 0;
const JSON_VIEW = 1;
let nextEditorId = 0;

/** A prévia com prioridade (S8) do último teste; `preview` nulo quando a leitura falhou. */
interface PreviewState {
  preview: PriorityPreview | null;
  error: boolean;
}

const integer = Validators.pattern(/^\d+$/);
/** Milissegundos de atraso ou de dribble: inteiro de 0 ao teto de 60 s. */
const ms = [Validators.required, Validators.min(0), Validators.max(DELAY_MAX_MS), integer];

/** Erro assim que o campo fica inválido, sem esperar o blur (JSON digitado e erros do servidor). */
const showAtOnce: ErrorStateMatcher = { isErrorState: (control) => !!control?.invalid };

/**
 * Editor de regra na página Rules (`region` "New rule" / "Edit rule {nome}"): a regra "em
 * palavras", as abas Match, Response, Scenario e Test num formulário tipado, e a visão "JSON" com a
 * regra crua. Salvar é o `PUT` da lista inteira; o 422 aparece no campo apontado pela chave em
 * notação de ponto, e o que não tem campo aparece no alerta do topo. Na aba Match, cada condição
 * diz como foi no último teste (`conditions` do `rules/test`) e nos near misses gravados.
 */
@Component({
  selector: 'app-rule-editor',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    RuleEditorHeader,
    RuleTabs,
    ConditionResultChip,
    AgainstHistory,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    MatSelect,
    MatOption,
    MatSlideToggle,
    MatButton,
    MatButtonToggleGroup,
    MatButtonToggle,
    HistoryTestPanel,
    RuleSuggest,
    NgTemplateOutlet,
    ScenarioPanel,
    RuleFromRequestPanel,
    RuleConditionHint,
    RuleBodyTools,
  ],
  templateUrl: './rule-editor.html',
  styleUrl: './rule-editor.scss',
  host: {
    '(document:keydown)': 'handleShortcut($event)',
    '(window:beforeunload)': 'warnBeforeUnload($event)',
    '[class.sheet]': '!wide()',
  },
})
export class RuleEditor {
  private readonly store = inject(RuleStore);
  private readonly drafts = inject(RuleDrafts);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  protected readonly tokens = inject(TokenStore);
  private readonly viewport = inject(Viewport);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** Largura grande: os helpers de template vêm abertos (RULES-23). */
  protected readonly wide = computed(() =>
    ['large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  /** A regra a editar; a página recria o editor quando ela muda. */
  readonly data = input.required<RuleEditorData>();
  /** Fecha o editor: `true` depois de salvar, `false` no Discard. */
  readonly closed = output<boolean>();
  /** "Delete rule": a página apaga a regra salva (com Undo) e fecha o editor. */
  readonly deleteRequested = output<string>();
  /** "Duplicate rule": a regra como está no editor; a página abre a cópia como regra nova. */
  readonly duplicateRequested = output<Rule>();
  protected readonly headingId = `rule-editor-heading-${nextEditorId++}`;
  /** Algo mudou desde a abertura (formulário, JSON ou sugestão aplicada): "Unsaved changes". */
  protected readonly unsaved = computed(() => {
    this.edits();
    return this.form.dirty || this.json.dirty || this.suggestionApplied();
  });
  private readonly suggestionApplied = signal(false);

  /** Regra de partida: o que o formulário não edita (`id`, `scenario`...) sai dela. */
  private base: Rule = newRule();
  /** A regra salva em edição, como estava ao abrir (`null` numa regra nova). */
  private readonly editing = signal<Rule | null>(null);
  /** `id` da regra salva em edição (fixo, mesmo que o JSON editado perca o campo). */
  private readonly editingId = signal<string | undefined>(undefined);
  /**
   * A regra salva em edição não está mais na lista (apagada ou reimportada com ids novos em outro
   * lugar): o Save a acrescenta como regra nova, com id novo, e a tela avisa antes.
   */
  protected readonly missingFromList = computed(() => {
    const id = this.editingId();
    return id !== undefined && !this.store.rules().some((rule) => rule.id === id);
  });
  /** Título com o nome salvo, fixo enquanto o nome é editado. */
  protected readonly title = signal($localize`New rule`);
  protected readonly methods = signal<string[]>(METHODS);

  protected readonly form = this.formBuilder.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    enabled: [true],
    priority: [0, [Validators.required, Validators.min(1), integer]],
    methods: [[] as string[]],
    pathMode: ['equals' as PathMode],
    // Vazio = qualquer caminho (WM-14).
    path: [''],
    query: this.formBuilder.array<ConditionGroup>([]),
    headers: this.formBuilder.array<ConditionGroup>([]),
    body: this.formBuilder.array<BodyGroup>([]),
    signature: ['any' as SignatureOption],
    schema: ['any' as SchemaOption],
    status: [0, [Validators.required, Validators.min(100), Validators.max(599), integer]],
    responseHeaders: this.formBuilder.array<HeaderGroup>([]),
    responseBody: [''],
    template: [false],
    delayType: ['none' as DelayType],
    delayFixed: [0, ms],
    delayMin: [0, ms],
    delayMax: [0, [...ms, notBelowMin]],
    delayMedian: [0, ms],
    delaySigma: [0, [Validators.required, Validators.min(0)]],
    dribble: [false],
    dribbleChunks: [
      0,
      [Validators.required, Validators.min(1), Validators.max(DRIBBLE_MAX_CHUNKS), integer],
    ],
    dribbleDuration: [0, ms],
    fault: ['none' as FaultOption],
    scenarioName: ['', Validators.maxLength(100)],
    requiredState: ['', Validators.maxLength(100)],
    newState: ['', Validators.maxLength(100)],
  });

  // Sugestões do cenário (`<datalist>`, que o navegador filtra pelo texto digitado): nomes e
  // estados que as regras da URL já citam. O `MatAutocomplete` traria operadores do RxJS para a
  // carga inicial (o `main` importa o `rxjs`), e o orçamento dela está no limite.
  private readonly typedName = toSignal(this.form.controls.scenarioName.valueChanges, {
    initialValue: '',
  });
  protected readonly nameSuggestions = computed(() => scenarioNames(this.store.rules()));
  protected readonly stateSuggestions = computed(() =>
    scenarioStates(this.store.rules(), this.typedName().trim()),
  );
  protected readonly json = this.formBuilder.control('', ruleJsonValidator);

  protected readonly view = signal(FORM_VIEW);
  /** "Form" clicado com o JSON inválido (WM-04): o primeiro erro, para "To go back to the form, fix:". */
  protected readonly backToFormError = signal<string | null>(null);
  /**
   * Mensagem de exemplo (WM-16, E-12): a de `?from=` ou a aberta na Inbox, senão a mais nova da
   * URL; `null` sem nenhuma.
   */
  protected readonly example = signal<WebhookRequest | null>(null);
  protected readonly approxTitle = $localize`Checked in the browser against the example request; the server decides (Test against history).`;
  protected readonly tab = signal<EditorTab>('match');
  /** Muda a cada edição do formulário ou do JSON: recalcula a frase e o aviso do caminho. */
  private readonly edits = signal(0);
  protected readonly saving = signal(false);
  /** O último Save ou Test achou o formulário inválido: o resumo fica até ele voltar a valer. */
  private readonly blocked = signal<Blocked | null>(null);
  /** "To save, fix: Path (required), Status (100–599)", enquanto houver o que corrigir. */
  protected readonly blockedMessage = computed(() => {
    const kind = this.blocked();
    this.edits();
    const fields = kind ? this.currentInvalid().map(({ label }) => label) : [];
    if (fields.length === 0) {
      return null;
    }
    const list = fields.join(', ');
    return kind === 'save'
      ? $localize`To save, fix: ${list}:fields:`
      : $localize`To test, fix: ${list}:fields:`;
  });
  /** Rascunho desta regra guardado na aba, oferecido ao abrir (E-04); some ao editar. */
  protected readonly draftOffer = signal<RuleDraft | null>(null);
  /** Saída já confirmada (ou salva): nada mais pergunta nem grava rascunho. */
  private leaving = false;
  private confirming: Promise<boolean> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  /** O último Save achou a lista do servidor diferente da lida: nada foi gravado. */
  protected readonly changedElsewhere = signal(false);
  /** Erros do servidor sem campo no formulário (ou de outras regras da lista). */
  protected readonly generalErrors = signal<readonly string[]>([]);
  /** Último "Test against history" da regra como está; some quando a regra muda. */
  protected readonly historyTest = signal<HistoryTest | null>(null);
  protected readonly historyErrors = signal<readonly string[]>([]);
  protected readonly testing = signal(false);
  protected readonly preview = signal<PreviewState | null>(null);
  /** As mensagens da janela do teste (a aba Test descreve cada uma e abre ao lado, WM-22). */
  protected readonly recent = signal<ReadonlyMap<string, WebhookRequest>>(new Map());
  /** A mensagem do resultado aberta ao lado, dentro de Regras (`region "Request {id}"`). */
  protected readonly openedRequest = signal<WebhookRequest | null>(null);
  /** O detalhe da mensagem (o da Inbox, só leitura), carregado na primeira vez que abre. */
  protected readonly requestView = signal<Type<unknown> | null>(null);
  private readonly requestHost = viewChild('requestHost', { read: ViewContainerRef });
  /** "Preview response" (C4): buscando, e as respostas da última busca. */
  protected readonly rendering = signal(false);
  private readonly rendered = signal<readonly RenderedResponse[] | null>(null);
  private readonly renderedView = signal<Type<unknown> | null>(null);
  private readonly renderedHost = viewChild('renderedHost', { read: ViewContainerRef });
  /** As condições (o `match`) do último resultado: mudou, o resultado fica "Out of date". */
  private readonly testedMatch = signal<string | null>(null);
  /** O teste já foi pedido uma vez: a partir daí, mudar condição reroda sozinho. */
  private testRequested = false;
  /** As condições do teste pedido por último (em curso ou agendado): não pede de novo o mesmo. */
  private lastRunMatch: string | null = null;
  /** O teste agendado (rerun) e o que está em curso: um pedido novo cancela os dois. */
  private testTimer: ReturnType<typeof setTimeout> | undefined;
  private testRun: Subscription | null = null;
  protected readonly outOfDate = computed(() => {
    this.edits();
    this.view();
    return !!this.historyTest() && this.testedMatch() !== matchKey(this.editedRule());
  });
  /** Near misses gravados desta regra, por condição (só editando uma regra salva). */
  protected readonly recorded = signal<ConditionTally | null>(null);
  protected readonly tokenId = this.store.tokenId;

  /** A regra "em palavras", da visão aberta, em pedaços com destaque; `null` com o JSON inválido. */
  /** A regra da visão aberta, a cada edição (a lista de mudanças da sugestão, E-13). */
  protected readonly currentRule = computed(() => {
    this.edits();
    this.view();
    return this.editedRule();
  });
  protected readonly words = computed(() => {
    this.edits();
    this.view();
    const rule = this.editedRule();
    return rule ? ruleWordSegments(rule) : null;
  });
  /** Caminho sem o token da URL, quando o caminho escrito começa com ele (nunca casaria). */
  protected readonly pathFix = computed(() => {
    this.edits();
    const { pathMode, path } = this.form.controls;
    return this.view() === FORM_VIEW && path.value !== '' && pathMode.value !== 'regex'
      ? pathWithoutToken(path.value, this.tokenId() ?? '')
      : null;
  });
  /** Falhas do último teste por condição (`misses[].conditions`, ou a frase no servidor antigo). */
  private readonly tested = computed(() => {
    const result = this.historyTest();
    return result && result.tested > 0
      ? { tested: result.tested, tally: tallyConditions(result.misses, this.editedRule()) }
      : null;
  });
  /** As regras da URL com este rascunho no lugar dele (diagramas da aba Scenario). */
  protected readonly draftRules = computed(() => {
    this.edits();
    const rules = [...this.store.rules()];
    if (this.view() === FORM_VIEW) {
      rules[this.currentIndex() ?? rules.length] = this.formRule();
    }
    return rules;
  });
  protected readonly historyWindow = HISTORY_TEST_WINDOW;
  /** Selos das abas: o status da resposta e, depois de um teste, "casam / testadas". */
  protected readonly tabBadges = computed(() => {
    const result = this.historyTest();
    return {
      response: this.responseBadge(),
      ...(result && { test: `${result.matched} / ${result.tested}` }),
    };
  });
  protected readonly responseBadge = computed(() => {
    this.edits();
    const { fault, status } = this.form.controls;
    return fault.value !== 'none' ? 'fault' : String(status.value ?? RULE_DEFAULT_STATUS);
  });
  protected readonly conditionSections = [
    { list: 'query', title: $localize`Query` },
    { list: 'headers', title: $localize`Headers` },
  ] as const;
  protected readonly valueOperators: { value: ValueOperator; label: string }[] = [
    { value: 'equals', label: $localize`equals` },
    { value: 'contains', label: $localize`contains` },
    { value: 'regex', label: $localize`matches regex (whole value)` },
    { value: 'present', label: $localize`is present` },
    { value: 'absent', label: $localize`is absent` },
  ];
  protected readonly bodyTypes: { value: BodyType; label: string }[] = [
    { value: 'equals', label: $localize`Equals` },
    { value: 'contains', label: $localize`Contains` },
    { value: 'regex', label: $localize`Matches regex (whole value)` },
    { value: 'jsonPath', label: 'JSONPath' },
    { value: 'equalToJson', label: $localize`Equal to JSON` },
  ];
  protected readonly signatureOptions: { value: SignatureOption; label: string }[] = [
    { value: 'any', label: $localize`Any` },
    { value: 'valid', label: $localize`Valid` },
    { value: 'invalid', label: $localize`Invalid` },
    { value: 'absent', label: $localize`Absent` },
  ];
  protected readonly schemaOptions: { value: SchemaOption; label: string }[] = [
    { value: 'any', label: $localize`Any` },
    { value: 'valid', label: $localize`Valid` },
    { value: 'invalid', label: $localize`Invalid` },
  ];
  protected readonly delayTypes: { value: DelayType; label: string }[] = [
    { value: 'none', label: $localize`None` },
    { value: 'fixed', label: $localize`Fixed` },
    { value: 'uniform', label: $localize`Uniform` },
    { value: 'lognormal', label: $localize`Log-normal` },
  ];
  protected readonly faults: { value: FaultOption; label: string }[] = [
    { value: 'none', label: $localize`None` },
    ...RULE_FAULTS.map((fault) => ({ value: fault, label: FAULT_LABELS[fault] })),
  ];
  protected readonly delayMax = DELAY_MAX_MS;
  protected readonly msError = $localize`An integer between 0 and ${DELAY_MAX_MS} (ms).`;
  /** Mensagens de validação quando o servidor não mandou a dele (`errorOf`). */
  protected readonly messages = {
    nameRequired: $localize`The name is required.`,
    priority: $localize`The priority must be an integer of at least 1.`,
    jsonPathRequired: $localize`The JSONPath is required.`,
    validJson: $localize`The value must be valid JSON.`,
    status: $localize`The status must be an integer between 100 and 599.`,
    delayMax: $localize`At least the min, up to 60000 (ms).`,
    sigma: $localize`A number of at least 0.`,
    chunks: $localize`An integer between 1 and 100.`,
    upTo100: $localize`Up to 100 characters.`,
  };
  protected readonly showAtOnce = showAtOnce;
  protected readonly formView = FORM_VIEW;
  protected readonly jsonView = JSON_VIEW;

  constructor() {
    const { fault, delayType, dribble, scenarioName, delayMin, delayMax } = this.form.controls;
    for (const control of [fault, delayType, dribble] as AbstractControl[]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncResponse());
    }
    scenarioName.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncScenario());
    delayMin.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => delayMax.updateValueAndValidity());
    merge(this.form.valueChanges, this.json.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.edits.update((n) => n + 1);
        this.rerunIfConditionsChanged();
        this.draftOffer.set(null);
        this.scheduleDraft();
      });
    // Erros do servidor mudam a validade sem mudar o valor: o resumo do Save acompanha.
    merge(this.form.statusChanges, this.json.statusChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.edits.update((n) => n + 1);
        if (this.editedValid()) {
          this.blocked.set(null);
        }
      });
    // A mensagem aberta ao lado: o detalhe da Inbox, criado à mão (sem @defer, que levaria o
    // mecanismo de carga adiada para o pacote inicial).
    effect(() => {
      const [host, view, request] = [this.requestHost(), this.requestView(), this.openedRequest()];
      if (host && view && request) {
        untracked(() => {
          host.clear();
          const ref = host.createComponent(view);
          ref.setInput('request', request);
          ref.setInput('token', this.tokens.token());
          ref.setInput('readonly', true);
        });
      }
    });
    // As respostas renderizadas (C4), no mesmo esquema: criadas à mão, sob demanda.
    effect(() => {
      const [host, view, rendered, recent] = [
        this.renderedHost(),
        this.renderedView(),
        this.rendered(),
        this.recent(),
      ];
      if (!host) {
        return;
      }
      untracked(() => {
        host.clear();
        if (view && rendered) {
          const ref = host.createComponent(view);
          ref.setInput('responses', rendered);
          ref.setInput('requests', recent);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.testTimer);
      this.testRun?.unsubscribe();
      // A aba fechou (ou a URL trancou) no meio do debounce: o rascunho sai agora.
      if (this.draftTimer !== undefined) {
        clearTimeout(this.draftTimer);
        this.writeDraft();
      }
    });
    effect(() => {
      const data = this.data();
      untracked(() => this.start(data));
    });
    // Os hits chegam depois da lista (link direto para a regra): os near misses gravados esperam por eles.
    effect(() => {
      const rule = this.editing();
      const hits = this.store.hits();
      if (rule?.id && hits) {
        untracked(() => void this.loadRecorded(rule));
      }
    });
  }

  private start(data: RuleEditorData): void {
    const saved = data.index === null ? undefined : this.store.rules()[data.index];
    this.base = saved ?? data.draft ?? newRule();
    this.editingId.set(saved?.id);
    this.title.set(saved ? $localize`Edit rule ${saved.name}` : $localize`New rule`);
    this.methods.set([
      ...METHODS,
      ...(this.base.match?.method ?? []).filter((method) => !METHODS.includes(method)),
    ]);
    this.loadForm(this.base);
    this.edits.update((n) => n + 1);
    this.editing.set(saved ?? null);
    this.offerDraft(saved?.id);
    this.example.set(data.example ?? null);
    if (!data.example) {
      void this.store.exampleRequest().then((request) => {
        if (this.data() === data) {
          this.example.set(request);
        }
      });
    }
  }

  /** O rascunho desta regra na aba, se ele difere do que abriu (senão, não há o que restaurar). */
  private offerDraft(ruleId: string | undefined): void {
    const tokenId = this.tokenId();
    const draft = tokenId ? this.drafts.load(tokenId, ruleId) : null;
    const same =
      !!draft && JSON.stringify(draft.rule) === JSON.stringify(withoutSecrets(this.base).rule);
    if (same && tokenId) {
      this.drafts.clear(tokenId, ruleId);
    }
    this.draftOffer.set(draft && !same ? draft : null);
  }

  /** "3 minutes ago", para "You have a draft from 3 minutes ago." */
  protected draftAge(draft: RuleDraft): string {
    return fromNow(new Date(draft.savedAt).toISOString().slice(0, 19).replace('T', ' '));
  }

  /** "Restore draft": o rascunho volta como alteração não salva, e o foco vai ao nome. */
  protected restoreDraft(): void {
    const draft = this.draftOffer();
    if (!draft) {
      return;
    }
    const id = this.editingId();
    this.base = id === undefined ? draft.rule : { ...draft.rule, id };
    this.loadForm(this.base);
    this.form.markAsDirty();
    if (this.view() === JSON_VIEW) {
      this.json.setValue(JSON.stringify(this.formRule(), null, 2));
      this.json.markAsDirty();
    }
    this.draftOffer.set(null);
    this.edits.update((n) => n + 1);
    const target = this.view() === JSON_VIEW ? '.json textarea' : '.name-input';
    afterNextRender(() => this.host.querySelector<HTMLElement>(target)?.focus(), {
      injector: this.injector,
    });
  }

  /** "Discard draft": o rascunho sai da aba. */
  protected discardDraft(): void {
    const tokenId = this.tokenId();
    if (tokenId) {
      this.drafts.clear(tokenId, this.editingId());
    }
    this.draftOffer.set(null);
  }

  /** Grava o rascunho 300 ms depois da última mudança, só com alterações não salvas. */
  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (this.leaving || !this.unsaved()) {
      return;
    }
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      this.writeDraft();
    }, 300);
  }

  private writeDraft(): void {
    const tokenId = this.tokenId();
    const rule = this.editedRule();
    if (tokenId && rule && !this.leaving) {
      this.drafts.save(tokenId, this.editingId(), rule);
    }
  }

  /**
   * Saída do editor (outra regra, rail, rota, Discard, Esc): sem alterações, sai; com elas,
   * "Discard changes?" decide. Descartar de propósito apaga o rascunho da aba.
   */
  confirmLeave(): Promise<boolean> {
    if (this.leaving || !this.unsaved()) {
      return Promise.resolve(true);
    }
    // A regra salva pelo nome salvo (o da lista); a nova, pelo que já tem no campo.
    const name =
      this.editing()?.name || this.form.controls.name.value.trim() || $localize`New rule`;
    // O diálogo (e o MatDialog) vêm sob demanda: ficam fora do pedaço de Regras.
    this.confirming ??= import('./rule-dialogs')
      .then(({ confirmDiscard }) => confirmDiscard(this.injector, name))
      .then((discard) => {
        this.confirming = null;
        if (discard) {
          this.leave();
        }
        return discard;
      });
    return this.confirming;
  }

  /** Daqui em diante o editor fecha: sem pergunta, e o rascunho sai da aba. */
  private leave(): void {
    this.leaving = true;
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    const tokenId = this.tokenId();
    if (tokenId) {
      this.drafts.clear(tokenId, this.editingId());
    }
  }

  /**
   * Atalhos do editor (WM-13), com o foco em qualquer campo: Ctrl/Cmd+S salva, Ctrl/Cmd+Enter
   * testa, Esc fecha. Com um diálogo aberto, nada; o Esc que já fechou uma folha, um diálogo ou
   * uma lista de opções (evento tratado) não fecha o editor.
   */
  protected handleShortcut(event: KeyboardEvent): void {
    if (this.document.querySelector('mat-dialog-container')) {
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveRule();
    } else if (modifier && event.key === 'Enter') {
      event.preventDefault();
      void this.testAgainstHistory();
    } else if (event.key === 'Escape' && !modifier && !event.defaultPrevented) {
      void this.cancel();
    }
  }

  /** Fechar ou recarregar a aba com alterações não salvas: o navegador pergunta. */
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.leaving && this.unsaved()) {
      event.preventDefault();
    }
  }

  /**
   * Os near misses gravados desta regra na janela das mensagens recentes, por condição. Só lê as
   * mensagens quando os hits dizem que há near miss dela (a leitura custa até 5 páginas).
   */
  private async loadRecorded(rule: Rule): Promise<void> {
    const count = this.store.hits()?.near_miss.find(({ id }) => id === rule.id)?.count ?? 0;
    if (count === 0) {
      return;
    }
    try {
      const misses = (await this.store.recentRequests())
        .map((request) => request.near_miss)
        .filter((miss) => miss?.id === rule.id)
        .map((miss) => ({ failed: miss?.failed ?? [], conditions: miss?.conditions }));
      this.recorded.set(misses.length ? tallyConditions(misses, rule) : null);
    } catch {
      this.recorded.set(null);
    }
  }

  protected selectTab(tab: EditorTab): void {
    this.tab.set(tab);
  }

  /**
   * Relê a lista depois do aviso "changed elsewhere". O rascunho fica no editor; o próximo Save o
   * põe na lista nova (pelo `id` da regra em edição, ou no fim se é nova). Prioridade e enabled
   * que o editor não tocou passam a ser os da lista nova (outra aba pode tê-los mudado).
   */
  protected async reloadRules(): Promise<void> {
    try {
      await this.store.reload();
      this.changedElsewhere.set(false);
      const saved = this.store.rules().find((rule) => rule.id === this.editingId());
      if (saved) {
        this.takeUntouched(saved);
      }
    } catch (error) {
      this.generalErrors.set(validationMessages(error));
    }
  }

  /** Prioridade e enabled da regra salva, onde o formulário (ou o JSON) não os mudou. */
  private takeUntouched(saved: Rule): void {
    const { priority, enabled } = this.form.controls;
    const untouched: Partial<Rule> = {};
    if (!priority.dirty) {
      untouched.priority = saved.priority;
      priority.setValue(saved.priority ?? RULE_DEFAULT_PRIORITY, { emitEvent: false });
    }
    if (!enabled.dirty) {
      untouched.enabled = saved.enabled;
      enabled.setValue(saved.enabled ?? true, { emitEvent: false });
    }
    this.base = { ...this.base, ...untouched };
    this.edits.update((n) => n + 1);
  }

  /** A regra em edição está desligada: a prévia diz o que ela casaria, mas ela não responde. */
  protected ruleOff(): boolean {
    return this.editedRule()?.enabled === false;
  }

  /** Discard e Esc: pergunta antes de perder alterações. */
  protected async cancel(): Promise<void> {
    if (await this.confirmLeave()) {
      this.closed.emit(false);
    }
  }

  /** "Duplicate rule": a cópia parte da regra como está no editor. */
  protected duplicateRule(): void {
    const rule = this.editedRule();
    if (rule) {
      this.duplicateRequested.emit(rule);
    }
  }

  /** Só uma regra salva, que ainda está na lista, pode ser apagada daqui. */
  protected canDelete(): boolean {
    return this.editingId() !== undefined && !this.missingFromList();
  }

  protected deleteRule(): void {
    const id = this.editingId();
    if (id !== undefined) {
      this.deleteRequested.emit(id);
    }
  }

  /** Tira o token da URL do começo do caminho (o caminho da regra é relativo à URL). */
  protected removeTokenFromPath(): void {
    const fixed = this.pathFix();
    if (fixed !== null) {
      this.form.controls.path.setValue(fixed);
    }
  }

  /** Nomes acessíveis de uma linha de condição (n a partir de 1). */
  protected conditionLabels(list: 'query' | 'headers', n: number) {
    return list === 'query'
      ? {
          name: $localize`Query ${n}:number: name`,
          operator: $localize`Query ${n}:number: operator`,
          value: $localize`Query ${n}:number: value`,
          remove: $localize`Remove query ${n}:number:`,
        }
      : {
          name: $localize`Header ${n}:number: name`,
          operator: $localize`Header ${n}:number: operator`,
          value: $localize`Header ${n}:number: value`,
          remove: $localize`Remove header ${n}:number:`,
        };
  }

  /** Nomes acessíveis de uma condição do corpo (n a partir de 1). */
  protected bodyLabels(n: number) {
    return {
      type: $localize`Body ${n}:number: type`,
      path: $localize`Body ${n}:number: path`,
      equals: $localize`Body ${n}:number: equals`,
      value: $localize`Body ${n}:number: value`,
      remove: $localize`Remove body ${n}:number:`,
    };
  }

  /** Nomes acessíveis de um cabeçalho da resposta (n a partir de 1). */
  protected responseHeaderLabels(n: number) {
    return {
      name: $localize`Response header ${n}:number: name`,
      value: $localize`Response header ${n}:number: value`,
      remove: $localize`Remove response header ${n}:number:`,
    };
  }

  /**
   * O chip de uma condição (RULES-18): sem condição, "No condition"; com ela, depois de um teste,
   * "Passes 196/200" ou "Fails on 4/200"; antes do teste, nada.
   */
  protected result(key: ConditionKey, hasCondition: boolean): ConditionResult | null {
    if (!hasCondition) {
      return { kind: 'none', text: $localize`No condition` };
    }
    const tested = this.tested();
    if (!tested) {
      return null;
    }
    const failed = tested.tally.counts.get(key) ?? 0;
    const total = tested.tested;
    return failed > 0
      ? { kind: 'fails', text: $localize`Fails on ${failed}:failed:/${total}:tested:` }
      : { kind: 'passes', text: $localize`Passes ${total - failed}:passed:/${total}:tested:` };
  }

  /** Os métodos como chips (RULES-17): liga ou desliga um; nenhum ligado é qualquer método. */
  protected toggleMethod(method: string): void {
    const control = this.form.controls.methods;
    const current = control.value;
    // Sujo antes do valor: quem ouve a mudança (o rascunho) já a vê como alteração.
    control.markAsDirty();
    control.setValue(
      current.includes(method) ? current.filter((m) => m !== method) : [...current, method],
    );
  }

  /** De onde vem o resultado da assinatura: o provedor da URL, ou "not set up". */
  protected signatureOrigin(): string {
    const provider = this.tokens.token()?.signature?.provider;
    return provider ? SIGNATURE_PROVIDER_LABELS[provider] : $localize`not set up`;
  }

  /** De onde vem o resultado do schema: "JSON Schema" com um salvo na URL, ou "not validated". */
  /**
   * A condição exige assinatura (ou schema) e a URL não verifica: a regra nunca casa (E-11, J3).
   * Com a URL ainda não lida, nada se afirma.
   */
  protected neverMatches(kind: 'signature' | 'schema'): boolean {
    const token = this.tokens.token();
    if (!token || this.form.controls[kind].value === 'any') {
      return false;
    }
    return kind === 'signature' ? !token.signature?.provider : !token.schema;
  }

  protected schemaOrigin(): string {
    return this.tokens.token()?.schema ? $localize`JSON Schema` : $localize`not validated`;
  }

  /** Erro do servidor num controle sem `mat-form-field` (os segmentados). */
  protected serverError(control: AbstractControl): string | null {
    return (control.getError('server') as string | undefined) ?? null;
  }

  /** Quantos near misses gravados desta regra falharam na condição. */
  protected recordedMisses(key: ConditionKey): number {
    return this.recorded()?.counts.get(key) ?? 0;
  }

  protected rowKey(list: 'query' | 'headers', row: AbstractControl): ConditionKey {
    return `match.${list}.${(row.get('name')?.value as string | undefined) ?? ''}`;
  }

  /** Com falha escolhida, o servidor ignora status, headers, corpo, atraso e dribble. */
  protected faulted(): boolean {
    return this.form.controls.fault.value !== 'none';
  }

  protected addCondition(list: 'query' | 'headers'): void {
    this.form.controls[list].push(this.conditionGroup({ name: '', operator: 'equals', value: '' }));
  }

  /** "Add body field (JSONPath)": a condição mais comum do corpo (WM-14). */
  protected addBodyField(): void {
    this.form.controls.body.push(
      this.bodyGroup({ type: 'jsonPath', value: '', path: '', equals: '' }),
    );
  }

  /** "Require invalid signature": o segmentado da assinatura vai para Invalid. */
  protected requireInvalidSignature(): void {
    const signature = this.form.controls.signature;
    signature.markAsDirty();
    signature.setValue('invalid');
  }

  protected addBodyCondition(): void {
    this.form.controls.body.push(
      this.bodyGroup({ type: 'contains', value: '', path: '', equals: '' }),
    );
  }

  protected addResponseHeader(header: HeaderRow): void {
    const headers = this.form.controls.responseHeaders;
    headers.markAsDirty();
    headers.push(this.headerGroup(header));
  }

  protected removeRow(list: 'query' | 'headers' | 'body' | 'responseHeaders', index: number): void {
    this.form.controls[list].removeAt(index);
  }

  /**
   * Formulário → JSON mostra a regra montada; JSON → formulário leva o JSON editado (o botão
   * "Form" fica desabilitado enquanto o JSON é inválido).
   */
  protected switchView(index: number, group: MatButtonToggleGroup): void {
    this.backToFormError.set(null);
    if (index === JSON_VIEW) {
      this.json.setValue(JSON.stringify(this.formRule(), null, 2));
    } else {
      const { rule, errors } = parseRuleJson(this.json.value);
      if (!rule) {
        // "Form" nunca desabilitado (WM-04): fica no JSON e diz o que corrigir.
        group.value = JSON_VIEW;
        this.backToFormError.set(errors[0] ?? null);
        afterNextRender(() => this.host.querySelector<HTMLElement>('.json textarea')?.focus(), {
          injector: this.injector,
        });
        return;
      }
      this.base = rule;
      this.loadForm(rule);
    }
    this.view.set(index);
  }

  /** O valor da mensagem de exemplo no cabeçalho ou na query da condição (testador, E-12). */
  protected exampleValue(list: 'query' | 'headers', name: string): string | null {
    const request = this.example();
    if (!request || name.trim() === '') {
      return null;
    }
    return list === 'headers' ? exampleHeader(request, name) : exampleQuery(request, name);
  }

  protected examplePathValue(): string | null {
    const request = this.example();
    return request ? examplePath(request) : null;
  }

  /** O que o JSONPath simples acha no corpo da mensagem de exemplo; `null` sem o que dizer. */
  protected exampleAtPath(path: string): string | null {
    const request = this.example();
    if (!request || path.trim() === '') {
      return null;
    }
    const found = valueAtPath(request.content ?? '', path);
    if (found.kind === 'unsupported') {
      return $localize`Can't check here — test against history.`;
    }
    return found.kind === 'found'
      ? $localize`In this request: ${JSON.stringify(found.value)}:value: · approx.`
      : $localize`Not in this request · approx.`;
  }

  /** Como o "Equals (JSON)" leu o texto ("Read as number 10"); `null` vazio. */
  protected readAsText(input: string): string | null {
    const read = readAs(input);
    if (!read) {
      return null;
    }
    if (read.kind === 'json') {
      return $localize`Read as JSON`;
    }
    return read.kind === 'number'
      ? $localize`Read as number ${read.text}:value:`
      : $localize`Read as text "${read.text}:value:"`;
  }

  /** "Use contains": a regex que não cobre o valor inteiro vira "contém", com o mesmo texto. */
  protected useContains(operator: AbstractControl): void {
    operator.markAsDirty();
    operator.setValue('contains');
  }

  /**
   * Campo de "From this request" na aba Match: vira a condição (cabeçalho ou query igual, JSONPath
   * igual) com o valor da mensagem; um segundo clique não duplica, só leva o foco à existente.
   */
  protected useField(field: ExampleField): void {
    if (field.kind === 'body') {
      const rows = this.form.controls.body.controls;
      let index = rows.findIndex(
        (row) => row.controls.type.value === 'jsonPath' && row.controls.path.value === field.path,
      );
      if (index < 0) {
        this.form.controls.body.markAsDirty();
        this.form.controls.body.push(
          this.bodyGroup({
            type: 'jsonPath',
            value: '',
            path: field.path,
            equals: JSON.stringify(field.value),
          }),
        );
        index = rows.length - 1;
      }
      this.focusRow('body', index, 'equals');
      return;
    }
    const list = field.kind === 'header' ? 'headers' : 'query';
    const same = (name: string) =>
      list === 'headers' ? name.toLowerCase() === field.path.toLowerCase() : name === field.path;
    const rows = this.form.controls[list].controls;
    let index = rows.findIndex((row) => same(row.controls.name.value));
    if (index < 0) {
      this.form.controls[list].markAsDirty();
      this.form.controls[list].push(
        this.conditionGroup({ name: field.path, operator: 'equals', value: String(field.value) }),
      );
      index = rows.length - 1;
    }
    this.focusRow(list, index, 'value');
  }

  /** Foco no campo de uma linha de condição, depois do render em que ela aparece. */
  private focusRow(list: 'query' | 'headers' | 'body', index: number, field: string): void {
    afterNextRender(
      () => {
        const rows = this.host.querySelectorAll(`#rule-panel-match [data-list="${list}"] .row`);
        rows.item(index)?.querySelector<HTMLElement>(`[formcontrolname="${field}"]`)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Campo de "From this request" na aba Response: o helper dele no cursor do corpo. */
  protected insertField(field: ExampleField): void {
    const snippet = {
      header: `{{request.headers.${field.path}}}`,
      query: `{{request.query.${field.path}}}`,
      body: `{{jsonPath request.body '${field.path}'}}`,
    }[field.kind];
    this.insertIntoBody(snippet);
  }

  /** Insere no cursor do corpo da resposta (ou no fim), e o cursor fica depois do trecho. */
  protected insertIntoBody(snippet: string): void {
    const control = this.form.controls.responseBody;
    if (control.disabled) {
      return;
    }
    const area = this.host.querySelector<HTMLTextAreaElement>(
      '#rule-panel-response textarea[formcontrolname="responseBody"]',
    );
    const text = control.value;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? start;
    control.markAsDirty();
    control.setValue(text.slice(0, start) + snippet + text.slice(end));
    const caret = start + snippet.length;
    afterNextRender(
      () => {
        area?.focus();
        area?.setSelectionRange(caret, caret);
      },
      { injector: this.injector },
    );
  }

  /** "Format JSON". */
  protected setBody(text: string): void {
    const control = this.form.controls.responseBody;
    control.markAsDirty();
    control.setValue(text);
  }

  /** A resposta já declara Content-Type (a sugestão some). */
  protected hasContentType(): boolean {
    return this.form.controls.responseHeaders.controls.some(
      (row) => row.controls.name.value.trim().toLowerCase() === 'content-type',
    );
  }

  /** O content type padrão da URL (Checks › Response). */
  protected defaultContentType(): string | null {
    return this.tokens.token()?.default_content_type ?? null;
  }

  /**
   * A regra do "Describe the rule" entra no editor (na visão aberta) sem salvar. Editando uma
   * regra salva, ela fica com o `id` dessa regra.
   */
  protected applySuggestion({ rule, conditionsOnly }: SuggestionApply): void {
    const previous = this.editedRule() ?? this.base;
    const id = this.editingId();
    const next = conditionsOnly ? { ...previous, match: rule.match } : rule;
    this.replaceRule(id === undefined ? next : { ...next, id });
    this.snackBar
      .open($localize`Suggestion applied`, $localize`Undo`, { duration: 5000 })
      .onAction()
      .subscribe(() => this.replaceRule(previous));
  }

  /** A regra inteira no editor (na visão aberta), como alteração não salva. */
  private replaceRule(rule: Rule): void {
    this.suggestionApplied.set(true);
    this.base = rule;
    this.generalErrors.set([]);
    this.loadForm(rule);
    if (this.view() === JSON_VIEW) {
      this.json.setValue(JSON.stringify(this.formRule(), null, 2));
    }
  }

  /** Os botões de testar dos painéis só esperam o teste em curso; inválido, o clique explica. */
  protected canTest(): boolean {
    return !this.testing();
  }

  /**
   * Save ou Test com o formulário inválido (WM-12): os erros aparecem, a aba do primeiro campo
   * inválido abre, o foco vai a ele e o resumo "To save, fix: …" fica abaixo do cabeçalho.
   */
  private block(kind: Blocked): void {
    this.form.markAllAsTouched();
    this.json.markAsTouched();
    this.blocked.set(kind);
    this.edits.update((n) => n + 1);
    const first = this.currentInvalid()[0];
    if (first?.tab) {
      this.tab.set(first.tab);
    }
    afterNextRender(() => this.focusInvalid(first), { injector: this.injector });
  }

  private focusInvalid(first: InvalidField | undefined): void {
    let target: HTMLElement | null | undefined;
    if (this.view() === JSON_VIEW) {
      target = this.host.querySelector<HTMLElement>('.json textarea');
    } else {
      const scope = first?.tab
        ? this.host.querySelector(`#rule-panel-${first.tab}`)
        : this.host.querySelector('app-rule-editor-header');
      target =
        scope?.querySelector<HTMLElement>(INVALID_CONTROL) ??
        scope?.querySelector<HTMLElement>('.chips button');
    }
    target?.focus();
  }

  /** Campos inválidos da visão aberta; no JSON, a primeira frase da validação dele. */
  private currentInvalid(): InvalidField[] {
    if (this.view() === JSON_VIEW) {
      const [error] = this.jsonErrors();
      return this.json.invalid ? [{ tab: null, label: `${$localize`Rule JSON`} (${error})` }] : [];
    }
    return invalidFields(this.form);
  }

  /** `rules/test` com a regra como está no editor (formulário ou JSON), sem salvar. */
  protected testAgainstHistory(): void {
    if (this.testing()) {
      return;
    }
    const rule = this.editedValid() ? this.editedRule() : undefined;
    if (!rule) {
      this.block('test');
      return;
    }
    this.tab.set('test');
    this.testRequested = true;
    this.lastRunMatch = matchKey(rule);
    this.scheduleTest(0);
  }

  /** Um teste por vez (WM-22): o pedido novo cancela o agendado e o que está em curso. */
  private scheduleTest(delay: number): void {
    clearTimeout(this.testTimer);
    this.testTimer = setTimeout(() => this.runTest(), delay);
  }

  /**
   * Rerun (WM-22): só depois de um teste pedido, só quando as condições mudam e o formulário vale,
   * 1 s depois da última mudança. Nome, prioridade, ligada, resposta e cenário não reprovam o
   * resultado.
   */
  private rerunIfConditionsChanged(): void {
    if (!this.testRequested || !this.editedValid()) {
      return;
    }
    const key = matchKey(this.editedRule());
    if (key !== this.lastRunMatch) {
      this.lastRunMatch = key;
      this.scheduleTest(RERUN_DELAY_MS);
    }
  }

  /**
   * `rules/test` com a regra como está agora. O resultado anterior fica até o novo chegar; o erro
   * (422) aparece ao lado dele.
   */
  private runTest(): void {
    this.testRun?.unsubscribe();
    const rule = this.editedValid() ? this.editedRule() : undefined;
    if (!rule) {
      this.testing.set(false);
      return;
    }
    this.testing.set(true);
    this.historyErrors.set([]);
    this.testRun = this.store.testRule$(rule).subscribe({
      next: (result) => {
        this.testing.set(false);
        this.historyTest.set(result);
        this.rendered.set(null);
        this.testedMatch.set(matchKey(rule));
        this.preview.set(null);
        if (result.tested > 0) {
          void this.loadRecent();
        }
        if (result.matched > 0) {
          void this.previewOf(rule, result).then((state) => {
            if (this.historyTest() === result) {
              this.preview.set(state);
            }
          });
        }
      },
      error: (error: unknown) => {
        this.testing.set(false);
        this.historyErrors.set(testMessages(error));
      },
    });
  }

  /**
   * "Preview response" (C4): a resposta que a regra, como está, daria às até 3 mensagens mais novas
   * que ela casa. Só sob pedido; o componente das respostas vem por import() na primeira vez.
   */
  protected async previewResponse(): Promise<void> {
    const rule = this.editedValid() ? this.editedRule() : undefined;
    if (!rule) {
      this.block('test');
      return;
    }
    this.rendering.set(true);
    this.historyErrors.set([]);
    try {
      const [view, responses] = await Promise.all([
        this.renderedView() ?? import('./rule-rendered').then(({ RuleRendered }) => RuleRendered),
        this.store.renderRule(rule),
      ]);
      this.renderedView.set(view);
      this.rendered.set(responses);
    } catch (error) {
      this.historyErrors.set(testMessages(error));
    } finally {
      this.rendering.set(false);
    }
  }

  /** "{method} {path} · {time}" no resultado: abre a mensagem ao lado, sem sair da regra. */
  protected openRequest(uuid: string): void {
    const request = this.recent().get(uuid);
    if (request) {
      this.openedRequest.set(request);
      if (!this.requestView()) {
        void import('../request-detail/request-view').then(({ RequestView }) =>
          this.requestView.set(RequestView),
        );
      }
      afterNextRender(() => this.host.querySelector<HTMLElement>('.opened-request h3')?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected openedLabel(request: WebhookRequest): string {
    return $localize`Request ${request.uuid}:uuid:`;
  }

  /**
   * Prévia com prioridade (S8): a regra que respondeu cada mensagem casada vem das mensagens
   * recentes (a mesma janela de 500 do `rules/test`).
   */
  private async previewOf(rule: Rule, result: HistoryTest): Promise<PreviewState | null> {
    try {
      const answeredBy = new Map(
        (await this.store.recentRequests()).map((request) => [request.uuid, request.rule ?? null]),
      );
      if (this.historyTest() !== result) {
        return null;
      }
      const index = this.currentIndex();
      return {
        preview: priorityPreview(this.store.rules(), rule, index, result.matches, answeredBy),
        error: false,
      };
    } catch {
      return { preview: null, error: true };
    }
  }

  /** A hora de cada mensagem testada (a mesma janela do teste), para a aba Test. */
  /** As mensagens da janela do teste (a mesma do `rules/test`), para a aba Test. */
  private async loadRecent(): Promise<void> {
    try {
      const recent = await this.store.recentRequests();
      this.recent.set(new Map(recent.map((request) => [request.uuid, request])));
    } catch {
      // Sem as mensagens, a aba Test mostra o id de cada uma.
    }
  }

  /** Quantas mensagens seguem com uma regra anterior (a barra da prévia). */
  protected earlierCount(preview: PriorityPreview): number {
    return preview.earlier.reduce((sum, rule) => sum + rule.count, 0);
  }

  /** Status da resposta padrão da URL ("instead of the default 200"). */
  protected defaultStatus(): number {
    return this.tokens.token()?.default_status ?? RULE_DEFAULT_STATUS;
  }

  /** O que a regra responde, para a frase da prévia ("would now get 201 from this rule"). */
  protected answer(): string {
    const rule = this.editedRule();
    return rule?.response?.fault
      ? 'a network fault'
      : String(rule?.response?.status ?? RULE_DEFAULT_STATUS);
  }

  protected async saveRule(): Promise<void> {
    if (this.saving()) {
      return;
    }
    const rule = this.editedValid() ? this.editedRule() : undefined;
    if (!rule) {
      this.block('save');
      return;
    }
    const rules = [...this.store.rules()];
    let index = this.currentIndex();
    if (index === null) {
      // Regra nova, ou a que saiu da lista em outro lugar (volta como nova, sem o id velho): na
      // posição que a página escolheu (antes da pega-tudo, depois da original), senão no fim.
      index = Math.min(this.data().insertAt ?? rules.length, rules.length);
      rules.splice(index, 0, this.missingFromList() ? withoutId(rule) : rule);
    } else {
      rules[index] = rule;
    }
    this.saving.set(true);
    this.generalErrors.set([]);
    this.changedElsewhere.set(false);
    try {
      await this.store.saveIfUnchanged(rules);
      this.leave();
      this.closed.emit(true);
    } catch (error) {
      if (error instanceof RulesChangedError) {
        this.changedElsewhere.set(true);
        return;
      }
      this.showErrors(error, index);
    } finally {
      this.saving.set(false);
    }
  }

  protected jsonErrors(): readonly string[] {
    return (this.json.getError('rule') as string[] | null) ?? [];
  }

  /** Mensagem do campo: a do servidor, se houver; senão a da validação da tela. */
  protected errorOf(control: AbstractControl, fallback: string): string {
    return (control.getError('server') as string | undefined) ?? fallback;
  }

  /**
   * Posição da regra em edição na lista de agora, pelo `id`: a lista pode ter mudado ao lado
   * (toggle, reordenação). `null` para regra nova, ou se ela saiu da lista (salvar a recria no fim).
   */
  private currentIndex(): number | null {
    const id = this.editingId();
    if (id === undefined) {
      return null;
    }
    const index = this.store.rules().findIndex((rule) => rule.id === id);
    return index < 0 ? null : index;
  }

  private formRule(): Rule {
    return fromFormValue(this.form.getRawValue() as RuleFormValue, this.base);
  }

  private editedValid(): boolean {
    return this.view() === JSON_VIEW ? this.json.valid : this.form.valid;
  }

  /** A regra na visão aberta: a do formulário, ou o JSON como foi escrito. */
  private editedRule(): Rule | undefined {
    return this.view() === JSON_VIEW ? parseRuleJson(this.json.value).rule : this.formRule();
  }

  private loadForm(rule: Rule): void {
    const value = toFormValue(rule);
    const { query, headers, body, responseHeaders } = this.form.controls;
    for (const array of [query, headers, body, responseHeaders] as FormArray[]) {
      array.clear();
    }
    value.query.forEach((row) => query.push(this.conditionGroup(row)));
    value.headers.forEach((row) => headers.push(this.conditionGroup(row)));
    value.body.forEach((row) => body.push(this.bodyGroup(row)));
    value.responseHeaders.forEach((row) => responseHeaders.push(this.headerGroup(row)));
    this.form.setValue(value);
    this.syncResponse();
    this.syncScenario();
  }

  /**
   * Habilita só o que vale para a resposta escolhida: com falha, nada além da falha; sem ela, os
   * parâmetros do tipo de atraso escolhido e os do dribble quando ligado. Controle desabilitado
   * não conta na validade, então parâmetro escondido não bloqueia o "Save".
   */
  private syncResponse(): void {
    const c = this.form.controls;
    const faulted = this.faulted();
    const delay = faulted ? 'none' : c.delayType.value;
    const dribble = !faulted && c.dribble.value;
    const enabled: [AbstractControl, boolean][] = [
      [c.status, !faulted],
      [c.responseHeaders, !faulted],
      [c.responseBody, !faulted],
      [c.template, !faulted],
      [c.delayType, !faulted],
      [c.dribble, !faulted],
      [c.delayFixed, delay === 'fixed'],
      [c.delayMin, delay === 'uniform'],
      [c.delayMax, delay === 'uniform'],
      [c.delayMedian, delay === 'lognormal'],
      [c.delaySigma, delay === 'lognormal'],
      [c.dribbleChunks, dribble],
      [c.dribbleDuration, dribble],
    ];
    for (const [control, on] of enabled) {
      setEnabled(control, on);
    }
  }

  /** Os estados só fazem sentido com o nome do cenário. */
  private syncScenario(): void {
    const c = this.form.controls;
    const named = c.scenarioName.value.trim() !== '';
    setEnabled(c.requiredState, named);
    setEnabled(c.newState, named);
  }

  private showErrors(error: unknown, index: number): void {
    if (!(error instanceof HttpErrorResponse && error.status === 422)) {
      this.generalErrors.set(validationMessages(error));
      return;
    }
    const general: string[] = [];
    const prefix = `${index}.`;
    const value = this.form.getRawValue() as RuleFormValue;
    for (const [key, messages] of Object.entries(error.error as Record<string, string[]>)) {
      const ref =
        this.view() === FORM_VIEW && key.startsWith(prefix)
          ? locateError(key.slice(prefix.length), value)
          : null;
      const control = ref && this.control(ref);
      // Campo desabilitado não mostra erro: a mensagem vai para o alerta do topo.
      if (control?.enabled) {
        control.setErrors({ server: messages.join(' ') });
        control.markAsTouched();
      } else {
        general.push(
          ...validationMessages(new HttpErrorResponse({ status: 422, error: { [key]: messages } })),
        );
      }
    }
    this.generalErrors.set(general);
  }

  /** Controle do campo; na condição sem valor (`present`/`absent`), o erro vai para o nome. */
  private control(ref: FieldRef): AbstractControl | null {
    if (!('list' in ref)) {
      return this.form.controls[ref.field];
    }
    const row = this.form.controls[ref.list].at(ref.index) as FormGroup | undefined;
    const control = row?.get(ref.field);
    return control?.enabled ? control : (row?.get('name') ?? control ?? null);
  }

  private conditionGroup(row: ConditionRow): ConditionGroup {
    const group = this.formBuilder.group({
      name: [row.name, Validators.required],
      operator: [row.operator],
      value: [row.value],
    });
    const syncValue = () => {
      const noValue = ['present', 'absent'].includes(group.controls.operator.value);
      group.controls.value[noValue ? 'disable' : 'enable']({ emitEvent: false });
    };
    group.controls.operator.valueChanges.subscribe(syncValue);
    syncValue();
    return group;
  }

  private bodyGroup(row: BodyRow): BodyGroup {
    const group = this.formBuilder.group({
      type: [row.type],
      value: [row.value, jsonWhenEqualToJson],
      path: [row.path, requiredWhenJsonPath],
      equals: [row.equals],
    });
    // Os validadores leem o tipo da linha: validam de novo quando ele muda e depois que a linha
    // existe (na criação do controle ainda não há linha).
    const revalidate = () => {
      group.controls.value.updateValueAndValidity();
      group.controls.path.updateValueAndValidity();
    };
    group.controls.type.valueChanges.subscribe(revalidate);
    revalidate();
    return group;
  }

  private headerGroup(row: HeaderRow): HeaderGroup {
    return this.formBuilder.group({ name: [row.name, Validators.required], value: [row.value] });
  }
}

/** As condições da regra como texto, para saber se mudaram desde o teste. */
function matchKey(rule: Rule | undefined): string | null {
  return rule ? JSON.stringify(rule.match ?? null) : null;
}

function withoutId(rule: Rule): Rule {
  const copy = { ...rule };
  delete copy.id;
  return copy;
}

function setEnabled(control: AbstractControl, enabled: boolean): void {
  if (enabled && control.disabled) {
    control.enable({ emitEvent: false });
  } else if (!enabled && control.enabled) {
    control.disable({ emitEvent: false });
  }
}

/** Máximo do atraso uniforme não pode ficar abaixo do mínimo. */
function notBelowMin(control: AbstractControl<number>): ValidationErrors | null {
  const min = control.parent?.get('delayMin')?.value as number | null | undefined;
  return min !== null && min !== undefined && control.value < min ? { belowMin: true } : null;
}

function ruleJsonValidator(control: AbstractControl<string>): ValidationErrors | null {
  const { errors } = parseRuleJson(control.value);
  return errors.length > 0 ? { rule: errors } : null;
}

function rowType(control: AbstractControl): BodyType | undefined {
  return (control.parent?.get('type')?.value as BodyType | undefined) ?? undefined;
}

function jsonWhenEqualToJson(control: AbstractControl<string>): ValidationErrors | null {
  if (rowType(control) !== 'equalToJson') {
    return null;
  }
  try {
    JSON.parse(control.value);
    return null;
  } catch {
    return { json: true };
  }
}

function requiredWhenJsonPath(control: AbstractControl<string>): ValidationErrors | null {
  return rowType(control) === 'jsonPath' && !control.value.trim() ? { required: true } : null;
}

/** Erro do `rules/test`: o 422 (regra inválida) e a URL apagada como no salvar; o resto, genérico. */
function testMessages(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && [404, 410, 422].includes(error.status)) {
    return validationMessages(error);
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return [$localize`Could not test the rule (${status}).`];
}
