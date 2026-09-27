import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import {
  OUTBOUND_METHODS,
  OutboundResult,
  SendDraft,
  TIMEOUT_DEFAULT_S,
  requestErrorText,
} from './outbound';
import { TARGET_ERROR, TIMEOUT_ERROR, targetValidators, timeoutValidators } from './outbound-form';
import { OutboundStore } from './outbound-store';
import { rememberedTarget } from './replay-target';

type HeaderGroup = FormGroup<{ name: FormControl<string>; value: FormControl<string> }>;

/**
 * Compositor "Send request" (era o diálogo): método, URL, headers, corpo e timeout; o servidor
 * dispara. "Sign with this URL's signature" assina com a configuração HMAC da URL, sem o segredo
 * sair do servidor; sem assinatura configurada, a opção fica desligada e diz onde configurar.
 */
@Component({
  selector: 'app-send-composer',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    MatSlideToggle,
  ],
  templateUrl: './send-composer.html',
  styleUrls: ['./composer.scss'],
  host: { role: 'region', 'aria-labelledby': 'send-title' },
})
export class SendComposer implements OnInit {
  private readonly store = inject(OutboundStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  readonly token = input.required<Token>();
  /** Requisição já preenchida ("Send as new…", `?send-from=`); sem ela, um POST vazio. */
  readonly draft = input<SendDraft | null>(null);
  /** Começa assinando (`?send=signed`, "Send as new with a fresh signature"). */
  readonly sign = input(false);
  readonly sent = output<OutboundResult>();

  protected readonly form = this.formBuilder.group({
    method: ['POST', Validators.required],
    url: ['', targetValidators],
    headers: this.formBuilder.array<HeaderGroup>([]),
    body: [''],
    sign: [false],
    timeout: [TIMEOUT_DEFAULT_S, timeoutValidators],
  });

  /** Provedor da assinatura da URL; `null` quando ela não assina. */
  protected signature: string | null = null;
  protected readonly methods = OUTBOUND_METHODS;
  protected readonly targetError = TARGET_ERROR;
  protected readonly timeoutError = TIMEOUT_ERROR;
  protected readonly sending = signal(false);
  protected readonly failure = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.token();
    const draft = this.draft() ?? {
      method: 'POST',
      url: rememberedTarget(token.uuid),
      headers: [],
      body: '',
    };
    this.signature = token.signature ? SIGNATURE_PROVIDER_LABELS[token.signature.provider] : null;
    for (const [name, value] of draft.headers) {
      this.form.controls.headers.push(this.headerGroup(name, value));
    }
    this.form.patchValue({
      method: draft.method,
      url: draft.url,
      body: draft.body,
      sign: this.signature !== null && this.sign(),
    });
    if (this.signature === null) {
      this.form.controls.sign.disable();
    }
  }

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
    try {
      this.sent.emit(
        await this.store.send(this.token().uuid, {
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
