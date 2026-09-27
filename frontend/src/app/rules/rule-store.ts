import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { RequestPage, WebhookRequest } from '../requests/webhook-request';
import { ServerPhrase, validationPhrase } from '../pipeline/server-phrases';
import { RuleStats, TokenStats } from '../stats/stats';
import {
  HISTORY_TEST_WINDOW,
  HistoryTest,
  RenderedResponse,
  Rule,
  RuleMatch,
  RuleTestResponse,
  RuleTrace,
  summarizeHistoryTest,
} from './rule';

/** Quantas mensagens o "Preview response" renderiza (o teto do servidor, C4). */
const RENDER_COUNT = 3;

/** Páginas de 100 que cobrem a janela de 500 do `rules/test` (S8). */
const RECENT_PER_PAGE = 100;

/**
 * O `PUT` da lista inteira apagaria o que outra aba ou o CLI mudou desde a leitura: a lista do
 * servidor não é mais a que a tela leu.
 */
export class RulesChangedError extends Error {
  constructor() {
    super('The rules changed elsewhere');
  }
}

/**
 * Regras da URL aberta. A API só tem a lista inteira: `GET` lê, `PUT` substitui (e é o import).
 * Toda mudança da tela — criar, editar, ligar, reordenar, apagar — é um `PUT` da lista.
 */
@Injectable({ providedIn: 'root' })
export class RuleStore {
  private readonly http = inject(HttpClient);

  readonly tokenId = signal<string | null>(null);
  readonly rules = signal<readonly Rule[]>([]);
  /**
   * A lista do servidor mudou desde a leitura e nada foi gravado (toggle, reordenação, apagar,
   * Undo). Fica aqui, e não na página, porque o Undo do "Delete rule" chega depois que o editor
   * fechou e a rota trocou (outra instância da página).
   */
  readonly changedElsewhere = signal(false);
  /**
   * Para onde vai o foco depois que a rota do editor muda: ao abrir, o nome no topo do editor; ao
   * fechar, o item da regra (`rule: null`, "New rule"). Fica aqui porque `rules` e `rules/{id}`
   * são rotas diferentes (outra instância da página).
   */
  readonly pendingFocus = signal<'editor' | { rule: string | null } | null>(null);
  /** Hits por regra na janela de `stats` (`null` enquanto não chegam ou se falharem). */
  readonly hits = signal<(RuleStats & { evaluated: number }) | null>(null);
  /** A lista como o servidor a devolveu na última leitura ou gravação. */
  private serverList = '[]';
  /** As mensagens da janela do `rules/test`, lidas uma vez por carga da lista. */
  private recent: Promise<WebhookRequest[]> | null = null;
  private latest: Promise<WebhookRequest | null> | null = null;
  private total: Promise<number> | null = null;

  /** A leitura dos hits falhou (ou o servidor não os tem): "Hits unavailable" na lista. */
  readonly hitsFailed = signal(false);
  /**
   * O último "Test against history" de cada regra salva, com o `match` testado: a lista só o usa
   * como evidência de sombra provável enquanto a regra salva tem o mesmo `match` (E-01).
   */
  readonly tested = signal<ReadonlyMap<string, { match: RuleMatch; matches: readonly string[] }>>(
    new Map(),
  );

  async load(tokenId: string): Promise<void> {
    if (tokenId !== this.tokenId()) {
      // O teste da regra vale para esta URL: "Back to list" relê a lista da mesma URL e o mantém.
      this.tested.set(new Map());
    }
    this.tokenId.set(tokenId);
    this.rules.set([]);
    this.recent = null;
    this.latest = null;
    this.total = null;
    this.keep(await firstValueFrom(this.http.get<Rule[]>(this.url(tokenId))));
  }

  /** Relê a lista do servidor (depois do aviso "changed elsewhere"), sem apagar a da tela antes. */
  async reload(): Promise<void> {
    this.keep(await this.fetchAll());
  }

  /** Relê os hits (`GET /stats`); sem eles, a lista só não mostra as contagens. */
  async loadHits(tokenId: string): Promise<void> {
    this.hits.set(null);
    this.hitsFailed.set(false);
    await this.refreshHits(tokenId);
  }

  /** Relê os hits sem apagar os de agora (atualização ao vivo, WM-38). */
  async refreshHits(tokenId: string): Promise<void> {
    try {
      const stats = await firstValueFrom(this.http.get<TokenStats>(`/token/${tokenId}/stats`));
      if (this.tokenId() === tokenId && stats.rules) {
        this.hits.set({ ...stats.rules, evaluated: stats.evaluated });
        this.hitsFailed.set(false);
      } else if (this.tokenId() === tokenId) {
        this.hitsFailed.set(true);
      }
    } catch {
      // Servidor sem `stats` ou falha momentânea: a lista funciona sem os hits.
      if (this.tokenId() === tokenId && !this.hits()) {
        this.hitsFailed.set(true);
      }
    }
  }

