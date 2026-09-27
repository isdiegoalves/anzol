import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { fromNow, localDate } from '../request-detail/dates';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Token } from '../token/token';
import { TokenStore } from '../token/token-store';
import { MethodBadge } from '../ui/method-badge';
import { StatusCode } from '../ui/status-code';
import { ForwardLegacy } from './forward-legacy';
import {
  OutboundResult,
  SendDraft,
  apiDate,
  draftFromRequest,
  outboundErrorText,
} from './outbound';
import { OutboundResultView } from './outbound-result-view';
import { OutboundStore } from './outbound-store';
import { ReplayComposer } from './replay-composer';
import { rememberedTarget } from './replay-target';
import { SendComposer } from './send-composer';

type Mode = 'replay' | 'send';

/**
 * Outbound (`#/{token}/outbound`, C §2.7): o histórico do que o servidor mandou, o compositor
 * Replay | Send e o resultado na mesma página (o resultado não some ao fechar, como no diálogo).
 * `?replay={requestId}` abre o Replay com a mensagem; `?send-from={requestId}` abre o Send
 * preenchido com ela ("Send as new…"); `?send=signed` abre o Send assinando (o "Send a signed test"
 * de Checks); outro `?send=` abre o Send vazio (o "Send" do cabeçalho da URL). Embaixo, recolhido,
 * o redirect pelo navegador de hoje.
 */
@Component({
  selector: 'app-outbound-page',
  imports: [
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MethodBadge,
    StatusCode,
    ForwardLegacy,
    OutboundResultView,
    ReplayComposer,
    SendComposer,
  ],
  templateUrl: './outbound-page.html',
  styleUrl: './outbound-page.scss',
})
export class OutboundPage {
  protected readonly store = inject(OutboundStore);
  private readonly tokens = inject(TokenStore);
  private readonly inbox = inject(RequestStore);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  /** URL carregada do servidor para esta rota (a assinatura dela assina o Send). */
  protected readonly token = signal<Token | null>(null);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** As mensagens mais novas da URL: as que o Replay oferece. */
  protected readonly requests = signal<readonly WebhookRequest[] | null>(null);

  protected readonly mode = signal<Mode>('replay');
  /** Mensagem escolhida no Replay (e a do "Redirect Now"). */
  protected readonly replayId = signal<string | null>(null);
  protected readonly draft = signal<SendDraft | null>(null);
  protected readonly signing = signal(false);
  /** Troca a cada abertura do compositor: os formulários nascem de novo com o que a rota pede. */
  protected readonly composerKey = signal(0);

  private readonly selectedId = signal<string | null>(null);
  /** O escolhido no histórico, ou o mais novo (o que acabou de sair aparece aberto). */
  protected readonly selected = computed(() => {
    const history = this.store.history();
    return history.find((item) => item.id === this.selectedId()) ?? history.at(0) ?? null;
  });
  /** As recentes chegaram (o compositor espera por elas uma vez, não a cada mudança da lista). */
  private readonly listed = computed(() => this.requests() !== null);
  protected readonly replayRequest = computed(
    () => this.requests()?.find((request) => request.uuid === this.replayId()) ?? null,
  );

  protected readonly when = (at: string) => fromNow(apiDate(at));
  protected readonly date = (at: string) => localDate(apiDate(at));
  protected readonly errorTitle = outboundErrorText;

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => void this.open(tokenId));
    });
    effect(() => {
      const query = this.query();
      const token = this.token();
      if (query && token && this.listed()) {
        untracked(() => void this.compose(query, token, this.requests() ?? []));
      }
    });
  }

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected async refresh(): Promise<void> {
    await this.open(this.tokenId());
  }

  protected chooseMode(mode: Mode): void {
    this.mode.set(mode);
    this.draft.set(null);
    this.signing.set(false);
    this.composerKey.update((key) => key + 1);
  }

  /** "Send as new with a fresh signature": a mesma requisição no Send, assinada pela URL. */
  protected resign(request: WebhookRequest): void {
    const token = this.token();
    if (token) {
      this.draft.set(draftFromRequest(request, rememberedTarget(token.uuid)));
      this.signing.set(true);
      this.mode.set('send');
      this.composerKey.update((key) => key + 1);
    }
  }

  protected showResult(result: OutboundResult): void {
    this.selectedId.set(result.id);
  }

  private async open(tokenId: string): Promise<void> {
    this.loaded.set(false);
    this.loadError.set(null);
    this.token.set(null);
    this.requests.set(null);
    this.tokens
      .load(tokenId)
      .then((token) => this.token.set(token))
      .catch(() => undefined);
    this.store
      .recent(tokenId)
      .then((requests) => this.requests.set(requests))
      .catch(() => this.requests.set([]));
    try {
      await this.store.load(tokenId);
      this.loaded.set(true);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.loadError.set(
        status === 404 || status === 410
          ? `This URL no longer exists (${status}).`
          : `Could not load the outbound history (${status}).`,
      );
    }
  }

  /** O compositor que a rota pede, com a mensagem dela (buscada se não está entre as recentes). */
  private async compose(
    query: ParamMap,
    token: Token,
    requests: readonly WebhookRequest[],
  ): Promise<void> {
    const replay = query.get('replay');
    const sendFrom = query.get('send-from');
    const send = query.get('send');
    const find = async (id: string) =>
      requests.find((request) => request.uuid === id) ??
      (await this.store.request(token.uuid, id).catch(() => null));
    if (sendFrom) {
      const request = await find(sendFrom);
      this.draft.set(request && draftFromRequest(request, rememberedTarget(token.uuid)));
      this.signing.set(false);
      this.mode.set('send');
    } else if (send !== null) {
      this.draft.set(null);
      this.signing.set(send === 'signed');
      this.mode.set('send');
    } else {
      const open = this.inbox.selected();
      const id = replay ?? (open?.token_id === token.uuid ? open.uuid : null);
      const request = id ? await find(id) : null;
      if (request && !requests.some((r) => r.uuid === request.uuid)) {
        this.requests.set([request, ...requests]);
      }
      this.replayId.set(request?.uuid ?? requests[0]?.uuid ?? null);
      this.mode.set('replay');
    }
    this.composerKey.update((key) => key + 1);
  }
}
