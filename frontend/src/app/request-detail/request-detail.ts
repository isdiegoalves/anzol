import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  Injector,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AI_OFF_HINT, AiClient } from '../ai/ai-client';
import { CompareStore } from '../diff/compare-store';
import { UNDO_MS } from '../requests/request-list';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { closestPhrase } from '../pipeline/pipeline';
import { RuleStore } from '../rules/rule-store';
import { Viewport } from '../shell/viewport';
import { Token } from '../token/token';
import { Icon } from '../ui/icon';
import type { CopyFormat } from './copy-as';
import { EventGrouping } from '../requests/event-grouping';
import { eventValueOf } from '../requests/event-key';
import { Explanations } from './explanations';
import { RuleTracePanel } from './rule-trace';
import { RequestView } from './request-view';

let nextId = 0;

/** Os formatos do "Copy As" (o conversor vem sob demanda, no primeiro uso). */
const COPY_FORMATS: readonly CopyFormat[] = ['curl', 'HAR'];

/**
 * Detalhe da mensagem na Inbox: a visualização (`RequestView`) com as ações — Newer/Older e o menu
 * "More" (Permalink, Raw content) no cabeçalho; embaixo dos cartões, a barra "Request actions"
 * agrupada por intenção (reenviar e comparar; criar regra e schema; copiar; compartilhar e
 * explicar). Cada ação que leva a outra página ainda abre o fluxo de hoje até a fatia dela. No
 * celular, a barra é uma linha rolável com as principais, e as demais vão ao "More".
 */
