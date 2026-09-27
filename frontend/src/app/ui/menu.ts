import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { Icon, IconName } from './icon';

/** Um item do menu: o texto é o nome acessível; `action` roda ao escolher. */
export interface MenuItem {
  label: string;
  icon?: IconName;
  action: () => void;
}

let nextId = 0;

/**
 * Botão ⋮ com um menu (padrão "menu button" da WAI-ARIA), sem o `MatMenu`: o cabeçalho da URL e a
 * barra do celular estão no pacote inicial, e o `MatMenu` traria o Overlay do CDK (§7 do padrão).
 * Setas, Home e End andam pelos itens; Esc fecha e devolve o foco ao botão; Tab ou clique fora
 * fecham.
 */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  template: `
    <button
      #trigger
      type="button"
      class="trigger"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? id : null"
      [attr.aria-label]="label()"
      [attr.title]="hint()"
      (click)="toggle()"
      (keydown.arrowdown)="openAt(0, $event)"
      (keydown.arrowup)="openAt(-1, $event)"
    >
      <app-icon name="more" [size]="20" />
    </button>
    @if (open()) {
      <div
        class="menu"
        role="menu"
        tabindex="-1"
        [id]="id"
        [attr.aria-label]="label()"
        (keydown)="move($event)"
      >
        @for (item of items(); track item.label) {
          <button type="button" role="menuitem" tabindex="-1" class="item" (click)="choose(item)">
            @if (item.icon) {
              <app-icon [name]="item.icon" [size]="18" />
            }
            <span>{{ item.label }}</span>
          </button>
        }
      </div>
    }
  `,
  styleUrl: './menu.scss',
  host: {
    '(document:click)': 'closeOutside($event)',
    '(focusout)': 'closeOnLeave($event)',
  },
})
export class Menu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  /** Nome acessível do botão e do menu ("More URL actions"). */
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly items = input.required<readonly MenuItem[]>();

  protected readonly id = `app-menu-${nextId++}`;
  protected readonly open = signal(false);

  protected toggle(): void {
    if (this.open()) {
      this.close(true);
    } else {
      this.openAt(0);
    }
  }

  /** Abre e põe o foco no item (negativo conta do fim, como a seta para cima). */
  protected openAt(index: number, event?: Event): void {
    event?.preventDefault();
    this.open.set(true);
    afterNextRender(() => this.focusItem(index), { injector: this.injector });
  }

  protected choose(item: MenuItem): void {
    this.close(true);
    item.action();
  }

  protected move(event: KeyboardEvent): void {
    const items = this.menuItems();
    const at = items.indexOf(event.target as HTMLElement);
    const step: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in step) {
      event.preventDefault();
      this.focusItem(step[event.key]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
    }
  }

  protected closeOutside(event: MouseEvent): void {
    if (this.open() && !this.host.contains(event.target as Node)) {
      this.close(false);
    }
  }

  protected closeOnLeave(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && next && !this.host.contains(next)) {
      this.close(false);
    }
  }

  private close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) {
      this.host.querySelector<HTMLButtonElement>('.trigger')?.focus();
    }
  }

  private focusItem(index: number): void {
    const items = this.menuItems();
    if (items.length > 0) {
      items[(index + items.length) % items.length].focus();
    }
  }

  private menuItems(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }
}
