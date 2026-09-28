import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { routeOf } from '../pipeline/pipeline';
import { parseUtc } from '../request-detail/dates';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { RuleStore } from '../rules/rule-store';
import { TokenStore } from '../token/token-store';
import { cliListenCommand } from '../token/token';
import { Icon } from '../ui/icon';
import { GuideStep } from './guide-step';
import { firstSteps } from './guide-steps';

/**
 * Roteiro "First webhook" (R1): mandar a primeira requisição, vê-la chegar e, se quiser, conferir
 * a assinatura, escolher a resposta e testar um retry. Cada passo é um atalho para o que já existe.
 */
@Component({
  selector: 'app-first-guide',
  imports: [GuideStep, Icon, MatButton, MatTab, MatTabGroup, RouterLink],
  templateUrl: './first-guide.html',
  styleUrl: './first-guide.scss',
})
export class FirstGuide {
  private readonly requests = inject(RequestStore);
  private readonly tokens = inject(TokenStore);
  private readonly rules = inject(RuleStore);
  private readonly clipboard = inject(Clipboard);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly document = inject(DOCUMENT);

  readonly tokenId = input.required<string>();
  readonly openRequest = output<WebhookRequest>();

  /** Regras da URL, lidas uma vez ao abrir (sem mexer na lista da página de Regras). */
  private readonly ruleCount = signal(0);
  protected readonly steps = computed(() => {
    const token = this.tokens.token();
    const unread = this.requests.unread();
    return firstSteps({
      tokenId: this.tokenId(),
      requests: Math.max(this.requests.total(), this.requests.requests().length),
      opened: this.requests.requests().some(({ uuid }) => !unread.includes(uuid)),
      signature: token?.uuid === this.tokenId() && !!token.signature,
      rules: this.ruleCount(),
    });
  });

  protected readonly url = computed(() => `${this.document.location.origin}/${this.tokenId()}`);
  protected readonly curl = computed(
    () => `curl -X POST -H 'Content-Type: application/json' -d '{"hello":"world"}' ${this.url()}`,
  );
  protected readonly cli = computed(() =>
    cliListenCommand(this.document.location.origin, this.tokenId()),
  );
  /** A requisição que chegou: a mais nova da lista. */
  protected readonly arrived = computed(() => this.requests.newest());
  protected readonly arrivedText = computed(() => {
    const request = this.arrived();
    if (!request) {
      return '';
    }
    const time = new Intl.DateTimeFormat(this.document.documentElement.lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(parseUtc(request.created_at));
    return $localize`${request.method}:method: ${routeOf(request.url)}:path:, at ${time}:time:.`;
  });

  protected readonly sending = signal(false);
  protected readonly sent = signal('');

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      this.ruleCount.set(0);
      void this.rules.listRules(tokenId).then(
        (rules) => tokenId === this.tokenId() && this.ruleCount.set(rules.length),
        // Sem as regras, o passo fica "optional".
        () => undefined,
      );
    });
  }

  protected copyCurl(): void {
    this.clipboard.copy(this.curl());
    void this.announcer.announce($localize`Command copied. It has this URL, which is a secret.`);
  }

  /** Manda um POST com JSON para a captura; a requisição chega pela lista, em tempo real. */
  protected async sendTest(): Promise<void> {
    this.sending.set(true);
    this.sent.set('');
    try {
      const response = await fetch(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test',
          message: 'Hello from Anzol',
          sent_at: new Date().toISOString(),
        }),
      });
      this.sent.set(
        $localize`Sent. The URL answered ${response.status}:status:; the request shows up in the list.`,
      );
    } catch {
      this.sent.set(
        $localize`Could not send the test request. Check that the server is running and try again.`,
      );
    } finally {
      this.sending.set(false);
    }
  }
}
