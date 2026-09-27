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
} from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { ChecksStore } from './checks-store';
import { SaveBar, SaveNotice } from './save-bar';
import { PendingField, fieldErrors, pendingSummary, saveErrorNotice } from './url-settings';

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
}[] = [
  {
    provider: 'stripe',
    arrives: 'Stripe-Signature',
    signed: '"{t}.{raw body}", HMAC-SHA256, hex',
    secret: $localize`Endpoint signing secret, whole (whsec_…)`,
  },
  {
    provider: 'github',
    arrives: 'X-Hub-Signature-256',
    signed: $localize`Raw body, HMAC-SHA256, hex`,
    secret: $localize`The webhook's secret`,
  },
  {
    provider: 'shopify',
    arrives: 'X-Shopify-Hmac-Sha256',
    signed: $localize`Raw body, HMAC-SHA256, base64`,
    secret: $localize`The app's client secret`,
  },
  {
    provider: 'slack',
    arrives: 'X-Slack-Signature + X-Slack-Request-Timestamp',
    signed: '"v0:{timestamp}:{raw body}", HMAC-SHA256, hex',
    secret: $localize`The app's signing secret`,
  },
  {
    provider: 'generic',
    arrives: $localize`The header you name`,
    signed: $localize`Raw body, HMAC-SHA1/256/512, hex or base64`,
    secret: $localize`Any secret, up to 256 characters`,
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
 * os campos do provedor com os obrigatórios marcados desde o começo, e a barra de salvar que diz o
 * que falta (o Save nunca fica desabilitado: o genérico sem header nem segredo explica o motivo).
 * Trocar de provedor exige segredo novo (S11).
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
    SaveBar,
  ],
  templateUrl: './signature-card.html',
  styleUrls: ['./card.scss', './signature-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'signature-title' },
})
export class SignatureCard {
  protected readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** As linhas do seletor: "None" (desliga) e os cinco provedores. */
  protected readonly providers: readonly {
    provider: ProviderOption;
    label: string;
    arrives: string;
    signed: string;
    secret: string;
  }[] = [
    {
      provider: 'none',
      label: $localize`None`,
      arrives: '—',
      signed: $localize`Requests are not checked`,
      secret: '—',
    },
    ...PROVIDER_GUIDE.map((row) => ({ ...row, label: SIGNATURE_PROVIDER_LABELS[row.provider] })),
  ];
  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;
  protected readonly algorithms = SIGNATURE_ALGORITHMS.map((value) => ({
    value,
    label: value.replace('sha', 'SHA-'),
  }));

  /** A configuração salva: base do "SAVED", do segredo mantido e do Discard. */
  protected readonly saved = signal<SignatureConfig | null>(this.tokens.token()?.signature ?? null);
  protected readonly form = this.signatureForm(this.saved());
  /** A URL como este cartão a leu: o save confere se a assinatura mudou lá fora. */
  private readonly base = signal(this.tokens.token());
  protected readonly saving = signal(false);
  protected readonly attempted = signal(false);
  protected readonly notice = signal<SaveNotice | null>(null);

  constructor() {
    this.form.controls.provider.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncFields());
    this.syncFields();
  }

  protected provider(): ProviderOption {
    return this.form.controls.provider.value;
  }

  protected chooseProvider(provider: ProviderOption): void {
    const control = this.form.controls.provider;
    if (control.value !== provider) {
      control.setValue(provider);
      control.markAsDirty();
      this.notice.set(null);
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
    const hmac = `HMAC-${c.algorithm.value.toUpperCase()}(body)`;
    return [`${c.header.value || '<header>'}: ${c.prefix.value}<${c.encoding.value} of ${hmac}>`];
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

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  protected discard(): void {
    this.reset(this.saved());
  }

  /** "Reload" depois de "changed elsewhere": o cartão volta à URL como está no servidor. */
  protected async reloadCard(): Promise<void> {
    const base = this.base();
    if (base) {
      const token = await this.checks.reload(base.uuid);
      this.base.set(token);
      this.saved.set(token.signature ?? null);
      this.reset(this.saved());
      this.notice.set(null);
    }
  }

  protected async saveSignature(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.notice.set(null);
    if (this.form.invalid) {
      this.showPending();
      return;
    }
    const base = this.base();
    if (!base) {
      return;
    }
    this.saving.set(true);
    try {
      const token: Token = await this.checks.save({ signature: this.signatureOf() }, base);
      this.base.set(token);
      this.saved.set(token.signature ?? null);
      this.reset(this.saved());
      this.notice.set({ text: $localize`Saved.`, error: false });
    } catch (error) {
      const messages = fieldErrors(error, 'signature.secret');
      if (messages.length > 0) {
        this.form.controls.secret.setErrors({ server: messages.join(' ') });
        this.showPending();
      } else {
        this.notice.set(saveErrorNotice(error));
        this.checks.offerRetry(error, () => void this.saveSignature());
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Clicar com pendência: todos os erros à vista, o resumo em `alert` e o foco no primeiro campo. */
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

  /** Campos que podem ficar pendentes, na ordem da tela. */
  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.header, 'header', $localize`Signature header`],
      [c.secret, 'secret', 'Secret'],
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
    this.attempted.set(false);
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
