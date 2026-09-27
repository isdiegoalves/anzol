import { Component, input } from '@angular/core';
import { StatusCode } from '../ui/status-code';
import { RuleFlag } from './rule';

/**
 * As três linhas de um item da lista de regras (C, RULES-01): prioridade, nome, indicadores e o
 * status; o match em mono; e os hits. Vai dentro do botão da linha (ou do link da resposta
 * padrão), que é quem recebe o clique e o foco; os `id` servem ao nome e à descrição dele.
 */
@Component({
  selector: 'app-rule-item',
  imports: [StatusCode],
  template: `
    <span class="line1">
      @if (priority() !== null) {
        <span class="priority" i18n="priority badge|P and the priority, as in P1"
          >P{{ priority() }}</span
        >
      }
      <span class="name" [id]="baseId() + '-name'">{{ name() }}</span>
      @for (flag of flags(); track flag.label) {
        <span class="flag" [title]="flag.detail">{{ flag.label }}</span>
      }
      <span class="spacer"></span>
      @if (off()) {
        <span class="off" i18n>Off</span>
      }
      <app-status-code class="status" [status]="status()" error="Fault" i18n-error />
    </span>
    <span class="line2 match" [id]="baseId() + '-match'">{{ detail() }}</span>
    <span class="line3 hits" [id]="baseId() + '-hits'">{{ hits() }}</span>
  `,
  styleUrl: './rule-item.scss',
})
export class RuleItem {
  /** Prefixo dos `id` do nome (`-name`), do match (`-match`) e dos hits (`-hits`). */
  readonly baseId = input.required<string>();
  readonly name = input.required<string>();
  readonly priority = input<number | null>(null);
  readonly flags = input<readonly RuleFlag[]>([]);
  readonly off = input(false);
  /** `null` com falha de rede no lugar da resposta. */
  readonly status = input<number | null>(null);
  readonly detail = input('');
  readonly hits = input<string | null>(null);
}
