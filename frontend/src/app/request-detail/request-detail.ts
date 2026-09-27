import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
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
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AI_OFF_HINT, AiClient } from '../ai/ai-client';
import { CompareStore } from '../diff/compare-store';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Token } from '../token/token';
import { Icon } from '../ui/icon';
import type { CopyFormat } from './copy-as';
import { RequestView } from './request-view';

/** Os formatos do "Copy As" (o conversor vem sob demanda, no primeiro uso). */
const COPY_FORMATS: readonly CopyFormat[] = ['curl', 'HAR'];

/**
 * Detalhe da mensagem na Inbox: a visualização (`RequestView`) com as ações — Newer/Older e o menu
 * "More" (Permalink, Raw content) no cabeçalho; embaixo dos cartões, a barra "Request actions"
 * agrupada por intenção (reenviar e comparar; criar regra e schema; copiar; compartilhar e
 * explicar). Cada ação que leva a outra página ainda abre o fluxo de hoje até a fatia dela.
 */
@Component({
  selector: 'app-request-detail',
  imports: [Icon, MatButton, MatIconButton, MatMenu, MatMenuItem, MatMenuTrigger, RequestView],
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

  protected readonly formats = COPY_FORMATS;

  private readonly index = computed(() =>
    this.requests.requests().findIndex((request) => request.uuid === this.request().uuid),
  );
  protected readonly hasNewer = computed(() => {
    const index = this.index();
    return index >= 0 && index < this.requests.requests().length - 1;
  });
  protected readonly hasOlder = computed(() => this.index() > 0);

  constructor() {
    // Fechar (ou abrir outra mensagem) tira o painel.
    effect(() => {
      if (!this.explaining()) {
        this.explainHost().clear();
      }
    });
  }

  protected readonly permalink = computed(
    () => `${this.origin}/#/${this.token().uuid}/${this.request().uuid}/${this.page()}`,
  );
  protected readonly rawUrl = computed(
    () => `${this.origin}/token/${this.token().uuid}/request/${this.request().uuid}/raw`,
  );
  /** "Create schema from this request" só aparece quando há o que inferir. */
  protected readonly jsonBody = computed(() => isJson(this.request().content));

  /** A mensagem seguinte (mais nova); na última carregada, busca a próxima página, como antes. */
  showNewer(): void {
    const list = this.requests.requests();
    const next = this.index() + 1;
    const request = list[next];
    if (request) {
      this.openRequest.emit(request);
      if (next === list.length - 1 && this.requests.hasNextPage()) {
        void this.requests.loadNextPage();
      }
    }
  }

  showOlder(): void {
    const request = this.requests.requests()[this.index() - 1];
    if (request) {
      this.openRequest.emit(request);
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
    this.compare.start(this.request());
  }

  /** O editor de regras é a página Rules, que monta a regra a partir da mensagem (`?from=`). */
  protected createRule(): void {
    const request = this.request();
    void this.router.navigate(['/', request.token_id, 'rules', 'new'], {
      queryParams: { from: request.uuid },
    });
  }

  /**
   * Abre ou fecha o diagnóstico da mensagem ("Explain"). O painel vem sob demanda (pedaço do
   * `explain-panel`) e faz a chamada ao abrir.
   */
  protected async toggleExplain(): Promise<void> {
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
    const { openShareDialog } = await import('../share/share-dialog');
    openShareDialog(this.injector, this.request());
  }

  /** Outbound com o Send já preenchido com método, headers e corpo desta mensagem (E7). */
  protected async sendAsNew(): Promise<void> {
    await this.openOutbound('send-from');
  }

  private async openOutbound(param: 'replay' | 'send-from'): Promise<void> {
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
