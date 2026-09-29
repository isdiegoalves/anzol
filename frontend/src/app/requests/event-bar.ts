import { Component, Injector, computed, inject } from '@angular/core';
import { EventGrouping, NO_GROUPING, eventsIn, groupedBy } from './event-grouping';
import { RequestStore } from './request-store';

/**
 * Acima da lista (E1): sem chave, a faixa que oferece agrupar, uma vez por URL, quando as
 * carregadas repetem um campo ("Some requests repeat the same x-loja-event-id"); com chave, o
 * estado "Grouped by … · 17 events in the 50 loaded" e o "Change". Sem chave e sem candidato, nada:
 * nenhuma palavra sobre evento.
 */
@Component({
  selector: 'app-event-bar',
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
      <section class="offer" aria-label="Group by event" i18n-aria-label>
        <p i18n>
          Some requests repeat the same <code>{{ field }}</code
          >. Group them by event?
        </p>
        <div class="actions">
          <button type="button" class="primary" (click)="grouping.choose(field)">
            <ng-container i18n>Group by event</ng-container>
          </button>
          <button type="button" class="link" (click)="change()">
            <ng-container i18n>Choose another field…</ng-container>
          </button>
          <button type="button" class="link" (click)="grouping.choose(off)">
            <ng-container i18n>Not now</ng-container>
          </button>
        </div>
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
      padding: 8px 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-body-medium);

      p {
        margin: 0 0 8px;
      }
    }

    code {
      font-family: var(--app-code-family);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
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
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
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
    }
  `,
})
export class EventBar {
  protected readonly grouping = inject(EventGrouping);
  private readonly store = inject(RequestStore);
  private readonly injector = inject(Injector);

  protected readonly off = NO_GROUPING;
  /** "Grouped by x · 17 events in the 50 loaded", ou a nota de que nenhuma carregada tem o campo. */
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

  protected change(): void {
    void this.grouping.openDialog(this.injector);
  }
}