  /** A mensagem mais nova da URL (o cartão "Create from the latest request"), ou `null`. */
  async latestRequest(tokenId: string): Promise<WebhookRequest | null> {
    const page = await firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page: 1, per_page: 1, sorting: 'newest' },
      }),
    );
    return page.data[0] ?? null;
  }

  /**
   * Substitui a lista só se a do servidor ainda é a que a tela leu (toda mudança da tela parte da
   * lista mostrada: salvar no editor, toggle, reordenação, apagar e desfazer); senão, não grava e
   * lança `RulesChangedError`. O import é a exceção: ele troca a lista de propósito.
   */
  async saveIfUnchanged(rules: readonly Rule[]): Promise<void> {
    const current = await this.fetchAll();
    if (JSON.stringify(current) !== this.serverList) {
      throw new RulesChangedError();
    }
    await this.save(rules);
  }

  /**
   * As mensagens mais novas da URL, até a janela do `rules/test` (5 páginas de 100, S8), com a
   * regra que respondeu cada uma e o near miss. Lidas uma vez por carga da lista.
   */
  recentRequests(): Promise<WebhookRequest[]> {
    const tokenId = this.requireToken();
    this.recent ??= this.fetchRecent(tokenId).catch((error: unknown) => {
      this.recent = null;
      throw error;
    });
    return this.recent;
  }

  private async fetchRecent(tokenId: string): Promise<WebhookRequest[]> {
    const requests: WebhookRequest[] = [];
    for (let page = 1; requests.length < HISTORY_TEST_WINDOW; page++) {
      const result = await firstValueFrom(
        this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
          params: { page, per_page: RECENT_PER_PAGE, sorting: 'newest' },
        }),
      );
      requests.push(...result.data);
      if (result.is_last_page || result.data.length === 0) {
        break;
      }
    }
    return requests.slice(0, HISTORY_TEST_WINDOW);
  }

  /**
   * A mensagem mais nova da URL (o exemplo do editor, WM-16), ou `null` sem nenhuma. Uma leitura
   * por carga da lista; falha vira "sem exemplo".
   */
  exampleRequest(): Promise<WebhookRequest | null> {
    const tokenId = this.requireToken();
    this.latest ??= firstValueFrom(
      this.http.get<RequestPage>(`/token/${tokenId}/requests`, {
        params: { page: 1, per_page: 1, sorting: 'newest' },
      }),
    )
      .then((page) => page.data[0] ?? null)
      .catch(() => null);
    return this.latest;
  }

  /**
   * As regras da URL sem mexer na lista da página de Regras (o "Why not rule…?" do detalhe da
   * mensagem, C1).
   */
  listRules(tokenId: string): Promise<Rule[]> {
    return firstValueFrom(this.http.get<Rule[]>(this.url(tokenId)));
  }

  /** C1: as regras de agora avaliadas contra a mensagem gravada, sem gravar nada. */
  trace(tokenId: string, requestId: string): Promise<RuleTrace> {
    return firstValueFrom(
      this.http.get<RuleTrace>(
        `/token/${tokenId}/request/${encodeURIComponent(requestId)}/rules/trace`,
      ),
    );
  }

  /** Uma mensagem da URL (`rules/new?from=`). */
  fetchRequest(tokenId: string, requestId: string): Promise<WebhookRequest> {
    return firstValueFrom(
      this.http.get<WebhookRequest>(`/token/${tokenId}/request/${encodeURIComponent(requestId)}`),
    );
  }

  private keep(rules: Rule[]): void {
    this.serverList = JSON.stringify(rules);
    this.rules.set(rules);
  }

  /** Lista atual do servidor (o export baixa o que está salvo, não o que a tela mostra). */
  fetchAll(): Promise<Rule[]> {
    return firstValueFrom(this.http.get<Rule[]>(this.url(this.requireToken())));
  }

  /**
   * Substitui a lista no servidor. A tela mostra a mudança na hora (o toggle não pula de volta)
   * e fica com a lista que o servidor devolve, com os `id`s e padrões; se o `PUT` falha, volta à
   * lista anterior e repassa o erro (o 422 é mostrado por quem chamou).
   */
  async save(rules: readonly Rule[]): Promise<void> {
    const tokenId = this.requireToken();
    const previous = this.rules();
    this.rules.set(rules);
    try {
      this.keep(await firstValueFrom(this.http.put<Rule[]>(this.url(tokenId), rules)));
    } catch (error) {
      this.rules.set(previous);
      throw error;
    }
  }

  /**
   * A regra em edição (salva ou não) contra as mensagens gravadas mais recentes. O total de
   * mensagens da URL vem junto, para o link de cada falha abrir a página certa da lista.
   */
  testRule(rule: Rule): Promise<HistoryTest> {
    return firstValueFrom(this.testRule$(rule));
  }

  /**
   * O mesmo teste como Observable: cancelar a inscrição cancela o `POST` (o rerun do editor só
   * quer o último, WM-22). O total de mensagens da URL é lido uma vez por carga da lista.
   */
  testRule$(rule: Rule): Observable<HistoryTest> {
    const tokenId = this.requireToken();
    // Sem operadores do RxJS: eles iriam para o pedaço compartilhado com a carga inicial.
    return new Observable<HistoryTest>((subscriber) => {
      const total = this.requestTotal(tokenId);
      const post = this.http.post<RuleTestResponse>(`${this.url(tokenId)}/test`, rule).subscribe({
        next: (response) =>
          void total.then(
            (count) => {
              const result = summarizeHistoryTest(response, count);
              if (rule.id) {
                const tested = { match: rule.match ?? {}, matches: result.matches };
                this.tested.update((known) => new Map(known).set(rule.id ?? '', tested));
              }
              subscriber.next(result);
              subscriber.complete();
            },
            (error: unknown) => subscriber.error(error),
          ),
        error: (error: unknown) => subscriber.error(error),
      });
      return () => post.unsubscribe();
    });
  }

  /**
   * Quantas das mensagens recentes de uma URL a regra casaria, sem carregar a lista dela (a folha
   * "Create rule from this request" abre na Inbox, WM-31).
   */
  async countMatches(tokenId: string, rule: Rule): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<RuleTestResponse>(`${this.url(tokenId)}/test`, rule),
    );
    return response.matches.length;
  }

  /**
   * "Preview response" (C4): o `rules/test` com `render=3`, a resposta renderizada das até 3
   * mensagens mais novas que a regra casa. Só sob pedido; o rerun nunca pede render.
   */
  async renderRule(rule: Rule): Promise<RenderedResponse[]> {
    const tokenId = this.requireToken();
    const response = await firstValueFrom(
      this.http.post<RuleTestResponse>(`${this.url(tokenId)}/test`, rule, {
        params: { render: RENDER_COUNT },
      }),
    );
    return response.rendered ?? [];
  }

  /** Quantas mensagens a URL guarda (para a página de cada link do teste); uma leitura por carga. */
  private requestTotal(tokenId: string): Promise<number> {
    this.total ??= firstValueFrom(
      this.http.get<{ total: number }>(`/token/${tokenId}/requests`, { params: { per_page: 1 } }),
    )
      .then(({ total }) => total)
      .catch((error: unknown) => {
        this.total = null;
        throw error;
      });
    return this.total;
  }

  private url(tokenId: string): string {
    return `/token/${tokenId}/rules`;
  }

  private requireToken(): string {
    const tokenId = this.tokenId();
    if (!tokenId) {
      throw new Error('No URL loaded');
    }
    return tokenId;
  }
}

