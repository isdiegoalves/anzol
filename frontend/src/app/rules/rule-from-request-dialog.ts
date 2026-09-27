import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { WebhookRequest } from '../requests/webhook-request';
import { HISTORY_TEST_WINDOW, RULE_DEFAULT_STATUS } from './rule';
import { isJsonBody } from './rule-example';
import { RuleCandidate, ruleCandidates, ruleFromCandidates } from './rule-from-request';
import { RuleIntents } from './rule-intents';
import { catchAllPlacement } from './rule-shadow';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';

type HeaderGroup = FormGroup<{ name: FormControl<string>; value: FormControl<string> }>;

/** Espera depois da última escolha antes de contar de novo (E-03). */
const COUNT_DELAY_MS = 600;
/** Com esta quantidade de mensagens no mesmo método e caminho, casar só uma é específico demais. */
const SIBLINGS_FOR_WARNING = 5;

/**
 * "Create rule from this request" (WM-31, E-03): a regra a partir da mensagem sem superajustar. À
 * esquerda, as condições em caixas (id, datas e UUIDs desmarcados, cabeçalhos também); à direita, a
 * resposta. Embaixo, quantas das últimas 500 casariam, ao vivo, com o aviso de regra específica
 * demais e o "Loosen". "Create rule" grava (antes da pega-tudo) e abre a lista; "Open in editor"
 * leva o rascunho ao editor.
 */
