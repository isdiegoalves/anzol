import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  AI_DOCS_URL,
  AI_OFF_HINT,
  AiCancelled,
  AiClient,
  KeptExplanation,
  aiErrorMessages,
} from '../ai/ai-client';
import { AiWait } from '../ai/ai-wait';
import { checksOf } from '../pipeline/pipeline';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';
import { MarkdownView } from '../ui/markdown-view';

/** Quanto o aviso "Explanation for #… is ready." fica na tela. */
const READY_NOTICE_MS = 10_000;

/**
 * Os pedidos de explicação em curso, um por requisição. Ficam fora do painel porque trocar de
 * requisição (ou esconder o painel) **não cancela** o pedido (B4): a resposta é guardada para a
 * requisição que a pediu e, sem o painel dela à vista, um aviso com "Open" diz que ficou pronta.
 */
@Injectable({ providedIn: 'root' })
export class Explanations {
  private readonly ai = inject(AiClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly requests = inject(RequestStore);

  private readonly running = new Map<
    string,
    { answer: Promise<KeptExplanation>; abort: AbortController }
  >();
  /** A requisição cujo painel está à vista. */
  private watched: string | null = null;
  /**
   * A requisição cuja explicação a pessoa pediu para abrir pelo "Open" do aviso: quem monta o
   * painel (o detalhe) o abre para ela.
   */
  readonly wanted = signal<string | null>(null);

  watch(requestId: string): void {
    this.watched = requestId;
    if (this.wanted() === requestId) {
      this.wanted.set(null);
    }
  }

  unwatch(requestId: string): void {
    if (this.watched === requestId) {
      this.watched = null;
    }
  }

  /** O pedido desta requisição: o que já está em curso, ou um novo. */
  ask(tokenId: string, requestId: string): Promise<KeptExplanation> {
    const running = this.running.get(requestId);
    if (running) {
      return running.answer;
    }
    const abort = new AbortController();
    const answer = this.ai.explain(tokenId, requestId, abort.signal);
    this.running.set(requestId, { answer, abort });
    void answer
      .then(
        () => this.watched !== requestId && this.notify(tokenId, requestId),
        () => undefined,
      )
      .finally(() => this.running.delete(requestId));
    return answer;
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.abort.abort();
  }

  private notify(tokenId: string, requestId: string): void {
    this.snackBar
      .open(
        $localize`Explanation for #${requestId.slice(0, 5)}:id: is ready.`,
        $localize`:action|Opens the request whose explanation is ready:Open`,
        { duration: READY_NOTICE_MS },
      )
      .onAction()
      .subscribe(() => {
        this.wanted.set(requestId);
        void this.router.navigate(['/', tokenId, requestId, this.requests.pageOf(requestId)]);
      });
  }
}

/**
 * "What the checks say": o que a requisição gravou da assinatura, do schema e da resposta, dito
 * pela tela, sem a IA. Sai na hora e vale com a IA desligada.
 */
export function whatTheChecksSay(request: CapturedRequest): string[] {
  const lines = checksOf(request).map(({ title, detail }) => `${title}: ${detail}`);
  const { status, fault } = request.response ?? {};
  if (!request.rule && (status !== undefined || fault)) {
    lines.push(
      fault
        ? $localize`Answered with the network fault ${fault}:fault:.`
        : $localize`Answered ${status}:status: with the default response.`,
    );
  }
  return lines;
}

/**
 * Painel do "Explain" na mensagem (B4): primeiro o que as verificações dizem, sem a IA; depois a
 * explicação do modelo local. A guardada na aba aparece na hora, com a hora e a duração, e "Ask
 * again" pede outra; sem guardada, o painel pede ao abrir e mostra a espera honesta. Carregado sob
 * demanda pelo detalhe da mensagem.
 */
@Component({
  selector: 'app-explain-panel',
  imports: [AiWait, MatButton, MarkdownView],
  templateUrl: './explain-panel.html',
  styleUrl: './explain-panel.scss',
})
export class ExplainPanel {
  private readonly ai = inject(AiClient);
  private readonly explanations = inject(Explanations);
  private readonly requests = inject(RequestStore);
  private readonly language = inject(DOCUMENT).documentElement.lang || 'en';

  readonly tokenId = input.required<string>();
  readonly requestId = input.required<string>();

  protected readonly checks = computed(() => {
    const id = this.requestId();
    const selected = this.requests.selected();
    const request =
      selected?.uuid === id ? selected : this.requests.requests().find((r) => r.uuid === id);
    return request ? whatTheChecksSay(request) : [];
  });
  protected readonly kept = signal<KeptExplanation | null>(null);
  protected readonly answered = computed(() => {
    const kept = this.kept();
    if (!kept) {
      return '';
    }
    const time = new Intl.DateTimeFormat(this.language, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(kept.answeredAt);
    const seconds = kept.seconds.toLocaleString(this.language, { maximumFractionDigits: 1 });
    return $localize`Answered at ${time}:time:, in ${seconds}:seconds: s.`;
  });
  private readonly pending = signal(false);
  /**
   * A região viva da espera nasce vazia e só depois recebe a frase (§4.3): região criada já com o
   * texto não é anunciada.
   */
  private readonly settled = signal(false);
  protected readonly waiting = computed(() => this.settled() && this.pending());
  protected readonly outcome = signal('');
  /** O pedido foi cancelado: "Ask again" pede outro. */
  protected readonly cancelled = signal(false);
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly disabled = this.ai.disabled;
  protected readonly offHint = AI_OFF_HINT;
  protected readonly docsUrl = AI_DOCS_URL;
  private destroyed = false;

  constructor() {
    effect((onCleanup) => {
      const [tokenId, requestId] = [this.tokenId(), this.requestId()];
      untracked(() => this.open(tokenId, requestId));
      onCleanup(() => this.explanations.unwatch(requestId));
    });
    const timer = setTimeout(() => this.settled.set(true));
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      this.destroyed = true;
    });
  }

  protected askAgain(): void {
    void this.ask(this.tokenId(), this.requestId());
  }

  /** "Cancel" (ou `Esc`) durante a espera: aborta o pedido e o painel fica como estava. */
  protected cancel(): void {
    this.explanations.cancel(this.requestId());
  }

  private open(tokenId: string, requestId: string): void {
    this.explanations.watch(requestId);
    const kept = this.ai.keptExplanation(tokenId, requestId);
    this.kept.set(kept);
    this.errors.set([]);
    this.outcome.set('');
    this.cancelled.set(false);
    if (!kept && !this.disabled()) {
      void this.ask(tokenId, requestId);
    }
  }

  private async ask(tokenId: string, requestId: string): Promise<void> {
    const current = () => !this.destroyed && this.requestId() === requestId;
    this.pending.set(true);
    this.kept.set(null);
    this.errors.set([]);
    this.outcome.set('');
    this.cancelled.set(false);
    try {
      const kept = await this.explanations.ask(tokenId, requestId);
      if (current()) {
        this.kept.set(kept);
        this.outcome.set($localize`Explanation ready.`);
      }
    } catch (error) {
      if (current()) {
        // Cancelado: quem avisa é a região da espera.
        this.cancelled.set(error instanceof AiCancelled);
        this.errors.set(error instanceof AiCancelled ? [] : aiErrorMessages(error));
      }
    } finally {
      if (current()) {
        this.pending.set(false);
      }
    }
  }
}
