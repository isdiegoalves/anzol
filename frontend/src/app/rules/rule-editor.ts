import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
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
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { merge } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { RuleSuggest } from './rule-suggest';
import { RouterLink } from '@angular/router';
import { WebhookRequest } from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS } from '../token/token';
import { TokenStore } from '../token/token-store';
import { HistoryTestPanel } from './history-test-panel';
import { PriorityPreview, priorityPreview } from './priority-preview';
import {
  DELAY_MAX_MS,
  DRIBBLE_MAX_CHUNKS,
  FAULT_LABELS,
  HISTORY_TEST_WINDOW,
  HistoryTest,
  RULE_DEFAULT_PRIORITY,
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
import { EditorTab, RuleTabs } from './rule-tabs';
import { AgainstHistory } from './against-history';
import { ConditionResult, ConditionResultChip } from './condition-result';
import { ruleInWords } from './rule-words';
import { ScenarioStates } from './scenario-states';

export interface RuleEditorData {
  /** Posição da regra na lista salva; `null` para uma regra nova (entra no fim). */
  index: number | null;
  /** Regra nova já preenchida (ex.: a partir de uma mensagem); sem ela, uma regra em branco. */
  draft?: Rule;
  /** Mensagem aberta: o "Describe the rule" pode mandá-la ao modelo como exemplo. */
  example?: WebhookRequest;
}

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

/** Cola dos helpers de template (Anexo B), com um exemplo de cada. */
const TEMPLATE_HELPERS: { example: string; description: string }[] = [
  { example: '{{request.method}}', description: $localize`HTTP method` },
  { example: '{{request.path}}', description: $localize`Path after the URL's token` },
  { example: '{{request.url}}', description: $localize`Full URL` },
  { example: '{{request.query.id}}', description: $localize`Query parameter "id"` },
  {
    example: '{{request.headers.authorization}}',
    description: $localize`Header, name in lowercase`,
  },
  { example: '{{request.body}}', description: $localize`Raw request body` },
  { example: '{{seq}}', description: $localize`Sequence number of the request` },
  {
    example: "{{jsonPath request.body '$.id'}}",
    description:
      "Value from the JSON body (objects and lists come out as JSON). Simple paths only: '..', '?' and '(' " +
      "are refused anywhere in the path, even inside a quoted key ($['a(b)'], $['x?'])",
  },
  { example: '{{now}}', description: $localize`Current time, ISO-8601 UTC` },
  {
    example: "{{now format='yyyy-MM-dd'}}",
    description: $localize`Current time, Java date pattern`,
  },
  { example: "{{randomValue type='UUID'}}", description: $localize`Random UUID` },
  {
    example: "{{randomValue type='ALPHANUMERIC' length=8}}",
    description: $localize`Random text: ALPHANUMERIC, NUMERIC or HEX (length 16 by default)`,
  },
  { example: "{{math seq '*' 10}}", description: $localize`Arithmetic: '+', '-', '*', '/'` },
];

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
    ScenarioStates,
  ],
  templateUrl: './rule-editor.html',
  styleUrl: './rule-editor.scss',
})
export class RuleEditor {
  private readonly store = inject(RuleStore);
  private readonly tokens = inject(TokenStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** A regra a editar; a página recria o editor quando ela muda. */
  readonly data = input.required<RuleEditorData>();
  /** Fecha o editor: `true` depois de salvar, `false` no Discard. */
  readonly closed = output<boolean>();
  /** "Delete rule": a página apaga a regra salva (com Undo) e fecha o editor. */
  readonly deleteRequested = output<string>();
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
    pathMode: ['any' as PathMode],
    path: ['', Validators.required],
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
  protected readonly tab = signal<EditorTab>('match');
  /** Muda a cada edição do formulário ou do JSON: recalcula a frase e o aviso do caminho. */
  private readonly edits = signal(0);
  protected readonly saving = signal(false);
  /** O último Save achou a lista do servidor diferente da lida: nada foi gravado. */
  protected readonly changedElsewhere = signal(false);
  /** Erros do servidor sem campo no formulário (ou de outras regras da lista). */
  protected readonly generalErrors = signal<readonly string[]>([]);
  /** Último "Test against history" da regra como está; some quando a regra muda. */
  protected readonly historyTest = signal<HistoryTest | null>(null);
  protected readonly historyErrors = signal<readonly string[]>([]);
  protected readonly testing = signal(false);
  protected readonly preview = signal<PreviewState | null>(null);
  protected readonly times = signal<ReadonlyMap<string, string>>(new Map());
  /** Near misses gravados desta regra, por condição (só editando uma regra salva). */
  protected readonly recorded = signal<ConditionTally | null>(null);
  protected readonly tokenId = this.store.tokenId;

  /** A regra "em palavras", da visão aberta; `null` com o JSON inválido. */
  protected readonly words = computed(() => {
    this.edits();
    this.view();
    const rule = this.editedRule();
    return rule ? ruleInWords(rule) : null;
  });
  /** Caminho sem o token da URL, quando o caminho escrito começa com ele (nunca casaria). */
  protected readonly pathFix = computed(() => {
    this.edits();
    const { pathMode, path } = this.form.controls;
    return this.view() === FORM_VIEW && pathMode.value !== 'any'
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
    { list: 'query', title: $localize`Query`, add: $localize`Add query condition` },
    { list: 'headers', title: $localize`Headers`, add: $localize`Add header condition` },
  ] as const;
  protected readonly valueOperators: { value: ValueOperator; label: string }[] = [
    { value: 'equals', label: $localize`equals` },
    { value: 'contains', label: $localize`contains` },
    { value: 'regex', label: $localize`matches regex` },
    { value: 'present', label: $localize`is present` },
    { value: 'absent', label: $localize`is absent` },
  ];
  protected readonly bodyTypes: { value: BodyType; label: string }[] = [
    { value: 'equals', label: $localize`Equals` },
    { value: 'contains', label: $localize`Contains` },
    { value: 'regex', label: $localize`Matches regex` },
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
    { value: 'uniform', label: $localize`Uniform (random)` },
    { value: 'lognormal', label: $localize`Log-normal` },
  ];
  protected readonly faults: { value: FaultOption; label: string }[] = [
    { value: 'none', label: $localize`None` },
    ...RULE_FAULTS.map((fault) => ({ value: fault, label: FAULT_LABELS[fault] })),
  ];
  protected readonly helpers = TEMPLATE_HELPERS;
  protected readonly delayMax = DELAY_MAX_MS;
  protected readonly msError = $localize`An integer between 0 and ${DELAY_MAX_MS} (ms).`;
  /** Mensagens de validação quando o servidor não mandou a dele (`errorOf`). */
  protected readonly messages = {
    nameRequired: $localize`The name is required.`,
    priority: $localize`The priority must be an integer of at least 1.`,
    pathRequired: $localize`The path is required.`,
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
    const { pathMode, fault, delayType, dribble, scenarioName, delayMin, delayMax } =
      this.form.controls;
    pathMode.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncPath());
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
        this.clearHistoryTest();
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

  protected cancel(): void {
    this.closed.emit(false);
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
    control.setValue(
      current.includes(method) ? current.filter((m) => m !== method) : [...current, method],
    );
    control.markAsDirty();
  }

  /** De onde vem o resultado da assinatura: o provedor da URL, ou "not set up". */
  protected signatureOrigin(): string {
    const provider = this.tokens.token()?.signature?.provider;
    return provider ? SIGNATURE_PROVIDER_LABELS[provider] : $localize`not set up`;
  }

  /** De onde vem o resultado do schema: "JSON Schema" com um salvo na URL, ou "not set up". */
  protected schemaOrigin(): string {
    return this.tokens.token()?.schema ? $localize`JSON Schema` : $localize`not set up`;
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

  protected addBodyCondition(): void {
    this.form.controls.body.push(
      this.bodyGroup({ type: 'contains', value: '', path: '', equals: '' }),
    );
  }

  protected addResponseHeader(): void {
    this.form.controls.responseHeaders.push(this.headerGroup({ name: '', value: '' }));
  }

  protected removeRow(list: 'query' | 'headers' | 'body' | 'responseHeaders', index: number): void {
    this.form.controls[list].removeAt(index);
  }

  /**
   * Formulário → JSON mostra a regra montada; JSON → formulário leva o JSON editado (o botão
   * "Form" fica desabilitado enquanto o JSON é inválido).
   */
  protected switchView(index: number): void {
    if (index === JSON_VIEW) {
      this.json.setValue(JSON.stringify(this.formRule(), null, 2));
    } else {
      const { rule } = parseRuleJson(this.json.value);
      if (rule) {
        this.base = rule;
        this.loadForm(rule);
      }
    }
    this.view.set(index);
  }

  /**
   * A regra do "Describe the rule" entra no editor (na visão aberta) sem salvar. Editando uma
   * regra salva, ela fica com o `id` dessa regra.
   */
  protected applySuggestion(rule: Rule): void {
    this.suggestionApplied.set(true);
    const id = this.editingId();
    this.base = id === undefined ? rule : { ...rule, id };
    this.generalErrors.set([]);
    this.loadForm(this.base);
    this.tab.set('match');
    if (this.view() === JSON_VIEW) {
      this.json.setValue(JSON.stringify(this.formRule(), null, 2));
    }
  }

  protected canSave(): boolean {
    return !this.saving() && this.editedValid();
  }

  protected canTest(): boolean {
    return !this.testing() && this.editedValid();
  }

  /** `rules/test` com a regra como está no editor (formulário ou JSON), sem salvar. */
  protected async testAgainstHistory(): Promise<void> {
    const rule = this.canTest() ? this.editedRule() : undefined;
    if (!rule) {
      return;
    }
    this.clearHistoryTest();
    this.tab.set('test');
    this.testing.set(true);
    try {
      const result = await this.store.testRule(rule);
      this.historyTest.set(result);
      if (result.tested > 0) {
        void this.loadTimes();
      }
      if (result.matched > 0) {
        this.preview.set(await this.previewOf(rule, result));
      }
    } catch (error) {
      this.historyErrors.set(testMessages(error));
    } finally {
      this.testing.set(false);
    }
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
  private async loadTimes(): Promise<void> {
    try {
      const recent = await this.store.recentRequests();
      this.times.set(new Map(recent.map((request) => [request.uuid, request.created_at])));
    } catch {
      // Sem as horas, a aba Test mostra o resto.
    }
  }

  /** O que a regra responde, para a frase da prévia ("would now get 201 from this rule"). */
  protected answer(): string {
    const rule = this.editedRule();
    return rule?.response?.fault
      ? 'a network fault'
      : String(rule?.response?.status ?? RULE_DEFAULT_STATUS);
  }

  protected async saveRule(): Promise<void> {
    const rule = this.canSave() ? this.editedRule() : undefined;
    if (!rule) {
      return;
    }
    const rules = [...this.store.rules()];
    const index = this.currentIndex() ?? rules.length;
    // Regra que saiu da lista em outro lugar volta como nova: o id velho não é reaproveitado.
    rules[index] = this.missingFromList() ? withoutId(rule) : rule;
    this.saving.set(true);
    this.generalErrors.set([]);
    this.changedElsewhere.set(false);
    try {
      await this.store.saveIfUnchanged(rules);
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

  private clearHistoryTest(): void {
    this.historyTest.set(null);
    this.historyErrors.set([]);
    this.preview.set(null);
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
    this.syncPath();
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

  private syncPath(): void {
    const path = this.form.controls.path;
    if (this.form.controls.pathMode.value === 'any') {
      path.disable({ emitEvent: false });
    } else {
      path.enable({ emitEvent: false });
    }
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
