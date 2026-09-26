import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
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
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { merge } from 'rxjs';
import { HistoryTestPanel } from './history-test-panel';
import {
  DELAY_MAX_MS,
  DRIBBLE_MAX_CHUNKS,
  FAULT_LABELS,
  HistoryTest,
  RULE_FAULTS,
  Rule,
  scenarioNames,
  scenarioStates,
} from './rule';
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
  SignatureOption,
  ValueOperator,
  fromFormValue,
  locateError,
  newRule,
  parseRuleJson,
  toFormValue,
} from './rule-form';
import { RuleStore, validationMessages } from './rule-store';

export interface RuleEditorData {
  /** Posição da regra na lista salva; `null` para uma regra nova (entra no fim). */
  index: number | null;
  /** Regra nova já preenchida (ex.: a partir de uma mensagem); sem ela, uma regra em branco. */
  draft?: Rule;
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
 * Editor de regra (`MatDialog`): seções Match e Response num formulário tipado, e a aba "JSON"
 * com a regra crua. Salvar é o `PUT` da lista inteira; o 422 aparece no campo apontado pela
 * chave em notação de ponto, e o que não tem campo aparece no alerta do topo.
 */
@Component({
  selector: 'app-rule-editor',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
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
  ],
  templateUrl: './rule-editor.html',
  styleUrl: './rule-editor.scss',
})
export class RuleEditor {
  protected readonly data = inject<RuleEditorData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<RuleEditor, boolean>>(MatDialogRef);
  private readonly store = inject(RuleStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** Regra de partida: o que o formulário não edita (`id`, `scenario`...) sai dela. */
  private base: Rule =
    this.data.index === null
      ? (this.data.draft ?? newRule())
      : (this.store.rules()[this.data.index] ?? newRule());

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
  protected readonly saving = signal(false);
  /** Erros do servidor sem campo no formulário (ou de outras regras da lista). */
  protected readonly generalErrors = signal<readonly string[]>([]);
  /** Último "Test against history" da regra como está; some quando a regra muda. */
  protected readonly historyTest = signal<HistoryTest | null>(null);
  protected readonly historyErrors = signal<readonly string[]>([]);
  protected readonly testing = signal(false);
  protected readonly tokenId = this.store.tokenId;

  protected readonly methods = [
    ...METHODS,
    ...(this.base.match?.method ?? []).filter((method) => !METHODS.includes(method)),
  ];
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
      .subscribe(() => this.clearHistoryTest());
    this.loadForm(this.base);
  }

  /** Com falha escolhida, o servidor ignora status, headers, corpo, atraso e dribble. */
  protected faulted(): boolean {
    return this.form.controls.fault.value !== 'none';
  }

  protected get title(): string {
    return this.data.index === null ? 'New rule' : 'Edit rule';
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
    this.testing.set(true);
    try {
      this.historyTest.set(await this.store.testRule(rule));
    } catch (error) {
      this.historyErrors.set(testMessages(error));
    } finally {
      this.testing.set(false);
    }
  }

  protected async saveRule(): Promise<void> {
    const rule = this.canSave() ? this.editedRule() : undefined;
    if (!rule) {
      return;
    }
    const rules = [...this.store.rules()];
    const index = this.data.index ?? rules.length;
    rules[index] = rule;
    this.saving.set(true);
    this.generalErrors.set([]);
    try {
      await this.store.save(rules);
      this.dialogRef.close(true);
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
