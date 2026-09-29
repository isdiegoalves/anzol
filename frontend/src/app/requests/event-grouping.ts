import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { Rule } from '../rules/rule';
import { RuleStore } from '../rules/rule-store';
import { TokenStore } from '../token/token-store';
import {
  EventKey,
  chronological,
  eventCount,
  eventValueOf,
  isEventKey,
  keyCandidates,
} from './event-key';
import { RequestStore } from './request-store';
import { CapturedRequest, WebhookRequest } from './webhook-request';

export const EVENT_KEY_STORAGE = (tokenId: string) => `anzol.eventKey.${tokenId}`;
/** Guardado no lugar da chave: a pessoa disse "Not now" ou "Do not group". */
export const NO_GROUPING = 'off';

function readSaved(tokenId: string): string | null {
  try {
    return localStorage.getItem(EVENT_KEY_STORAGE(tokenId));
  } catch {
    return null;
  }
}

/**
 * O agrupamento por evento: liga só com a chave que a pessoa escolhe, guardada no navegador. Com
 * filtro, guarda as carregadas sem ele, para a trilha do evento vir inteira.
 */
@Injectable({ providedIn: 'root' })
export class EventGrouping {
  private readonly store = inject(RequestStore);
  private readonly tokens = inject(TokenStore);
  private readonly ruleStore = inject(RuleStore);

  private readonly saved = signal<{ tokenId: string | null; value: string | null }>({
    tokenId: null,
    value: null,
  });
  readonly key = computed((): EventKey | null => {
    const { value } = this.saved();
    return value && value !== NO_GROUPING && isEventKey(value) ? value : null;
  });
  readonly decided = computed(() => this.saved().value !== null);
  readonly linkKey = signal<EventKey | null>(null);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly showingAll = signal<ReadonlySet<string>>(new Set());
  private readonly rules = signal<readonly Rule[]>([]);
  private readonly unfiltered = signal<readonly WebhookRequest[]>([]);
  /** Um objeto novo a cada vez: dizer a mesma frase de novo também anuncia. */
  readonly said = signal<{ text: string } | null>(null);

  readonly context = computed(() =>
    this.store.filtering() ? this.unfiltered() : this.store.requests(),
  );
  readonly offer = computed((): EventKey | null => {
    if (this.decided() || this.store.filtering()) {
      return null;
    }
    return this.linkKey() ?? keyCandidates(this.store.requests())[0]?.key ?? null;
  });
  /** Só das carregadas: a tela não sabe quantos eventos a URL tem. */
  readonly events = computed(() => {
    const key = this.key();
    return key ? eventCount(this.context(), key) : 0;
  });

  constructor() {
    effect(() => {
      const tokenId = this.store.tokenId();
      untracked(() => {
        if (tokenId !== this.saved().tokenId) {
          this.saved.set({ tokenId, value: tokenId ? readSaved(tokenId) : null });
          this.expanded.set(new Set());
          this.showingAll.set(new Set());
          this.rules.set([]);
          this.unfiltered.set([]);
        }
      });
    });
    effect(() => {
      const [tokenId, key] = [this.store.tokenId(), this.key()];
      if (tokenId && key) {
        untracked(() => void this.loadRules(tokenId));
      }
    });
    effect(() => {
      const filtering = this.store.filtering();
      const requests = this.store.requests();
      const [tokenId, key] = [this.store.tokenId(), this.key()];
      untracked(() => {
        if (!filtering) {
          this.unfiltered.set(requests);
        } else if (tokenId && key && this.unfiltered().length === 0) {
          void this.loadUnfiltered(tokenId);
        }
      });
    });
  }

  choose(choice: EventKey | typeof NO_GROUPING): void {
    const tokenId = this.store.tokenId();
    if (!tokenId) {
      return;
    }
    try {
      localStorage.setItem(EVENT_KEY_STORAGE(tokenId), choice);
    } catch {
      // Sem localStorage, a chave vale até fechar a aba.
    }
    const wasGrouped = this.key() !== null;
    this.saved.set({ tokenId, value: choice });
    this.linkKey.set(null);
    const key = this.key();
    if (key) {
      const loaded = this.context().length;
      this.said.set({ text: `${groupedBy(key)}. ${eventsIn(this.events(), loaded)}.` });
    } else if (wasGrouped) {
      this.said.set({ text: $localize`Showing requests one by one.` });
    }
  }

  async openDialog(injector: Injector): Promise<void> {
    const { openGroupDialog } = await import('./group-dialog');
    const requests = this.context();
    const choice = await openGroupDialog(injector, {
      requests,
      candidates: keyCandidates(requests),
      current: this.key(),
    });
    if (choice !== undefined) {
      this.choose(choice);
    }
  }

  /** Da mais antiga para a mais nova; `null` sem chave, sem o campo, ou com uma tentativa só. */
  attemptsOf(request: WebhookRequest): WebhookRequest[] | null {
    const key = this.key();
    const value = key ? eventValueOf(request, key) : null;
    if (key === null || value === null) {
      return null;
    }
    const byId = new Map<string, WebhookRequest>();
    for (const each of [...this.context(), ...this.store.requests(), request]) {
      if (eventValueOf(each, key) === value) {
        byId.set(each.uuid, each);
      }
    }
    const attempts = [...byId.values()].sort(chronological);
    return attempts.length >= 2 ? attempts : null;
  }

  toggle(value: string): void {
    this.expanded.update((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(value)) {
        next.add(value);
      }
      return next;
    });
  }

  expand(value: string, open: boolean): void {
    if (this.expanded().has(value) !== open) {
      this.toggle(value);
    }
  }

  showAll(value: string): void {
    this.showingAll.update((all) => new Set([...all, value]));
  }

  /** O `Retry-After` como está configurado agora, não o que foi respondido (não é gravado). */
  askedBy = (answer: CapturedRequest): unknown => {
    if (answer.rule) {
      const headers = this.rules().find((rule) => rule.id === answer.rule?.id)?.response?.headers;
      const name = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === 'retry-after');
      return name === undefined ? null : headers?.[name];
    }
    return this.tokens.token()?.retry_after ?? null;
  };

  private async loadRules(tokenId: string): Promise<void> {
    try {
      const rules = await this.ruleStore.listRules(tokenId);
      if (this.store.tokenId() === tokenId) {
        this.rules.set(rules);
      }
    } catch {
      // Sem as regras, a conferência vale só para a resposta padrão.
    }
  }

  private async loadUnfiltered(tokenId: string): Promise<void> {
    try {
      const page = await this.store.unfilteredPage(tokenId);
      if (this.store.tokenId() === tokenId && this.store.filtering()) {
        this.unfiltered.set(page.data);
      }
    } catch {
      // Sem ela, a trilha fica com as tentativas que o filtro trouxe.
    }
  }
}

export function groupedBy(key: EventKey): string {
  return $localize`Grouped by ${key}:key:`;
}

export function eventsIn(events: number, loaded: number): string {
  return events === 1
    ? $localize`1 event in the ${loaded}:loaded: loaded`
    : $localize`${events}:events: events in the ${loaded}:loaded: loaded`;
}
