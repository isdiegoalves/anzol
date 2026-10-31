import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RequestStream } from '../realtime/request-stream';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';
import { RuleStore } from '../rules/rule-store';
import { KnownUrls } from '../token/known-urls';
import { TokenStore } from '../token/token-store';
import { CircuitNode, circuitOf } from './circuit-model';

/** A largura do palco da demo e a margem dele à esquerda (onde fica a legenda "circuito"). */
const STAGE_WIDTH = 1248;
const STAGE_MARGIN = 24;
/** O piso da escala: o texto de 11 px do palco não fica abaixo de 10 px. */
const MIN_SCALE = 10 / 11;
/** Com a leitura das regras em falha, a próxima tentativa sozinha; antes dela, nenhuma outra. */
export const RULES_RETRY_MS = 15_000;
/** O intervalo mínimo entre as releituras pedidas pela volta da conexão ou pela lista carregada de novo. */
export const REREAD_MIN_MS = 5_000;
/** A folga do relógio para a tentativa marcada não ser barrada por chegar um instante antes dos 15 s. */
const RETRY_SLACK_MS = 100;

/**
 * Como o palco cabe na faixa: a margem cede primeiro (até 0), depois o palco encolhe até o piso legível e só então a
 * faixa rola por dentro.
 */
export function stageFit(available: number): { scale: number; margin: number; scrolls: boolean } {
  const margin = Math.max(0, Math.min(STAGE_MARGIN, available - STAGE_WIDTH));
  const scale = Math.max(MIN_SCALE, Math.min(1, available / STAGE_WIDTH));
  return { scale, margin, scrolls: STAGE_WIDTH * scale > available };
}

/**
 * O circuito da URL na Entrada, abaixo do cabeçalho (C-1, demo combinada): o desenho de 1248 × 120 com os nós da
 * configuração e, com uma mensagem aberta, o caminho dela e a regra que quase casou. Os nós são botões num grupo,
 * cada um uma parada do Tab, como na demo (as setas são um atalho a mais); clicar filtra a lista pelo que passou ali
 * e clicar de novo tira, sem motion. No celular (`line`), só a frase "caminho: …" da mensagem aberta, numa linha que
 * rola.
 */
@Component({
  selector: 'app-circuit',
  templateUrl: './circuit.html',
  styleUrl: './circuit.scss',
})
export class Circuit {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly ruleStore = inject(RuleStore);
  private readonly stream = inject(RequestStream);
  private readonly known = inject(KnownUrls);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly band = viewChild<ElementRef<HTMLElement>>('band');

  /** Celular: a linha de glifos com o caminho da mensagem aberta, no lugar do desenho. */
  readonly line = input(false);

  /**
   * A última leitura das regras que acabou: a URL e se falhou. As regras em si são as da `RuleStore` (a folha
   * "Create rule" e o roteiro gravam por ela, e a escada acompanha na hora).
   */
  private readonly read = signal<{ tokenId: string; failed: boolean } | null>(null);
  private reading: string | null = null;
  /** As URLs que esta Entrada já leu ou releu (voltar a uma delas não lê de novo). */
  private readonly seen = new Set<string>();
  private retry: ReturnType<typeof setTimeout> | undefined;
  /** Quando começou a última leitura e quando a última falhou (`null` depois de uma que deu certo). */
  private lastReadAt = Number.NEGATIVE_INFINITY;
  private lastFailedAt: number | null = null;

  /**
   * As mensagens que contam nos nós: as carregadas sem filtro. Com a lista filtrada (pelo próprio circuito, por
   * exemplo), as contagens ficam as de antes do filtro; aberta já filtrada (um link), conta o resultado do filtro.
   */
  private readonly counted = linkedSignal<
    { tokenId: string | null; filtering: boolean; list: readonly CapturedRequest[] },
    { list: readonly CapturedRequest[]; unfiltered: boolean }
  >({
    source: () => ({
      tokenId: this.requests.tokenId(),
      filtering: this.requests.filtering(),
      list: this.requests.requests(),
    }),
    computation: (source, previous) => {
      if (!source.filtering) {
        return { list: source.list, unfiltered: true };
      }
      return previous?.value.unfiltered && previous.source.tokenId === source.tokenId
        ? previous.value
        : { list: source.list, unfiltered: false };
    },
  });

