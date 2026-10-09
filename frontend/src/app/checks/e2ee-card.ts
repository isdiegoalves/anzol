import { Clipboard } from '@angular/cdk/clipboard';
import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, Injector, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { localDate } from '../request-detail/dates';
import { Rule, RuleMatch } from '../rules/rule';
import { RuleStore, validationMessages } from '../rules/rule-store';
import {
  E2EE_KEYS_MAX,
  E2eeBinding,
  E2eeKey,
  E2eePolicy,
  Jwk,
  Token,
  TokenSettings,
} from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { CardFold } from './card-fold';
import { CardFoot } from './card-foot';
import { ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import { ChecksStore } from './checks-store';
import { E2eeLab } from './e2ee-lab';
import {
  PendingField,
  changeOf,
  decryptedRefusal,
  errorKeys,
  fieldErrors,
  onOff,
  pendingLabels,
  pendingSummary,
} from './url-settings';

/** Limites que o servidor aceita. */
const MAX_AGE_DEFAULT = 43_200;
const MAX_AGE_MIN = 60;
const MAX_AGE_MAX = 604_800;
const AUDIENCE_MAX = 256;
const INTEGER = /^[+-]?\d+$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;

const BINDINGS = ['jti', 'evt', 'app'] as const;
type BindingName = (typeof BINDINGS)[number];

/** Lista de JWKs em JSON; o resto (curva, `kid`, sem `d`) o servidor confere. */
export function signersValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (control.value.trim() === '') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(control.value);
  } catch (error) {
    return { json: $localize`Invalid JSON: ${(error as Error).message}` };
  }
  return Array.isArray(value) && value.every((jwk) => typeof jwk === 'object' && jwk !== null)
    ? null
    : { json: $localize`Paste a JSON array of public JWKs: [{"kty": "EC", …}].` };
}

/**
 * As respostas de falha do laboratório: 401 no HMAC (só numa URL que confere assinatura), 500 na
 * chave de cifra desconhecida, 400 em outra falha da decifra.
 */
function failureRules(signed: boolean): Rule[] {
  const rule = (name: string, priority: number, match: RuleMatch, status: number): Rule => ({
    name,
    priority,
    match,
    response: { status },
  });
  return [
    ...(signed
      ? [
          rule('signature: invalid → 401', 1, { signature: 'invalid' }, 401),
          rule('signature: absent → 401', 1, { signature: 'absent' }, 401),
        ]
      : []),
    rule('decryption: unknown_kid → 500', 2, { decryption: 'unknown_kid' }, 500),
    rule('decryption: invalid → 400', 3, { decryption: 'invalid' }, 400),
  ];
}

type FailureRulesResult = { added: string[] } | { error: string };

function bindingPath(binding: E2eeBinding | undefined): string {
  return typeof binding === 'object' ? binding.path : (binding ?? '');
}

function bindingIgnoresCase(binding: E2eeBinding | undefined): boolean {
  return typeof binding === 'object' && binding.ignore_case === true;
}

/**
 * Checks › E2EE: a política da decifra do atributo (onde ele vem, quem assina, o que confere com o
 * envelope em claro) e as chaves de cifra da URL. A política entra no rascunho da página e vai no
 * `PUT`; as chaves são gravadas na hora, cada uma pela sua rota.
 */
