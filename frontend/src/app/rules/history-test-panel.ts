import { Component, computed, input, output, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { fromNow } from '../request-detail/dates';
import { closestFirst } from './against-history';
import { HISTORY_TEST_WINDOW, HistoryTest } from './rule';

/**
 * Aba Test do editor (C, RULES-20): quantas das mensagens mais recentes a regra casaria, como está
 * no editor, e duas colunas — as que casariam ("Would match", com o seq e a hora) e as que não
 * ("Would not match", das mais próximas às mais longes com "Closest first", a contagem de condições
 * e as frases). Os links abrem a mensagem em outra aba, para não perder a regra em edição.
 */
@Component({
  selector: 'app-history-test-panel',
  imports: [MatButton],
  templateUrl: './history-test-panel.html',
  styleUrl: './history-test-panel.scss',
})
export class HistoryTestPanel {
  readonly result = input.required<HistoryTest>();
  readonly tokenId = input.required<string>();
  /** `created_at` das mensagens recentes, para a hora de cada uma. */
  readonly times = input<ReadonlyMap<string, string>>(new Map());
  readonly canTest = input(true);
  readonly testAgain = output<void>();

  protected readonly window = HISTORY_TEST_WINDOW;
  protected readonly closest = signal(true);
  protected readonly misses = computed(() =>
    this.closest() ? closestFirst(this.result().misses) : this.result().misses,
  );
  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly openLabel = (uuid: string) => $localize`Open request ${uuid}:uuid:`;

  protected when(uuid: string): string | null {
    const created = this.times().get(uuid);
    return created ? fromNow(created) : null;
  }

  protected link(uuid: string, page: number): string {
    return `#/${this.tokenId()}/${uuid}/${page}`;
  }
}
