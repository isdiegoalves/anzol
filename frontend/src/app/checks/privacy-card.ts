import { Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TokenSettings } from '../token/token';
import { TokenStore } from '../token/token-store';
import { ChecksStore } from './checks-store';
import { SaveBar, SaveNotice } from './save-bar';
import { PendingField, pendingSummary, updateError } from './url-settings';

/** Tamanho do segredo de leitura que o servidor aceita. */
const READ_SECRET_MIN = 8;
const READ_SECRET_MAX = 256;

/**
 * Checks › Privacy, portada da seção do antigo Edit URL (item 12): "Require a secret to view this
 * URL" com o segredo e a confirmação. Na URL já protegida, em branco mantém o segredo atual;
 * desligar tira a proteção (`read_secret: null`). Segredo novo destranca esta tela na hora.
 */
@Component({
  selector: 'app-privacy-card',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
    SaveBar,
  ],
  templateUrl: './privacy-card.html',
  styleUrls: ['./card.scss'],
  host: { role: 'region', 'aria-labelledby': 'privacy-title' },
})
export class PrivacyCard {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  /** A URL salva já exige segredo: campo em branco mantém o atual. */
  protected readonly wasProtected = signal(this.tokens.token()?.protected === true);
  protected readonly form = this.formBuilder.group({
    required: [this.wasProtected()],
    read_secret: [''],
    read_secret_confirm: [''],
  });
  protected readonly attempted = signal(false);
  protected readonly saving = signal(false);
  protected readonly notice = signal<SaveNotice | null>(null);

  constructor() {
    const c = this.form.controls;
    c.read_secret_confirm.addValidators((confirm) =>
      confirm.value === c.read_secret.value ? null : { mismatch: true },
    );
    c.required.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.sync());
    c.read_secret.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => c.read_secret_confirm.updateValueAndValidity());
    this.sync();
  }

  protected secretLabel(): string {
    return this.wasProtected() ? 'New secret' : 'Secret to view';
  }

  protected pending(): string {
    return pendingSummary(this.fields());
  }

  protected discard(): void {
    this.reset();
  }

  protected async savePrivacy(): Promise<void> {
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
      const token = await this.checks.save(this.readSecret());
      this.wasProtected.set(token.protected === true);
      this.reset();
      this.notice.set({ text: 'Saved.', error: false });
    } catch (error) {
      this.notice.set({ text: updateError(error), error: true });
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * `read_secret` só vai quando muda: segredo novo, ou `null` para tirar a proteção. Ausente mantém
   * o atual no `PUT`.
   */
  private readSecret(): Pick<TokenSettings, 'read_secret'> {
    const { required, read_secret } = this.form.getRawValue();
    if (required && read_secret !== '') {
      return { read_secret };
    }
    return !required && this.wasProtected() ? { read_secret: null } : {};
  }

  private reset(): void {
    this.form.reset({ required: this.wasProtected(), read_secret: '', read_secret_confirm: '' });
    this.attempted.set(false);
    this.sync();
  }

  /**
   * Com a proteção desligada, os campos do segredo saem da validação. O segredo é obrigatório só
   * para quem ainda não tem um.
   */
  private sync(): void {
    const c = this.form.controls;
    c.read_secret.setValidators([
      ...(this.wasProtected() ? [] : [Validators.required]),
      Validators.minLength(READ_SECRET_MIN),
      Validators.maxLength(READ_SECRET_MAX),
    ]);
    for (const control of [c.read_secret, c.read_secret_confirm]) {
      if (c.required.value) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    c.read_secret.updateValueAndValidity({ emitEvent: false });
    c.read_secret_confirm.updateValueAndValidity({ emitEvent: false });
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
      [c.read_secret, 'read_secret', this.secretLabel()],
      [c.read_secret_confirm, 'read_secret_confirm', 'Confirm secret'],
    ];
  }
}
