import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { fromNow, localDate, parseUtc } from '../request-detail/dates';
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

/**
 * Estado, motivo e chave como a API os grava, com o estado na língua da tela: `invalid (downgrade)`,
 * `valid · kid enc-v2`.
 */
export function labOutcome(outcome: LabExpected | LabActual): string {
  const states: Record<string, string> = {
    valid: $localize`:lab outcome state|:valid`,
    invalid: $localize`:lab outcome state|:invalid`,
    unknown_kid: $localize`:lab outcome state|:unknown_kid`,
    absent: $localize`:lab outcome state|:absent`,
  };
  const state = outcome.state === null ? '—' : (states[outcome.state] ?? outcome.state);
  const reason = outcome.reason ? ` (${outcome.reason})` : '';
  const kid = outcome.kid ? ` · kid ${outcome.kid}` : '';
  return `${state}${reason}${kid}`;
}

/**
 * A descrição do cenário na língua da tela, com o original no `title` quando difere. A tabela é
 * pelo texto do servidor: um cenário novo, ou uma descrição mudada, aparece como veio.
 */
export function labDescription(original: string): { text: string; original: string | null } {
  const descriptions: Record<string, string> = {
    'Round trip': $localize`:lab scenario|:Round trip`,
    'Rotation: encrypted to enc-v1 while enc-v2 is active': $localize`:lab scenario|:Rotation: encrypted to enc-v1 while enc-v2 is active`,
    'Accents and emoji in the data': $localize`:lab scenario|:Accents and emoji in the data`,
    'Large and precise numbers in the data': $localize`:lab scenario|:Large and precise numbers in the data`,
    'app in a different case from the envelope': $localize`:lab scenario|:app in a different case from the envelope`,
    'JWE without a JWS inside (the channel forging with the public key)': $localize`:lab scenario|:JWE without a JWS inside (the channel forging with the public key)`,
    'JWS from a signer that is not trusted': $localize`:lab scenario|:JWS from a signer that is not trusted`,
    'JWS with the trusted kid but signed by another key': $localize`:lab scenario|:JWS with the trusted kid but signed by another key`,
    'Ciphertext of one message in the envelope of another': $localize`:lab scenario|:Ciphertext of one message in the envelope of another`,
    'Plaintext object where the JWE should be (downgrade)': $localize`:lab scenario|:Plaintext object where the JWE should be (downgrade)`,
    'JWE for a key the URL does not have': $localize`:lab scenario|:JWE for a key the URL does not have`,
    'epk point off the P-256 curve': $localize`:lab scenario|:epk point off the P-256 curve`,
    'HMAC computed with another secret': $localize`:lab scenario|:HMAC computed with another secret`,
    'Body changed after the HMAC': $localize`:lab scenario|:Body changed after the HMAC`,
    'JWS with alg none': $localize`:lab scenario|:JWS with alg none`,
    'JWS with alg HS256': $localize`:lab scenario|:JWS with alg HS256`,
    'app different from the envelope': $localize`:lab scenario|:app different from the envelope`,
    'aud of another recipient': $localize`:lab scenario|:aud of another recipient`,
    'JWE header without cty': $localize`:lab scenario|:JWE header without cty`,
    'JWS without data': $localize`:lab scenario|:JWS without data`,
    'evt in a different case from the envelope': $localize`:lab scenario|:evt in a different case from the envelope`,
    'iat older than the window': $localize`:lab scenario|:iat older than the window`,
    'JWE header without kid': $localize`:lab scenario|:JWE header without kid`,
    'JWE larger than 256 KiB': $localize`:lab scenario|:JWE larger than 256 KiB`,
  };
  const text = descriptions[original] ?? original;
  return { text, original: text === original ? null : original };
}

/** O laboratório criado a partir de uma URL comum, que ela guarda até ele expirar. */
interface LabOrigin {
  uuid: string;
  expires_at: string;
}

const LAB_ORIGIN_KEY = (tokenId: string) => `anzol.labFrom.${tokenId}`;

function readLabOrigin(tokenId: string): LabOrigin | null {
  try {
    const text = localStorage.getItem(LAB_ORIGIN_KEY(tokenId));
    const origin = text ? (JSON.parse(text) as Partial<LabOrigin>) : null;
    if (typeof origin?.uuid !== 'string' || typeof origin.expires_at !== 'string') {
      return null;
    }
    if (parseUtc(origin.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(LAB_ORIGIN_KEY(tokenId));
      return null;
    }
    return { uuid: origin.uuid, expires_at: origin.expires_at };
  } catch {
    return null;
  }
}

function writeLabOrigin(tokenId: string, origin: LabOrigin): void {
  try {
    localStorage.setItem(LAB_ORIGIN_KEY(tokenId), JSON.stringify(origin));
  } catch {
    // Sem storage: a URL de origem só não mostra o link.
  }
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
  /** O que deu o esperado, separado entre o que decifrou e o que foi recusado, e o que divergiu. */
  protected readonly counts = computed(() => {
    const rows = this.rows();
    const decrypted = rows.filter((row) => row.ok && row.actual.state === 'valid').length;
    const differing = rows.filter((row) => !row.ok).length;
    return { decrypted, refused: rows.length - decrypted - differing, differing };
  });

  protected readonly creating = signal(false);
  protected readonly refusal = signal<string | null>(null);
  protected readonly origin = signal<LabOrigin | null>(null);
  protected readonly fromNow = fromNow;

  protected readonly outcome = labOutcome;
  protected readonly describe = labDescription;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => this.origin.set(tokenId ? readLabOrigin(tokenId) : null));
    });
  }

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
    const expiresAt = created.token.lab?.expires_at;
    if (this.tokenId() && expiresAt) {
      writeLabOrigin(this.tokenId(), { uuid, expires_at: expiresAt });
    }
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
