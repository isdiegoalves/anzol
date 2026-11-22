import { Component, input, output } from '@angular/core';
import { MatMenuPanel, MatMenuTrigger } from '@angular/material/menu';
import { AI_OFF_HINT } from '../ai/ai-client';

/**
 * Lista vazia (WM-02): a frase de sempre e três caminhos. "Describe it in words" abre o editor com
 * o Describe expandido (com a IA desligada, o cartão fica e diz por quê); "Start from a template"
 * abre o menu dos modelos; "Create from the latest request" só aparece com mensagens. O nome de
 * cada cartão é o texto dele inteiro, título e linha de baixo.
 */
@Component({
  selector: 'app-rule-list-empty',
  imports: [MatMenuTrigger],
  template: `
    <p class="lead" i18n>No rules yet. Every request gets the URL's default response.</p>
    <div class="cards">
      <button type="button" class="card" (click)="describe.emit()">
        <span class="title" i18n>Describe it in words</span>
        <span class="hint">{{ aiDisabled() ? aiOffHint : describeHint }}</span>
      </button>
      <button type="button" class="card" [matMenuTriggerFor]="templates()">
        <span class="title" i18n>Start from a template</span>
        <span class="hint" i18n>Accept everything, fail N times, 429, echo the body…</span>
      </button>
      @if (hasRequests()) {
        <button type="button" class="card" (click)="fromLatest.emit()">
          <span class="title" i18n>Create from the latest request</span>
          <span class="hint" i18n>Method, path and the fields you pick from it.</span>
        </button>
      }
    </div>
  `,
  styleUrl: './rule-list-empty.scss',
})
export class RuleListEmpty {
  /** O menu "Rule templates" do cabeçalho: o mesmo, aberto também daqui. */
  readonly templates = input.required<MatMenuPanel>();
  readonly aiDisabled = input(false);
  readonly hasRequests = input(false);

  readonly describe = output<void>();
  readonly fromLatest = output<void>();

  protected readonly aiOffHint = AI_OFF_HINT;
  /**
   * A tela só sabe que a IA está desligada depois do primeiro 503 do servidor (M5): até lá, o
   * cartão não promete o rascunho, diz de quem ele depende.
   */
  protected readonly describeHint = $localize`Say what should answer; if this server has AI set up, it drafts the rule.`;
}
