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
import { RuleSuggest } from '../ai/rule-suggest';
import { WebhookRequest } from '../requests/webhook-request';
import { Pane } from '../ui/pane';
import { HistoryTestPanel } from './history-test-panel';
import { PriorityPreview, priorityPreview } from './priority-preview';
import {
  DELAY_MAX_MS,
  DRIBBLE_MAX_CHUNKS,
  FAULT_LABELS,
  HISTORY_TEST_WINDOW,
  HistoryTest,
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
import { RuleStore, validationMessages } from './rule-store';
import { ruleInWords } from './rule-words';
import { ScenarioDiagram } from './scenario-diagram';

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

/** Abas do editor em modo formulário (C §2.4). */
export type EditorTab = 'match' | 'response' | 'scenario' | 'test';
const TABS: { id: EditorTab; label: string }[] = [
  { id: 'match', label: 'Match' },
  { id: 'response', label: 'Response' },
  { id: 'scenario', label: 'Scenario' },
  { id: 'test', label: 'Test' },
];

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
  { example: '{{request.method}}', description: 'HTTP method' },
  { example: '{{request.path}}', description: "Path after the URL's token" },
  { example: '{{request.url}}', description: 'Full URL' },
  { example: '{{request.query.id}}', description: 'Query parameter "id"' },
  { example: '{{request.headers.authorization}}', description: 'Header, name in lowercase' },
  { example: '{{request.body}}', description: 'Raw request body' },
  { example: '{{seq}}', description: 'Sequence number of the request' },
  {
    example: "{{jsonPath request.body '$.id'}}",
    description:
      "Value from the JSON body (objects and lists come out as JSON). Simple paths only: '..', '?' and '(' " +
      "are refused anywhere in the path, even inside a quoted key ($['a(b)'], $['x?'])",
  },
  { example: '{{now}}', description: 'Current time, ISO-8601 UTC' },
  { example: "{{now format='yyyy-MM-dd'}}", description: 'Current time, Java date pattern' },
  { example: "{{randomValue type='UUID'}}", description: 'Random UUID' },
  {
    example: "{{randomValue type='ALPHANUMERIC' length=8}}",
    description: 'Random text: ALPHANUMERIC, NUMERIC or HEX (length 16 by default)',
  },
  { example: "{{math seq '*' 10}}", description: "Arithmetic: '+', '-', '*', '/'" },
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
    Pane,
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
    ScenarioDiagram,
  ],
  templateUrl: './rule-editor.html',
  styleUrl: './rule-editor.scss',
})
export class RuleEditor {
  private readonly store = inject(RuleStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** A regra a editar; a página recria o editor quando ela muda. */
  readonly data = input.required<RuleEditorData>();
  /** Fecha o editor: `true` depois de salvar, `false` no Cancel. */
  readonly closed = output<boolean>();

  /** Regra de partida: o que o formulário não edita (`id`, `scenario`...) sai dela. */
  private base: Rule = newRule();
  /** A regra salva em edição, como estava ao abrir (`null` numa regra nova). */
  private readonly editing = signal<Rule | null>(null);
  /** `id` da regra salva em edição (fixo, mesmo que o JSON editado perca o campo). */
  private editingId: string | undefined;
  /** Título com o nome salvo, fixo enquanto o nome é editado. */
  protected readonly title = signal('New rule');
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
  protected readonly tabs = TABS;
  /** Muda a cada edição do formulário ou do JSON: recalcula a frase e o aviso do caminho. */
  private readonly edits = signal(0);
  protected readonly saving = signal(false);
  /** Erros do servidor sem campo no formulário (ou de outras regras da lista). */
  protected readonly generalErrors = signal<readonly string[]>([]);
  /** Último "Test against history" da regra como está; some quando a regra muda. */
  protected readonly historyTest = signal<HistoryTest | null>(null);
  protected readonly historyErrors = signal<readonly string[]>([]);
  protected readonly testing = signal(false);
  protected readonly preview = signal<PreviewState | null>(null);
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
  /** As regras do cenário digitado, com este rascunho no lugar dele (diagrama da aba Scenario). */
  protected readonly scenarioRules = computed(() => {
    this.edits();
    const name = this.typedName().trim();
    if (!name || this.view() !== FORM_VIEW) {
      return null;
    }
    const rules = [...this.store.rules()];
    rules[this.currentIndex() ?? rules.length] = this.formRule();
    return { name, rules };
  });
  protected readonly historyWindow = HISTORY_TEST_WINDOW;
  protected readonly responseBadge = computed(() => {
    this.edits();
    const { fault, status } = this.form.controls;
    return fault.value !== 'none' ? 'fault' : String(status.value ?? RULE_DEFAULT_STATUS);
  });
  protected readonly conditionSections = [
    { list: 'query', title: 'Query', label: 'Query' },
    { list: 'headers', title: 'Headers', label: 'Header' },
  ] as const;
  protected readonly valueOperators: { value: ValueOperator; label: string }[] = [
    { value: 'equals', label: 'equals' },
    { value: 'contains', label: 'contains' },
    { value: 'regex', label: 'matches regex' },
    { value: 'present', label: 'is present' },
    { value: 'absent', label: 'is absent' },
  ];
  protected readonly bodyTypes: { value: BodyType; label: string }[] = [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'regex', label: 'Matches regex' },
    { value: 'jsonPath', label: 'JSONPath' },
    { value: 'equalToJson', label: 'Equal to JSON' },
  ];
  protected readonly signatureOptions: { value: SignatureOption; label: string }[] = [
    { value: 'any', label: 'Any' },
    { value: 'valid', label: 'Valid' },
    { value: 'invalid', label: 'Invalid' },
    { value: 'absent', label: 'Absent (no signature header)' },
  ];
  protected readonly schemaOptions: { value: SchemaOption; label: string }[] = [
    { value: 'any', label: 'Any' },
    { value: 'valid', label: 'Valid' },
    { value: 'invalid', label: 'Invalid' },
  ];
  protected readonly delayTypes: { value: DelayType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'fixed', label: 'Fixed' },
    { value: 'uniform', label: 'Uniform (random)' },
    { value: 'lognormal', label: 'Log-normal' },
  ];
  protected readonly faults: { value: FaultOption; label: string }[] = [
    { value: 'none', label: 'None' },
    ...RULE_FAULTS.map((fault) => ({ value: fault, label: FAULT_LABELS[fault] })),
  ];
  protected readonly helpers = TEMPLATE_HELPERS;
  protected readonly delayMax = DELAY_MAX_MS;
  protected readonly msError = `An integer between 0 and ${DELAY_MAX_MS} (ms).`;
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
    this.editingId = saved?.id;
    this.title.set(saved ? `Edit rule ${saved.name}` : 'New rule');
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

  /** Setas, Home e End entre as abas (padrão de abas da ARIA); o foco vai junto. */
  protected moveTab(event: KeyboardEvent, current: EditorTab): void {
    const index = TABS.findIndex(({ id }) => id === current);
    const next: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    if (!(event.key in next)) {
      return;
    }
    event.preventDefault();
    const tab = TABS[next[event.key]].id;
    this.tab.set(tab);
    const list = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
    list?.querySelector<HTMLElement>(`#rule-tab-${tab}`)?.focus();
  }

  protected cancel(): void {
    this.closed.emit(false);
  }

  /** Tira o token da URL do começo do caminho (o caminho da regra é relativo à URL). */
  protected removeTokenFromPath(): void {
    const fixed = this.pathFix();
    if (fixed !== null) {
      this.form.controls.path.setValue(fixed);
    }
  }

  /** Como a condição foi no último teste: "Fails on 3 of 10 tested" ou "Passes on all 10 tested". */
  protected feedback(key: ConditionKey): string | null {
    const tested = this.tested();
    if (!tested) {
      return null;
    }
    const failed = tested.tally.counts.get(key) ?? 0;
    return failed > 0
      ? `Fails on ${failed} of ${tested.tested} tested`
      : `Passes on all ${tested.tested} tested`;
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
    this.base = this.editingId === undefined ? rule : { ...rule, id: this.editingId };
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
    rules[index] = rule;
    this.saving.set(true);
    this.generalErrors.set([]);
    try {
      await this.store.save(rules);
      this.closed.emit(true);
    } catch (error) {
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
    if (this.editingId === undefined) {
      return null;
    }
    const index = this.store.rules().findIndex((rule) => rule.id === this.editingId);
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
  return [`Could not test the rule (${status}).`];
}
