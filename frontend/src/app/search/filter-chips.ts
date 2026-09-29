import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Injectable, computed, inject, signal } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import {
  FILTER_METHODS,
  NO_FILTER,
  OutcomeFilter,
  RequestFilter,
  SchemaFilter,
  SignatureFilter,
  ValueFilter,
  valueLabel,
} from './request-filter';

/** F1: o valor clicado na requisição aberta (ou no selo da lista), e o filtro que ele cria. */
export interface ValueTarget {
  kind: 'method' | 'path' | 'header' | 'query' | 'body' | 'status';
  /** O cabeçalho, o parâmetro ou o JSONPath do corpo; vazio nos outros. */
  name: string;
  value: string;
}

/** As classes do status respondido, com chip próprio no subgrupo "Answer" (B2). */
const ANSWERED_CLASSES: readonly string[] = ['2xx', '3xx', '4xx', '5xx'];

/** Um chip do grupo "Filters": o nome acessível é o texto, o estado é o `aria-pressed`. */
export interface FilterChip {
  label: string;
  pressed: boolean;
  toggle: () => void;
  /** Desligado, o chip abre o menu das regras da URL ("Answered by rule…", "Near miss of…"). */
  menu?: 'rule' | 'near_miss';
  /** Filtro que só existe ligado (o motivo exato, a regra escolhida): o chip mostra o ✕. */
  removable?: boolean;
  /** O texto na lista "Active filters", quando é outro ("method POST" do chip "POST", F1). */
  active?: string;
  /** O texto à vista, quando é mais curto que o nome acessível ("4xx" de "Answered 4xx"). */
  short?: string;
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
  private readonly announcer = inject(LiveAnnouncer);
  private cleared = false;
  /** Quantas linhas de resultado da lista estão na tela (no celular, com o detalhe à frente, nenhuma). */
  private listening = 0;

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
      active: $localize`:filter chip|Active filter, the request method:method ${name}:method:`,
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
            : [exact($localize`:filter chip:signature: ${reason}:reason:`, 'signatureReason')]),
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
                  $localize`:filter chip:schema error at ${path === '' ? $localize`(root)` : path}:path:`,
                  'schemaPath',
                ),
              ]),
        ],
      },
      {
        id: 'answer',
        label: this.groupLabels.answer,
        chips: [...this.answer(filter.outcome ?? null), ...this.answered(filter.answered ?? [])],
      },
    ];
  });

  /** Os ligados, na ordem do painel: um item por filtro em "Active filters". */
  readonly active = computed(() => [
    ...this.groups().flatMap((group) => group.chips.filter((chip) => chip.pressed)),
    ...this.valueChips(this.store.filter().values ?? []),
  ]);

  /**
   * F1: o filtro por valor que o servidor recusou (422): a lista voltou ao filtro anterior, e o chip
   * fica à vista, marcado "not accepted", até sair.
   */
  readonly rejected = computed(() =>
    this.store.rejected().map((filter): FilterChip => ({
      label: $localize`${valueLabel(filter)}:filter: — not accepted`,
      pressed: true,
      removable: true,
      toggle: () => this.store.rejected.set([]),
    })),
  );

  /** F1: o link trouxe filtros por valor que esta aba não tem (os valores não vão no endereço). */
  readonly missingValues = signal(0);

  /** O que o último filtro ligado por um valor acrescentou, para o resultado dizer "Filtered by …". */
  private added: string | null = null;

  /**
   * F1: o valor clicado vira filtro ("Filter by this value"), ou o exclui onde o `match` nega (o
   * método). O mesmo campo troca de valor; os outros somam.
   */
  filterByValue(target: ValueTarget, exclude = false): void {
    const filter = this.store.filter();
    const before = new Set(this.activeTexts());
    const { kind, name, value } = target;
    let done: Promise<void>;
    if (kind === 'method') {
      done = this.apply({
        methods: exclude ? FILTER_METHODS.filter((method) => method !== value) : [value],
      });
    } else if (kind === 'status') {
      done = this.apply({
        answered: [...(filter.answered ?? []).filter((v) => v !== value), value],
      });
    } else {
      const others = (filter.values ?? []).filter((v) => v.kind !== kind || v.name !== name);
      done = this.apply({ values: [...others, { kind, name, value }] });
    }
    const added = this.activeTexts().filter((text) => !before.has(text));
    this.added = added.length > 0 ? added.join(', ') : null;
    if (this.listening === 0) {
      // Sem a linha do resultado na tela (o celular com o detalhe à frente), fala o anunciador.
      void done.then(() => this.announceAdded());
    }
  }

  /** A linha do resultado da lista está na tela: é ela que fala o resultado do filtro. */
  listen(): () => void {
    this.listening++;
    return () => this.listening--;
  }

  private announceAdded(): void {
    const added = this.takeAdded();
    if (!added) {
      return;
    }
    const [matched, scan] = [this.store.matched(), this.store.scan()];
    const found = scan
      ? $localize`${matched}:count: match among the newest ${scan.scanned}:scanned:`
      : matched === 1
        ? $localize`1 request matches`
        : $localize`${matched}:count: requests match`;
    void this.announcer.announce($localize`Filtered by ${added}:filter:. ${found}:result:`);
  }

  /** O filtro acrescentado pelo último clique num valor; responde uma vez. */
  takeAdded(): string | null {
    const added = this.added;
    this.added = null;
    return added;
  }

  /**
   * "Filtered by …" ao chegar por um link: o que está ligado, sem o veredito largo quando o motivo
   * ou o caminho exato está junto (o link de Métricas e de Saúde leva os dois).
   */
  describe(): string {
    const filter = this.store.filter();
    const broad = [
      ...(filter.signatureReason != null
        ? [this.signatureLabels.invalid, this.signatureLabels.absent]
        : []),
      ...(filter.schemaPath != null ? [this.schemaLabels.invalid] : []),
    ];
    const text = filter.text
      ? [$localize`:active filter, the text being searched:Search: ${filter.text}:text:`]
      : [];
    return [...text, ...this.activeTexts().filter((label) => !broad.includes(label))].join(', ');
  }

  /** Os textos da lista "Active filters", sem o da busca. */
  private activeTexts(): string[] {
    return this.active().map((chip) => chip.active ?? chip.label);
  }

  private valueChips(values: readonly ValueFilter[]): FilterChip[] {
    return values.map((filter) => ({
      label: valueLabel(filter),
      pressed: true,
      removable: true,
      toggle: () =>
        this.apply({ values: (this.store.filter().values ?? []).filter((v) => v !== filter) }),
    }));
  }

  /** Um desfecho por vez; `null` tira o filtro. */
  setOutcome(outcome: OutcomeFilter | null): void {
    this.apply({ outcome });
  }

  apply(change: Partial<RequestFilter>): Promise<void> {
    return this.store.applyFilter({ ...this.store.filter(), ...change });
  }

  /** "Clear filters": a busca da lista diz "Filters cleared" (e não "No filter"). */
  clear(): void {
    this.cleared = this.store.filtering();
    void this.store.applyFilter(NO_FILTER);
  }

  /** O filtro saiu por "Clear filters"? Responde uma vez. */
  takeCleared(): boolean {
    const cleared = this.cleared;
    this.cleared = false;
    return cleared;
  }

  /**
   * B2 (UX-02): as classes do status respondido e, ligado pela F1, o status exato, com o texto das
   * condições de Regras ("answered 429"). Filtram no navegador (`RequestStore.scan`).
   */
  private answered(answered: readonly string[]): FilterChip[] {
    const toggle = (value: string) => () =>
      this.apply({
        answered: answered.includes(value)
          ? answered.filter((chosen) => chosen !== value)
          : [...answered, value],
      });
    return [
      ...ANSWERED_CLASSES.map((value) => ({
        label: $localize`:filter chip|Requests answered with a status of this class:Answered ${value}:class:`,
        // Os quatro cabem numa linha do subgrupo "Answer"; o nome acessível leva o "Answered".
        short: value,
        pressed: answered.includes(value),
        toggle: toggle(value),
      })),
      ...answered
        .filter((value) => !ANSWERED_CLASSES.includes(value))
        .map((value) => ({
          label: $localize`:filter chip|Active filter, requests answered with this exact status:answered ${value}:status:`,
          pressed: true,
          removable: true,
          toggle: toggle(value),
        })),
    ];
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