  /** As regras desta URL, quando a `RuleStore` está nela; `null` enquanto não chegaram (ou se a leitura falhou). */
  private readonly rules = computed(() => {
    const tokenId = this.tokens.shown()?.uuid;
    return tokenId && this.ruleStore.loadedFor() === tokenId ? this.ruleStore.rules() : null;
  });
  private readonly unavailable = computed(() => {
    const read = this.read();
    return !this.rules() && !!read?.failed && read.tokenId === this.tokens.shown()?.uuid;
  });

  protected readonly view = computed(() => {
    const token = this.tokens.shown();
    const rules = this.rules();
    if (!token || (!rules && !this.unavailable())) {
      return null;
    }
    return circuitOf({
      token,
      name: this.known.nameOf(token.uuid),
      rules,
      rulesUnavailable: this.unavailable(),
      requests: this.counted().list,
      selected: this.requests.selected() ?? null,
      filter: this.requests.filter(),
      scale: this.fit().scale,
    });
  });

  /** As arestas do caminho da mensagem aberta, desenhadas por cima em tinta. */
  protected readonly routeEdges = computed(() => {
    const view = this.view();
    return view ? view.edges.filter((edge) => view.route.includes(edge.id)) : [];
  });

  /**
   * Como o palco cabe na largura da faixa: medida antes da primeira pintura (`afterRenderEffect`) e depois pelo
   * `ResizeObserver`. A mesma medida não pinta de novo.
   */
  protected readonly fit = signal(stageFit(STAGE_WIDTH + STAGE_MARGIN), {
    equal: (a, b) => a.scale === b.scale && a.margin === b.margin && a.scrolls === b.scrolls,
  });

  constructor() {
    // As regras de cada URL: lidas quando ela abre; a que a store já tem é relida em silêncio na primeira vez.
    effect(() => {
      const tokenId = this.tokens.shown()?.uuid;
      if (!tokenId) {
        return;
      }
      const loaded = this.ruleStore.loadedFor() === tokenId;
      untracked(() => {
        if (this.reading === tokenId || this.read()?.tokenId === tokenId) {
          return;
        }
        if (!loaded) {
          void this.readRules(tokenId);
        } else if (!this.seen.has(tokenId)) {
          this.seen.add(tokenId);
          void this.readRules(tokenId);
        }
      });
    });
    // A lista desta URL saiu da store sem uma leitura do circuito em curso (outra tela leu outra URL nela): relê.
    let had: string | null = null;
    effect(() => {
      const tokenId = this.tokens.shown()?.uuid ?? null;
      const loaded = this.ruleStore.loadedFor();
      const lost = !!tokenId && had === tokenId && loaded !== tokenId;
      had = loaded;
      if (lost && untracked(() => this.reading) !== tokenId) {
        untracked(() => this.reread('lost'));
      }
    });
    // A conexão voltou (o tempo real reabriu depois da queda): as regras podem ter mudado, ou a leitura ter falhado.
    let before = untracked(this.stream.status);
    effect(() => {
      const status = this.stream.status();
      const back = status === 'open' && (before === 'reconnecting' || before === 'silent');
      before = status;
      if (back) {
        untracked(() => this.reread('event'));
      }
    });
    // A lista carregou de novo (o "Try again" da lista em erro): com as regras em falha, tenta junto.
    let listLoading = untracked(this.requests.loading);
    effect(() => {
      const loading = this.requests.loading();
      const loaded = listLoading && !loading && !this.requests.failure();
      listLoading = loading;
      if (loaded && untracked(this.unavailable)) {
        untracked(() => this.reread('event'));
      }
    });
    // A faixa nova já pinta na medida dela: a leitura e a escrita acontecem antes de o navegador pintar (F1-R16).
    afterRenderEffect({
      earlyRead: () => this.band()?.nativeElement.clientWidth ?? 0,
      write: (width) => {
        // Sem largura (sem leiaute ainda, ou escondida), fica a medida de antes.
        if (width() > 0) {
          this.fit.set(stageFit(width()));
        }
      },
    });
    afterNextRender(() => this.observeBand());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
  }

