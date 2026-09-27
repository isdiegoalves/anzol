import { Component, ElementRef, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { AUTO_CLEANUP_LIMITS, AutoCleanup, Token, retryAfterValidator } from '../token/token';
import { TokenStore } from '../token/token-store';
import { ChecksStore } from './checks-store';
import { SaveBar, SaveNotice } from './save-bar';
import { PendingField, pendingSummary, saveErrorNotice } from './url-settings';

const INTEGER = /^[+-]?\d+$/;
/** Valor do segmentado "Auto cleanup": `off` desliga (vai `null`). */
type CleanupOption = 'off' | `${AutoCleanup}`;

/**
 * Checks › Response (C §2.6): a resposta padrão quando nenhuma regra casa (status, Content-Type,
 * corpo, atraso), Retry-After, Auto cleanup em segmentado com a explicação por extenso e o CORS.
 * O CORS vale na hora, pelo toggle de hoje; o resto só com "Save response".
 */
@Component({
  selector: 'app-response-card',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
    SaveBar,
  ],
  templateUrl: './response-card.html',
  styleUrls: ['./card.scss', './response-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'response-title' },
})
export class ResponseCard {
  protected readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly limits = AUTO_CLEANUP_LIMITS.map(String);
  protected readonly form = this.formBuilder.group({
    default_status: ['', [Validators.required, Validators.pattern(INTEGER)]],
    default_content_type: [''],
    timeout: ['', [Validators.pattern(INTEGER), Validators.min(0), Validators.max(10)]],
    default_content: [''],
    retry_after: ['', retryAfterValidator],
    auto_cleanup: ['off' as CleanupOption],
  });
  protected readonly attempted = signal(false);
  protected readonly saving = signal(false);
  protected readonly notice = signal<SaveNotice | null>(null);
  protected readonly togglingCors = signal(false);
  /** A URL como este cartão a leu: o save confere se o campo dele mudou lá fora. */
  private readonly base = signal(this.tokens.token());

  constructor() {
    this.reset(this.tokens.token());
  }

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  protected cleanupLimit(): string | null {
    const value = this.form.controls.auto_cleanup.value;
    return value === 'off' ? null : value;
  }

  protected discard(): void {
    this.reset(this.base());
  }

  /** "Reload" depois de "changed elsewhere": o cartão volta à URL como está no servidor. */
  protected async reloadCard(): Promise<void> {
    const base = this.base();
    if (base) {
      const token = await this.checks.reload(base.uuid);
      this.base.set(token);
      this.reset(token);
      this.notice.set(null);
    }
  }

  protected async toggleCors(): Promise<void> {
    this.togglingCors.set(true);
    await this.checks.toggleCors();
    this.togglingCors.set(false);
  }

  protected async saveResponse(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.notice.set(null);
    if (this.form.invalid) {
      this.showPending();
      return;
    }
    const value = this.form.getRawValue();
    const base = this.base();
    if (!base) {
      return;
    }
    this.saving.set(true);
    try {
      const token = await this.checks.save(
        {
          default_status: value.default_status,
          // Em branco é o padrão do servidor, como o campo ausente no app atual.
          default_content_type: value.default_content_type || 'text/plain',
          // O campo numérico apagado vem `null`: vazio é 0, como no Create (e o servidor recusa null).
          timeout: value.timeout == null || value.timeout === '' ? '0' : String(value.timeout),
          default_content: value.default_content,
          retry_after: value.retry_after || null,
          auto_cleanup:
            value.auto_cleanup === 'off' ? null : (Number(value.auto_cleanup) as AutoCleanup),
        },
        base,
      );
      this.base.set(token);
      this.reset(token);
      this.notice.set({ text: 'Saved.', error: false });
    } catch (error) {
      this.notice.set(saveErrorNotice(error));
    } finally {
      this.saving.set(false);
    }
  }

  private reset(token: Token | null): void {
    this.form.reset({
      default_status: String(token?.default_status ?? 200),
      default_content_type: token?.default_content_type ?? '',
      timeout: String(token?.timeout ?? 0),
      default_content: token?.default_content ?? '',
      retry_after: String(token?.retry_after ?? ''),
      auto_cleanup: token?.auto_cleanup ? (String(token.auto_cleanup) as CleanupOption) : 'off',
    });
    this.attempted.set(false);
  }

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

  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.default_status, 'default_status', 'Default status code'],
      [c.timeout, 'timeout', 'Timeout before response'],
      [c.retry_after, 'retry_after', 'Retry-After'],
    ];
  }
}