@Component({
  selector: 'app-request-detail',
  imports: [
    Icon,
    MatButton,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    NgTemplateOutlet,
    RequestView,
    RuleTracePanel,
  ],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly compare = inject(CompareStore);
  private readonly requests = inject(RequestStore);
  protected readonly ai = inject(AiClient);
  private readonly viewport = inject(Viewport);
  private readonly rules = inject(RuleStore);
  private readonly explanations = inject(Explanations);
  private readonly grouping = inject(EventGrouping);
  private readonly announcer = inject(LiveAnnouncer);

  readonly request = input.required<WebhookRequest>();
  readonly token = input.required<Token>();
  readonly page = input.required<number>();
  /** Newer/Older: a mensagem a abrir (a lista vai da mais antiga para a mais nova). */
  readonly openRequest = output<WebhookRequest>();

  /** Painel do "Explain" aberto; fecha ao abrir outra mensagem. */
  protected readonly explaining = linkedSignal({
    source: () => this.request().uuid,
    computation: () => false,
  });
  /** Onde o painel entra, criado à mão (o painel vem num pedaço à parte). */
  private readonly explainHost = viewChild.required('explainHost', { read: ViewContainerRef });
  protected readonly aiOffHint = AI_OFF_HINT;
  /**
   * B4 (UX-15): o "Explain" com a IA desligada (um 503 nesta sessão) fica `aria-disabled`, focável,
   * com a razão na descrição acessível. Com a requisição que sumiu (B2), a razão é a dela.
   */
  protected readonly aiReasonId = `ai-reason-${nextId++}`;
  protected readonly explainReason = computed(() =>
    this.gone() ? this.goneReasonId : this.ai.disabled() ? this.aiReasonId : null,
  );

  protected readonly formats = COPY_FORMATS;

  /**
   * B2: quando quem respondeu foi uma regra pega-tudo, a regra que chegou mais perto vem do trace,
   * com a ressalva de que ele reavalia as regras de agora. Com a resposta padrão, vem do
   * `near_miss` gravado (o cartão já o mostra).
   */
  protected readonly closest = signal<readonly string[]>([]);

  /** INBOX-20: o "Delete request" do "More", com o Undo da lixeira da lista. */
  protected deleteRequest(): void {
    if (this.gone()) {
      return;
    }
    const notice = this.snackBar.open($localize`Request deleted`, $localize`Undo`, {
      duration: UNDO_MS,
    });
    const undo = firstValueFrom(notice.afterDismissed()).then(
      ({ dismissedByAction }) => dismissedByAction,
    );
    void this.requests.deleteRequest(this.request(), undo).then((deleted) => {
      if (!deleted) {
        // O aviso da requisição some; a frase sai uma vez, pelo anunciador.
        void this.announcer.announce($localize`Request restored.`);
      }
    });
  }
  /**
   * B2 (UX-38): a requisição aberta sumiu do servidor e a tela mostra a cópia. O que precisa do
   * servidor fica desligado (`aria-disabled`, focável), com a razão na descrição acessível.
   */
  protected readonly gone = computed(() => this.requests.gone()?.id === this.request().uuid);
  protected readonly goneReasonId = `gone-reason-${nextId++}`;
  protected readonly goneReason = computed(() => (this.gone() ? this.goneReasonId : null));
  /** O "Explain" desligado: a IA do servidor está desligada, ou a requisição sumiu. */
  protected readonly explainOff = computed(() => this.ai.disabled() || this.gone());

  /**
   * E1: com a chave do evento, a tentativa anterior do mesmo evento (nunca a vizinha da lista, que
   * pode ser de outro); na primeira tentativa, `request` é `null` e o botão fica desligado.
   */
  protected readonly previousAttempt = computed(() => {
    const request = this.request();
    const attempts = this.grouping.attemptsOf(request);
    const index = attempts?.findIndex((attempt) => attempt.uuid === request.uuid) ?? -1;
    if (!attempts || index < 0) {
      return null;
    }
    return {
      request: index > 0 ? attempts[index - 1] : null,
      label:
        index > 0
          ? $localize`Compare with attempt ${index}:number:`
          : $localize`Compare with attempt —`,
    };
  });
  protected readonly firstReasonId = `first-attempt-${nextId++}`;

  /** Celular: a barra fica com Replay, Create rule e Copy; o resto vai ao "More" (INBOX-33). */
  protected readonly compact = computed(() => this.viewport.windowClass() === 'compact');

  private readonly index = computed(() =>
    this.requests.requests().findIndex((request) => request.uuid === this.request().uuid),
  );
  /**
   * A vizinha na lista: da cópia (a requisição saiu da lista), a que ficou no lugar dela é a
   * vizinha de um lado, e a anterior, a do outro.
   */
  private neighbour(newer: boolean): number {
    const list = this.requests.requests();
    const step = this.step(newer);
    const gone = this.requests.gone();
    const next =
      gone && gone.id === this.request().uuid
        ? gone.index < 0
          ? -1
          : step > 0
            ? gone.index
            : gone.index - 1
        : this.index() < 0
          ? -1
          : this.index() + step;
    return next >= 0 && next < list.length ? next : -1;
  }
  /**
   * Passo na lista até a vizinha mais nova (+1) ou mais antiga: com a mais nova no topo (INBOX-01),
   * a mais nova fica acima (índice menor).
   */
  private step(newer: boolean): number {
    return newer === this.requests.newestFirst() ? -1 : 1;
  }
  protected readonly hasNewer = computed(() => this.neighbour(true) >= 0);
  protected readonly hasOlder = computed(() => this.neighbour(false) >= 0);

  constructor() {
    // B4: o "Open" do aviso "Explanation for #id is ready." abre o painel da requisição pedida.
    effect(() => {
      if (this.explanations.wanted() === this.request().uuid) {
        untracked(() => {
          if (!this.explaining()) {
            void this.toggleExplain();
          }
        });
      }
    });
    effect(() => {
      const { uuid, token_id: tokenId, rule, response } = this.request();
      untracked(() => {
        this.closest.set([]);
        if (rule && response?.status !== undefined) {
          void this.findClosest(tokenId, uuid, rule.id);
        }
      });
    });
    // Fechar (ou abrir outra mensagem) tira o painel.
    effect(() => {
      if (!this.explaining()) {
        this.explainHost().clear();
      }
    });
  }

  private async findClosest(tokenId: string, requestId: string, answeredBy: string) {
    try {
      const trace = await this.rules.trace(tokenId, requestId);
      const answered = trace.rules.find((entry) => entry.id === answeredBy);
      // Só a pega-tudo: a regra com condições respondeu porque casou, e não por falta de outra.
      if (this.request().uuid !== requestId || !answered || answered.conditions.length > 0) {
        return;
      }
      const [near] = trace.rules
        .filter((entry) => entry.enabled && !entry.matches && entry.failed.length > 0)
        .sort((a, b) => a.failed.length - b.failed.length);
      if (near) {
        this.closest.set([
          closestPhrase(near.name, near.failed),
          $localize`Checked against the rules as they are now.`,
        ]);
      }
    } catch {
      // Sem o trace, o cartão fica só com o que a mensagem gravou.
    }
  }

  /**
   * B2: o link leva `?at=`, para o estado vazio dizer de quando era a requisição que sumiu; E1: com
   * a chave do evento, leva também o valor e o nome dela (`&event=&key=`).
   */
  protected readonly permalink = computed(() => {
    const request = this.request();
    const key = this.grouping.key();
    const value = key ? eventValueOf(request, key) : null;
    const event =
      key && value !== null
        ? `&event=${encodeURIComponent(value)}&key=${encodeURIComponent(key)}`
        : '';
    return `${this.origin}/#/${this.token().uuid}/${request.uuid}/${this.page()}?at=${encodeURIComponent(request.created_at)}${event}`;
  });
  protected readonly rawUrl = computed(
    () => `${this.origin}/token/${this.token().uuid}/request/${this.request().uuid}/raw`,
  );
  /** "Create schema from this request" só aparece quando há o que inferir. */
  protected readonly jsonBody = computed(() => isJson(this.request().content));

  /** A vizinha mais nova (K). */
  showNewer(): void {
    this.showNeighbour(true);
  }

  /** A vizinha mais antiga (J). */
  showOlder(): void {
    this.showNeighbour(false);
  }

  /** Abre a vizinha; ao chegar na última carregada, busca a página seguinte, como antes. */
  private showNeighbour(newer: boolean): void {
    const list = this.requests.requests();
    const next = this.neighbour(newer);
    if (next < 0) {
      return;
    }
    this.openRequest.emit(list[next]);
    if (next === list.length - 1 && this.requests.hasNextPage()) {
      void this.requests.loadNextPage();
    }
  }

  /** Corpo exatamente como chegou, mesmo com o Pretty ligado. */
  protected copyPayload(): void {
    this.clipboard.copy(this.request().content ?? '');
    this.snackBar.open($localize`Copied payload`, undefined, { duration: 1000 });
  }

  /** O conversor (curl, HAR) vem sob demanda: não pesa no pedaço da Inbox. */
  protected async copyRequestAs(format: CopyFormat): Promise<void> {
    const { convertRequest } = await import('./copy-as');
    this.clipboard.copy(convertRequest(this.request(), format, this.token()));
    this.snackBar.open($localize`Copied request as ${format}:format:`, undefined, {
      duration: 1000,
    });
  }

  /**
   * A lista entra em modo de escolha da mensagem B; escolhida, abre a página do Compare
   * (`#/{token}/compare/{a}/{b}`, link compartilhável) pelo `CompareStore`.
   */
  protected compareWith(): void {
    if (this.gone()) {
      return;
    }
    this.compare.start(this.request());
  }

  /** "Compare with attempt {n}" (E1, tecla D): a anterior do mesmo evento como A, a aberta como B. */
  compareWithPrevious(): void {
    const previous = this.previousAttempt()?.request;
    if (previous && !this.gone()) {
      this.compare.openPair(previous, this.request());
    }
  }

  /** A tecla D: com evento, a tentativa anterior; sem ele, o "Compare with…" de escolher na lista. */
  compareByKey(): void {
    if (this.previousAttempt()) {
      this.compareWithPrevious();
    } else {
      this.compareWith();
    }
  }

  /**
   * "Create rule from this request" (WM-31): a folha de Regras com as condições sugeridas e a
   * contagem, que vem sob demanda (pedaço do `rule-actions`); grava ou leva ao editor.
   */
  protected async createRule(): Promise<void> {
    const { openCreateRuleDialog } = await import('../rules/rule-actions');
    openCreateRuleDialog(this.injector, this.request());
  }

  /**
   * Abre ou fecha o diagnóstico da mensagem ("Explain"). O painel vem sob demanda (pedaço do
   * `explain-panel`) e faz a chamada ao abrir.
   */
  protected async toggleExplain(): Promise<void> {
    if (this.gone()) {
      return;
    }
    if (this.explaining()) {
      this.explaining.set(false);
      return;
    }
    const request = this.request();
    const { ExplainPanel } = await import('./explain-panel');
    if (this.request() !== request || this.explaining()) {
      return;
    }
    const panel = this.explainHost().createComponent(ExplainPanel);
    panel.setInput('tokenId', request.token_id);
    panel.setInput('requestId', request.uuid);
    this.explaining.set(true);
  }

  /** Outbound com o Replay desta mensagem (E7). */
  protected async replayRequest(): Promise<void> {
    await this.openOutbound('replay');
  }

  /** O diálogo do link só-leitura vem sob demanda (pedaço do `share-dialog`). */
  protected async shareRequest(): Promise<void> {
    if (this.gone()) {
      return;
    }
    const { openShareDialog } = await import('../share/share-dialog');
    openShareDialog(this.injector, this.request());
  }

  /** Outbound com o Send já preenchido com método, headers e corpo desta mensagem (E7). */
  protected async sendAsNew(): Promise<void> {
    await this.openOutbound('send-from');
  }

  /** "Test a variation" (WM-28): o Send da mensagem apontado para a própria URL e caminho. */
  protected async testVariation(): Promise<void> {
    if (this.gone()) {
      return;
    }
    const request = this.request();
    await this.router.navigate(['/', request.token_id, 'outbound'], {
      queryParams: { 'send-from': request.uuid, to: 'self' },
    });
  }

  private async openOutbound(param: 'replay' | 'send-from'): Promise<void> {
    if (this.gone()) {
      return;
    }
    const request = this.request();
    await this.router.navigate(['/', request.token_id, 'outbound'], {
      queryParams: { [param]: request.uuid },
    });
  }

  /** Checks › Schema com o schema inferido desta mensagem, para revisar e salvar (E5). */
  protected async createSchema(): Promise<void> {
    const request = this.request();
    await this.router.navigate(['/', request.token_id, 'checks'], {
      queryParams: { 'schema-from': request.uuid },
    });
  }
}

function isJson(content: string | null): boolean {
  if (!content) {
    return false;
  }
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}
