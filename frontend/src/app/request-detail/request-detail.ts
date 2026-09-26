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
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AI_OFF_HINT, AiClient } from '../ai/ai-client';
import { CompareStore } from '../diff/compare-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Token } from '../token/token';
import { COPY_FORMATS, CopyFormat, convertRequest } from './copy-as';
import { RequestView } from './request-view';

/**
 * Detalhe da mensagem: a visualização (`RequestView`) com as ações da URL — permalink, copiar,
 * reenviar, comparar, compartilhar, explicar, criar regra e schema.
 */
@Component({
  selector: 'app-request-detail',
  imports: [MatButton, MatMenu, MatMenuItem, MatMenuTrigger, RequestView],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly injector = inject(Injector);
  private readonly compare = inject(CompareStore);
  protected readonly ai = inject(AiClient);

  readonly request = input.required<WebhookRequest>();
  readonly token = input.required<Token>();
  readonly page = input.required<number>();

  /** Painel do "Explain" aberto; fecha ao abrir outra mensagem. */
  protected readonly explaining = linkedSignal({
    source: () => this.request().uuid,
    computation: () => false,
  });
  /** Onde o painel entra. Criado à mão: o `@defer` e o `NgComponentOutlet` pesariam na carga inicial. */
  private readonly explainHost = viewChild.required('explainHost', { read: ViewContainerRef });
  protected readonly aiOffHint = AI_OFF_HINT;

  protected readonly formats = COPY_FORMATS;

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

  /** Corpo exatamente como chegou, mesmo com "Format JSON/XML" ligado na tela. */
  protected copyPayload(): void {
    this.clipboard.copy(this.request().content ?? '');
    this.snackBar.open('Copied payload', undefined, { duration: 1000 });
  }

  protected copyRequestAs(format: CopyFormat): void {
    this.clipboard.copy(convertRequest(this.request(), format, this.token()));
    this.snackBar.open(`Copied request as ${format}`, undefined, { duration: 1000 });
  }

  /** A lista entra em modo de escolha da mensagem B. */
  protected compareWith(): void {
    this.compare.start(this.request());
  }

  /** O editor de regras vem sob demanda (no pedaço da aba Rules), fora da carga inicial. */
  protected async createRule(): Promise<void> {
    const { RuleFromRequest } = await import('../rules/rule-from-request');
    await this.injector.get(RuleFromRequest).open(this.request());
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
    const { ExplainPanel } = await import('../ai/explain-panel');
    if (this.request() !== request || this.explaining()) {
      return;
    }
    const panel = this.explainHost().createComponent(ExplainPanel);
    panel.setInput('tokenId', request.token_id);
    panel.setInput('requestId', request.uuid);
    this.explaining.set(true);
  }

  /** Os diálogos de saída vêm sob demanda (no pedaço do `outbound-actions`). */
  protected async replayRequest(): Promise<void> {
    const { OutboundActions } = await import('../outbound/outbound-actions');
    this.injector.get(OutboundActions).replay(this.request());
  }

  /** O diálogo do link só-leitura vem sob demanda (pedaço do `share-dialog`). */
  protected async shareRequest(): Promise<void> {
    const { openShareDialog } = await import('../share/share-dialog');
    openShareDialog(this.injector, this.request());
  }

  /** O Send da URL, já preenchido com método, headers e corpo da mensagem. */
  protected async sendAsNew(): Promise<void> {
    const { OutboundActions } = await import('../outbound/outbound-actions');
    this.injector.get(OutboundActions).send(this.request());
  }

  /** O diálogo do Edit URL e a inferência vêm sob demanda (no pedaço do `token-actions`). */
  protected async createSchema(): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await this.injector.get(TokenActions).createSchemaFrom(this.request());
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
