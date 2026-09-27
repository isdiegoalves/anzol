import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatTab, MatTabGroup } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { Preferences } from '../settings/preferences';
import { cliListenCommand } from '../token/token';
import { Icon } from '../ui/icon';

/** O corpo do "Send a test request": JSON, como um webhook de verdade (não formulário). */
export function testPayload(now: Date = new Date()): string {
  return JSON.stringify({
    event: 'test',
    message: 'Hello from Anzol',
    sent_at: now.toISOString(),
  });
}

/**
 * "Your URL is ready" (C §2.10): o detalhe da URL vazia. A URL com "Copy URL" e "Open in new tab", três
 * jeitos de mandar a primeira requisição (cURL, um provedor, o CLI), o "Send a test request" e o
 * que a URL sabe fazer. O "Close" alterna `hideTutorial`, como o tutorial do app atual.
 */
@Component({
  selector: 'app-onboarding',
  imports: [CdkCopyToClipboard, Icon, MatButton, MatTab, MatTabGroup, RouterLink],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class Onboarding {
  private readonly preferences = inject(Preferences);

  /** A URL do webhook (`{origem}/{uuid}`). */
  readonly url = input.required<string>();
  readonly tokenId = input.required<string>();
  /** A URL pedida que não existia mais e foi trocada por esta (a tela avisa aqui, não num snackbar). */
  readonly missing = input<string | null>(null);

  protected readonly curl = computed(
    () => `curl -X POST -H 'Content-Type: application/json' -d '{"hello":"world"}' ${this.url()}`,
  );
  protected readonly cli = computed(() =>
    cliListenCommand(new URL(this.url()).origin, this.tokenId()),
  );

  protected readonly sending = signal(false);
  protected readonly sent = signal<{ ok: boolean; text: string } | null>(null);

  protected toggleTutorial(): void {
    this.preferences.hideTutorial.update((hidden) => !hidden);
  }

  /**
   * Manda um POST com JSON para a captura, da própria origem (`/{uuid}` não é rota de gestão). A
   * mensagem chega pela lista, em tempo real, como qualquer outra.
   */
  protected async sendTest(): Promise<void> {
    this.sending.set(true);
    this.sent.set(null);
    try {
      const response = await fetch(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: testPayload(),
      });
      this.sent.set({
        ok: true,
        text: $localize`Sent. The URL answered ${response.status}:status:; the request shows up in the list.`,
      });
    } catch {
      this.sent.set({
        ok: false,
        text: $localize`Could not send the test request. Check that the server is running and try again.`,
      });
    } finally {
      this.sending.set(false);
    }
  }
}