@Component({
  selector: 'app-rule-from-request-dialog',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatCheckbox,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatRadioButton,
    MatRadioGroup,
  ],
  templateUrl: './rule-from-request-dialog.html',
  styleUrl: './rule-from-request-dialog.scss',
})
export class RuleFromRequestDialog {
  private readonly request = inject<WebhookRequest>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<RuleFromRequestDialog>);
  private readonly store = inject(RuleStore);
  private readonly intents = inject(RuleIntents);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly candidates = signal<readonly RuleCandidate[]>(ruleCandidates(this.request));
  protected readonly pathMode = signal<'equals' | 'prefix'>('equals');
  protected readonly form = this.formBuilder.group({
    status: [
      RULE_DEFAULT_STATUS,
      [Validators.required, Validators.min(100), Validators.max(599), Validators.pattern(/^\d+$/)],
    ],
    body: [''],
    headers: this.formBuilder.array<HeaderGroup>([]),
  });
  private readonly response = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  /** Quantas das últimas 500 casariam como está; `null` enquanto conta. */
  protected readonly count = signal<number | null>(null);
  /** Quantas têm o mesmo método e caminho (o limite do "Loosen"). */
  private readonly siblings = signal<number | null>(null);
  protected readonly tooSpecific = computed(
    () => this.count() === 1 && (this.siblings() ?? 0) >= SIBLINGS_FOR_WARNING,
  );
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly saving = signal(false);
  protected readonly window = HISTORY_TEST_WINDOW;

  private readonly rule = computed(() => {
    const response = this.response();
    return ruleFromCandidates(this.request, this.candidates(), this.pathMode(), {
      status: Number(response.status ?? RULE_DEFAULT_STATUS),
      body: response.body ?? '',
      headers: Object.fromEntries(
        (response.headers ?? [])
          .filter((header) => !!header.name?.trim())
          .map((header) => [header.name ?? '', header.value ?? '']),
      ),
    });
  });
  /** As condições (o que conta): a resposta não muda quantas casariam. */
  private readonly match = computed(() => JSON.stringify(this.rule().match));
  protected readonly suggestJson = computed(() => {
    const response = this.response();
    const hasType = (response.headers ?? []).some(
      (header) => header.name?.trim().toLowerCase() === 'content-type',
    );
    return !hasType && isJsonBody(response.body ?? '', false);
  });

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let run = 0;
    effect(() => {
      this.match();
      const rule = untracked(() => this.rule());
      const current = ++run;
      clearTimeout(timer);
      this.count.set(null);
      timer = setTimeout(() => {
        this.store
          .countMatches(this.request.token_id, rule)
          .then((count) => current === run && this.count.set(count))
          .catch(() => undefined);
      }, COUNT_DELAY_MS);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    // Quantas têm o mesmo método e caminho: lido uma vez, para o aviso de E-03.
    const base = ruleFromCandidates(
      this.request,
      this.candidates().filter(({ kind }) => kind === 'method' || kind === 'path'),
      'equals',
      { status: RULE_DEFAULT_STATUS, body: '', headers: {} },
    );
    this.store
      .countMatches(this.request.token_id, base)
      .then((count) => this.siblings.set(count))
      .catch(() => undefined);
  }

  /** Nome acessível (e texto) de cada caixa, traduzido; o valor vem como na mensagem. */
  protected label(candidate: RuleCandidate): string {
    const { field, display } = candidate;
    switch (candidate.kind) {
      case 'method':
        return $localize`Method ${display}:method:`;
      case 'path':
        return $localize`Path ${display}:path:`;
      case 'query':
        return $localize`Query ${field}:name: = ${display}:value:`;
      case 'header':
        return $localize`Header ${field}:name: = ${display}:value:`;
      case 'body':
        return $localize`Body ${field}:path: = ${display}:value:`;
      default:
        return $localize`Body equals the text (10 KiB max)`;
    }
  }

  protected hint(candidate: RuleCandidate): string | null {
    switch (candidate.hint) {
      case 'id':
        return $localize`looks like an id`;
      case 'timestamp':
        return $localize`timestamp`;
      case 'uuid':
        return $localize`UUID`;
      default:
        return null;
    }
  }

  protected toggle(key: string, checked: boolean): void {
    this.candidates.update((list) =>
      list.map((candidate) => (candidate.key === key ? { ...candidate, checked } : candidate)),
    );
  }

  /** "Loosen" (E-03): tira as condições do corpo e da query, que prendem a regra a esta mensagem. */
  protected loosen(): void {
    this.candidates.update((list) =>
      list.map((candidate) =>
        ['body', 'bodyText', 'query'].includes(candidate.kind)
          ? { ...candidate, checked: false }
          : candidate,
      ),
    );
  }

  protected countText(count: number): string {
    return $localize`${count}:count: of the last ${this.window}:window: requests would match`;
  }

  protected addHeader(name = '', value = ''): void {
    this.form.controls.headers.push(
      this.formBuilder.group({ name: [name, Validators.required], value: [value] }),
    );
  }

  protected removeHeader(index: number): void {
    this.form.controls.headers.removeAt(index);
  }

  protected headerLabels(n: number) {
    return {
      name: $localize`Response header ${n}:number: name`,
      value: $localize`Response header ${n}:number: value`,
      remove: $localize`Remove response header ${n}:number:`,
    };
  }

  /** "Create rule": grava antes da pega-tudo, com a prioridade dela (E-01), e abre a lista. */
  protected async create(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const tokenId = this.request.token_id;
    this.saving.set(true);
    this.errors.set([]);
    try {
      if (this.store.tokenId() !== tokenId) {
        await this.store.load(tokenId);
      }
      const rules = [...this.store.rules()];
      const placement = catchAllPlacement(rules);
      const rule = { ...this.rule(), ...(placement && { priority: placement.priority }) };
      rules.splice(placement ? placement.index : rules.length, 0, rule);
      const before = new Set(this.store.rules().map(({ id }) => id));
      await this.store.saveIfUnchanged(rules);
      const created = this.store
        .rules()
        .map(({ id }) => id)
        .filter((id): id is string => !!id && !before.has(id));
      this.intents.markCreated(created);
      // R2-M1: a lista abre com o foco na regra criada (o botão da Entrada que abriu a folha some).
      this.store.pendingFocus.set({ rule: created[0] ?? null });
      this.dialog.close();
      this.snackBar.open($localize`Rule saved`, undefined, { duration: 4000 });
      await this.router.navigate(['/', tokenId, 'rules']);
    } catch (error) {
      this.errors.set(
        error instanceof RulesChangedError
          ? [$localize`The rules changed elsewhere; open Rules and try again.`]
          : validationMessages(error),
      );
    } finally {
      this.saving.set(false);
    }
  }

  /** "Open in editor": o rascunho vai para o editor da regra nova, sem gravar. */
  protected async openInEditor(): Promise<void> {
    this.intents.request({ draft: this.rule() });
    // R2-M2: o editor abre com o foco no Nome, como no "New rule".
    this.store.pendingFocus.set('editor');
    this.dialog.close();
    await this.router.navigate(['/', this.request.token_id, 'rules', 'new'], {
      queryParams: { from: this.request.uuid },
    });
  }
}
