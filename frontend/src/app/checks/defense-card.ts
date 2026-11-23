import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { fromNow, localDate } from '../request-detail/dates';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { NOTICE_MS, copyFailedText } from '../ui/notice';
import { CardFold } from './card-fold';
import { ChecksStore } from './checks-store';
import {
  DefenseLabCreated,
  DefenseReport as Report,
  MAX_SEED,
  StoredRound,
  agentPrompt,
  briefingText,
  defenseFailure,
  forgetRound,
  parseSeed,
  readBriefing,
  readRound,
  writeBriefing,
  writeRound,
} from './defense-lab';
import { DefenseReport } from './defense-report';
import { DefenseStore } from './defense-store';

/** `idle`: sem rodada; `checking`: lendo a guardada; `open`: rodada aberta; `closed`: relatório à vista. */
type Phase = 'idle' | 'checking' | 'open' | 'closed';

/**
 * Checks › Defense lab. Na URL comum, cria uma URL de laboratório de defesa; na de laboratório,
 * abre a rodada, deixa julgar a onda 1 à mão (ou pelo agente, com o roteiro pronto), fecha e
 * mostra o relatório. A API não lista as rodadas da URL: a tela guarda a que abriu.
 */
@Component({
  selector: 'app-defense-card',
  imports: [
    CdkCopyToClipboard,
    DefenseReport,
    Icon,
    MatButton,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
  ],
  templateUrl: './defense-card.html',
  styleUrls: ['./card.scss', './defense-card.scss'],
  host: { role: 'region', 'aria-labelledby': 'defense-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class DefenseCard {
  private readonly tokens = inject(TokenStore);
  private readonly checks = inject(ChecksStore);
  private readonly defense = inject(DefenseStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly tokenId = computed(() => this.tokens.token()?.uuid ?? '');
  protected readonly mark = computed(() => this.tokens.token()?.defense_lab ?? null);
  protected readonly expires = computed(() => {
    const mark = this.mark();
    return mark
      ? $localize`Expires ${fromNow(mark.expires_at)}:relative: (${localDate(mark.expires_at)}:date:)`
      : '';
  });
  protected readonly briefing = signal<string | null>(null);

  protected readonly phase = signal<Phase>('idle');
  protected readonly round = signal<StoredRound | null>(null);
  protected readonly report = signal<Report | null>(null);
  protected readonly busy = signal(false);
  protected readonly progress = signal('');
  protected readonly failure = signal<string | null>(null);
  protected readonly prompt = computed(() => {
    const round = this.round();
    return round ? agentPrompt(this.tokenId(), round.round_id) : '';
  });

  protected readonly seed = new FormControl('', { nonNullable: true });
  protected readonly pastedId = new FormControl('', { nonNullable: true });
  protected readonly maxSeed = MAX_SEED;

  protected readonly creating = signal(false);
  protected readonly refusal = signal<string | null>(null);

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      const isLab = this.mark() !== null;
      untracked(() => this.load(tokenId, isLab));
    });
  }

  private load(tokenId: string, isLab: boolean): void {
    this.report.set(null);
    this.failure.set(null);
    this.progress.set('');
    const raw = tokenId && isLab ? readBriefing(tokenId) : null;
    this.briefing.set(raw === null ? null : briefingText(raw));
    const stored = tokenId && isLab ? readRound(tokenId) : null;
    this.round.set(stored);
    if (!stored) {
      this.phase.set('idle');
      return;
    }
    this.phase.set('checking');
    void this.check(stored, true);
  }

  /** Lê o relatório: fechada, mostra; aberta (409), segue aberta; desconhecida (404), esquece. */
  protected async check(round = this.round(), quiet = false): Promise<void> {
    const tokenId = this.tokenId();
    if (!round || !tokenId) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.showReport(round, await this.defense.report(tokenId, round.round_id));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.phase.set('open');
        if (!quiet) {
          this.progress.set($localize`The round is still open.`);
        }
      } else if (error instanceof HttpErrorResponse && error.status === 404) {
        forgetRound(tokenId);
        this.round.set(null);
        this.phase.set('idle');
      } else {
        this.phase.set('open');
        this.failure.set(
          defenseFailure(
            error,
            (status) => $localize`Could not read the round (${status}:status:).`,
          ),
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async startRound(): Promise<void> {
    const tokenId = this.tokenId();
    if (!tokenId || this.busy()) {
      return;
    }
    const seed = parseSeed(this.seed.value);
    if (seed === undefined) {
      this.failure.set(
        $localize`The seed must be a whole number from 0 to ${MAX_SEED}:max:. Leave it empty to draw one.`,
      );
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    this.progress.set($localize`Delivering wave 1. It takes a few seconds…`);
    try {
      const before = await this.defense.newestSeq(tokenId);
      const started = await this.defense.start(tokenId, seed);
      const wave = await this.defense
        .after(tokenId, before)
        .then((requests) => requests.slice(0, started.requests).map(({ uuid }) => uuid))
        .catch(() => []);
      const round: StoredRound = {
        round_id: started.round_id,
        requests: wave,
        marks: {},
        sent: {},
      };
      writeRound(tokenId, round);
      this.round.set(round);
      this.report.set(null);
      this.phase.set('open');
      this.progress.set(
        $localize`Round ${started.round_id.slice(0, 8)}:round: is open: wave 1 delivered ${started.requests}:count: requests.`,
      );
    } catch (error) {
      this.progress.set('');
      this.failure.set(
        defenseFailure(
          error,
          (status) => $localize`Could not start the round (${status}:status:).`,
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Lê (ou passa a acompanhar) a rodada do id colado, aberta em outro lugar. */
  protected async openPasted(): Promise<void> {
    const roundId = this.pastedId.value.trim();
    const tokenId = this.tokenId();
    if (!tokenId || this.busy()) {
      return;
    }
    if (roundId === '') {
      this.failure.set($localize`Paste the round id that the agent or the API gave you.`);
      return;
    }
    const round: StoredRound = { round_id: roundId, requests: [], marks: {}, sent: {} };
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.showReport(round, await this.defense.report(tokenId, roundId));
      writeRound(tokenId, round);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        writeRound(tokenId, round);
        this.round.set(round);
        this.phase.set('open');
        this.progress.set(
          $localize`Round ${roundId.slice(0, 8)}:round: is open; it was started elsewhere.`,
        );
      } else {
        this.failure.set(
          defenseFailure(
            error,
            (status) => $localize`Could not read the round (${status}:status:).`,
          ),
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Fecha a rodada (a onda 2 sai contra as regras de agora); ela não reabre. */
  protected async finishRound(): Promise<void> {
    const round = this.round();
    const tokenId = this.tokenId();
    if (!round || !tokenId || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    this.progress.set($localize`Delivering wave 2 and measuring. It takes a few seconds…`);
    try {
      this.showReport(round, await this.defense.finish(tokenId, round.round_id));
    } catch (error) {
      this.progress.set('');
      this.failure.set(
        defenseFailure(
          error,
          (status) => $localize`Could not finish the round (${status}:status:).`,
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  private showReport(round: StoredRound, report: Report): void {
    this.round.set(round);
    this.report.set(report);
    this.phase.set('closed');
    this.progress.set($localize`Round ${round.round_id.slice(0, 8)}:round: is finished.`);
  }

  protected copied(message: string, done: boolean): void {
    this.snackBar.open(done ? message : copyFailedText(), undefined, { duration: NOTICE_MS });
  }

  protected readonly copyRoundDone = $localize`Copied the round id`;
  protected readonly copyPromptDone = $localize`Copied the prompt`;

  /** Cria a URL, destranca com o segredo dela, mostra segredo e briefing e a abre em Checks › Defense. */
  protected async createLab(): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    this.refusal.set(null);
    let created: DefenseLabCreated;
    try {
      created = await this.defense.create();
    } catch (error) {
      this.refusal.set(
        defenseFailure(
          error,
          (status) => $localize`Could not create the defense lab URL (${status}:status:).`,
        ),
      );
      return;
    } finally {
      this.creating.set(false);
    }
    const uuid = created.token.uuid;
    writeBriefing(uuid, created.briefing);
    // Sem o cookie, a URL abre na tela de desbloqueio, que aceita o segredo mostrado no diálogo.
    await this.checks.unlock(uuid, created.read_secret).catch(() => undefined);
    const { showDefenseLab } = await import('./defense-lab-dialog');
    await showDefenseLab(this.injector, created);
    await this.router.navigate(['/', uuid, 'checks'], { queryParams: { section: 'defense' } });
  }
}
