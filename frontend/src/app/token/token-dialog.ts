import { Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { retryAfterValidator } from './retry-after';
import {
  AUTO_CLEANUP_LIMITS,
  AutoCleanup,
  JsonSchema,
  SIGNATURE_ALGORITHMS,
  SIGNATURE_PROVIDERS,
  SIGNATURE_PROVIDER_LABELS,
  SignatureAlgorithm,
  SignatureConfig,
  SignatureEncoding,
  SignatureProvider,
  Token,
  TokenSettings,
} from './token';

export interface TokenDialogData {
  mode: 'create' | 'edit';
  /** `null` quando a URL não foi encontrada (mostra o aviso, como no app atual). */
  token: Token | null;
  /** Schema que o campo mostra no lugar do salvo ("Create schema from this request"). */
  schema?: JsonSchema;
  /**
   * Salva na API. Devolve os erros do servidor para o campo Schema (o diálogo fica aberto para
   * corrigir); vazio fecha o diálogo com os campos enviados.
   */
  save: (settings: TokenSettings) => Promise<readonly string[]>;
}

const INTEGER = /^[+-]?\d+$/;

type ProviderOption = SignatureProvider | 'none';

/** Quadro fixo dos provedores no diálogo: onde a assinatura chega, o que é assinado, qual segredo. */
const PROVIDER_GUIDE: readonly {
  provider: SignatureProvider;
  arrives: string;
  signed: string;
  secret: string;
}[] = [
  {
    provider: 'stripe',
    arrives: 'Stripe-Signature',
    signed: '"{t}.{raw body}", HMAC-SHA256, hex',
    secret: 'Endpoint signing secret, whole (whsec_…)',
  },
  {
    provider: 'github',
    arrives: 'X-Hub-Signature-256',
    signed: 'Raw body, HMAC-SHA256, hex',
    secret: "The webhook's secret",
  },
  {
    provider: 'shopify',
    arrives: 'X-Shopify-Hmac-Sha256',
    signed: 'Raw body, HMAC-SHA256, base64',
    secret: "The app's client secret",
  },
  {
    provider: 'slack',
    arrives: 'X-Slack-Signature + X-Slack-Request-Timestamp',
    signed: '"v0:{timestamp}:{raw body}", HMAC-SHA256, hex',
    secret: "The app's signing secret",
  },
  {
    provider: 'generic',
    arrives: 'The header you name',
    signed: 'Raw body, HMAC-SHA1/256/512, hex or base64',
    secret: 'Any secret, up to 256 characters',
  },
];

/** Anatomia do header esperado por provedor fixo; a do genérico se monta com os campos. */
const ANATOMY: Record<Exclude<SignatureProvider, 'generic'>, readonly string[]> = {
  stripe: ['Stripe-Signature: t=<unix time>,v1=<hex of HMAC-SHA256("{t}.{body}")>'],
  github: ['X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(body)>'],
  shopify: ['X-Shopify-Hmac-Sha256: <base64 of HMAC-SHA256(body)>'],
  slack: [
    'X-Slack-Signature: v0=<hex of HMAC-SHA256("v0:{timestamp}:{body}")>',
    'X-Slack-Request-Timestamp: <unix time>',
  ],
};

/** Tolerância do timestamp (Stripe e Slack), em segundos, como o servidor aceita. */
const TOLERANCE_DEFAULT = 300;
const TOLERANCE_MAX = 86_400;
const SECRET_MAX = 256;
/** Tamanho do segredo de leitura que o servidor aceita. */
const READ_SECRET_MIN = 8;

/** O schema salvo, ou o sugerido, indentado para editar à mão. */
function schemaText(schema: JsonSchema | null | undefined): string {
  return schema ? JSON.stringify(schema, null, 2) : '';
}

/** Vazio desliga a validação; senão, precisa ser um objeto JSON (o servidor compila o resto). */
function schemaValidator(control: AbstractControl<string>): ValidationErrors | null {
  const text = control.value.trim();
  if (text === '') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { json: `Invalid JSON: ${(error as Error).message}` };
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? null
    : { json: 'The schema must be a JSON object.' };
}

/**
 * Diálogos "Create New URL" e "Edit URL", com a validação do servidor (`timeout` 0–10,
 * `retry_after` em segundos ou data HTTP, `auto_cleanup` só com os limites aceitos).
 */
@Component({
  selector: 'app-token-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    MatSelect,
    MatOption,
    MatButton,
    MatSlideToggle,
  ],
  templateUrl: './token-dialog.html',
  styleUrl: './token-dialog.scss',
})
export class TokenDialog {
  protected readonly data = inject<TokenDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TokenDialog, TokenSettings>>(MatDialogRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly editing = this.data.mode === 'edit' ? this.data.token : null;
  /** A URL editada já exige segredo: campo em branco mantém o atual. */
  protected readonly wasProtected = this.editing?.protected === true;
  protected readonly form = this.formBuilder.group({
    default_status: [
      this.editing ? String(this.editing.default_status) : '',
      Validators.pattern(INTEGER),
    ],
    default_content_type: [this.editing?.default_content_type ?? ''],
    timeout: [
      this.editing ? this.editing.timeout : (0 as number | null),
      [Validators.pattern(INTEGER), Validators.min(0), Validators.max(10)],
    ],
    default_content: [this.editing?.default_content ?? ''],
    retry_after: [String(this.editing?.retry_after ?? ''), retryAfterValidator],
    auto_cleanup: [this.editing?.auto_cleanup ?? (null as AutoCleanup | null)],
    signature: this.signatureGroup(this.editing?.signature ?? null),
    schema: [schemaText(this.data.schema ?? this.editing?.schema), schemaValidator],
    privacy: this.formBuilder.group({
      required: [this.wasProtected],
      // Obrigatório só para quem ainda não tem segredo; na URL protegida, em branco mantém o atual.
      read_secret: [
        '',
        [
          ...(this.wasProtected ? [] : [Validators.required]),
          Validators.minLength(READ_SECRET_MIN),
          Validators.maxLength(SECRET_MAX),
        ],
      ],
      read_secret_confirm: [''],
    }),
  });
  protected readonly secretLabel = this.wasProtected ? 'New secret' : 'Secret to view';
  protected readonly saving = signal(false);
  /** Tentou salvar com pendência: o resumo do que falta aparece e acompanha o preenchimento. */
  protected readonly attempted = signal(false);

  protected readonly autoCleanupLimits = AUTO_CLEANUP_LIMITS;
  protected readonly providers = SIGNATURE_PROVIDERS.map((value) => ({
    value,
    label: SIGNATURE_PROVIDER_LABELS[value],
  }));
  protected readonly providerGuide = PROVIDER_GUIDE.map((row) => ({
    ...row,
    label: SIGNATURE_PROVIDER_LABELS[row.provider],
  }));
  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;
  protected readonly algorithms = SIGNATURE_ALGORITHMS.map((value) => ({
    value,
    label: value.replace('sha', 'SHA-'),
  }));
  /** Segredo salvo, mascarado pelo servidor (`••••` e os 4 últimos); reenviado, mantém o salvo. */
  protected readonly savedSecret = this.editing?.signature?.secret ?? null;
  protected readonly savedProvider = this.editing?.signature?.provider ?? null;

  constructor() {
    const { provider } = this.form.controls.signature.controls;
    provider.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncSignature());
    this.syncSignature();
    const privacy = this.form.controls.privacy.controls;
    privacy.read_secret_confirm.addValidators((confirm) =>
      confirm.value === privacy.read_secret.value ? null : { mismatch: true },
    );
    privacy.required.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncPrivacy());
    privacy.read_secret.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => privacy.read_secret_confirm.updateValueAndValidity());
    this.syncPrivacy();
  }

  /**
   * Campos de texto vão só preenchidos, como o `serializeArray` filtrado do app atual.
   * `retry_after`, `auto_cleanup`, `signature` e `schema` vão sempre (`null` quando vazios): no
   * `PUT`, campo ausente volta ao padrão.
   */
  protected async saveSettings(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.showPending();
      return;
    }
    const { retry_after, auto_cleanup, signature, schema, privacy, ...fields } =
      this.form.getRawValue();
    const settings: TokenSettings = {};
    for (const [name, value] of Object.entries(fields)) {
      if (value !== null && value !== '') {
        settings[name as keyof typeof fields] = String(value);
      }
    }
    const sent: TokenSettings = {
      ...settings,
      retry_after: retry_after || null,
      auto_cleanup,
      signature: signatureOf(signature, this.keepsSecret() ? this.savedSecret : null),
      schema: schema.trim() === '' ? null : (JSON.parse(schema) as JsonSchema),
      ...this.readSecret(privacy.required, privacy.read_secret),
    };
    this.saving.set(true);
    const schemaErrors = await this.data.save(sent);
    this.saving.set(false);
    if (schemaErrors.length > 0) {
      const control = this.form.controls.schema;
      control.setErrors({ server: schemaErrors.join(' ') });
      control.markAsTouched();
      return;
    }
    this.dialogRef.close(sent);
  }

  /**
   * `read_secret` só vai quando muda: segredo novo, ou `null` para tirar a proteção. Ausente mantém
   * o atual no `PUT` (e, no create, a URL nasce aberta).
   */
  private readSecret(required: boolean, secret: string): Pick<TokenSettings, 'read_secret'> {
    if (required && secret !== '') {
      return { read_secret: secret };
    }
    return !required && this.wasProtected ? { read_secret: null } : {};
  }

  /**
   * O segredo salvo só vale para o provedor em que foi salvo: trocar de provedor exige um novo
   * (o `whsec_` da Stripe num genérico quase sempre é engano).
   */
  protected keepsSecret(): boolean {
    return (
      this.savedSecret !== null &&
      this.form.controls.signature.controls.provider.value === this.savedProvider
    );
  }

  /** O header que o provedor escolhido manda, com cada parte no lugar. */
  protected anatomy(): readonly string[] {
    const c = this.form.controls.signature.controls;
    const provider = c.provider.value;
    if (provider === 'none') {
      return [];
    }
    if (provider !== 'generic') {
      return ANATOMY[provider];
    }
    const hmac = `HMAC-${c.algorithm.value.toUpperCase()}(body)`;
    return [`${c.header.value || '<header>'}: ${c.prefix.value}<${c.encoding.value} of ${hmac}>`];
  }

  /** "To save, fill in: Signature header, Secret"; vazio quando nada falta. */
  protected pending(): string {
    const problems = this.fields().filter(([control]) => control.invalid);
    const missing = problems.filter(([control]) => control.hasError('required'));
    const invalid = problems.filter(([control]) => !control.hasError('required'));
    const parts = [
      ...(missing.length > 0 ? [`fill in: ${missing.map(([, , label]) => label).join(', ')}`] : []),
      ...(invalid.length > 0 ? [`fix: ${invalid.map(([, , label]) => label).join(', ')}`] : []),
    ];
    return parts.length > 0 ? `To save, ${parts.join('; ')}` : '';
  }

  /** Clicar com pendência: todos os erros à vista, o resumo e o foco no primeiro campo. */
  private showPending(): void {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    const first = this.fields().find(([control]) => control.invalid);
    if (first) {
      this.host.nativeElement
        .querySelector<HTMLElement>(`[formControlName="${first[1]}"]`)
        ?.focus();
    }
  }

  /** Campos que podem ficar pendentes, na ordem da tela, com o nome e o rótulo. */
  private fields(): [AbstractControl, string, string][] {
    const c = this.form.controls;
    const s = c.signature.controls;
    return [
      [c.default_status, 'default_status', 'Default status code'],
      [c.timeout, 'timeout', 'Timeout before response'],
      [c.retry_after, 'retry_after', 'Retry-After'],
      [s.header, 'header', 'Signature header'],
      [s.secret, 'secret', 'Secret'],
      [s.toleranceSeconds, 'toleranceSeconds', 'Timestamp tolerance (seconds)'],
      [c.schema, 'schema', 'JSON Schema'],
      [c.privacy.controls.read_secret, 'read_secret', this.secretLabel],
      [c.privacy.controls.read_secret_confirm, 'read_secret_confirm', 'Confirm secret'],
    ];
  }

  /** "Clear schema": sem schema, a URL deixa de validar ao salvar. */
  protected clearSchema(): void {
    this.form.controls.schema.setValue('');
  }

  /**
   * Os campos do genérico e a tolerância só valem para os provedores que os usam; a obrigação do
   * segredo segue o provedor escolhido (`syncSignature`). Campo desabilitado não conta na validade.
   */
  private signatureGroup(saved: SignatureConfig | null) {
    return this.formBuilder.group({
      provider: [(saved?.provider ?? 'none') as ProviderOption],
      secret: ['', Validators.maxLength(SECRET_MAX)],
      header: [saved?.header ?? '', Validators.required],
      algorithm: [saved?.algorithm ?? ('sha256' as SignatureAlgorithm)],
      encoding: [saved?.encoding ?? ('hex' as SignatureEncoding)],
      prefix: [saved?.prefix ?? ''],
      toleranceSeconds: [
        saved?.toleranceSeconds ?? (TOLERANCE_DEFAULT as number | null),
        [
          Validators.required,
          Validators.min(1),
          Validators.max(TOLERANCE_MAX),
          Validators.pattern(INTEGER),
        ],
      ],
    });
  }

  /** Com a proteção desligada, os campos do segredo saem da validação. */
  private syncPrivacy(): void {
    const c = this.form.controls.privacy.controls;
    for (const control of [c.read_secret, c.read_secret_confirm]) {
      if (c.required.value) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }

  /** Segredo obrigatório, com o asterisco no rótulo, a menos que o salvo continue valendo. */
  private syncSignature(): void {
    const c = this.form.controls.signature.controls;
    const provider = c.provider.value;
    c.secret.setValidators(
      this.keepsSecret()
        ? Validators.maxLength(SECRET_MAX)
        : [Validators.required, Validators.maxLength(SECRET_MAX)],
    );
    const generic = provider === 'generic';
    const enabled: [AbstractControl, boolean][] = [
      [c.secret, provider !== 'none'],
      [c.header, generic],
      [c.algorithm, generic],
      [c.encoding, generic],
      [c.prefix, generic],
      [c.toleranceSeconds, provider === 'stripe' || provider === 'slack'],
    ];
    for (const [control, on] of enabled) {
      if (on) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }
}

interface SignatureFormValue {
  provider: ProviderOption;
  secret: string;
  header: string;
  algorithm: SignatureAlgorithm;
  encoding: SignatureEncoding;
  prefix: string;
  toleranceSeconds: number | null;
}

/**
 * Configuração para o servidor, só com os campos do provedor. Segredo em branco reenvia o
 * mascarado que veio do servidor, que então mantém o salvo: o segredo só sai da tela quando muda.
 */
function signatureOf(form: SignatureFormValue, savedSecret: string | null): SignatureConfig | null {
  const { provider } = form;
  if (provider === 'none') {
    return null;
  }
  const secret = form.secret || savedSecret;
  const base: SignatureConfig = { provider, ...(secret && { secret }) };
  switch (provider) {
    case 'stripe':
    case 'slack':
      return { ...base, toleranceSeconds: Number(form.toleranceSeconds) };
    case 'generic':
      return {
        ...base,
        header: form.header,
        algorithm: form.algorithm,
        encoding: form.encoding,
        ...(form.prefix !== '' && { prefix: form.prefix }),
      };
    default:
      return base;
  }
}
