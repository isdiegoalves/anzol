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
import { ChecksStore } from './checks-store';
import { SaveBar, SaveNotice } from './save-bar';
import { PendingField, fieldErrors, pendingSummary, updateError } from './url-settings';

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

/** Legenda das partes do header, por provedor. */
const LEGEND: Record<SignatureProvider, readonly string[]> = {
  stripe: [
    't: when Stripe signed, checked against the timestamp tolerance.',
    'v1: the HMAC of t, a dot and the raw body.',
  ],
  github: ['sha256=: fixed prefix, then the HMAC of the raw body.'],
  shopify: ['The whole value is the HMAC of the raw body, in base64.'],
  slack: [
    'v0=: version prefix, then the HMAC of "v0:", the timestamp, ":" and the raw body.',
    'The timestamp header is checked against the timestamp tolerance.',
  ],
  generic: [
    'The prefix, if any, comes before the HMAC of the raw body in the encoding you choose.',
  ],
};

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
      label: 'None',
      arrives: '—',
      signed: 'Requests are not checked',
      secret: '—',
    },
    ...PROVIDER_GUIDE.map((row) => ({ ...row, label: SIGNATURE_PROVIDER_LABELS[row.provider] })),
  ];
  protected readonly providerLabels = SIGNATURE_PROVIDER_LABELS;
  protected readonly algorithms = SIGNATURE_ALGORITHMS.map((value) => ({
    value,
    label: value.replace('sha', 'SHA-'),
  }));
  protected readonly legend = LEGEND;

  /** A configuração salva: base do "SAVED", do segredo mantido e do Discard. */
  protected readonly saved = signal<SignatureConfig | null>(this.tokens.token()?.signature ?? null);
  protected readonly form = this.signatureForm(this.saved());
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

  protected guideOf(provider: ProviderOption) {
    return this.providers.find((row) => row.provider === provider) ?? null;
  }

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  protected discard(): void {
    this.reset(this.saved());
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
    this.saving.set(true);
    try {
      const token: Token = await this.checks.save({ signature: this.signatureOf() });
      this.saved.set(token.signature ?? null);
      this.reset(this.saved());
      this.notice.set({ text: 'Saved.', error: false });
    } catch (error) {
      const messages = fieldErrors(error, 'signature.secret');
      if (messages.length > 0) {
        this.form.controls.secret.setErrors({ server: messages.join(' ') });
        this.showPending();
      } else {
        this.notice.set({ text: updateError(error), error: true });
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
      [c.header, 'header', 'Signature header'],
      [c.secret, 'secret', 'Secret'],
      [c.toleranceSeconds, 'toleranceSeconds', 'Timestamp tolerance (seconds)'],
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
