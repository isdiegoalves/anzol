import { Component, computed, input, output } from '@angular/core';
import { conditionPhrase, originalTitle } from '../pipeline/server-phrases';
import { MatButton } from '@angular/material/button';
import { HistoryMiss, HistoryTest } from './rule';

/** Quantas falhas mais próximas o resumo mostra. */
const CLOSEST = 3;

/**
 * As mensagens que a regra não casaria, das que falharam em menos condições para as que falharam
 * em mais ("Closest first", RULES-19/20); no empate, a mais nova primeiro.
 */
export function closestFirst(misses: readonly HistoryMiss[]): HistoryMiss[] {
  return [...misses].sort((a, b) => a.failed.length - b.failed.length || b.seq - a.seq);
}

/**
 * Resumo do último "Test against history" ao lado das condições da aba Match (C, RULES-19): quantas
 * casariam, as falhas mais próximas com as frases, "Test again" e "All results" (a aba Test).
 */
@Component({
  selector: 'app-against-history',
  imports: [MatButton],
  template: `
    <aside class="aside" aria-label="Against history" i18n-aria-label>
      <h3 i18n>Against history</h3>
      @if (result(); as current) {
        <p class="total">
          <span class="big">{{ current.matched }}</span
          >&ngsp;<span class="of" i18n>of the {{ current.tested }} most recent would match</span>
        </p>
        @if (closest().length > 0) {
          <h4 i18n>Closest misses</h4>
          <ul class="closest">
            @for (miss of closest(); track miss.uuid) {
              <li [class.near]="miss.failed.length === 1">
                <span class="id">#{{ miss.uuid.substring(0, 5) }}</span
                >&ngsp; &ngsp;<span class="count" i18n>{miss.failed.length, plural,
                  =1 {1 condition}
                  other {{{ miss.failed.length }} conditions}
                }</span
                >&ngsp;
                <ul class="failed">
                  @for (reason of miss.failed; track $index) {
                    @let phrase = translate(reason);
                    <li [attr.title]="originalTitle(phrase)">{{ phrase.text }}</li>
                  }
                </ul>
              </li>
            }
          </ul>
        }
        <div class="actions">
          <button
            mat-stroked-button
            type="button"
            [disabled]="!canTest()"
            (click)="testAgain.emit()"
            i18n
          >
            Test again
          </button>
          <button mat-button type="button" (click)="allResults.emit()" i18n>All results</button>
        </div>
      } @else {
        <p class="hint" i18n>
          Not tested yet. "Test against history" runs the rule as it is here, unsaved, on the
          recorded requests.
        </p>
      }
    </aside>
  `,
  styleUrl: './against-history.scss',
})
export class AgainstHistory {
  readonly result = input<HistoryTest | null>(null);
  /** As frases de falha na língua da tela, com o original no `title` (WM-05). */
  protected readonly translate = conditionPhrase;
  protected readonly originalTitle = originalTitle;
  readonly canTest = input(true);
  readonly testAgain = output<void>();
  readonly allResults = output<void>();

  protected readonly closest = computed(() =>
    closestFirst(this.result()?.misses ?? []).slice(0, CLOSEST),
  );
}
