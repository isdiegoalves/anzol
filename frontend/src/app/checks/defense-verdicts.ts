import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatOption, MatSelect } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { signatureReasonText } from '../pipeline/signature-check';
import { Icon } from '../ui/icon';
import {
  Mark,
  StoredRound,
  WaveRow,
  defenseFailure,
  pendingVerdicts,
  waveRow,
} from './defense-lab';
import { DefenseStore } from './defense-store';

/**
 * A onda 1 da rodada aberta, para julgar à mão: o que cada requisição traz e um veredicto por
 * linha. As marcas ficam no navegador junto da rodada até serem enviadas; para a mesma requisição,
 * o servidor guarda o último veredicto, venha daqui ou do agente.
 */
@Component({
  selector: 'app-defense-verdicts',
  imports: [Icon, MatButton, MatOption, MatSelect, RouterLink],
  templateUrl: './defense-verdicts.html',
  styleUrl: './defense-verdicts.scss',
})
export class DefenseVerdicts {
  private readonly defense = inject(DefenseStore);

  readonly tokenId = input.required<string>();
  readonly round = input.required<StoredRound>();
  /** A rodada com as marcas novas, para o cartão guardar. */
  readonly changed = output<StoredRound>();
  /** Uma frase para a região viva do cartão. */
  readonly said = output<string>();

  /** Só a troca de rodada relê a onda; marcar uma linha não. */
  private readonly roundId = computed(() => this.round().round_id);
  private readonly after = computed(() => this.round().after);

  protected readonly rows = signal<WaveRow[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly sending = signal(false);

  protected readonly options = computed((): { value: Mark | ''; text: string }[] => [
    { value: '', text: $localize`:verdict option|:Not judged` },
    { value: 'legitimate', text: $localize`:verdict option|:Legitimate` },
    { value: 'integrity', text: $localize`:verdict option|:Attack · integrity` },
    { value: 'compromised_sender', text: $localize`:verdict option|:Attack · compromised sender` },
    { value: 'prompt_injection', text: $localize`:verdict option|:Attack · prompt injection` },
  ]);

  /** O cabeçalho de nota que quase toda requisição traz igual fica de fora; o diferente aparece. */
  private readonly usualHeader = computed(() => {
    const counts = new Map<string, number>();
    for (const row of this.rows() ?? []) {
      if (row.header !== null) {
        counts.set(row.header, (counts.get(row.header) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  });

  protected readonly counter = computed(() => {
    const round = this.round();
    const marked = round.requests.filter((id) => round.marks?.[id]).length;
    const pending = pendingVerdicts(round).length;
    const total = round.requests.length;
    return pending > 0
      ? $localize`${marked}:marked: of ${total}:total: marked · ${pending}:pending: not sent`
      : $localize`${marked}:marked: of ${total}:total: marked`;
  });

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      const roundId = this.roundId();
      const after = this.after();
      untracked(() => void this.load(tokenId, roundId, after));
    });
  }

  private async load(tokenId: string, roundId: string, after: number | undefined): Promise<void> {
    this.rows.set(null);
    this.failure.set(null);
    if (after === undefined) {
      this.rows.set([]);
      return;
    }
    try {
      const requests = await this.defense.after(tokenId, after);
      if (this.round().round_id !== roundId) {
        return;
      }
      const order = this.round().requests;
      this.rows.set(
        requests
          .filter(({ uuid }) => order.includes(uuid))
          .sort((a, b) => order.indexOf(a.uuid) - order.indexOf(b.uuid))
          .map(waveRow),
      );
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : $localize`unknown`;
      this.failure.set($localize`Could not read wave 1 (${status}:status:).`);
    }
  }

  protected markOf(requestId: string): Mark | '' {
    return this.round().marks?.[requestId] ?? '';
  }

  protected mark(requestId: string, value: Mark | ''): void {
    const marks = { ...this.round().marks };
    if (value === '') {
      delete marks[requestId];
    } else {
      marks[requestId] = value;
    }
    this.changed.emit({ ...this.round(), marks });
  }

  protected markRest(): void {
    const round = this.round();
    const marks = { ...round.marks };
    for (const requestId of round.requests) {
      marks[requestId] ??= 'legitimate';
    }
    this.changed.emit({ ...round, marks });
  }

  protected async send(): Promise<void> {
    const round = this.round();
    const verdicts = pendingVerdicts(round);
    if (this.sending()) {
      return;
    }
    if (verdicts.length === 0) {
      this.said.emit($localize`No new verdict to send: mark a request first.`);
      return;
    }
    this.sending.set(true);
    this.failure.set(null);
    try {
      const recorded = await this.defense.verdicts(this.tokenId(), round.round_id, verdicts);
      this.changed.emit({ ...this.round(), sent: { ...round.sent, ...sentOf(round, verdicts) } });
      this.said.emit(
        $localize`The server has verdicts for ${recorded.recorded}:recorded: of ${recorded.requests}:requests: requests.`,
      );
    } catch (error) {
      this.failure.set(
        defenseFailure(
          error,
          (status) => $localize`Could not send the verdicts (${status}:status:).`,
        ),
      );
    } finally {
      this.sending.set(false);
    }
  }

  protected headerOf(row: WaveRow): string | null {
    return row.header !== null && row.header !== this.usualHeader() ? row.header : null;
  }

  protected headerLine(header: string): string {
    return `X-Provider-Note: ${header}`;
  }

  protected signatureText(row: WaveRow): string {
    const states: Record<string, string> = {
      valid: $localize`:signature state|:Valid`,
      invalid: $localize`:signature state|:Invalid`,
      absent: $localize`:signature state|:Absent`,
    };
    return row.signature === null ? '—' : (states[row.signature] ?? row.signature);
  }

  protected signatureTitle(row: WaveRow): string | null {
    return row.signatureReason ? signatureReasonText(row.signatureReason) : null;
  }

  protected verdictLabel(index: number): string {
    return $localize`Verdict for request ${index}:number:`;
  }

  protected openLabel(requestId: string): string {
    return $localize`Open request #${requestId.slice(0, 8)}:id: in the Inbox`;
  }
}

/** As marcas que acabaram de ir ao servidor, por id de requisição. */
function sentOf(round: StoredRound, verdicts: { request_id: string }[]): Record<string, Mark> {
  const sent: Record<string, Mark> = {};
  for (const { request_id } of verdicts) {
    const mark = round.marks?.[request_id];
    if (mark) {
      sent[request_id] = mark;
    }
  }
  return sent;
}
