import { Component, ElementRef, inject, input, output } from '@angular/core';

/** Abas do editor em modo formulário (C §2.4). */
export type EditorTab = 'match' | 'response' | 'scenario' | 'test';

/**
 * As abas Match, Response, Scenario e Test do editor de regra (padrão de abas da ARIA): setas,
 * Home e End trocam de aba e levam o foco junto. Os painéis ficam no editor, com os ids
 * `rule-panel-{aba}` que cada aba controla. `badges` mostra o status da resposta e o último teste.
 */
@Component({
  selector: 'app-rule-tabs',
  template: `
    <div class="tabs" role="tablist" aria-label="Rule parts" i18n-aria-label>
      @for (item of tabs; track item.id) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="'rule-tab-' + item.id"
          [attr.aria-selected]="current() === item.id"
          [attr.aria-controls]="'rule-panel-' + item.id"
          [attr.tabindex]="current() === item.id ? 0 : -1"
          (click)="selected.emit(item.id)"
          (keydown)="moveTab($event, item.id)"
        >
          {{ item.label }}
          @if (badges()[item.id]; as badge) {
            <span class="badge" aria-hidden="true">{{ badge }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './rule-tabs.scss',
})
export class RuleTabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly current = input.required<EditorTab>();
  readonly badges = input<Partial<Record<EditorTab, string>>>({});
  readonly selected = output<EditorTab>();

  protected readonly tabs: { id: EditorTab; label: string }[] = [
    { id: 'match', label: $localize`Match` },
    { id: 'response', label: $localize`Response` },
    { id: 'scenario', label: $localize`Scenario` },
    { id: 'test', label: $localize`Test` },
  ];

  protected moveTab(event: KeyboardEvent, current: EditorTab): void {
    const index = this.tabs.findIndex(({ id }) => id === current);
    const count = this.tabs.length;
    const next: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in next)) {
      return;
    }
    event.preventDefault();
    const tab = this.tabs[next[event.key]].id;
    this.selected.emit(tab);
    this.host.querySelector<HTMLElement>(`#rule-tab-${tab}`)?.focus();
  }
}