  /**
   * Relê as regras da URL aberta: a tentativa marcada depois da falha (`retry`), um sinal de que elas podem ter
   * mudado (`event`: a volta da conexão, a lista de novo) ou a lista que saiu da store (`lost`). Com freio (F1-R12):
   * a leitura que falha sem resposta derruba o tempo real (`connectionInterceptor`), que volta logo e pediria outra,
   * num laço. Depois de uma falha, nenhuma leitura antes da tentativa de 15 s; e os sinais não releem a menos de 5 s
   * da última.
   */
  private reread(cause: 'retry' | 'event' | 'lost'): void {
    const tokenId = this.tokens.shown()?.uuid;
    if (!tokenId || this.reading === tokenId) {
      return;
    }
    const now = Date.now();
    if (this.lastFailedAt !== null && now - this.lastFailedAt < RULES_RETRY_MS - RETRY_SLACK_MS) {
      return;
    }
    if (cause === 'event' && now - this.lastReadAt < REREAD_MIN_MS) {
      return;
    }
    void this.readRules(tokenId);
  }

  /**
   * Lê pela `RuleStore`: na URL que ela já tem, sem apagar a lista enquanto a resposta não chega (`reload`); em
   * outra, esperando a leitura em curso desta URL ou carregando-a (`ready`). Sem a lista no fim (falhou, a nossa ou
   * a que tomou o lugar dela): o circuito diz "regras indisponíveis" e tenta de novo daqui a pouco.
   */
  private async readRules(tokenId: string): Promise<void> {
    this.reading = tokenId;
    this.lastReadAt = Date.now();
    clearTimeout(this.retry);
    let failed = false;
    let erred = false;
    try {
      if (this.ruleStore.loadedFor() === tokenId) {
        await this.ruleStore.reload();
      } else {
        await this.ruleStore.ready(tokenId);
      }
      this.seen.add(tokenId);
    } catch {
      erred = true;
      // A releitura que falha deixa a lista de antes na tela: as regras seguem disponíveis.
      failed = this.ruleStore.loadedFor() !== tokenId;
    }
    if (this.reading !== tokenId) {
      return;
    }
    this.reading = null;
    this.read.set({ tokenId, failed });
    this.lastFailedAt = erred ? Date.now() : null;
    if (erred) {
      this.retry = setTimeout(() => this.reread('retry'), RULES_RETRY_MS);
    }
  }

  /** A largura útil da faixa decide a margem, a escala e se ela rola (`stageFit`). */
  private observeBand(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      const band = this.band()?.nativeElement;
      if (band) {
        this.fit.set(stageFit(band.clientWidth));
      }
    });
    effect(
      (onCleanup) => {
        const band = this.band()?.nativeElement;
        if (band) {
          observer.observe(band);
          onCleanup(() => observer.unobserve(band));
        }
      },
      { injector: this.injector },
    );
  }

  /**
   * Um filtro do circuito por vez, como na demo: o nó liga o dele e tira o dos outros nós (assinatura, schema,
   * decifra e desfecho); de novo, tira o dele. Os nós sem filtro mostram todas.
   */
  protected toggle(node: CircuitNode): void {
    const filter = this.requests.filter();
    const cleared = {
      signature: 'any' as const,
      schema: 'any' as const,
      decryption: null,
      outcome: null,
    };
    const change = node.pressed ? node.off : { ...cleared, ...node.filter };
    // A busca que falha diz isso no lugar da lista.
    this.requests.applyFilter({ ...filter, ...change }).catch(() => undefined);
  }

  /** Atalho a mais: as setas, Home e End andam entre os nós (o Tab anda em todos, como na demo). */
  protected move(event: KeyboardEvent): void {
    const nodes = [...this.host.querySelectorAll<HTMLButtonElement>('.node')];
    const at = nodes.indexOf(event.target as HTMLButtonElement);
    if (at < 0) {
      return;
    }
    const last = nodes.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: Math.min(last, at + 1),
      ArrowDown: Math.min(last, at + 1),
      ArrowLeft: Math.max(0, at - 1),
      ArrowUp: Math.max(0, at - 1),
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    nodes[next].focus();
  }
}
