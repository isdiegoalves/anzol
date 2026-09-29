import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  OutboundResult,
  TIMEOUT_DEFAULT_S,
  TIMEOUT_MAX_S,
  TIMEOUT_MIN_S,
  outboundErrorText,
  pathSuffix,
  requestErrorText,
} from '../outbound/outbound';
import { OutboundStore } from '../outbound/outbound-store';
import { WebhookRequest } from '../requests/webhook-request';
import { reasonPhrase } from '../ui/status-code';
import { ActionPanelStore } from './action-panel-store';

/** A mesma chave da Saída: os dois lembram o mesmo destino. */
const REPLAY_TARGETS_KEY = 'replayTargets';
const BODY_SHOWN = 200;

function rememberedTargets(): Record<string, string> {
  try {
    return (JSON.parse(localStorage.getItem(REPLAY_TARGETS_KEY) ?? '{}') ?? {}) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

export function withScheme(target: string): string {
  const trimmed = target.trim();
  return /^https?:\/\//i.test(trimmed) || trimmed === '' ? trimmed : `http://${trimmed}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** A aba Replay do painel de ação; o histórico fica na Saída. */
@Component({
  selector: 'app-replay-panel',
  imports: [RouterLink],
  template: `
    <form
      class="replay"
      role="region"
      aria-labelledby="replay-panel-title"
      (submit)="replay($event)"
    >
      <h3 class="title" id="replay-panel-title" i18n>Replay request</h3>
      <div class="row">
        <label class="field url">
          <span i18n>Target URL</span>
          <input
            #box
            type="text"
            name="target"
            autocomplete="off"
            spellcheck="false"
            aria-label="Target URL"
            i18n-aria-label
            placeholder="localhost:3000/webhooks"
            i18n-placeholder
            [value]="target()"
            (input)="setTarget(box.value)"
          />
        </label>
        <button type="submit" class="go" [attr.aria-disabled]="sending() || null">
          @if (sending()) {
            <ng-container i18n>Replaying…</ng-container>
          } @else {
            <ng-container i18n="action|Botão que manda a requisição">Replay</ng-container>
          }
        </button>
      </div>
      @if (target().trim()) {
        <p class="hint" i18n>
          Sends to <code>{{ sendsTo() }}</code>
        </p>
      }
      @if (translated(); as host) {
        <p class="hint">{{ host }}</p>
      }
      <div class="row options">
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            [checked]="keepPath()"
            (change)="keepPath.set(!keepPath())"
          />
          <span i18n>Keep path and query</span>
        </label>
        <label class="field timeout">
          <span i18n>Timeout (s)</span>
          <input
            #seconds
            type="number"
            aria-label="Timeout (s)"
            i18n-aria-label
            [min]="timeoutMin"
            [max]="timeoutMax"
            [value]="timeout()"
            (input)="timeout.set(seconds.valueAsNumber)"
          />
        </label>
      </div>
      @if (invalid()) {
        <p class="error" role="alert" i18n>The target must be an http:// or https:// address.</p>
      }
      <a class="link" [routerLink]="['/', request().token_id, 'outbound']" i18n>Open in Outbound</a>
    </form>
  `,
  styleUrl: './replay-panel.scss',
})
export class ReplayPanel {
  private readonly outbound = inject(OutboundStore);
  private readonly panel = inject(ActionPanelStore);

  readonly request = input.required<WebhookRequest>();

  protected readonly timeoutMin = TIMEOUT_MIN_S;
  protected readonly timeoutMax = TIMEOUT_MAX_S;
  protected readonly keepPath = signal(true);
  protected readonly timeout = signal(TIMEOUT_DEFAULT_S);
  protected readonly sending = signal(false);
  protected readonly invalid = signal(false);
  private readonly last = signal<{ typed: string; result: OutboundResult } | null>(null);

  protected readonly target = computed(
    () => this.panel.target() ?? rememberedTargets()[this.request().token_id] ?? '',
  );
  protected readonly sendsTo = computed(() => {
    const url = withScheme(this.target()).replace(/\/+$/, '');
    return this.keepPath() ? `${url}${pathSuffix(this.request())}` : url;
  });
  protected readonly translated = computed(() => {
    const last = this.last();
    if (!last) {
      return '';
    }
    const [typed, reached] = [hostOf(withScheme(last.typed)), hostOf(last.result.target)];
    return typed && reached && typed !== reached
      ? $localize`You typed ${typed}:typed:. The server reaches it as ${reached}:resolved:.`
      : '';
  });

  protected setTarget(value: string): void {
    this.panel.target.set(value);
    this.invalid.set(false);
  }

  protected async replay(event: Event): Promise<void> {
    event.preventDefault();
    const url = withScheme(this.target());
    if (this.sending()) {
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.invalid.set(true);
      return;
    }
    const request = this.request();
    const typed = this.target();
    this.sending.set(true);
    try {
      const targets = { ...rememberedTargets(), [request.token_id]: url };
      localStorage.setItem(REPLAY_TARGETS_KEY, JSON.stringify(targets));
    } catch {
      // Sem localStorage, o destino fica só no painel.
    }
    try {
      const result = await this.outbound.replay(request.token_id, request.uuid, {
        url,
        keep_path: this.keepPath(),
        timeout: Math.min(Math.max(this.timeout() || TIMEOUT_DEFAULT_S, 1), 30) * 1000,
      });
      this.last.set({ typed, result });
      this.panel.result.set(resultText(result));
    } catch (error) {
      this.panel.result.set(
        $localize`Replay did not get an answer: ${requestErrorText(error)}:reason:`,
      );
    } finally {
      this.sending.set(false);
    }
  }
}

function resultText(result: OutboundResult): string {
  if (result.error) {
    const reason =
      result.error.kind === 'blocked'
        ? $localize`Blocked: this server only sends to public addresses.`
        : (({ title, detail }) => `${title}: ${detail}`)(outboundErrorText(result.error));
    return $localize`Replay did not get an answer: ${reason}:reason:`;
  }
  const status = `${result.status ?? ''} ${reasonPhrase(result.status ?? 0) ?? ''}`.trim();
  const body = (result.body ?? '').slice(0, BODY_SHOWN);
  const line = $localize`Replay result: ${status}:status: in ${result.duration_ms}:ms: ms`;
  return body ? `${line}. ${body}` : line;
}
