import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { EventView } from './list-rows';

/**
 * A linha de evento: o corpo abre a tentativa mais nova; o chevron, fora da ordem do Tab, mostra e
 * esconde as tentativas sem abrir nenhuma. Nenhum selo de julgamento: o Anzol relata.
 */
@Component({
  selector: 'app-event-line',
  imports: [Icon, MethodBadge],
  template: `
    @let event = view();
    <button
      type="button"
      class="chevron"
      tabindex="-1"
      [attr.aria-expanded]="event.expanded"
      [attr.aria-label]="chevronLabel()"
      (click)="toggled.emit()"
    >
      <app-icon [name]="event.expanded ? 'up' : 'down'" [size]="20" />
    </button>
    <button
      type="button"
      class="select"
      [attr.data-uuid]="'event:' + event.value"
      [attr.tabindex]="stop() ? 0 : -1"
      [attr.aria-label]="event.label"
      (focus)="focused.emit()"
      (keydown)="moved.emit($event)"
      (click)="opened.emit($event)"
    >
      <span class="line">
        <app-method-badge [method]="event.method" />
        <!-- prettier-ignore -->
        <span class="route" [title]="event.route"><span class="head">{{ event.head }}</span><span class="tail">{{ event.tail }}</span></span>
        @if (!compact()) {
          <span class="value">{{ event.value }}</span>
        }
        <span class="time" [title]="event.when">{{ event.time }}</span>
      </span>
      @if (compact()) {
        <span class="line meta">
          <span class="value">{{ event.value }}</span>
          <span> · {{ event.count }}</span>
        </span>
      }
      <span class="line meta trail">
        <span class="seals">
          @for (seal of event.trail; track $index) {
            <!-- A marca ✗ e o "×14" ficam no selo; o nome acessível da linha diz os problemas. -->
            <!-- prettier-ignore -->
            <span class="seal" [class.fault]="seal.fault" [class.last]="seal.last">{{ seal.text }}@if (seal.mark) {<span class="mark">✗</span>}@if (seal.count > 1) {<span> ×{{ seal.count }}</span>}</span>
          }
        </span>
        @if (!compact()) {
          <span class="count"> {{ event.count }}</span>
        }
        @for (note of event.notes; track note) {
          <span class="note"> · {{ note }}</span>
        }
      </span>
    </button>
  `,
  styleUrl: './event-line.scss',
  host: {
    '[class.touch]': 'compact()',
    '[class.early]': 'view().early',
    '[style.height.px]': 'height()',
  },
})
export class EventLine {
  readonly view = input.required<EventView>();
  readonly height = input.required<number>();
  readonly compact = input(false);
  readonly stop = input(false);

  readonly opened = output<MouseEvent>();
  readonly toggled = output<void>();
  readonly moved = output<KeyboardEvent>();
  readonly focused = output<void>();

  protected readonly chevronLabel = computed(
    () => $localize`Attempts of ${this.view().value}:value:`,
  );
}
