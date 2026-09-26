import { Component, inject, linkedSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { debounceTime } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import {
  FILTER_METHODS,
  NO_FILTER,
  RequestFilter,
  SchemaFilter,
  SignatureFilter,
} from './request-filter';

/** Espera depois da última tecla antes de buscar. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Busca por texto e filtros rápidos acima da lista, com o contador "N of M requests". */
@Component({
  selector: 'app-request-search',
  imports: [MatButton, MatFormField, MatInput, MatLabel, MatOption, MatSelect],
  templateUrl: './request-search.html',
  styleUrl: './request-search.scss',
})
export class RequestSearch {
  protected readonly store = inject(RequestStore);

  protected readonly methods = FILTER_METHODS;
  /** As opções das condições "Signature" e "Schema" do editor de regras (sem "Absent"). */
  protected readonly signatureOptions: { value: SignatureFilter; label: string }[] = [
    { value: 'any', label: 'Any' },
    { value: 'valid', label: 'Valid' },
    { value: 'invalid', label: 'Invalid' },
  ];
  protected readonly schemaOptions: { value: SchemaFilter; label: string }[] = [
    { value: 'any', label: 'Any' },
    { value: 'valid', label: 'Valid' },
    { value: 'invalid', label: 'Invalid' },
  ];

  /** Texto digitado; volta ao do filtro quando ele muda por fora (limpar, trocar de URL). */
  protected readonly draft = linkedSignal(() => this.store.filter().text);

  constructor() {
    toObservable(this.draft)
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((text) => this.apply({ text }));
  }

  protected setMethods(methods: string[]): void {
    this.apply({ methods });
  }

  protected setSignature(signature: SignatureFilter): void {
    this.apply({ signature });
  }

  protected setSchema(schema: SchemaFilter): void {
    this.apply({ schema });
  }

  protected clearFilters(): void {
    this.draft.set('');
    void this.store.applyFilter(NO_FILTER);
  }

  private apply(change: Partial<RequestFilter>): void {
    void this.store.applyFilter({ ...this.store.filter(), ...change });
  }
}