@Component({
  selector: 'app-e2ee-card',
  imports: [
    Icon,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    MatButton,
    MatCheckbox,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
    CardFoot,
    E2eeLab,
  ],
  templateUrl: './e2ee-card.html',
  styleUrls: ['./card.scss', './e2ee-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'e2ee-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class E2eeCard implements ChecksSection {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly rules = inject(RuleStore);
  private readonly draft = inject(ChecksDraft);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly cardFold = inject(CardFold);

  readonly id = 'e2ee';
  protected readonly bindingNames = BINDINGS;
  protected readonly keysMax = E2EE_KEYS_MAX;
  protected readonly localDate = localDate;
  protected readonly folding = computed(() => this.cardFold.fold() !== 'none');

  protected readonly saved = signal<E2eePolicy | null>(
    (this.draft.base() ?? this.tokens.token())?.e2ee ?? null,
  );
  private readonly savedProtected = signal(
    (this.draft.base() ?? this.tokens.token())?.protected === true,
  );
  /** O rascunho deixa a URL com segredo de leitura: sem ele, o servidor recusa ligar a decifra. */
  protected readonly readProtected = computed(() => this.draft.protects() ?? this.savedProtected());
  readonly form = this.policyForm(this.saved());
  /** O 422 em `e2ee` (sem segredo de leitura, por exemplo), que não é de um campo. */
  protected readonly refusal = signal<string | null>(null);

  /** As chaves vêm da URL aberta: gerar e apagar não passam pelo rascunho. */
  protected readonly keys = computed<readonly E2eeKey[]>(
    () => this.tokens.token()?.e2ee_keys ?? [],
  );
  protected readonly full = computed(() => this.keys().length >= E2EE_KEYS_MAX);
  protected readonly jwksUrl = computed(
    () => `${this.origin}/token/${this.tokens.token()?.uuid ?? ''}/jwks.json`,
  );
  protected readonly kid = new FormControl('', {
    nonNullable: true,
    validators: Validators.pattern(KID),
  });
  protected readonly kidRefusal = signal<string | null>(null);
  protected readonly isLab = computed(() => Boolean(this.tokens.token()?.lab));
  protected readonly generating = signal(false);
  protected readonly tokenId = computed(() => this.tokens.token()?.uuid ?? '');
  protected readonly signed = computed(() => Boolean(this.tokens.token()?.signature));
  protected readonly addingRules = signal(false);
  protected readonly failureRulesResult = signal<FailureRulesResult | null>(null);

  constructor() {
    this.form.controls.enabled.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncFields());
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.refusal.set(null));
    this.kid.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.kidRefusal.set(null));
    this.syncFields();
    this.draft.register(this);
  }

  protected enabled(): boolean {
    return this.form.controls.enabled.value;
  }

  protected unsaved(): boolean {
    return this.draft.dirtySections().includes(this.id);
  }

  /** Com o `alert` da barra à vista, o resumo daqui se cala para não repetir. */
  protected pending(): string {
    return this.draft.alert() ? '' : pendingSummary(this.fields());
  }

  protected turnOff(): void {
    const control = this.form.controls.enabled;
    control.setValue(false);
    control.markAsDirty();
  }

  protected signersError(): string | null {
    const control = this.form.controls.signers;
    if (!control.invalid || !control.touched) {
      return null;
    }
    if (control.hasError('required')) {
      return $localize`Paste at least one public JWK of the sender.`;
    }
    return (control.errors?.['json'] ?? control.errors?.['server']) as string;
  }

  protected serverError(control: AbstractControl): string | null {
    return (control.errors?.['server'] as string | undefined) ?? null;
  }

  changes(): ChangeLine[] {
    const was = this.valuesOf(this.saved());
    const now = this.form.getRawValue();
    const lines = changeOf($localize`E2EE decryption`, onOff(was.enabled), onOff(now.enabled));
    if (!now.enabled) {
      return lines;
    }
    const binding = (name: BindingName, values: typeof now) =>
      values[`${name}IgnoreCase`] ? $localize`${values[name]}:path: (ignore case)` : values[name];
    const signers = (text: string) => text.replace(/\s+/g, '');
    return [
      ...lines,
      ...changeOf($localize`Encrypted attribute`, was.path, now.path),
      ...changeOf($localize`Reject plaintext`, onOff(was.required), onOff(now.required)),
      ...changeOf($localize`Audience (aud)`, was.audience, now.audience),
      ...BINDINGS.flatMap((name) => changeOf(name, binding(name, was), binding(name, now))),
      ...changeOf($localize`Max age (seconds)`, String(was.maxAge ?? ''), String(now.maxAge ?? '')),
      ...(signers(was.signers) === signers(now.signers)
        ? []
        : [
            {
              label: $localize`Trusted signers`,
              before: this.signerCount(was.signers),
              after: this.signerCount(now.signers),
            },
          ]),
    ];
  }

  invalid(): string[] {
    return pendingLabels(this.fields());
  }

  settings(): TokenSettings {
    return { e2ee: this.policyOf() };
  }

  showPending(focus: boolean): void {
    this.form.markAllAsTouched();
    const first = this.fields().find(([control]) => control.invalid);
    if (focus && first) {
      this.host.nativeElement
        .querySelector<HTMLElement>(`[formControlName="${first[1]}"]`)
        ?.focus();
    }
  }

  load(token: Token): void {
    this.saved.set(token.e2ee ?? null);
    this.savedProtected.set(token.protected === true);
    this.form.reset(this.valuesOf(this.saved()));
    this.refusal.set(null);
    this.syncFields();
  }

  /**
   * O 422 em `read_secret` (remover o segredo com requisição decifrada gravada) aparece também aqui,
   * mas o rótulo dele é do cartão Privacy.
   */
  refused(error: unknown): string[] {
    if (fieldErrors(error, 'read_secret').length > 0) {
      this.refusal.set(decryptedRefusal());
    }
    const keys = errorKeys(error).filter((key) => key === 'e2ee' || key.startsWith('e2ee.'));
    if (keys.length === 0) {
      return [];
    }
    const c = this.form.controls;
    const targets: [string, AbstractControl, string][] = [
      ['e2ee.path', c.path, $localize`Encrypted attribute`],
      ['e2ee.audience', c.audience, $localize`Audience (aud)`],
      ['e2ee.bindings.jti', c.jti, 'jti'],
      ['e2ee.bindings.evt', c.evt, 'evt'],
      ['e2ee.bindings.app', c.app, 'app'],
      ['e2ee.max_age_seconds', c.maxAge, $localize`Max age (seconds)`],
      ['e2ee.trusted_signers', c.signers, $localize`Trusted signers`],
    ];
    const labels: string[] = [];
    let rest = keys;
    for (const [prefix, control, label] of targets) {
      const mine = rest.filter((key) => key === prefix || key.startsWith(`${prefix}.`));
      if (mine.length > 0) {
        control.setErrors({ server: fieldErrors(error, ...mine).join(' ') });
        control.markAsTouched();
        labels.push(label);
        rest = rest.filter((key) => !mine.includes(key));
      }
    }
    if (rest.length > 0) {
      this.refusal.set(fieldErrors(error, ...rest).join(' '));
      labels.push($localize`E2EE decryption`);
    }
    return labels;
  }

  sketch(): Record<string, unknown> {
    return this.form.getRawValue();
  }

  restore(sketch: Record<string, unknown>): void {
    this.form.patchValue(sketch);
    this.form.markAsDirty();
    this.syncFields();
  }

  /** Gera a chave (com o `kid` digitado, ou o do servidor) e a põe na lista. */
  protected async generateKey(): Promise<void> {
    const tokenId = this.tokens.token()?.uuid;
    if (!tokenId || this.full() || this.generating()) {
      return;
    }
    if (this.kid.invalid) {
      this.kid.markAsTouched();
      return;
    }
    this.generating.set(true);
    try {
      const key = await this.checks.createKey(tokenId, this.kid.value.trim());
      this.kid.reset('');
      this.snackBar.open($localize`Key ${key.kid}:kid: generated`, undefined, { duration: 4000 });
    } catch (error) {
      const refused = fieldErrors(error, 'kid', 'keys');
      if (refused.length > 0) {
        this.kidRefusal.set(refused.join(' '));
      } else {
        const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
        this.snackBar.open($localize`Could not generate the key (${status}:status:).`, undefined, {
          duration: 10000,
        });
      }
    } finally {
      this.generating.set(false);
    }
  }

  /** Põe no começo da lista as regras de falha que a URL ainda não tem. */
  protected async addFailureRules(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.addingRules()) {
      return;
    }
    this.addingRules.set(true);
    try {
      const added = await this.rules.prependMissing(tokenId, failureRules(this.signed()));
      this.failureRulesResult.set({ added: added.map((rule) => rule.name) });
    } catch (error) {
      this.failureRulesResult.set({ error: validationMessages(error).join(' ') });
    } finally {
      this.addingRules.set(false);
    }
  }

  /** Apaga a chave depois da confirmação (diálogo do app, carregado sob demanda). */
  protected async deleteKey(kid: string): Promise<void> {
    const tokenId = this.tokens.token()?.uuid;
    if (!tokenId) {
      return;
    }
    const { confirmDeleteKey } = await import('./confirm-delete-key');
    const last = this.keys().length === 1 && this.saved() !== null;
    if (!(await confirmDeleteKey(this.injector, { kid, last }))) {
      return;
    }
    try {
      await this.checks.deleteKey(tokenId, kid);
      this.snackBar.open($localize`Key ${kid}:kid: deleted`, undefined, { duration: 4000 });
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.snackBar.open($localize`Could not delete the key (${status}:status:).`, undefined, {
        duration: 10000,
      });
    }
  }

  /** A JWK pública, como o remetente a usa para cifrar. */
  protected copyKey(key: E2eeKey): void {
    this.clipboard.copy(JSON.stringify(key.jwk));
    this.snackBar.open($localize`Copied the public key ${key.kid}:kid:`, undefined, {
      duration: 1000,
    });
  }

  protected ignoreCaseLabel(name: BindingName): string {
    return $localize`Ignore case in ${name}:claim:`;
  }

  protected deleteLabel(kid: string): string {
    return $localize`Delete key ${kid}:kid:`;
  }

  protected copyLabel(kid: string): string {
    return $localize`Copy public key ${kid}:kid:`;
  }

  private signerCount(text: string): string {
    if (text.trim() === '') {
      return $localize`none`;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (Array.isArray(value)) {
        return value.length === 1 ? $localize`1 key` : $localize`${value.length}:count: keys`;
      }
    } catch {
      // Texto ainda inválido: a linha diz só que mudou.
    }
    return $localize`edited`;
  }

  private policyOf(): E2eePolicy | null {
    const form = this.form.getRawValue();
    if (!form.enabled) {
      return null;
    }
    const binding = (name: BindingName): E2eeBinding =>
      form[`${name}IgnoreCase`] ? { path: form[name], ignore_case: true } : form[name];
    return {
      path: form.path,
      required: form.required,
      audience: form.audience,
      bindings: { jti: binding('jti'), evt: binding('evt'), app: binding('app') },
      max_age_seconds: Number(form.maxAge),
      trusted_signers: JSON.parse(form.signers) as Jwk[],
    };
  }

  private valuesOf(saved: E2eePolicy | null) {
    const bindings = saved?.bindings;
    return {
      enabled: saved !== null,
      path: saved?.path ?? '',
      required: saved?.required ?? true,
      audience: saved?.audience ?? '',
      jti: bindingPath(bindings?.jti),
      jtiIgnoreCase: bindingIgnoresCase(bindings?.jti),
      evt: bindingPath(bindings?.evt),
      evtIgnoreCase: bindingIgnoresCase(bindings?.evt),
      app: bindingPath(bindings?.app),
      appIgnoreCase: bindingIgnoresCase(bindings?.app),
      maxAge: saved?.max_age_seconds ?? (MAX_AGE_DEFAULT as number | null),
      signers: saved ? JSON.stringify(saved.trusted_signers, null, 2) : '',
    };
  }

  private policyForm(saved: E2eePolicy | null) {
    const values = this.valuesOf(saved);
    return this.formBuilder.group({
      enabled: [values.enabled],
      path: [values.path, Validators.required],
      required: [values.required],
      audience: [values.audience, [Validators.required, Validators.maxLength(AUDIENCE_MAX)]],
      jti: [values.jti, Validators.required],
      jtiIgnoreCase: [values.jtiIgnoreCase],
      evt: [values.evt, Validators.required],
      evtIgnoreCase: [values.evtIgnoreCase],
      app: [values.app, Validators.required],
      appIgnoreCase: [values.appIgnoreCase],
      maxAge: [
        values.maxAge,
        [
          Validators.required,
          Validators.min(MAX_AGE_MIN),
          Validators.max(MAX_AGE_MAX),
          Validators.pattern(INTEGER),
        ],
      ],
      signers: [values.signers, [Validators.required, signersValidator]],
    });
  }

  /** Desligada, a política sai da validação (campo desabilitado não conta). */
  private syncFields(): void {
    const on = this.enabled();
    for (const [name, control] of Object.entries(this.form.controls)) {
      if (name === 'enabled') {
        continue;
      }
      if (on) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }

  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.path, 'path', $localize`Encrypted attribute`],
      [c.audience, 'audience', $localize`Audience (aud)`],
      [c.jti, 'jti', 'jti'],
      [c.evt, 'evt', 'evt'],
      [c.app, 'app', 'app'],
      [c.maxAge, 'maxAge', $localize`Max age (seconds)`],
      [c.signers, 'signers', $localize`Trusted signers`],
    ];
  }
}
