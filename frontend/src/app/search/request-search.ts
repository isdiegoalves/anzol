import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { RequestStore } from '../requests/request-store';
import { TokenStore } from '../token/token-store';
import { ScreenState } from '../shell/screen-state';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { NgTemplateOutlet } from '@angular/common';
import { Rule, evaluationOrder } from '../rules/rule';
import { RuleStore } from '../rules/rule-store';
import { Icon } from '../ui/icon';
import {
  NO_FILTER,
  OutcomeFilter,
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
 * "N of M requests"; e o "Copy as anzol wait-for" com os mesmos filtros. No celular (INBOX-31),
 * só a linha de chips: a pílula e a linha Clear/Copy vêm pela lupa da barra do topo ou com filtro.
 */
@Component({
  selector: 'app-request-search',
  imports: [Icon, MatMenu, MatMenuItem, MatMenuTrigger, NgTemplateOutlet],
  templateUrl: './request-search.html',
  styleUrl: './request-search.scss',
  host: { '[class.collapsed]': "!screen.searchOpen() && !store.filtering() && draft() === ''" },
})
export class RequestSearch {
  protected readonly store = inject(RequestStore);
  private readonly tokens = inject(TokenStore);
  private readonly clipboard = inject(Clipboard);
  private readonly origin = inject(DOCUMENT).location.origin;
  protected readonly screen = inject(ScreenState);
  private readonly rulesStore = inject(RuleStore);

  /** As regras da URL, para os menus "Answered by rule…" e "Near miss of…" (C2); lidas ao abrir. */
  protected readonly rules = signal<readonly Rule[] | null>(null);
  private rulesToken: string | null = null;
  /** O desfecho ligado, para o nome do chip ("Answered by: Pix"). */
  protected readonly outcome = computed(() => this.store.filter().outcome ?? null);
  protected readonly answeredBy = computed(() => {
    const outcome = this.outcome();
    return outcome?.type === 'rule'
      ? $localize`:filter chip|Active filter, messages the rule answered:Answered by: ${outcome.name}:name:`
      : null;
  });
  protected readonly nearMissOf = computed(() => {
    const outcome = this.outcome();
    return outcome?.type === 'near_miss' ? $localize`Near miss of: ${outcome.name}:name:` : null;
  });

  /** Texto digitado; volta ao do filtro quando ele muda por fora (limpar, trocar de URL). */
  protected readonly draft = linkedSignal(() => this.store.filter().text);
  /** Com filtro e sem resultado: o estado vazio da lista tem o seu "Clear filters" (INBOX-25). */
  protected readonly nothingMatches = computed(
    () => this.store.filtering() && this.store.requests().length === 0,
  );
  /** "2 requests match · search runs on the server over all 3" (INBOX-10). */
  protected readonly statusLine = computed(() => {
    const [matched, total] = [this.store.matched(), this.store.total()];
    return matched === 1
      ? $localize`1 request matches · search runs on the server over all ${total}:total:`
      : $localize`${matched}:count: requests match · search runs on the server over all ${total}:total:`;
  });
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

  /**
   * Os chips na ordem do protótipo C (INBOX-09): os principais à vista e os demais atrás de "More
   * filters" (trava 4: nenhum filtro some). Um chip escondido que está ligado continua à vista.
   */
  protected readonly chips = computed<{ main: Chip[]; more: Chip[] }>(() => {
    const filter = this.store.filter();
    const method = (method: string): Chip => ({
      label: method,
      pressed: filter.methods.includes(method),
      toggle: () =>
        this.apply({
          methods: filter.methods.includes(method)
            ? filter.methods.filter((chosen) => chosen !== method)
            : [...filter.methods, method],
        }),
    });
    const signature = (value: 'valid' | 'invalid' | 'absent'): Chip => ({
      label: this.signatureLabels[value],
      pressed: filter.signature === value,
      toggle: () => this.apply({ signature: filter.signature === value ? 'any' : value }),
    });
    const schema = (value: 'valid' | 'invalid'): Chip => ({
      label: this.schemaLabels[value],
      pressed: filter.schema === value,
      toggle: () => this.apply({ schema: filter.schema === value ? 'any' : value }),
    });
    return {
      main: [
        method('POST'),
        method('GET'),
        method('PUT'),
        signature('invalid'),
        signature('absent'),
        schema('invalid'),
      ],
      more: [method('PATCH'), method('DELETE'), signature('valid'), schema('valid')],
    };
  });
  /** "More filters" aberto; nasce aberto quando um dos filtros de lá está ligado (um link, a rota). */
  protected readonly moreOpen = linkedSignal<boolean, boolean>({
    source: () => this.chips().more.some((chip) => chip.pressed),
    computation: (pressedMore, previous) => pressedMore || (previous?.value ?? false),
  });

  constructor() {
    toObservable(this.draft)
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe((text) => this.apply({ text }));
  }

  /** Lê as regras da URL na primeira vez que um dos menus abre. */
  protected async loadRules(): Promise<void> {
    const tokenId = this.store.tokenId();
    if (!tokenId || (this.rulesToken === tokenId && this.rules() !== null)) {
      return;
    }
    this.rulesToken = tokenId;
    this.rules.set(null);
    try {
      const rules = await this.rulesStore.listRules(tokenId);
      this.rules.set(evaluationOrder(rules).map((index) => rules[index]));
    } catch {
      this.rules.set([]);
    }
  }

  /** Um desfecho por vez; `null` tira o filtro. */
  protected setOutcome(outcome: OutcomeFilter | null): void {
    this.apply({ outcome });
  }

  protected chooseRule(type: 'rule' | 'near_miss', rule: Rule): void {
    if (rule.id) {
      this.setOutcome({ type, rule: rule.id, name: rule.name });
    }
  }

  protected toggleDefault(): void {
    this.setOutcome(this.outcome()?.type === 'default' ? null : { type: 'default' });
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
