import { Component, ElementRef, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { RouterLink } from '@angular/router';
import {
  AUTO_CLEANUP_LIMITS,
  AutoCleanup,
  Token,
  TokenSettings,
  retryAfterValidator,
} from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { CardFold } from './card-fold';
import { CardFoot } from './card-foot';
import { ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import { ChecksStore } from './checks-store';
import {
  PendingField,
  changeOf,
  fieldErrors,
  onOff,
  pendingLabels,
  pendingSummary,
} from './url-settings';

const INTEGER = /^[+-]?\d+$/;
/** Valor do segmentado "Auto cleanup": `off` desliga (vai `null`). */
type CleanupOption = 'off' | `${AutoCleanup}`;

/**
 * Checks › Response (C §2.6): a resposta padrão quando nenhuma regra casa (status, Content-Type,
 * corpo, atraso), Retry-After, Auto cleanup em segmentado com a explicação por extenso e o CORS.
 * Tudo entra na barra de salvar da página (B3): o CORS deixou de valer na hora.
 */
@Component({
  selector: 'app-response-card',
  imports: [
    Icon,
    ReactiveFormsModule,
    RouterLink,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
    MatSlider,
    MatSliderThumb,
    CardFoot,
  ],
  templateUrl: './response-card.html',
  styleUrls: ['./card.scss', './response-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'response-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class ResponseCard implements ChecksSection {
  protected readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly draft = inject(ChecksDraft);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = 'response';
  protected readonly limits = AUTO_CLEANUP_LIMITS.map(String);
  readonly form = this.formBuilder.group({
    default_status: ['', [Validators.required, Validators.pattern(INTEGER)]],
    default_content_type: [''],
    timeout: [0 as number | null],
    default_content: [''],
    retry_after: ['', retryAfterValidator],
    auto_cleanup: ['off' as CleanupOption],
    cors: [false],
  });
  /** Os valores salvos, no formato do formulário: a base das alterações. */
  private saved = valuesOf(this.draft.base() ?? this.tokens.token());

  /** Regras ligadas, que respondem antes da resposta padrão; `null` enquanto carrega (ou sem acesso). */
  protected readonly activeRules = signal<number | null>(null);

  constructor() {
    this.form.reset(this.saved);
    this.draft.register(this);
    const tokenId = this.tokens.token()?.uuid;
    if (tokenId) {
      this.checks
        .rules(tokenId)
        .then((rules) =>
          this.activeRules.set(rules.filter((rule) => rule.enabled !== false).length),
        )
        .catch(() => this.activeRules.set(null));
    }
  }

  protected unsaved(): boolean {
    return this.draft.dirtySections().includes(this.id);
  }

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  /** Leitura do slider para o leitor de tela: "2 seconds" (CHECKS-21). */
  protected readonly seconds = (value: number): string => $localize`${value}:seconds: seconds`;

  protected cleanupLimit(): string | null {
    const value = this.form.controls.auto_cleanup.value;
    return value === 'off' ? null : value;
  }

  changes(): ChangeLine[] {
    const now = this.form.getRawValue();
    const was = this.saved;
    const seconds = (value: number | null) => $localize`${value ?? 0}:seconds: s`;
    const cleanup = (value: CleanupOption) => (value === 'off' ? $localize`Disabled` : value);
    return [
      ...changeOf($localize`Default status code`, was.default_status, now.default_status),
      ...changeOf(
        $localize`Content Type`,
        was.default_content_type || 'text/plain',
        now.default_content_type || 'text/plain',
      ),
      ...changeOf($localize`Response body`, was.default_content, now.default_content),
      ...changeOf($localize`Timeout before response`, seconds(was.timeout), seconds(now.timeout)),
      ...changeOf('Retry-After', was.retry_after, now.retry_after),
      ...changeOf($localize`Auto cleanup`, cleanup(was.auto_cleanup), cleanup(now.auto_cleanup)),
      ...changeOf('CORS', onOff(was.cors), onOff(now.cors)),
    ];
  }

  invalid(): string[] {
    return pendingLabels(this.fields());
  }

  settings(): TokenSettings {
    const value = this.form.getRawValue();
    return {
      default_status: value.default_status,
      // Em branco é o padrão do servidor, como o campo ausente no app atual.
      default_content_type: value.default_content_type || 'text/plain',
      // O campo numérico apagado vem `null`: vazio é 0, como no Create (e o servidor recusa null).
      timeout: String(value.timeout ?? 0),
      default_content: value.default_content,
      retry_after: value.retry_after || null,
      auto_cleanup:
        value.auto_cleanup === 'off' ? null : (Number(value.auto_cleanup) as AutoCleanup),
    };
  }

  cors(): boolean | null {
    const wanted = this.form.controls.cors.value;
    return wanted === this.saved.cors ? null : wanted;
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
    this.saved = valuesOf(token);
    this.form.reset(this.saved);
  }

  /** O que o servidor recusou nos campos deste cartão (422). */
  refused(error: unknown): string[] {
    const refused = this.serverFields().filter(([control, name]) => {
      const messages = fieldErrors(error, name);
      if (messages.length > 0) {
        control.setErrors({ server: messages.join(' ') });
        control.markAsTouched();
      }
      return messages.length > 0;
    });
    return refused.map(([, , label]) => label);
  }

  sketch(): Record<string, unknown> {
    return this.form.getRawValue();
  }

  restore(sketch: Record<string, unknown>): void {
    this.form.patchValue(sketch);
    this.form.markAsDirty();
  }

  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.default_status, 'default_status', $localize`Default status code`],
      [c.timeout, 'timeout', $localize`Timeout before response`],
      [c.retry_after, 'retry_after', 'Retry-After'],
    ];
  }

  /** Os campos como o 422 os nomeia. */
  private serverFields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      ...this.fields(),
      [c.default_content_type, 'default_content_type', $localize`Content Type`],
      [c.default_content, 'default_content', $localize`Response body`],
    ];
  }
}

function valuesOf(token: Token | null) {
  return {
    default_status: String(token?.default_status ?? 200),
    default_content_type: token?.default_content_type ?? '',
    timeout: (token?.timeout ?? 0) as number | null,
    default_content: token?.default_content ?? '',
    retry_after: String(token?.retry_after ?? ''),
    auto_cleanup: (token?.auto_cleanup ? String(token.auto_cleanup) : 'off') as CleanupOption,
    cors: token?.cors ?? false,
  };
}
