import { Injectable, signal } from '@angular/core';

/**
 * O que a página diz ao shell sobre a tela do celular (< 600 px): o detalhe da mensagem em tela
 * cheia (o cartão da URL sai, INBOX-30) e a busca da lista aberta pelo ícone da barra do topo
 * (INBOX-29/31). Leve de propósito: fica no pacote inicial.
 */
@Injectable({ providedIn: 'root' })
export class ScreenState {
  readonly detailFullscreen = signal(false);
  readonly searchOpen = signal(false);
}
