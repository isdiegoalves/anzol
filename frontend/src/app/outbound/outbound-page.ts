import { Clipboard } from '@angular/cdk/clipboard';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { fromNow, localDate } from '../request-detail/dates';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Token } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Viewport } from '../shell/viewport';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { Split } from '../ui/split';
import { StatusCode } from '../ui/status-code';
import { ForwardLegacy } from './forward-legacy';
import {
  OutboundResult,
  SendDraft,
  apiDate,
  curlOf,
  draftFromRequest,
  noAnswerReadTitle,
  outboundErrorText,
  requestErrorText,
  resignedDraft,
} from './outbound';
import { OutboundResultView } from './outbound-result-view';
import { OutboundStore, isRequestId } from './outbound-store';
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
    NgTemplateOutlet,
    Icon,
    Split,
    MatIconButton,
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
  private readonly viewport = inject(Viewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  /**
   * Histórico e trabalho lado a lado, com a divisória arrastável, a partir de 840 px (OUTBOUND-01);
   * abaixo disso, um embaixo do outro.
   */
  protected readonly twoPanes = computed(() =>
    ['expanded', 'large', 'extra-large'].includes(this.viewport.windowClass()),
  );
  /** Largura do histórico no split, em px (lembrada no localStorage). */
  protected readonly historyWidth = signal(420);
  /** Erro do "Run again" (429, 422…), no detalhe. */
  protected readonly actionError = signal<string | null>(null);

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
  /** No lugar do status: o erro de saída, ou "No answer read" quando o caos cortou a resposta. */
  protected readonly failureOf = (item: OutboundResult): string | null =>
    item.error ? outboundErrorText(item.error).title : item.status ? null : noAnswerReadTitle();

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
      this.draft.set(resignedDraft(request, rememberedTarget(token.uuid), token));
      this.signing.set(true);
      this.mode.set('send');
      this.composerKey.update((key) => key + 1);
    }
  }

  protected showResult(result: OutboundResult): void {
    this.actionError.set(null);
    this.selectedId.set(result.id);
  }

  /**
   * Resultado de um Replay ou Send do compositor: o botão ficou desabilitado no envio e o foco
   * cairia no body, então ele vai ao título do resultado.
   */
  protected showSent(result: OutboundResult): void {
    this.showResult(result);
    afterNextRender(
      () => this.host.querySelector<HTMLElement>('.detail app-outbound-result-view h2')?.focus(),
      { injector: this.injector },
    );
  }

  /** "Run again": o mesmo replay ou send; o resultado novo entra no topo e fica aberto. */
  protected async runAgain(result: OutboundResult): Promise<void> {
    const token = this.token();
    if (!token) {
      return;
    }
    this.actionError.set(null);
    try {
      this.showResult(await this.store.runAgain(token.uuid, result));
    } catch (error) {
      this.actionError.set(requestErrorText(error));
    }
  }

  /**
   * "Copy as curl": método, alvo, headers enviados e o corpo que a tela conhece (o do send feito
   * aqui, ou o da mensagem que o replay reenviou).
   */
  protected async copyCurl(result: OutboundResult): Promise<void> {
    let body = this.store.sentBody(result);
    const source = result.source_request;
    if (body === null && result.kind === 'replay' && source) {
      const request =
        this.requests()?.find((item) => item.uuid === source) ??
        (await this.store.request(this.tokenId(), source).catch(() => null));
      body = request?.content ?? null;
    }
    this.clipboard.copy(curlOf(result.method, result.target, result.request_headers, body));
    this.snackBar.open($localize`Copied as curl`, undefined, { duration: 4000 });
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
          ? $localize`This URL no longer exists (${status}).`
          : $localize`Could not load the outbound history (${status}).`,
      );
    }
  }

  /** O compositor que a rota pede, com a mensagem dela (buscada se não está entre as recentes). */
  private async compose(
    query: ParamMap,
    token: Token,
    requests: readonly WebhookRequest[],
  ): Promise<void> {
    const replay = valid(query.get('replay'));
    const sendFrom = valid(query.get('send-from'));
    const send = query.get('send');
    const find = async (id: string) =>
      requests.find((request) => request.uuid === id) ??
      (await this.store.request(token.uuid, id).catch(() => null));
    if (sendFrom) {
      const request = await find(sendFrom);
      // "Test a variation" (WM-28): o destino é a própria URL, com o caminho e a query da mensagem.
      const target =
        query.get('to') === 'self' && request ? request.url : rememberedTarget(token.uuid);
      this.draft.set(request && draftFromRequest(request, target));
      this.signing.set(false);
      this.mode.set('send');
    } else if (send !== null || query.has('send-from')) {
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

/** O id de mensagem da rota, ou `null` quando não é um UUID (o parâmetro é ignorado). */
function valid(id: string | null): string | null {
  return isRequestId(id) ? id : null;
}
