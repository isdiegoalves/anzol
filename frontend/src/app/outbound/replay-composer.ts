import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { outputFromObservable, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import { MethodBadge } from '../ui/method-badge';
import {
  OutboundResult,
  TIMEOUT_DEFAULT_S,
  ageText,
  pathSuffix,
  requestErrorText,
  staleSignature,
} from './outbound';
import { TARGET_ERROR, TIMEOUT_ERROR, targetValidators, timeoutValidators } from './outbound-form';
import { OutboundStore } from './outbound-store';
import { rememberTarget, rememberedTarget } from './replay-target';

/**
 * Compositor "Replay request" (era o diálogo): a mensagem a reenviar, o destino (lembrado por URL
 * de webhook), "Keep path" e o timeout. O servidor reenvia método, headers e corpo como chegaram.
 * Se a mensagem traz uma assinatura com horário (Stripe, Slack) mais velha que a tolerância, avisa
 * que o receptor vai recusar e oferece "Send as new with a fresh signature".
 */
@Component({
  selector: 'app-replay-composer',
  imports: [
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MethodBadge,
    ReactiveFormsModule,
    RouterLink,
    MatAnchor,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
  ],
  templateUrl: './replay-composer.html',
  styleUrls: ['./composer.scss'],
  host: { role: 'region', 'aria-labelledby': 'replay-title' },
})
export class ReplayComposer implements OnInit {
  private readonly store = inject(OutboundStore);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  readonly token = input.required<Token>();
  /** Mensagens que podem ser reenviadas (as mais novas da URL). */
  readonly requests = input.required<readonly WebhookRequest[]>();
  /** A escolhida de início (`?replay=` ou a aberta na Inbox). */
  readonly initial = input<string | null>(null);
  readonly sent = output<OutboundResult>();
  /** "Send as new with a fresh signature": o Send com esta mensagem e a assinatura da URL. */
  readonly resign = output<WebhookRequest>();

  protected readonly form = this.formBuilder.group({
    request: [''],
    url: ['', targetValidators],
    keepPath: [true],
    timeout: [TIMEOUT_DEFAULT_S, timeoutValidators],
  });
  /** A mensagem escolhida mudou (o "Redirect Now" do Forward usa a mesma). */
  readonly picked = outputFromObservable(this.form.controls.request.valueChanges);
  private readonly chosenId = toSignal(this.form.controls.request.valueChanges, {
    initialValue: '',
  });
  protected readonly chosen = computed(
    () => this.requests().find((request) => request.uuid === this.chosenId()) ?? null,
  );
  protected readonly stale = computed(() => {
    const request = this.chosen();
    return request ? staleSignature(request, this.token()) : null;
  });
  protected readonly signer = computed(() => {
    const signature = this.token().signature;
    return signature ? SIGNATURE_PROVIDER_LABELS[signature.provider] : null;
  });
  protected readonly targetError = TARGET_ERROR;
  protected readonly timeoutError = TIMEOUT_ERROR;
  protected readonly sending = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly age = ageText;

  ngOnInit(): void {
    const first = this.initial() ?? this.requests()[0]?.uuid ?? '';
    this.form.patchValue({ request: first, url: rememberedTarget(this.token().uuid) });
  }

  protected readonly when = fromNow;
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  /** Para onde o replay vai: o alvo e, com "Keep path and query", o caminho e a query da mensagem. */
  protected resolved(): string {
    const { url, keepPath } = this.values();
    return url ? (keepPath ? `${url}${this.suffix()}` : url) : '…';
  }

  /** Nome do botão da mensagem: "Request to replay: #e41b7, POST /webhooks/stripe. Change". */
  protected pickLabel(): string {
    const request = this.chosen();
    if (!request) {
      return $localize`Request to replay. Choose`;
    }
    const id = request.uuid.slice(0, 5);
    const path = this.suffix() || '/';
    return $localize`Request to replay: #${id}:id:, ${request.method}:method: ${path}:path:. Change`;
  }

  /** Escolhe a mensagem na lista do botão "Change". */
  protected pick(requestId: string): void {
    this.form.controls.request.setValue(requestId);
  }

  protected suffix(): string {
    const request = this.chosen();
    return request ? pathSuffix(request) : '';
  }

  protected label(request: WebhookRequest): string {
    return `${request.method} #${request.uuid.slice(0, 5)} ${pathSuffix(request) || '/'} · ${fromNow(request.created_at)}`;
  }

  protected async replayRequest(): Promise<void> {
    const request = this.chosen();
    if (this.form.invalid || !request || this.sending()) {
      this.form.markAllAsTouched();
      return;
    }
    const { url, keepPath, timeout } = this.form.getRawValue();
    rememberTarget(this.token().uuid, url);
    this.sending.set(true);
    this.failure.set(null);
    try {
      this.sent.emit(
        await this.store.replay(this.token().uuid, request.uuid, {
          url,
          keep_path: keepPath,
          timeout: timeout * 1000,
        }),
      );
    } catch (error) {
      this.failure.set(requestErrorText(error));
    } finally {
      this.sending.set(false);
    }
  }
}
