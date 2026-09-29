import { Directive, input } from '@angular/core';

/** `none`: janela larga, sem cabeçalho recolhível. */
export type FoldState = 'none' | 'open' | 'closed';

/**
 * Recolhido, o cartão segue montado para o formulário guardar o que foi digitado. O estilo das
 * classes está em `card.scss`.
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
