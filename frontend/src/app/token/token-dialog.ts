import { Component, inject, signal } from '@angular/core';
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

/** Onde cada provedor manda a assinatura e qual segredo usar. */
const PROVIDER_HINTS: Record<SignatureProvider, string> = {
  stripe: 'Sent in Stripe-Signature: t=…,v1=…; use the endpoint signing secret (whsec_…)',
  github: 'Sent in X-Hub-Signature-256: sha256=<hex>; use the webhook secret',
  shopify: "Sent in X-Shopify-Hmac-Sha256 (base64); use the app's client secret",
  slack: 'Sent in X-Slack-Signature: v0=… with X-Slack-Request-Timestamp; use the signing secret',
  generic: 'HMAC of the raw body, sent in the header you choose',
};

/** Tolerância do timestamp (Stripe e Slack), em segundos, como o servidor aceita. */
const TOLERANCE_DEFAULT = 300;
const TOLERANCE_MAX = 86_400;
const SECRET_MAX = 256;

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
  ],
  templateUrl: './token-dialog.html',
  styleUrl: './token-dialog.scss',
})
export class TokenDialog {
  protected readonly data = inject<TokenDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TokenDialog, TokenSettings>>(MatDialogRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  private readonly editing = this.data.mode === 'edit' ? this.data.token : null;
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
  });
  protected readonly saving = signal(false);

  protected readonly autoCleanupLimits = AUTO_CLEANUP_LIMITS;
  protected readonly providers = SIGNATURE_PROVIDERS.map((value) => ({
    value,
    label: SIGNATURE_PROVIDER_LABELS[value],
  }));
  protected readonly providerHints = PROVIDER_HINTS;
  protected readonly algorithms = SIGNATURE_ALGORITHMS.map((value) => ({
    value,
    label: value.replace('sha', 'SHA-'),
  }));
  /** Segredo salvo, mascarado pelo servidor (`••••` e os 4 últimos); reenviado, mantém o salvo. */
  protected readonly savedSecret = this.editing?.signature?.secret ?? null;

  constructor() {
    const { provider } = this.form.controls.signature.controls;
    provider.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncSignature());
    this.syncSignature();
  }

  /**
   * Campos de texto vão só preenchidos, como o `serializeArray` filtrado do app atual.
   * `retry_after`, `auto_cleanup`, `signature` e `schema` vão sempre (`null` quando vazios): no
   * `PUT`, campo ausente volta ao padrão.
   */
  protected async saveSettings(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      return;
    }
    const { retry_after, auto_cleanup, signature, schema, ...fields } = this.form.getRawValue();
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
      signature: signatureOf(signature, this.savedSecret),
      schema: schema.trim() === '' ? null : (JSON.parse(schema) as JsonSchema),
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

  /** "Clear schema": sem schema, a URL deixa de validar ao salvar. */
  protected clearSchema(): void {
    this.form.controls.schema.setValue('');
  }

  /**
   * Segredo obrigatório só sem um salvo (criar, ou URL que não tinha assinatura); os campos do
   * genérico e a tolerância só valem para os provedores que os usam. Campo desabilitado não conta
   * na validade.
   */
  private signatureGroup(saved: SignatureConfig | null) {
    const secret = [Validators.maxLength(SECRET_MAX)];
    if (!saved?.secret) {
      secret.push(Validators.required);
    }
    return this.formBuilder.group({
      provider: [(saved?.provider ?? 'none') as ProviderOption],
      secret: ['', secret],
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

  private syncSignature(): void {
    const c = this.form.controls.signature.controls;
    const provider = c.provider.value;
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
