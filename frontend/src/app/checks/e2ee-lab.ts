import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { fromNow, localDate } from '../request-detail/dates';
import { LabActual, LabCreated, LabExpected, LabReport } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { ChecksStore } from './checks-store';
import { fieldErrors } from './url-settings';

/** O erro da rodada numa frase: o 429 com a espera do `Retry-After`, a recusa do servidor ou o status. */
export function labRunFailure(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    const retryAfter = error.headers.get('Retry-After');
    return retryAfter && /^\d+$/.test(retryAfter)
      ? $localize`Too many runs for this URL (up to 6 per minute). Try again in ${retryAfter}:seconds: s.`
      : $localize`Too many runs for this URL (up to 6 per minute). Try again in a moment.`;
  }
  const refused = fieldErrors(error, 'lab', 'scenarios');
  if (refused.length > 0) {
    return $localize`The server refused the run: ${refused.join(' ')}:reason:`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
  return $localize`Could not run the scenarios (${status}:status:).`;
}

/** Estado, motivo e chave como a API os grava: `invalid (downgrade)`, `valid · kid enc-v2`. */
export function labOutcome(outcome: LabExpected | LabActual): string {
  const state = outcome.state ?? '—';
  const reason = outcome.reason ? ` (${outcome.reason})` : '';
  const kid = outcome.kid ? ` · kid ${outcome.kid}` : '';
  return `${state}${reason}${kid}`;
}

/**
 * O laboratório E2EE no cartão. Na URL de laboratório, roda os cenários do contrato no servidor e
 * mostra o relatório; nas outras, cria uma URL de laboratório e mostra os segredos dela uma vez.
 */
@Component({
  selector: 'app-e2ee-lab',
  imports: [Icon, MatButton, RouterLink],
  templateUrl: './e2ee-lab.html',
  styleUrl: './e2ee-lab.scss',
})
export class E2eeLab {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly tokenId = computed(() => this.tokens.token()?.uuid ?? '');
  protected readonly lab = computed(() => this.tokens.token()?.lab ?? null);
  protected readonly expires = computed(() => {
    const lab = this.lab();
    return lab
      ? $localize`Expires ${fromNow(lab.expires_at)}:relative: (${localDate(lab.expires_at)}:date:)`
      : '';
  });

  protected readonly running = signal(false);
  protected readonly report = signal<LabReport | null>(null);
  protected readonly failure = signal<string | null>(null);
  /** Os que divergem primeiro; dentro de cada grupo, a ordem do catálogo. */
  protected readonly rows = computed(() =>
    [...(this.report()?.results ?? [])].sort((a, b) => Number(a.ok) - Number(b.ok)),
  );
  protected readonly differing = computed(() => this.rows().filter((row) => !row.ok).length);

  protected readonly creating = signal(false);
  protected readonly refusal = signal<string | null>(null);

  protected readonly outcome = labOutcome;

  protected async runScenarios(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.running()) {
      return;
    }
    this.running.set(true);
    this.failure.set(null);
    this.report.set(null);
    try {
      this.report.set(await this.checks.runLab(tokenId));
    } catch (error) {
      this.failure.set(labRunFailure(error));
    } finally {
      this.running.set(false);
    }
  }

  /** Cria a URL, destranca com o segredo dela, mostra os segredos e a abre em Checks › E2EE. */
  protected async createLab(): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    this.refusal.set(null);
    let created: LabCreated;
    try {
      created = await this.checks.createLab();
    } catch (error) {
      const refused = fieldErrors(error, 'lab');
      const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
      this.refusal.set(
        refused.length > 0
          ? refused.join(' ')
          : $localize`Could not create the lab URL (${status}:status:).`,
      );
      return;
    } finally {
      this.creating.set(false);
    }
    const uuid = created.token.uuid;
    // Sem o cookie, a URL abre na tela de desbloqueio, que aceita o segredo mostrado no diálogo.
    await this.checks.unlock(uuid, created.read_secret).catch(() => undefined);
    const { showLabSecrets } = await import('./lab-secrets-dialog');
    await showLabSecrets(this.injector, created);
    await this.router.navigate(['/', uuid, 'checks'], { queryParams: { section: 'e2ee' } });
  }

  protected openLabel(code: string, requestId: string): string {
    return $localize`Open request #${requestId.slice(0, 8)}:id: of ${code}:code: in the Inbox`;
  }
}
