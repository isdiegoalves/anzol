import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { regexMatches } from './rule-example';

/** Valor longo encurtado na frase (o servidor compara o inteiro). */
function short(value: string): string {
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

/**
 * Testador aproximado da regex contra o valor da mensagem de exemplo (E-12, WM-43), logo abaixo
 * do campo: casa, não casa (a regex cobre o valor inteiro: "Use contains" troca o operador) ou
 * "não dá para conferir aqui" fora do subconjunto seguro. Sem valor de exemplo, nada.
 */
@Component({
  selector: 'app-rule-condition-hint',
  imports: [MatButton],
  template: `
    @switch (outcome()) {
      @case ('matches') {
        <p class="hint" [title]="approxTitle">{{ matchesText() }}</p>
      }
      @case ('differs') {
        <p class="hint differs" [title]="approxTitle">{{ differsText() }}</p>
        @if (canUseContains()) {
          <button mat-button type="button" (click)="useContains.emit()" i18n>Use contains</button>
        }
      }
      @case ('unknown') {
        <p class="hint" [title]="approxTitle" i18n>Can't check here — test against history.</p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 8px;
    }

    .hint {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .differs {
      color: var(--mat-sys-on-surface);
    }
  `,
})
export class RuleConditionHint {
  /** A regex escrita na condição. */
  readonly pattern = input.required<string>();
  /** O valor que a mensagem de exemplo tem ali; `null` sem exemplo (e aí nada aparece). */
  readonly value = input<string | null>(null);
  /** "Use contains" só onde há o operador (query, cabeçalho, corpo; o caminho não tem). */
  readonly canUseContains = input(true);
  readonly useContains = output<void>();

  protected readonly approxTitle = $localize`Checked in the browser against the example request; the server decides (Test against history).`;
  protected readonly outcome = computed(() => {
    const value = this.value();
    if (value === null || this.pattern() === '') {
      return null;
    }
    const matches = regexMatches(this.pattern(), value);
    return matches === null ? 'unknown' : matches ? 'matches' : 'differs';
  });
  protected readonly matchesText = computed(
    () => $localize`Matches "${short(this.value() ?? '')}:value:" · approx.`,
  );
  protected readonly differsText = computed(
    () =>
      $localize`Doesn't match "${short(this.value() ?? '')}:value:" — a regex must cover the whole value.`,
  );
}
