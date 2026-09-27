import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import {
  FILTER_METHODS,
  NO_FILTER,
  RequestFilter,
  SchemaFilter,
  SignatureFilter,
  sameFilter,
  waitForCommand,
} from './request-filter';

/** Espera depois da última tecla antes de buscar. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Um chip do grupo "Filters": o nome acessível é o texto, o estado é o `aria-pressed`. */
interface Chip {
  label: string;
  pressed: boolean;
  toggle: () => void;
}

/**
 * Busca em pílula e os filtros como chips (um clique cada, C §2.3), no lugar dos três `MatSelect`
 * (fora do pacote da Inbox): método (vários), assinatura válida/inválida/ausente e schema
 * válido/inválido (um de cada). Mapeiam 1:1 no `match` da busca. Com filtro, o contador
 * "N of M requests"; e o "Copy as anzol wait-for" com os mesmos filtros.
 */
@Component({
  selector: 'app-request-search',
  imports: [Icon],
  templateUrl: './request-search.html',
  styleUrl: './request-search.scss',
})
export class RequestSearch {
  protected readonly store = inject(RequestStore);
  private readonly tokens = inject(TokenStore);
  private readonly clipboard = inject(Clipboard);
  private readonly origin = inject(DOCUMENT).location.origin;

  /** Texto digitado; volta ao do filtro quando ele muda por fora (limpar, trocar de URL). */
  protected readonly draft = linkedSignal(() => this.store.filter().text);
  /** O que o "Copy as anzol wait-for" copiou, com o aviso do texto que ficou de fora. */
  protected readonly copied = signal<string | null>(null);

  /** Rótulos dos chips (os nomes acessíveis da E4 em inglês), traduzidos na instância. */
  private readonly signatureLabels: Record<Exclude<SignatureFilter, 'any'>, string> = {
    valid: $localize`Signature valid`,
    invalid: $localize`Signature invalid`,
    absent: $localize`Signature absent`,
  };
  private readonly schemaLabels: Record<Exclude<SchemaFilter, 'any'>, string> = {
    valid: $localize`Schema valid`,
    invalid: $localize`Schema invalid`,
  };

  protected readonly chips = computed<Chip[]>(() => {
    const filter = this.store.filter();
    const methods = FILTER_METHODS.map((method) => ({
      label: method,
      pressed: filter.methods.includes(method),
      toggle: () =>
        this.apply({
          methods: filter.methods.includes(method)
            ? filter.methods.filter((chosen) => chosen !== method)
            : [...filter.methods, method],
        }),
    }));
    const signatures = (['valid', 'invalid', 'absent'] as const).map((value) => ({
      label: this.signatureLabels[value],
      pressed: filter.signature === value,
      toggle: () => this.apply({ signature: filter.signature === value ? 'any' : value }),
    }));
    const schemas = (['valid', 'invalid'] as const).map((value) => ({
      label: this.schemaLabels[value],
      pressed: filter.schema === value,
      toggle: () => this.apply({ schema: filter.schema === value ? 'any' : value }),
    }));
    return [...methods, ...signatures, ...schemas];
  });

  constructor() {
    toObservable(this.draft)
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((text) => this.apply({ text }));
  }

  protected clearFilters(): void {
    this.draft.set('');
    this.copied.set(null);
    void this.store.applyFilter(NO_FILTER);
  }

  /** S10: só o `match` vai para o comando; com a URL protegida, o segredo vem da variável. */
  protected copyWaitFor(): void {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    const filter = { ...this.store.filter(), text: this.draft() };
    this.clipboard.copy(
      waitForCommand(filter, {
        server: this.origin,
        tokenId: token.uuid,
        protected: token.protected === true,
      }),
    );
    this.copied.set(
      filter.text.trim()
        ? $localize`Copied. The text search is not part of wait-for: only the filters went into --match.`
        : $localize`Copied the anzol wait-for command.`,
    );
  }

  /** O "Copied…" só sai quando o filtro muda de fato (o debounce da busca reaplica o mesmo). */
  private apply(change: Partial<RequestFilter>): void {
    const next = { ...this.store.filter(), ...change };
    if (!sameFilter(next, this.store.filter())) {
      this.copied.set(null);
    }
    void this.store.applyFilter(next);
  }
}
