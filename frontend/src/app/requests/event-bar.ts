import { Component, Injector, computed, inject } from '@angular/core';
import { Icon } from '../ui/icon';
import { EventGrouping, NO_GROUPING, eventsIn, groupedBy } from './event-grouping';
import { RequestStore } from './request-store';

/**
 * Sem chave, a oferta de agrupar, uma vez por URL; com chave, o estado e o "Change". Sem chave e
 * sem candidato, nenhuma palavra sobre evento.
 */
@Component({
  selector: 'app-event-bar',
  imports: [Icon],
  template: `
    @if (grouping.key(); as key) {
      <p class="state">
        <span class="text">{{ state() }}</span>
        <button
          type="button"
          class="link"
          aria-label="Change the event key"
          i18n-aria-label
          (click)="change()"
        >
          <ng-container i18n="action|Changes the event key">Change</ng-container>
        </button>
      </p>
    } @else if (grouping.offer(); as field) {
      <!-- Numa linha só, para a oferta não tirar da primeira tela as requisições; a frase inteira
           fica para o leitor de tela e no title. -->
      <section class="offer" aria-label="Group by event" i18n-aria-label>
        <p class="visually-hidden" i18n>
          Some requests repeat the same <code>{{ field }}</code
          >. Group them by event?
        </p>
        <span class="short" aria-hidden="true" [title]="sentence(field)"
          ><code>{{ field }}</code
          >&ngsp;<ng-container i18n>repeats</ng-container></span
        >
        <button
          type="button"
          class="primary"
          aria-label="Group by event"
          i18n-aria-label
          (click)="grouping.choose(field)"
        >
          <ng-container i18n="action|Groups the list by the chosen key">Group</ng-container>
        </button>
        <button
          type="button"
          class="icon"
          aria-label="Choose another field…"
          i18n-aria-label
          title="Choose another field…"
          i18n-title
          (click)="change()"
        >
          <app-icon name="more" [size]="18" />
        </button>
        <button
          type="button"
          class="icon"
          aria-label="Not now"
          i18n-aria-label
          title="Not now"
          i18n-title
          (click)="grouping.choose(off)"
        >
          <app-icon name="close" [size]="18" />
        </button>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 0 16px;
    }

    .state {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .text {
      flex: 1;
      min-width: 0;
    }

    .offer {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-medium);
    }

    .short {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    code {
      font-family: var(--app-code-family);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    button {
      min-height: 32px;
      padding: 0 12px;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      font: var(--mat-sys-label-large);
      cursor: pointer;

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .primary {
      flex: none;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    .icon {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 32px;
      padding: 0;
      background: none;
      color: var(--mat-sys-on-surface-variant);
    }

    .link {
      padding: 0 6px;
      background: none;
      color: var(--mat-sys-primary);
    }

    @media (width < 600px) {
      button {
        min-height: 44px;
      }

      .icon {
        width: 44px;
      }
    }
  `,
})
export class EventBar {
  protected readonly grouping = inject(EventGrouping);
  private readonly store = inject(RequestStore);
  private readonly injector = inject(Injector);

  protected readonly off = NO_GROUPING;
  protected readonly state = computed(() => {
    const key = this.grouping.key();
    if (!key) {
      return '';
    }
    const events = this.grouping.events();
    return events === 0
      ? $localize`No loaded request has ${key}:key:. Showing requests one by one.`
      : `${groupedBy(key)} · ${eventsIn(events, this.grouping.context().length || this.store.requests().length)}`;
  });

  protected sentence(field: string): string {
    return $localize`Some requests repeat the same ${field}:field:. Group them by event?`;
  }

  protected change(): void {
    void this.grouping.openDialog(this.injector);
  }
}
