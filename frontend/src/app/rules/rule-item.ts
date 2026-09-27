import { Component, input } from '@angular/core';
import { StatusCode } from '../ui/status-code';
import { RuleFlag } from './rule';

/** A posição efetiva ao lado do "P5" (E-01): "#3", ou "—" desligada, com o nome para leitor de tela. */
export interface RulePosition {
  /** 1…N entre as ligadas, na ordem de avaliação; `null` desligada. */
  value: number | null;
  label: string;
  title: string;
}

/**
 * As três linhas de um item da lista de regras (C, RULES-01): prioridade, posição, nome,
 * indicadores e o status; o match em mono; e os hits (ou a causa do diagnóstico). Vai dentro do
 * botão da linha (ou do link da resposta padrão), que é quem recebe o clique e o foco; os `id`
 * servem ao nome e à descrição dele.
 */
@Component({
  selector: 'app-rule-item',
  imports: [StatusCode],
  template: `
    <span class="line1">
      @if (priority() !== null) {
        <span
          class="priority"
          [attr.title]="priorityTitle()"
          i18n="priority badge|P and the priority, as in P1"
          >P{{ priority() }}</span
        >
      }
      @if (position(); as position) {
        <span
          class="position"
          role="img"
          [id]="baseId() + '-position'"
          [attr.aria-label]="position.label"
          [attr.title]="position.title"
          >{{ position.value === null ? '—' : '#' + position.value }}</span
        >
      }
      <span class="title">
        <span class="name" [id]="baseId() + '-name'" [title]="name()">{{ name() }}</span>
        @if (created()) {
          <span class="created" i18n="badge on a rule created a moment ago">New</span>
        }
        @for (flag of flags(); track flag.label) {
          <span class="flag" [class]="'flag-' + flag.label" [title]="flag.detail">{{
            flag.text
          }}</span>
        }
      </span>
      @if (off()) {
        <span class="off" [attr.title]="offTitle()" i18n>OFF</span>
      }
      <app-status-code class="status" [status]="status()" [error]="fault() ?? faultText" />
    </span>
    <span class="line2 match" [id]="baseId() + '-match'">{{ detail() }}</span>
    @if (hits() !== null) {
      <span class="line3 hits" [class.warn]="warn()" [id]="baseId() + '-hits'">{{ hits() }}</span>
    }
  `,
  styleUrl: './rule-item.scss',
})
export class RuleItem {
  /** Prefixo dos `id` do nome (`-name`), do match (`-match`) e dos hits (`-hits`). */
  readonly baseId = input.required<string>();
  readonly name = input.required<string>();
  readonly priority = input<number | null>(null);
  readonly priorityTitle = input<string | null>(null);
  /** Ausente na resposta padrão, que não tem posição. */
  readonly position = input<RulePosition | null>(null);
  readonly flags = input<readonly RuleFlag[]>([]);
  readonly off = input(false);
  readonly offTitle = input<string | null>(null);
  /** `null` com falha de rede no lugar da resposta. */
  readonly status = input<number | null>(null);
  /** O tipo da falha no lugar do status (L11: o selo já diz "Fault"). */
  readonly fault = input<string | null>(null);
  protected readonly faultText = $localize`Fault`;
  readonly detail = input('');
  readonly hits = input<string | null>(null);
  /** A linha 3 é a causa de um diagnóstico (nunca casa, sombreada), e não os hits. */
  readonly warn = input(false);
  /** Criada agora há pouco (WM-35): o selo "New", além da borda da linha. */
  readonly created = input(false);
}
