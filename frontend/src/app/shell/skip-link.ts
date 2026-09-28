import { DOCUMENT } from '@angular/common';
import { Component, inject, input } from '@angular/core';

/**
 * "Skip to content" (UX-21): o primeiro elemento focável da página, à vista só com o foco; leva o
 * foco ao `main` que está na tela. O `href` é o endereço de agora: o `#` é a rota, e não uma âncora.
 */
@Component({
  selector: 'app-skip-link',
  template: `<a class="skip" [attr.href]="href()" (click)="skip($event)" i18n>Skip to content</a>`,
  styles: `
    .skip {
      position: fixed;
      z-index: 10;
      top: 8px;
      left: 8px;
      padding: 12px 16px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-inverse-surface);
      color: var(--mat-sys-inverse-on-surface);
      font: var(--mat-sys-label-large);
      transform: translateY(-200%);

      &:focus {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
        transform: none;
      }
    }
  `,
})
export class SkipLink {
  private readonly document = inject(DOCUMENT);

  readonly href = input.required<string>();

  protected skip(event: Event): void {
    event.preventDefault();
    const mains = [...this.document.querySelectorAll<HTMLElement>('main, [role="main"]')];
    const main = mains.find((candidate) => !candidate.closest('[hidden]')) ?? mains[0];
    if (main) {
      if (!main.hasAttribute('tabindex')) {
        main.setAttribute('tabindex', '-1');
      }
      main.focus();
    }
  }
}
