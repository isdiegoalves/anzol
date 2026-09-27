import { Component, ElementRef, Injector, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import {
  PathMatcher,
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  SCENARIO_STARTED,
  scenarioNames,
} from './rule';
import { RuleIntents } from './rule-intents';
import { catchAllPlacement } from './rule-shadow';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';

/** O que o assistente pede (WM-32): as condições uma vez, "responder A por N vezes, depois B". */
export interface SequenceSpec {
  methods: string[];
  path: PathMatcher | null;
  /** Quantas vezes a primeira resposta sai antes da final (1–20). */
  times: number;
  first: { status: number; body: string };
  /** A resposta que fica: a última regra não define estado novo. */
  final: { status: number; body: string };
  scenario: string;
}

/** Teto de regras por URL (o servidor responde 422 acima dele). */
const RULES_MAX = 100;
const TIMES_MAX = 20;
/** "{scenario} 20/21" cabe nos 100 caracteres do nome da regra. */
const SCENARIO_NAME_MAX = 94;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Os estados da sequência: Started, "{name} 2" … "{name} N+1" (nomes de estado não se traduzem). */
function sequenceStates(scenario: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? SCENARIO_STARTED : `${scenario} ${i + 1}`,
  );
}

/**
 * As N+1 regras encadeadas: "{name} i/n" exige o estado i e leva ao i+1; a última exige o estado
 * a que a penúltima leva e não define estado novo, então a resposta final fica (contrato de
 * cenário). Todas com a mesma prioridade e as mesmas condições.
 */
export function sequenceRules(spec: SequenceSpec, priority: number): Rule[] {
  const count = spec.times + 1;
  const states = sequenceStates(spec.scenario, count);
  return states.map((state, i) => {
    const last = i === count - 1;
    const answer = last ? spec.final : spec.first;
    return {
      name: `${spec.scenario} ${i + 1}/${count}`,
      enabled: true,
      priority,
      match: { method: spec.methods, path: spec.path, query: {}, headers: {}, body: [] },
      scenario: last
        ? { name: spec.scenario, requiredState: state }
        : { name: spec.scenario, requiredState: state, newState: states[i + 1] },
      response: { status: answer.status, headers: {}, body: answer.body },
    };
  });
}

/** O nome do cenário sugerido: o último pedaço do caminho ("/api/pagamentos" → "pagamentos"). */
export function suggestScenarioName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'sequence';
}

/**
 * A lista com as regras da sequência contíguas, antes da primeira pega-tudo ligada e com a
 * prioridade dela (E-01), ou no fim com P5.
 */
export function insertSequence(
  rules: readonly Rule[],
  spec: SequenceSpec,
): { rules: Rule[]; priority: number } {
  const placement = catchAllPlacement(rules);
  const priority = placement?.priority ?? RULE_DEFAULT_PRIORITY;
  const next = [...rules];
  next.splice(placement?.index ?? next.length, 0, ...sequenceRules(spec, priority));
  return { rules: next, priority };
}

type PathMode = 'any' | 'equals' | 'prefix' | 'regex';

/** O que abre o assistente: o caminho de partida (o da regra aberta, se houver). */
export interface SequenceData {
  path?: string;
}

/**
 * Diálogo "Sequence" (WM-32, E-09): monta "falhar N vezes e depois aceitar" numa tela só e grava as
 * N+1 regras de uma vez; a lista as destaca e anuncia quantas (WM-35). Create nunca desabilitado:
 * o clique com algo inválido diz o que corrigir e leva o foco ao primeiro campo.
 */