/**
 * Frases para o usuário a partir do erro do `PUT`: no 422, uma por mensagem, com a regra
 * numerada a partir de 1 (`0.match.path.regex` → `Rule 1 › match.path.regex: ...`).
 */
export function validationMessages(error: unknown): string[] {
  return validationPhrases(error).map(({ text }) => text);
}

/**
 * As mesmas frases, com a mensagem do 422 na língua da tela e o original ao lado (WM-05): a tela
 * mostra `text` e põe `original` no `title`.
 */
export function validationPhrases(error: unknown): ServerPhrase[] {
  if (!(error instanceof HttpErrorResponse)) {
    return [plainPhrase($localize`Could not save the rules (unknown).`)];
  }
  if (error.status === 422 && error.error && typeof error.error === 'object') {
    return Object.entries(error.error as Record<string, string[]>).flatMap(([key, messages]) =>
      messages.map((message) => {
        const phrase = validationPhrase(message);
        const prefix = describeKey(key);
        return {
          text: `${prefix}${phrase.text}`,
          original: `${prefix}${message}`,
          translated: phrase.translated,
        };
      }),
    );
  }
  if (error.status === 404 || error.status === 410) {
    return [plainPhrase($localize`This URL no longer exists (${error.status}).`)];
  }
  return [plainPhrase($localize`Could not save the rules (${error.status}).`)];
}

/** Uma frase da própria tela (já no idioma dela), no formato das do servidor. */
export function plainPhrase(text: string): ServerPhrase {
  return { text, original: text, translated: false };
}

function describeKey(key: string): string {
  const indexed = /^(\d+)\.(.+)$/.exec(key);
  if (indexed) {
    return $localize`Rule ${Number(indexed[1]) + 1}:position: › ${indexed[2]}:field:: `;
  }
  return key === 'rules' ? '' : `${key}: `;
}
