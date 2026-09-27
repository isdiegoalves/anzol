import { Component, input } from '@angular/core';

/** Uma parte da linha já em texto ("Method POST", "Path /a → /b", "No query"). */
export interface LineChip {
  kind: string;
  text: string;
  same: boolean;
}

/**
 * A linha da requisição no Compare (RULES-32): método, caminho sem o token e query em chips, com a
 * nota quando os três são iguais. No lugar da tabela "Request", que repetia a URL inteira.
 */
@Component({
  selector: 'app-request-line',
  template: `
    <section aria-labelledby="line-title">
      <h3 i18n id="line-title">Request line</h3>
      @if (same()) {
        <p i18n class="note">method, path and query are the same</p>
      }
      <ul class="parts">
        @for (part of parts(); track part.kind) {
          <li [class.changed]="!part.same">{{ part.text }}</li>
        }
      </ul>
    </section>
  `,
  styles: `
    h3 {
      margin: 16px 0 6px;
      font: var(--mat-sys-title-small);
    }

    .note {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .parts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      padding: 2px 10px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-small);
      font: var(--mat-sys-label-large);
      font-family: var(--app-code-family);
    }

    .changed {
      border-color: transparent;
      background: var(--app-warning-container);
      color: var(--app-on-warning-container);
    }
  `,
})
export class RequestLine {
  readonly parts = input.required<readonly LineChip[]>();
  readonly same = input.required<boolean>();
}
