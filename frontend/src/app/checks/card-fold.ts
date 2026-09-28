import { Directive, input } from '@angular/core';

/** `none`: janela larga, sem cabeçalho recolhível; senão, o cartão aberto ou recolhido. */
export type FoldState = 'none' | 'open' | 'closed';

/**
 * Cartão recolhível de Verificações (B3, abaixo de 840 px). A página projeta no cartão o cabeçalho
 * que abre e fecha (um `button` com `aria-expanded`) e diz o estado por `fold`; o cartão continua
 * sendo a `region`, e recolhido segue montado: o formulário guarda o que foi digitado. O estilo
 * está em `card.scss` (`.card-body`, `:host(.folding)`).
 */
@Directive({
  selector: '[appCardFold]',
  host: {
    '[class.folding]': 'fold() !== "none"',
    '[class.closed]': 'fold() === "closed"',
  },
})
export class CardFold {
  readonly fold = input<FoldState>('none');
}
