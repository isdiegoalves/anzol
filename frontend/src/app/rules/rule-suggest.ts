import {
  Component,
  ComponentRef,
  DestroyRef,
  Injector,
  ViewContainerRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { WebhookRequest } from '../requests/webhook-request';
import { Rule } from './rule';
import type { RuleSuggestForm } from './rule-suggest-form';

/** O que a proposta aplica: tudo, ou só as condições (a resposta fica a do editor). */
export interface SuggestionApply {
  rule: Rule;
  conditionsOnly: boolean;
}

/**
 * "Describe the rule" no editor de regra, recolhido (RULES-16). O formulário (com o checkbox do
 * Material e o markdown da explicação) vem por import() quando o `<details>` abre pela primeira
 * vez: fica fora do pedaço de Regras, que quase sempre abre sem ele.
 */
@Component({
  selector: 'app-rule-suggest',
  template: `
    <details class="suggest" [open]="open()" (toggle)="toggled($event)">
      <summary i18n>Describe the rule</summary>
      <ng-container #form />
      @if (opened() && !loaded()) {
        <p class="loading" i18n>Loading…</p>
      }
    </details>
  `,
  styles: `
    .suggest {
      margin: 0 0 12px;
      padding: 8px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: var(--mat-sys-surface-container);

      summary {
        cursor: pointer;
        font: var(--mat-sys-title-small);
      }
    }

    .loading {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class RuleSuggest {
  private readonly injector = inject(Injector);
  private destroyed = false;

  readonly tokenId = input.required<string>();
  /** Mensagem aberta, oferecida como exemplo ao modelo. */
  readonly example = input<WebhookRequest>();
  /** Vem aberto (o cartão "Describe it in words" da lista vazia); senão, recolhido (RULES-16). */
  readonly open = input(false);
  /** A regra como está no editor, para a lista de mudanças da proposta (E-13). */
  readonly current = input<Rule>();
  readonly applied = output<SuggestionApply>();

  private readonly host = viewChild.required('form', { read: ViewContainerRef });
  protected readonly opened = signal(false);
  protected readonly loaded = signal(false);
  private form: ComponentRef<RuleSuggestForm> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // Aberto de saída (openSuggest): o formulário vem já.
    effect(() => {
      if (this.open()) {
        untracked(() => this.opened.set(true));
      }
    });
    effect(() => {
      if (this.opened() && !this.form) {
        untracked(() => void this.load());
      }
    });
    effect(() => {
      const [tokenId, example, current] = [this.tokenId(), this.example(), this.current()];
      if (this.loaded() && this.form) {
        const form = this.form;
        untracked(() => {
          form.setInput('tokenId', tokenId);
          form.setInput('example', example);
          form.setInput('current', current);
        });
      }
    });
  }

  protected toggled(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) {
      this.opened.set(true);
    }
  }

  private async load(): Promise<void> {
    const { RuleSuggestForm } = await import('./rule-suggest-form');
    // O `import()` pode terminar depois de o editor fechar: sem componente, não há onde criar.
    if (this.form || this.destroyed) {
      return;
    }
    this.form = this.host().createComponent(RuleSuggestForm, { injector: this.injector });
    this.form.setInput('tokenId', this.tokenId());
    this.form.setInput('example', this.example());
    this.form.setInput('current', this.current());
    this.form.instance.applied.subscribe((apply) => this.applied.emit(apply));
    this.loaded.set(true);
  }
}
