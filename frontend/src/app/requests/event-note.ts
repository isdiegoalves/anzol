import { Component, input, output } from '@angular/core';
import { Icon } from '../ui/icon';

/**
 * As linhas curtas do evento expandido (E1): o veredito do intervalo contra o `Retry-After` (só
 * "chegou antes" no papel de aviso, com ícone e texto; "no limite" e "esperou" neutros), o "… N
 * more attempts" da entrega longa e a ressalva de que a espera é a configurada agora.
 */
@Component({
  selector: 'app-event-note',
  imports: [Icon],
  template: `
    @switch (kind()) {
      @case ('more') {
        <button
          type="button"
          class="more"
          [attr.data-uuid]="id()"
          [attr.tabindex]="stop() ? 0 : -1"
          (focus)="focused.emit()"
          (keydown)="moved.emit($event)"
          (click)="more.emit()"
        >
          {{ text() }}
        </button>
      }
      @case ('wait') {
        <p class="wait" [class.before]="before()">
          @if (before()) {
            <app-icon name="near" [size]="16" />
          }
          <span>{{ text() }}</span>
        </p>
      }
      @default {
        <p class="caveat">{{ text() }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      box-sizing: border-box;
      padding: 2px 8px 2px 48px;
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    p {
      display: flex;
      gap: 6px;
      margin: 0;
      padding: 4px 8px;
      border-radius: var(--mat-sys-corner-small);
    }

    .before {
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }

    .more {
      min-height: 32px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--mat-sys-corner-small);
      background: none;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: -3px;
      }
    }

    @media (width < 600px) {
      .more {
        min-height: 44px;
      }
    }
  `,
  host: { '[style.height.px]': 'height()' },
})
export class EventNote {
  readonly kind = input.required<'wait' | 'more' | 'note'>();
  readonly id = input.required<string>();
  readonly text = input.required<string>();
  readonly before = input(false);
  readonly height = input.required<number>();
  readonly stop = input(false);

  readonly more = output<void>();
  readonly moved = output<KeyboardEvent>();
  readonly focused = output<void>();
}
