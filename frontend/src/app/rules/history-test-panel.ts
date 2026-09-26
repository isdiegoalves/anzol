import { Component, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { HISTORY_TEST_WINDOW, HistoryTest } from './rule';

/**
 * Resultado do "Test against history" no editor: quantas mensagens gravadas a regra casaria e,
 * das outras, as condições que falharam, com o link da mensagem (em outra aba, para não perder
 * a regra em edição).
 */
@Component({
  selector: 'app-history-test-panel',
  templateUrl: './history-test-panel.html',
  styleUrl: './history-test-panel.scss',
})
export class HistoryTestPanel {
  readonly result = input.required<HistoryTest>();
  readonly tokenId = input.required<string>();

  protected readonly window = HISTORY_TEST_WINDOW;

  constructor() {
    // O resultado aparece no fim do editor, que pode estar rolado para cima.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.scrollIntoView?.({ block: 'nearest' }));
  }
}
