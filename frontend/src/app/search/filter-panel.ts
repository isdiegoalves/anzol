import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RequestStore } from '../requests/request-store';
import { Rule, evaluationOrder } from '../rules/rule';
import { RuleStore } from '../rules/rule-store';
import { Viewport } from '../shell/viewport';
import { FilterChips } from './filter-chips';
import { WaitForButton } from './wait-for';

/**
 * O painel atrás do `button "Filters"` (B1, UX-04): o `group "Filters"` com todos os chips, em
 * quatro subgrupos com rótulo. Aberto, empurra a lista (não cobre); no celular, é uma folha
 * inferior com "Show {n} requests". O painel é uma parada só do Tab (roving tabindex): as setas,
 * Home e End andam entre os chips; Espaço e Enter ligam e desligam; Esc fecha.
 */
@Component({
  selector: 'app-filter-panel',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger, NgTemplateOutlet, WaitForButton],
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.scss',
  host: {
    '[class.sheet]': 'compact()',
    '(keydown)': 'move($event)',
  },
})
export class FilterPanel {
  protected readonly chips = inject(FilterChips);
  private readonly store = inject(RequestStore);
  private readonly rulesStore = inject(RuleStore);
  private readonly viewport = inject(Viewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** O id do painel, para o `aria-controls` do botão "Filters". */
  readonly panelId = input.required<string>();
  /** Esc, ou "Show {n} requests" no celular. */
  readonly closed = output<void>();

  protected readonly compact = computed(() => this.viewport.windowClass() === 'compact');
  /** O chip que o Tab alcança (os outros ficam com `tabindex="-1"`). */
  protected readonly stop = signal(0);
  /** A posição de cada chip na ordem do painel, para o roving tabindex. */
  protected readonly offsets = computed(() => {
    let next = 0;
    return this.chips.groups().map((group) => {
      const start = next;
      next += group.chips.length;
      return start;
    });
  });

  /** A parada do Tab dentro do que há: os chips do motivo exato e da regra vêm e vão. */
  protected readonly tabStop = computed(() => {
    const count = this.chips.groups().reduce((sum, group) => sum + group.chips.length, 0);
    return Math.min(this.stop(), count - 1);
  });

  /** As regras da URL, para os menus "Answered by rule…" e "Near miss of…" (C2); lidas ao abrir. */
  protected readonly rules = signal<readonly Rule[] | null>(null);
  private rulesToken: string | null = null;

  /** "Show 4 requests": o que a lista mostra com os filtros de agora. */
  protected readonly showLabel = computed(() => {
    const count = this.store.filtering() ? this.store.matched() : this.store.total();
    return count === 1 ? $localize`Show 1 request` : $localize`Show ${count}:count: requests`;
  });

  /** Põe o foco no primeiro chip (a tecla F). */
  focusFirst(): void {
    this.stop.set(0);
    this.buttons()[0]?.focus();
  }

  /** Lê as regras da URL na primeira vez que um dos menus abre. */
  protected async loadRules(): Promise<void> {
    const tokenId = this.store.tokenId();
    if (!tokenId || (this.rulesToken === tokenId && this.rules() !== null)) {
      return;
    }
    this.rulesToken = tokenId;
    this.rules.set(null);
    try {
      const rules = await this.rulesStore.listRules(tokenId);
      this.rules.set(evaluationOrder(rules).map((index) => rules[index]));
    } catch {
      this.rules.set([]);
    }
  }

  protected chooseRule(type: 'rule' | 'near_miss', rule: Rule): void {
    if (rule.id) {
      this.chips.setOutcome({ type, rule: rule.id, name: rule.name });
    }
  }

  protected move(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const at = buttons.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
      return;
    }
    if (at < 0) {
      return;
    }
    const last = buttons.length - 1;
    const to: Record<string, number> = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowDown: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      ArrowUp: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    if (event.key in to) {
      event.preventDefault();
      this.stop.set(to[event.key]);
      buttons[to[event.key]].focus();
    }
  }

  private buttons(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>('.chip')];
  }
}
