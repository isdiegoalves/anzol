import { MediaMatcher } from '@angular/cdk/layout';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import { RuleStore } from '../rules/rule-store';
import { NO_FILTER } from '../search/request-filter';
import { KnownUrls } from '../token/known-urls';
import { TokenStore } from '../token/token-store';
import { circuitOf } from './circuit-model';

/**
 * Com movimento reduzido, o detalhe ganha a frase "caminho: assinatura ✓ → schema ✓ → resposta padrão 200" logo
 * abaixo do título (MR-0; demo combinada, `.dpath`): o que o pulso mostraria vira texto, no mesmo instante em que ele
 * terminaria (a chegada abre quando a linha nasce). As regras são as que o circuito da faixa já leu; esta frase não
 * lê nada. Sem movimento reduzido, ou sem as regras, ela não existe (e não ocupa lugar no detalhe).
 */
@Component({
  selector: 'app-circuit-path',
  template: `
    @if (parts(); as parts) {
      <!-- prettier-ignore -->
      <p class="dpath"><span class="lead" i18n="circuit path phrase, before the steps">path:</span>@for (part of parts; track $index) {<span class="arrow">{{ $index > 0 ? ' → ' : ' ' }}</span><span [class.fail]="part.bad">{{ part.text }}</span>}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .dpath {
      margin: 0;
      padding-left: 8px;
      border-left: var(--app-note-rule) solid var(--mat-sys-primary);
      font: 12px / 18px var(--app-code-family);
    }

    .lead,
    .arrow {
      color: var(--app-ink-2);
    }

    .fail {
      color: var(--mat-sys-error);
      font-weight: 700;
    }
  `,
  host: { '[style.display]': 'parts() ? null : "none"' },
})
export class CircuitPath {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly ruleStore = inject(RuleStore);
  private readonly known = inject(KnownUrls);
  private readonly reduced = inject(MediaMatcher).matchMedia('(prefers-reduced-motion: reduce)');
  private readonly reducedMotion = signal(this.reduced.matches);

  protected readonly parts = computed(() => {
    const token = this.tokens.shown();
    const selected = this.requests.selected();
    if (!this.reducedMotion() || !token || !selected || this.ruleStore.loadedFor() !== token.uuid) {
      return null;
    }
    return circuitOf({
      token,
      name: this.known.nameOf(token.uuid),
      rules: this.ruleStore.rules(),
      requests: [],
      selected,
      filter: NO_FILTER,
    }).path;
  });

  constructor() {
    const changed = (event: MediaQueryListEvent) => this.reducedMotion.set(event.matches);
    this.reduced.addEventListener?.('change', changed);
    inject(DestroyRef).onDestroy(() => this.reduced.removeEventListener?.('change', changed));
  }
}
