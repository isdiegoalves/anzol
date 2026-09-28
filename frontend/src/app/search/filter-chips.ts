import { Injectable, computed, inject } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import {
  NO_FILTER,
  OutcomeFilter,
  RequestFilter,
  SchemaFilter,
  SignatureFilter,
} from './request-filter';

/** Um chip do grupo "Filters": o nome acessível é o texto, o estado é o `aria-pressed`. */
export interface FilterChip {
  label: string;
  pressed: boolean;
  toggle: () => void;
  /** Desligado, o chip abre o menu das regras da URL ("Answered by rule…", "Near miss of…"). */
  menu?: 'rule' | 'near_miss';
  /** Filtro que só existe ligado (o motivo exato, a regra escolhida): o chip mostra o ✕. */
  removable?: boolean;
}

/** Um subgrupo do painel, com o rótulo à vista. */
export interface ChipGroup {
  id: 'method' | 'signature' | 'schema' | 'answer';
  label: string;
  chips: FilterChip[];
}

/**
 * Os filtros rápidos da Entrada como chips, nos quatro subgrupos do painel (B1): método (vários),
 * assinatura e schema (um de cada, mais o motivo exato e o caminho do M1) e resposta (um desfecho
 * por vez, C2). Mapeiam 1:1 no filtro da busca. O painel desenha os chips; a lista "Active
 * filters" mostra os ligados.
 */
@Injectable({ providedIn: 'root' })
export class FilterChips {
  private readonly store = inject(RequestStore);

  private readonly groupLabels: Record<ChipGroup['id'], string> = {
    method: $localize`:filter group:Method`,
    signature: $localize`:filter group:Signature`,
    schema: $localize`:filter group:Schema`,
    answer: $localize`:filter group:Answer`,
  };
  private readonly signatureLabels: Record<Exclude<SignatureFilter, 'any'>, string> = {
    valid: $localize`Signature valid`,
    invalid: $localize`Signature invalid`,
    absent: $localize`Signature absent`,
  };
  private readonly schemaLabels: Record<Exclude<SchemaFilter, 'any'>, string> = {
    valid: $localize`Schema valid`,
    invalid: $localize`Schema invalid`,
  };

  /** Os chips de hoje, com os mesmos nomes, começando por POST (INBOX-09). */
  readonly groups = computed<ChipGroup[]>(() => {
    const filter = this.store.filter();
    const method = (name: string): FilterChip => ({
      label: name,
      pressed: filter.methods.includes(name),
      toggle: () =>
        this.apply({
          methods: filter.methods.includes(name)
            ? filter.methods.filter((chosen) => chosen !== name)
            : [...filter.methods, name],
        }),
    });
    const signature = (value: Exclude<SignatureFilter, 'any'>): FilterChip => ({
      label: this.signatureLabels[value],
      pressed: filter.signature === value,
      toggle: () => this.apply({ signature: filter.signature === value ? 'any' : value }),
    });
    const schema = (value: Exclude<SchemaFilter, 'any'>): FilterChip => ({
      label: this.schemaLabels[value],
      pressed: filter.schema === value,
      toggle: () => this.apply({ schema: filter.schema === value ? 'any' : value }),
    });
    const exact = (label: string, field: 'signatureReason' | 'schemaPath'): FilterChip => ({
      label,
      pressed: true,
      removable: true,
      toggle: () => this.apply({ [field]: null }),
    });
    const reason = filter.signatureReason;
    const path = filter.schemaPath;
    return [
      {
        id: 'method',
        label: this.groupLabels.method,
        chips: ['POST', 'GET', 'PUT', 'DELETE', 'PATCH'].map(method),
      },
      {
        id: 'signature',
        label: this.groupLabels.signature,
        chips: [
          signature('invalid'),
          signature('absent'),
          signature('valid'),
          ...(reason == null
            ? []
            : [exact($localize`Signature: ${reason}:reason:`, 'signatureReason')]),
        ],
      },
      {
        id: 'schema',
        label: this.groupLabels.schema,
        chips: [
          schema('invalid'),
          schema('valid'),
          ...(path == null
            ? []
            : [
                exact(
                  $localize`Schema error at: ${path === '' ? $localize`(root)` : path}:path:`,
                  'schemaPath',
                ),
              ]),
        ],
      },
      { id: 'answer', label: this.groupLabels.answer, chips: this.answer(filter.outcome ?? null) },
    ];
  });

  /** Os ligados, na ordem do painel: um item por filtro em "Active filters". */
  readonly active = computed(() =>
    this.groups().flatMap((group) => group.chips.filter((chip) => chip.pressed)),
  );

  /** Um desfecho por vez; `null` tira o filtro. */
  setOutcome(outcome: OutcomeFilter | null): void {
    this.apply({ outcome });
  }

  apply(change: Partial<RequestFilter>): void {
    void this.store.applyFilter({ ...this.store.filter(), ...change });
  }

  clear(): void {
    void this.store.applyFilter(NO_FILTER);
  }

  private answer(outcome: OutcomeFilter | null): FilterChip[] {
    const off = () => this.setOutcome(null);
    return [
      outcome?.type === 'rule'
        ? {
            label: $localize`:filter chip|Active filter, messages the rule answered:Answered by: ${outcome.name}:name:`,
            pressed: true,
            removable: true,
            toggle: off,
          }
        : {
            label: $localize`:filter chip|Messages a rule answered; opens the list of rules:Answered by rule…`,
            pressed: false,
            menu: 'rule',
            toggle: () => undefined,
          },
      outcome?.type === 'near_miss'
        ? {
            label: $localize`Near miss of: ${outcome.name}:name:`,
            pressed: true,
            removable: true,
            toggle: off,
          }
        : {
            label: $localize`:filter chip|Messages that almost matched a rule; opens the list of rules:Near miss of…`,
            pressed: false,
            menu: 'near_miss',
            toggle: () => undefined,
          },
      {
        label: $localize`:filter chip|Messages the URL's default response answered:Default response`,
        pressed: outcome?.type === 'default',
        toggle: () => this.setOutcome(outcome?.type === 'default' ? null : { type: 'default' }),
      },
    ];
  }
}
