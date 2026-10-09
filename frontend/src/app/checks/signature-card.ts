import { Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import {
  SIGNATURE_ALGORITHMS,
  SIGNATURE_PROVIDERS,
  SIGNATURE_PROVIDER_LABELS,
  SignatureAlgorithm,
  SignatureConfig,
  SignatureEncoding,
  SignatureProvider,
  Token,
  TokenSettings,
} from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { CardFold } from './card-fold';
import { CardFoot, CardNotice } from './card-foot';
import { ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import {
  PendingField,
  changeOf,
  fieldErrors,
  pendingLabels,
  pendingSummary,
  secretChange,
} from './url-settings';

type ProviderOption = SignatureProvider | 'none';

/**
 * Tabela dos provedores, que também é o seletor: onde a assinatura chega, o que é assinado e qual
 * segredo colar, com os nomes que o usuário vê no painel do provedor.
 */
const PROVIDER_GUIDE: readonly {
  provider: SignatureProvider;
  arrives: string;
  signed: string;
  secret: string;
  /** Onde achar o segredo no painel do provedor. */
  where: string;
}[] = [
  {
    provider: 'stripe',
    arrives: 'Stripe-Signature: t=…,v1=<hex>',
    signed: 'HMAC-SHA256(secret, "{t}.{raw body}") → hex',
    secret: $localize`Endpoint signing secret (whsec_…)`,
    where: $localize`Stripe Dashboard › Developers › Webhooks › your endpoint › Signing secret.`,
  },
  {
    provider: 'github',
    arrives: 'X-Hub-Signature-256: sha256=<hex>',
    signed: 'HMAC-SHA256(secret, raw body) → hex',
    secret: $localize`The webhook Secret field`,
    where: $localize`Repository or organization › Settings › Webhooks › Secret.`,
  },
  {
    provider: 'shopify',
    arrives: 'X-Shopify-Hmac-Sha256: <base64>',
    signed: 'HMAC-SHA256(secret, raw body) → base64',
    secret: $localize`The app's client secret`,
    where: $localize`Partners › Apps › your app › Client credentials › Client secret.`,
  },
  {
    provider: 'slack',
    arrives: 'X-Slack-Signature: v0=<hex> + X-Slack-Request-Timestamp',
    signed: 'HMAC-SHA256(secret, "v0:{timestamp}:{raw body}") → hex',
    secret: $localize`The app Signing Secret`,
    where: $localize`api.slack.com › your app › Basic Information › Signing Secret.`,
  },
  {
    provider: 'generic',
    arrives: $localize`A header you name, optional prefix + signature`,
    signed: 'HMAC-{algorithm}(secret, raw body) → hex or base64',
    secret: $localize`Any shared secret, 1–256 chars`,
    where: $localize`Whatever secret the sender signs with.`,
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

/** Papel de cada parte do header de exemplo: a cor dela e a da chave na legenda (protótipo C). */
type PartTone = '' | 'prefix' | 'time' | 'sig';

interface Part {
  text: string;
  tone: PartTone;
}

interface LegendItem {
  key: string;
  tone: PartTone;
  text: string;
}

/** Header de exemplo real, em partes, por provedor fixo; o do genérico se monta com os campos. */
const EXAMPLE: Record<Exclude<SignatureProvider, 'generic'>, readonly Part[]> = {
  stripe: [
    { text: 'Stripe-Signature: ', tone: '' },
    { text: 't=1790438525', tone: 'time' },
    { text: ',', tone: '' },
    { text: 'v1=5257a869e7ec…', tone: 'sig' },
  ],
  github: [
    { text: 'X-Hub-Signature-256: ', tone: '' },
    { text: 'sha256=', tone: 'prefix' },
    { text: '3f2a91c8d07b…', tone: 'sig' },
  ],
  shopify: [
    { text: 'X-Shopify-Hmac-Sha256: ', tone: '' },
    { text: 'mx4MT6J9fQ2kP0…=', tone: 'sig' },
  ],
  slack: [
    { text: 'X-Slack-Request-Timestamp: ', tone: '' },
    { text: '1790438525', tone: 'time' },
    { text: '  X-Slack-Signature: ', tone: '' },
    { text: 'v0=', tone: 'prefix' },
    { text: 'a2114d57b48e…', tone: 'sig' },
  ],
};

/** Legenda das partes, com a chave na cor da parte; a do genérico se monta com os campos. */
function legendOf(provider: Exclude<SignatureProvider, 'generic'>): readonly LegendItem[] {
  switch (provider) {
    case 'stripe':
      return [
        {
          key: 't',
          tone: 'time',
          text: $localize`Unix time of signing. Rejected when more than the tolerance away from arrival.`,
        },
        {
          key: 'v1',
          tone: 'sig',
          text: $localize`Hex HMAC-SHA256 of t + "." + the raw body, keyed with the whole whsec_… secret.`,
        },
      ];
    case 'github':
      return [
        { key: 'sha256=', tone: 'prefix', text: $localize`Fixed prefix.` },
        {
          key: 'hex',
          tone: 'sig',
          text: $localize`HMAC-SHA256 of the raw body, keyed with the webhook secret.`,
        },
      ];
    case 'shopify':
      return [
        {
          key: 'base64',
          tone: 'sig',
          text: $localize`HMAC-SHA256 of the raw body, keyed with the client secret, in base64.`,
        },
      ];
    case 'slack':
      return [
        {
          key: 'timestamp',
          tone: 'time',
          text: $localize`Seconds since epoch; checked against the tolerance.`,
        },
        { key: 'v0=', tone: 'prefix', text: $localize`Version prefix.` },
        {
          key: 'hex',
          tone: 'sig',
          text: $localize`HMAC-SHA256 of "v0:" + timestamp + ":" + raw body.`,
        },
      ];
  }
}

/** Tolerância do timestamp (Stripe e Slack), em segundos, como o servidor aceita. */
const TOLERANCE_DEFAULT = 300;
const TOLERANCE_MAX = 86_400;
const SECRET_MAX = 256;
const INTEGER = /^[+-]?\d+$/;

/**
 * Checks › Signature verification (C §2.6, A): como funciona em três passos, a tabela dos
 * provedores que é o seletor (`radiogroup`), a anatomia do header com a linha "Expected header:",
 * os campos do provedor com os obrigatórios marcados desde o começo, e o pé do cartão que diz o
 * que falta (o genérico sem header nem segredo explica o motivo). Trocar de provedor exige segredo
 * novo.
 */
@Component({
  selector: 'app-signature-card',
  imports: [
    Icon,
    ReactiveFormsModule,
    RouterLink,
    MatAnchor,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    CardFoot,
  ],
  templateUrl: './signature-card.html',
  styleUrls: ['./card.scss', './signature-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'signature-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class SignatureCard implements ChecksSection {
  protected readonly tokens = inject(TokenStore);
  private readonly draft = inject(ChecksDraft);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = 'signature';
  /** As linhas do seletor: "None" (desliga) e os cinco provedores. */
  protected readonly providers: readonly {
    provider: ProviderOption;
    label: string;
    arrives: string;
    signed: string;
    secret: string;
    where: string;
  }[] = [
    {
      provider: 'none',
      label: $localize`None`,
      arrives: '—',
      signed: $localize`Requests are not checked`,
      secret: '—',
      where: '',
    },
    ...PROVIDER_GUIDE.map((row) => ({ ...row, label: SIGNATURE_PROVIDER_LABELS[row.provider] })),
  ];
  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;
  protected readonly algorithms = SIGNATURE_ALGORITHMS.map((value) => ({
    value,
    label: value.replace('sha', 'SHA-'),
  }));

  /** A configuração salva: base do "SAVED", do segredo mantido e do Discard. */
  protected readonly saved = signal<SignatureConfig | null>(
    (this.draft.base() ?? this.tokens.token())?.signature ?? null,
  );
  readonly form = this.signatureForm(this.saved());

  constructor() {
    this.form.controls.provider.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncFields());
    this.syncFields();
    this.draft.register(this);
  }

  protected unsaved(): boolean {
    return this.draft.dirtySections().includes(this.id);
  }

  protected provider(): ProviderOption {
    return this.form.controls.provider.value;
  }

  protected chooseProvider(provider: ProviderOption): void {
    const control = this.form.controls.provider;
    if (control.value !== provider) {
      control.setValue(provider);
      control.markAsDirty();
    }
  }

  /** Setas, Home e End no `radiogroup` dos provedores: movem o foco e escolhem (roving tabindex). */
  protected moveProvider(event: KeyboardEvent): void {
    const order: readonly ProviderOption[] = ['none', ...SIGNATURE_PROVIDERS];
    const last = order.length - 1;
    const current = order.indexOf(this.provider());
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    let next: number;
    if (forward) {
      next = current === last ? 0 : current + 1;
    } else if (back) {
      next = current <= 0 ? last : current - 1;
    } else if (event.key === 'Home' || event.key === 'End') {
      next = event.key === 'Home' ? 0 : last;
    } else {
      return;
    }
    event.preventDefault();
    this.chooseProvider(order[next]);
    this.host.nativeElement
      .querySelector<HTMLElement>(`#signature-provider-${order[next]}`)
      ?.focus();
  }

  /** Radio que recebe o Tab: o escolhido (roving tabindex). */
  protected tabbable(provider: ProviderOption): boolean {
    return provider === this.provider();
  }

  /**
   * O segredo salvo só vale para o provedor em que foi salvo: trocar de provedor exige um novo
   * (o `whsec_` da Stripe num genérico quase sempre é engano).
   */
  protected keepsSecret(): boolean {
    const saved = this.saved();
    return !!saved?.secret && this.provider() === saved.provider;
  }

  /** O header que o provedor escolhido manda, com cada parte no lugar. */
  protected anatomy(): readonly string[] {
    const c = this.form.controls;
    const provider = this.provider();
    if (provider === 'none') {
      return [];
    }
    if (provider !== 'generic') {
      return ANATOMY[provider];
    }
    const algorithm = c.algorithm.value.toUpperCase();
    const value = $localize`:expected generic signature header|:${c.encoding.value}:encoding: of HMAC-${algorithm}:algorithm:(body)`;
    return [`${c.header.value || '<header>'}: ${c.prefix.value}<${value}>`];
  }

  /** A linha "Expected header:" com o header do provedor escolhido (texto corrido, uma linha por header). */
  /** O header de exemplo em partes coloridas por papel (CHECKS-11). */
  protected example(): readonly Part[] {
    const provider = this.provider();
    if (provider === 'none') {
      return [];
    }
    if (provider !== 'generic') {
      return EXAMPLE[provider];
    }
    const c = this.form.controls;
    const sample = c.encoding.value === 'hex' ? '9b1e0c4fa27d…' : 'mx4MT6J9fQ…=';
    return [
      { text: `${c.header.value || 'X-Signature'}: `, tone: '' },
      ...(c.prefix.value ? [{ text: c.prefix.value, tone: 'prefix' as const }] : []),
      { text: sample, tone: 'sig' },
    ];
  }

  /** A legenda do exemplo, com a chave de cada parte na mesma cor. */
  protected legend(): readonly LegendItem[] {
    const provider = this.provider();
    if (provider === 'none') {
      return [];
    }
    if (provider !== 'generic') {
      return legendOf(provider);
    }
    const c = this.form.controls;
    const algorithm = c.algorithm.value.replace('sha', 'SHA-');
    const encoding = c.encoding.value;
    return [
      {
        key: c.header.value || 'X-Signature',
        tone: '',
        text: $localize`The header name; you type it in Signature header.`,
      },
      {
        key: 'prefix',
        tone: 'prefix',
        text: $localize`Optional text before the signature, removed before comparing.`,
      },
      {
        key: encoding,
        tone: 'sig',
        text: $localize`HMAC-${algorithm}:algorithm: of the raw body in ${encoding}:encoding:.`,
      },
    ];
  }

  protected anatomyText(): string {
    return $localize`Expected header: ${this.anatomy().join('\n')}`;
  }

  /** "Turn off" do cabeçalho: escolhe "None" (o banner diz que salvar desliga). */
  protected turnOff(): void {
    this.chooseProvider('none');
  }

  protected guideOf(provider: ProviderOption) {
    return this.providers.find((row) => row.provider === provider) ?? null;
  }

  /** Com o `alert` da barra à vista, o resumo daqui se cala para não repetir. */
  protected pending(): string {
    return this.draft.alert() ? '' : pendingSummary(this.fields());
  }

  /** Com uma assinatura salva e nada editado, o pé do cartão diz como mantê-la. */
  protected savedNotice(): CardNotice | null {
    return this.saved()
      ? { text: $localize`Saved. Leave the secret blank to keep it.`, error: false }
      : null;
  }

  changes(): ChangeLine[] {
    const c = this.form.controls;
    const was = this.valuesOf(this.saved());
    const name = (provider: ProviderOption) =>
      provider === 'none' ? $localize`None` : SIGNATURE_PROVIDER_LABELS[provider];
    const seconds = (value: number | null) => $localize`${value ?? 0}:seconds: s`;
    const field = <T>(control: AbstractControl<T>, label: string, show: (value: T) => string) =>
      control.enabled
        ? changeOf(label, show(was[nameOf(c, control)] as T), show(control.value))
        : [];
    const text = (value: string) => value;
    return [
      ...changeOf($localize`Signature provider`, name(was.provider), name(c.provider.value)),
      ...field(c.header, $localize`Signature header`, text),
      ...(c.secret.enabled ? secretChange(hmacSecretLabel(), c.secret.value) : []),
      ...field(c.toleranceSeconds, $localize`Tolerance`, seconds),
      ...field(c.prefix, $localize`Prefix`, text),
      ...field(c.algorithm, $localize`Algorithm`, (value) => value.replace('sha', 'SHA-')),
      ...field(c.encoding, $localize`Encoding`, text),
    ];
  }

  invalid(): string[] {
    return pendingLabels(this.fields());
  }

  settings(): TokenSettings {
    return { signature: this.signatureOf() };
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
    this.saved.set(token.signature ?? null);
    this.reset(this.saved());
  }

  refused(error: unknown): string[] {
    const messages = fieldErrors(error, 'signature.secret');
    if (messages.length === 0) {
      return [];
    }
    const control = this.form.controls.secret;
    control.setErrors({ server: messages.join(' ') });
    control.markAsTouched();
    return [hmacSecretLabel()];
  }

  sketch(): Record<string, unknown> {
    const values: Record<string, unknown> = this.form.getRawValue();
    delete values['secret'];
    return values;
  }

  restore(sketch: Record<string, unknown>): void {
    const values = { ...sketch };
    delete values['secret'];
    this.form.patchValue(values);
    this.form.markAsDirty();
    this.syncFields();
  }

  /** Campos que podem ficar pendentes, na ordem da tela. */
  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.header, 'header', $localize`Signature header`],
      [c.secret, 'secret', hmacSecretLabel()],
      [c.toleranceSeconds, 'toleranceSeconds', $localize`Timestamp tolerance (seconds)`],
    ];
  }

  /**
   * Configuração para o servidor, só com os campos do provedor. Segredo em branco reenvia o
   * mascarado que veio do servidor, que então mantém o salvo: o segredo só sai da tela quando muda.
   */
  private signatureOf(): SignatureConfig | null {
    const form = this.form.getRawValue();
    const provider = form.provider;
    if (provider === 'none') {
      return null;
    }
    const secret = form.secret || (this.keepsSecret() ? this.saved()?.secret : null);
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

  private reset(saved: SignatureConfig | null): void {
    this.form.reset(this.valuesOf(saved));
    this.syncFields();
  }

  private valuesOf(saved: SignatureConfig | null) {
    return {
      provider: (saved?.provider ?? 'none') as ProviderOption,
      secret: '',
      header: saved?.header ?? '',
      algorithm: saved?.algorithm ?? ('sha256' as SignatureAlgorithm),
      encoding: saved?.encoding ?? ('hex' as SignatureEncoding),
      prefix: saved?.prefix ?? '',
      toleranceSeconds: saved?.toleranceSeconds ?? (TOLERANCE_DEFAULT as number | null),
    };
  }

  /**
   * Os campos do genérico e a tolerância só valem para os provedores que os usam; a obrigação do
   * segredo segue o provedor escolhido (`syncFields`). Campo desabilitado não conta na validade.
   */
  private signatureForm(saved: SignatureConfig | null) {
    const values = this.valuesOf(saved);
    return this.formBuilder.group({
      provider: [values.provider],
      secret: [values.secret, Validators.maxLength(SECRET_MAX)],
      header: [values.header, Validators.required],
      algorithm: [values.algorithm],
      encoding: [values.encoding],
      prefix: [values.prefix],
      toleranceSeconds: [
        values.toleranceSeconds,
        [
          Validators.required,
          Validators.min(1),
          Validators.max(TOLERANCE_MAX),
          Validators.pattern(INTEGER),
        ],
      ],
    });
  }

  /** Segredo obrigatório, com o asterisco no rótulo, a menos que o salvo continue valendo. */
  private syncFields(): void {
    const c = this.form.controls;
    const provider = this.provider();
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
    c.secret.updateValueAndValidity({ emitEvent: false });
  }
}

function nameOf<K extends string>(
  controls: Record<K, AbstractControl>,
  control: AbstractControl,
): K {
  return (Object.keys(controls) as K[]).find((key) => controls[key] === control) as K;
}

/** O nome do campo do segredo do HMAC, na barra de alterações e nas pendências. */
function hmacSecretLabel(): string {
  return $localize`:HMAC secret field|:Secret`;
}
