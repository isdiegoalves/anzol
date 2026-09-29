import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UrlAccess } from './url-access';
import { UrlLock } from './url-lock';

/** Sem `Retry-After` legível, espera um minuto (a janela das 10 tentativas do servidor). */
const DEFAULT_WAIT_SECONDS = 60;

/**
 * Tela de desbloqueio da URL protegida: aparece no lugar da página quando uma chamada da URL volta
 * 401 `{"protected": true}`. O segredo certo grava o cookie de acesso e a página volta do zero.
 */
@Component({
  selector: 'app-unlock-screen',
  imports: [ReactiveFormsModule, MatFormField, MatLabel, MatError, MatInput, MatButton],
  templateUrl: './unlock-screen.html',
  styleUrl: './unlock-screen.scss',
})
export class UnlockScreen {
  private readonly access = inject(UrlAccess);
  protected readonly notice = inject(UrlLock).notice;
  private readonly snackBar = inject(MatSnackBar);
  private readonly location = inject(DOCUMENT).location;
  private readonly formBuilder = inject(NonNullableFormBuilder);

  readonly tokenId = input.required<string>();

  protected readonly form = this.formBuilder.group({
    secret: ['', Validators.required],
  });
  protected readonly webhookUrl = computed(
    () => `${this.location.protocol}//${this.location.host}/${this.tokenId()}`,
  );
  protected readonly unlocking = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Segundos até poder tentar de novo depois do 429; 0 libera. */
  protected readonly waiting = signal(0);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  protected async unlockUrl(): Promise<void> {
    if (this.unlocking() || this.waiting() > 0 || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.unlocking.set(true);
    this.error.set(null);
    try {
      await this.access.unlock(this.tokenId(), this.form.getRawValue().secret);
      this.snackBar.open($localize`URL unlocked`, undefined, { duration: 1000 });
    } catch (error) {
      this.failed(error);
    } finally {
      this.unlocking.set(false);
    }
  }

  private failed(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 429) {
      const headers = (error as HttpErrorResponse).headers;
      this.wait(retryAfterSeconds(headers.get('Retry-After')));
      return;
    }
    this.error.set(
      status === 401
        ? $localize`Wrong secret. Try again.`
        : $localize`Could not unlock the URL (${status || $localize`unknown`}:status:).`,
    );
    this.form.controls.secret.setValue('');
  }

  /** Conta os segundos na tela; o botão volta quando chega a zero. */
  private wait(seconds: number): void {
    clearInterval(this.timer);
    this.waiting.set(seconds);
    this.timer = setInterval(() => {
      this.waiting.update((left) => Math.max(0, left - 1));
      if (this.waiting() === 0) {
        clearInterval(this.timer);
      }
    }, 1000);
  }
}

/** `Retry-After` em segundos ou data HTTP (RFC 9110 §10.2.3), arredondado para cima. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (value && /^\d+$/.test(value.trim())) {
    return Math.max(1, Number(value.trim()));
  }
  const date = value ? Date.parse(value) : NaN;
  return Number.isNaN(date) ? DEFAULT_WAIT_SECONDS : Math.max(1, Math.ceil((date - now) / 1000));
}
