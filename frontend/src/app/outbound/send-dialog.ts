import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import {
  OUTBOUND_METHODS,
  OutboundResult,
  SendDraft,
  TIMEOUT_DEFAULT_S,
  requestErrorText,
} from './outbound';
import { TARGET_ERROR, TIMEOUT_ERROR, targetValidators, timeoutValidators } from './outbound-form';
import { OutboundResultView } from './outbound-result-view';
import { OutboundStore } from './outbound-store';
import { rememberedTarget } from './replay-target';

export interface SendDialogData {
  /** URL de webhook de onde sai o disparo (e cuja assinatura assina). */
  token: Token;
  /** Requisição já preenchida ("Send as new…"); sem ela, um POST vazio para o destino lembrado. */
  draft?: SendDraft;
}

type HeaderGroup = FormGroup<{ name: FormControl<string>; value: FormControl<string> }>;

/**
 * "Send": monta uma requisição (método, URL, headers, corpo) e o servidor a dispara. "Sign with
 * this URL's signature" assina com a configuração HMAC da URL, sem o segredo sair do servidor;
 * sem assinatura configurada, a opção fica desligada e explica por quê.
 */
@Component({
  selector: 'app-send-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatSelect,
    MatOption,
    MatSlideToggle,
    MatButton,
    OutboundResultView,
  ],
  templateUrl: './send-dialog.html',
  styleUrl: './outbound-dialog.scss',
})
export class SendDialog {
  protected readonly data = inject<SendDialogData>(MAT_DIALOG_DATA);
  private readonly store = inject(OutboundStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  private readonly draft: SendDraft = this.data.draft ?? {
    method: 'POST',
    url: rememberedTarget(this.data.token.uuid),
    headers: [],
    body: '',
  };

  /** Provedor da assinatura da URL; `null` quando ela não assina. */
  protected readonly signature = this.data.token.signature
    ? SIGNATURE_PROVIDER_LABELS[this.data.token.signature.provider]
    : null;

  protected readonly form = this.formBuilder.group({
    method: [this.draft.method, Validators.required],
    url: [this.draft.url, targetValidators],
    headers: this.formBuilder.array<HeaderGroup>(
      this.draft.headers.map(([name, value]) => this.headerGroup(name, value)),
    ),
    body: [this.draft.body],
    sign: [{ value: false, disabled: this.signature === null }],
    timeout: [TIMEOUT_DEFAULT_S, timeoutValidators],
  });

  protected readonly methods = OUTBOUND_METHODS;
  protected readonly targetError = TARGET_ERROR;
  protected readonly timeoutError = TIMEOUT_ERROR;
  protected readonly sending = signal(false);
  protected readonly result = signal<OutboundResult | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly sentUrl = signal('');

  protected addHeader(): void {
    this.form.controls.headers.push(this.headerGroup('', ''));
  }

  protected removeHeader(index: number): void {
    this.form.controls.headers.removeAt(index);
  }

  protected async sendRequest(): Promise<void> {
    if (this.form.invalid || this.sending()) {
      this.form.markAllAsTouched();
      return;
    }
    const { method, url, headers, body, sign, timeout } = this.form.getRawValue();
    this.sending.set(true);
    this.failure.set(null);
    this.sentUrl.set(url);
    try {
      this.result.set(
        await this.store.send(this.data.token.uuid, {
          url,
          method,
          // Linha repetida: vale a última, como num objeto JSON.
          headers: Object.fromEntries(headers.map(({ name, value }) => [name.trim(), value])),
          body,
          sign,
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

  private headerGroup(name: string, value: string): HeaderGroup {
    return this.formBuilder.group({
      name: [name, [Validators.required, Validators.pattern(/^\s*[!#$%&'*+.^_`|~\w-]+\s*$/)]],
      value: [value],
    });
  }
}
