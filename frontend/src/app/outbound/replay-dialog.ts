import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { WebhookRequest } from '../requests/webhook-request';
import { OutboundResult, TIMEOUT_DEFAULT_S, pathSuffix, requestErrorText } from './outbound';
import { OutboundResultView } from './outbound-result-view';
import { OutboundStore } from './outbound-store';
import { TARGET_ERROR, TIMEOUT_ERROR, targetValidators, timeoutValidators } from './outbound-form';
import { rememberTarget, rememberedTarget } from './replay-target';

export interface ReplayDialogData {
  request: WebhookRequest;
}

/**
 * "Replay" da mensagem: o servidor reenvia método, headers (sem os de conexão) e corpo gravados
 * para o destino. O destino fica lembrado por URL de webhook; o diálogo fica aberto com o
 * resultado, para reenviar de novo.
 */
@Component({
  selector: 'app-replay-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    MatSlideToggle,
    MatButton,
    OutboundResultView,
  ],
  templateUrl: './replay-dialog.html',
  styleUrl: './outbound-dialog.scss',
})
export class ReplayDialog {
  protected readonly data = inject<ReplayDialogData>(MAT_DIALOG_DATA);
  private readonly store = inject(OutboundStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly form = this.formBuilder.group({
    url: [rememberedTarget(this.data.request.token_id), targetValidators],
    keepPath: [true],
    timeout: [TIMEOUT_DEFAULT_S, timeoutValidators],
  });

  /** O que "Keep path" acrescenta ao destino (`/pedidos?x=1`). */
  protected readonly suffix = pathSuffix(this.data.request);
  protected readonly targetError = TARGET_ERROR;
  protected readonly timeoutError = TIMEOUT_ERROR;
  protected readonly sending = signal(false);
  protected readonly result = signal<OutboundResult | null>(null);
  protected readonly failure = signal<string | null>(null);
  /** URL do último disparo, para o resultado apontar se o servidor trocou o host. */
  protected readonly sentUrl = signal('');

  protected async replayRequest(): Promise<void> {
    if (this.form.invalid || this.sending()) {
      this.form.markAllAsTouched();
      return;
    }
    const { url, keepPath, timeout } = this.form.getRawValue();
    const request = this.data.request;
    rememberTarget(request.token_id, url);
    this.sending.set(true);
    this.failure.set(null);
    this.sentUrl.set(keepPath ? `${url}${this.suffix}` : url);
    try {
      this.result.set(
        await this.store.replay(request.token_id, request.uuid, {
          url,
          keep_path: keepPath,
          timeout: timeout * 1000,
        }),
      );
    } catch (error) {
      this.result.set(null);
      this.failure.set(requestErrorText(error));
    } finally {
      this.sending.set(false);
    }
  }
}
