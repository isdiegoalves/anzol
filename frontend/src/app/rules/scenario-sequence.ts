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
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { RULE_DEFAULT_STATUS, scenarioNames } from './rule';
import { RuleIntents } from './rule-intents';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';
import {
  RETRY_AFTER_MAX,
  RULES_MAX,
  SCENARIO_NAME_MAX,
  SequenceSpec,
  TIMES_MAX,
  insertSequence,
  sequenceStates,
  suggestScenarioName,
} from './sequence';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

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
    MatHint,
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
  protected readonly methods = signal<string[]>([]);
  protected readonly pathMode = signal<PathMode>(this.data?.path ? 'equals' : 'any');
  protected readonly path = signal(this.data?.path ?? '');
  protected readonly times = signal('2');
  protected readonly firstStatus = signal('503');
  protected readonly firstBody = signal('');
  protected readonly retryAfter = signal('');
  protected readonly finalStatus = signal(String(RULE_DEFAULT_STATUS));
  protected readonly finalBody = signal('');
  /** O nome digitado; até alguém digitar, o nome acompanha o caminho ("/entrega" → "entrega"). */
  private readonly typedScenario = signal<string | null>(null);
  protected readonly scenario = computed(
    () => this.typedScenario() ?? suggestScenarioName(this.path()),
  );
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly saving = signal(false);

  /** N válido (senão 2, para a prévia não sumir enquanto se digita). */
  private readonly count = computed(() => {
    const times = Number(this.times());
    return (Number.isInteger(times) && times >= 1 && times <= TIMES_MAX ? times : 2) + 1;
  });
  protected readonly createLabel = computed(() => $localize`Create ${this.count()}:count: rules`);
  /** Passaria do teto de 100 regras da URL: o aviso aparece e "Create" fica desabilitado. */
  protected readonly exceeds = computed(() => this.store.rules().length + this.count() > RULES_MAX);
  protected readonly exceedsText = $localize`Would exceed 100 rules.`;
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

  /** O caminho sempre aberto (como no editor, F3): digitar num "Any path" passa a "Equals". */
  protected typeScenario(name: string): void {
    this.typedScenario.set(name);
  }

  protected typePath(path: string): void {
    this.path.set(path);
    if (path.trim() !== '' && this.pathMode() === 'any') {
      this.pathMode.set('equals');
    }
  }

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
    if (this.exceeds()) {
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
      first: {
        status: Number(this.firstStatus()),
        body: this.firstBody(),
        retryAfter: this.retryAfter().trim() === '' ? null : Number(this.retryAfter()),
      },
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
        id: 'sequence-retry-after',
        label: $localize`Retry-After (0–${RETRY_AFTER_MAX}:max:)`,
        ok: this.retryAfter().trim() === '' || integer(this.retryAfter(), 0, RETRY_AFTER_MAX),
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
      // O caminho, e não o chip GET: é por ele que quase todo assistente começa (L8).
      autoFocus: '#sequence-path',
    });
  return (await firstValueFrom(ref.afterClosed())) === true;
}
