import { Component, input } from '@angular/core';

/**
 * Região viva persistente (guia da combinação, §4.3): o elemento existe no DOM desde a carga da
 * tela, vazio, e recebe o texto depois. Região criada já com o texto não é anunciada, por isso quem
 * usa a põe no template **sem** `@if` em volta e muda só o `text`.
 *
 * Uma ação, um anúncio: cada tela tem as regiões da tabela da §4.3 (`status "Connection"`, o
 * `status` da lista, `status "Request notice"`, o resumo da barra de salvar, `status "AI
 * progress"`, `status "Action result"`) e nenhuma outra. O que não tem lugar fixo na tela sai pelo
 * `LiveAnnouncer` do CDK. Contador, segundos e barra de progresso ficam fora dela, `aria-hidden`.
 *
 * `alert` troca o papel para `alert` (só para erro que impede a ação, como a validação da barra de
 * salvar). Vazia, a região não ocupa altura.
 */
@Component({
  selector: 'app-live-region',
  template: '{{ text() }}',
  styles: `
    :host {
      display: block;
    }

    :host(.empty) {
      display: contents;
    }
  `,
  host: {
    '[attr.role]': 'alert() ? "alert" : "status"',
    '[attr.aria-label]': 'label()',
    '[class.empty]': '!text()',
  },
})
export class LiveRegion {
  /** O nome da região ("Connection", "Request notice"); sem ele, o `status` fica sem nome. */
  readonly label = input<string | null>(null);
  /** O que a região diz agora; vazio enquanto não há o que dizer. */
  readonly text = input('');
  readonly alert = input(false);
}