@Component({
  selector: 'app-scenario-sequence',
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
  ],
  templateUrl: './scenario-sequence.html',
  styleUrl: './scenario-sequence.scss',
})
export class ScenarioSequence {
  private readonly store = inject(RuleStore);
  private readonly intents = inject(RuleIntents);
  private readonly dialog = inject<MatDialogRef<ScenarioSequence, boolean>>(MatDialogRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly data = inject<SequenceData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly allMethods = METHODS;
  protected readonly methods = signal<string[]>(['POST']);
  protected readonly pathMode = signal<PathMode>(this.data?.path ? 'equals' : 'any');
  protected readonly path = signal(this.data?.path ?? '');
  protected readonly times = signal('2');
  protected readonly firstStatus = signal('503');
  protected readonly firstBody = signal('');
  protected readonly finalStatus = signal(String(RULE_DEFAULT_STATUS));
  protected readonly finalBody = signal('');
  protected readonly scenario = signal(suggestScenarioName(this.data?.path ?? ''));
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly saving = signal(false);

  /** N válido (senão 2, para a prévia não sumir enquanto se digita). */
  private readonly count = computed(() => {
    const times = Number(this.times());
    return (Number.isInteger(times) && times >= 1 && times <= TIMES_MAX ? times : 2) + 1;
  });
  protected readonly createLabel = computed(() => $localize`Create ${this.count()}:count: rules`);
  protected readonly previewTitle = computed(
    () => $localize`${this.count()}:count: rules will be created`,
  );
  protected readonly preview = computed(() => {
    const name = this.scenario().trim() || 'sequence';
    const count = this.count();
    const states = sequenceStates(name, count);
    return states.map((state, i) => {
      const last = i === count - 1;
      const status = last ? this.finalStatus() : this.firstStatus();
      const step = last ? $localize`${state}:state: (stays)` : `${state} → ${states[i + 1]}`;
      return `${name} ${i + 1}/${count} · ${step} · ${status}`;
    });
  });
  protected readonly joins = computed(() => {
    const name = this.scenario().trim();
    return name && scenarioNames(this.store.rules()).includes(name) ? name : null;
  });
  protected readonly joinsText = computed(
    () => $localize`Joins the existing scenario "${this.joins()}:name:"`,
  );

  protected toggleMethod(method: string): void {
    this.methods.update((methods) =>
      methods.includes(method) ? methods.filter((m) => m !== method) : [...methods, method],
    );
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Grava as regras (só se a lista do servidor ainda é a lida), destaca e fecha. */
  protected async create(): Promise<void> {
    const invalid = this.invalidFields();
    if (invalid.length > 0) {
      this.errors.set([
        $localize`To create, fix: ${invalid.map(({ label }) => label).join(', ')}:fields:`,
      ]);
      this.host.querySelector<HTMLElement>(`#${invalid[0].id}`)?.focus();
      return;
    }
    const saved = this.store.rules();
    if (saved.length + this.count() > RULES_MAX) {
      this.errors.set([$localize`Would exceed 100 rules.`]);
      return;
    }
    const { rules } = insertSequence(saved, this.spec());
    this.errors.set([]);
    this.saving.set(true);
    try {
      await this.store.saveIfUnchanged(rules);
    } catch (error) {
      this.errors.set(
        error instanceof RulesChangedError
          ? [
              $localize`The rules changed elsewhere since this page read them, so nothing was saved. Reload to see the current rules, then try again.`,
            ]
          : validationMessages(error),
      );
      return;
    } finally {
      this.saving.set(false);
    }
    const before = new Set(saved.map((rule) => rule.id));
    this.intents.markCreated(
      this.store.rules().flatMap((rule) => (rule.id && !before.has(rule.id) ? [rule.id] : [])),
    );
    this.dialog.close(true);
  }

  private spec(): SequenceSpec {
    const mode = this.pathMode();
    const path = this.path().trim();
    return {
      methods: this.methods(),
      path:
        mode === 'any'
          ? null
          : mode === 'equals'
            ? { equals: path }
            : mode === 'prefix'
              ? { prefix: path }
              : { regex: path },
      times: Number(this.times()),
      first: { status: Number(this.firstStatus()), body: this.firstBody() },
      final: { status: Number(this.finalStatus()), body: this.finalBody() },
      scenario: this.scenario().trim(),
    };
  }

  /** Os campos inválidos, na ordem da tela, com o id para o foco. */
  private invalidFields(): { id: string; label: string }[] {
    const integer = (text: string, min: number, max: number) => {
      const n = Number(text);
      return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
    };
    const scenario = this.scenario().trim();
    return [
      {
        id: 'sequence-path',
        label: $localize`Path`,
        ok: this.pathMode() === 'any' || this.path().trim() !== '',
      },
      {
        id: 'sequence-first-status',
        label: $localize`First status (100–599)`,
        ok: integer(this.firstStatus(), 100, 599),
      },
      {
        id: 'sequence-times',
        label: $localize`Times (1–20)`,
        ok: integer(this.times(), 1, TIMES_MAX),
      },
      {
        id: 'sequence-final-status',
        label: $localize`Final status (100–599)`,
        ok: integer(this.finalStatus(), 100, 599),
      },
      {
        id: 'sequence-scenario',
        label: $localize`Scenario name`,
        ok: scenario !== '' && scenario.length <= SCENARIO_NAME_MAX,
      },
    ].filter(({ ok }) => !ok);
  }
}

/** Abre o assistente (no chunk de Regras) e diz se criou as regras. */
export async function openSequence(injector: Injector, data: SequenceData = {}): Promise<boolean> {
  const ref = injector
    .get(MatDialog)
    .open<ScenarioSequence, SequenceData, boolean>(ScenarioSequence, {
      data,
      width: 'min(640px, calc(100vw - 32px))',
      maxWidth: '100vw',
      autoFocus: 'first-tabbable',
    });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
