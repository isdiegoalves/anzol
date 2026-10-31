import { MediaMatcher } from '@angular/cdk/layout';
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
import { CapturedRequest, WebhookRequest } from '../requests/webhook-request';
import { RuleStore } from '../rules/rule-store';
import { FilterChips } from '../search/filter-chips';
import { NO_FILTER } from '../search/request-filter';
import { KnownUrls } from '../token/known-urls';
import { TokenStore } from '../token/token-store';
import { CircuitFlow, FlowStage } from './circuit-flow';
import { CircuitInput, CircuitNode, CircuitView, circuitOf, flowWidth } from './circuit-model';
import { Step } from './escada';
import { Motion, PulseLayer, readMotion } from './pulse';

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
/** Quanto o circuito segue mostrando a chegada que a tela ia abrir, se ela não a abriu quando a linha nasceu. */
const REVEAL_GRACE_MS = 2000;

/** O caminho de uma chegada: as arestas, os saltos do pulso e em que salto cada aresta acende. */
type Shape = Pick<CircuitView, 'route' | 'hops' | 'lit'>;

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
export class Circuit implements FlowStage {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly ruleStore = inject(RuleStore);
  private readonly stream = inject(RequestStream);
  private readonly known = inject(KnownUrls);
  private readonly chips = inject(FilterChips);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly flow = inject(CircuitFlow);
  private readonly reducedMotion = inject(MediaMatcher).matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private readonly band = viewChild<ElementRef<HTMLElement>>('band');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  /** A camada dos pulsos, por cima do desenho. */
  private readonly fx = viewChild<ElementRef<HTMLElement>>('fx');
  private layer: { host: HTMLElement; pulses: PulseLayer } | null = null;
  private tokensRead: Motion | null = null;
  /** Os pulsos curtos de um quadro, um por caminho (lote por `requestAnimationFrame`). */
  private readonly shortQueue = new Map<string, string[]>();
  private frame: number | null = null;
  /** As chegadas desta URL por aresta, para a espessura do modo fluxo, e o desenho a que elas se referem. */
  private segments = new Map<string, number>();
  private shapes = new Map<string, Shape>();
  private shapesFor: object | null = null;
  private layoutKey = '';
  /** A chegada que a tela vai abrir, mostrada no circuito enquanto o pulso passa, e a mensagem aberta de antes. */
  private readonly reveal = signal<{ request: WebhookRequest; before: string | null } | null>(null);
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  /** As animações do aparecer (arestas, glifos) e do assentar do caminho da chegada aberta. */
  private revealing: Animation[] = [];
  private settling: { id: string; animation: Animation } | null = null;

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

  /** O que o desenho precisa além das mensagens: a URL, as regras e a escala; `null` sem o que desenhar. */
  private readonly layout = computed(
    (): Omit<CircuitInput, 'requests' | 'selected' | 'filter'> | null => {
      const token = this.tokens.shown();
      const rules = this.rules();
      if (!token || (!rules && !this.unavailable())) {
        return null;
      }
      return {
        token,
        name: this.known.nameOf(token.uuid),
        rules,
        rulesUnavailable: this.unavailable(),
        scale: this.fit().scale,
      };
    },
  );

  /**
   * A mensagem que o desenho mostra: a aberta; enquanto o pulso de uma chegada que a tela vai abrir passa, a chegada
   * (até a aberta mudar, por ela ou pela pessoa).
   */
  private readonly showing = computed(() => {
    const selected = this.requests.selected() ?? null;
    const reveal = this.reveal();
    return reveal && (selected?.uuid ?? null) === reveal.before ? reveal.request : selected;
  });

  protected readonly view = computed(() => {
    const layout = this.layout();
    if (!layout) {
      return null;
    }
    return circuitOf({
      ...layout,
      requests: this.counted().list,
      selected: this.showing(),
      filter: this.requests.filter(),
      meter: this.flow.step() === 'flow' ? this.flow.rate() : null,
    });
  });

  /**
   * Os contadores e a espessura das arestas mudam com transição só quando a contagem mudou por uma chegada (C-6): um
   * filtro que sai, uma requisição apagada ou outra URL trocam o número em 0 ms.
   */
  protected readonly rolls = linkedSignal<
    { landed: number; counted: { list: readonly CapturedRequest[] } },
    boolean
  >({
    source: () => ({ landed: this.flow.landed(), counted: this.counted() }),
    computation: (source, previous) => !!previous && source.landed !== previous.source.landed,
  });

  /** A espessura das arestas no modo fluxo, por id (demo: de 1 a 3 px pelas chegadas que passaram por elas). */
  protected readonly widths = signal<Record<string, number>>({});

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
    // As chegadas pelo tempo real: só o desenho da faixa as mostra (no celular, a linha do caminho não tem pulso).
    let detach = () => undefined as void;
    afterNextRender(() => {
      if (!this.line()) {
        detach = this.flow.attach(this);
      }
    });
    // Outra URL: os pulsos, as espessuras e a chegada mostrada eram da anterior.
    let shownId: string | undefined;
    effect(() => {
      const id = this.tokens.shown()?.uuid;
      if (id !== shownId) {
        shownId = id;
        untracked(() => {
          this.clear();
          this.segments = new Map();
          this.widths.set({});
        });
      }
    });
    // A pessoa abriu outra mensagem enquanto o caminho da chegada assentava: ele para no estado final, sem motion.
    effect(() => {
      const selected = this.requests.selected()?.uuid ?? null;
      untracked(() => {
        if (this.settling && selected !== null && selected !== this.settling.id) {
          this.stopReveal();
        }
      });
    });
    const motionChanged = () => this.clear();
    this.reducedMotion.addEventListener?.('change', motionChanged);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.retry);
      clearTimeout(this.revealTimer);
      this.reducedMotion.removeEventListener?.('change', motionChanged);
      detach();
      this.clear();
    });
  }

  /**
   * Uma chegada pelo tempo real (a `CircuitFlow` decidiu o degrau): conta as arestas dela; no fluxo, engrossa as
   * arestas; no pulso curto, entra no lote do quadro; na chegada isolada, lança o pulso inteiro e, se a tela vai
   * abri-la, a mostra enquanto ele passa. Devolve em quanto tempo a linha nasce (o pulso chegou à Resposta e se
   * desfez); com movimento reduzido, sem pulso, o mesmo tempo, e tudo aparece de uma vez no fim (MR-0).
   */
  draw(
    request: WebhookRequest,
    step: Step,
    opens: boolean,
  ): { born: number; hurry(): void } | null {
    const shape = this.shapeOf(request);
    if (!shape || shape.hops.length === 0) {
      return null;
    }
    this.countSegments(shape, step);
    if (step === 'flow') {
      return null;
    }
    const motion = this.motion();
    const born = (shape.hops.length + 1) * motion.hop;
    if (this.reducedMotion.matches) {
      return step === 'full' ? { born, hurry: () => undefined } : null;
    }
    if (step === 'short') {
      this.queueShort(shape.hops);
      return null;
    }
    const pulse =
      this.pulses()?.launch({
        hops: shape.hops,
        hopMs: motion.hop,
        trail: true,
        discharge: true,
      }) ?? null;
    if (opens) {
      this.startReveal(request, born, motion);
    }
    return {
      born,
      hurry: () => {
        pulse?.downgrade();
        this.finishReveal();
      },
    };
  }

  /** Tira os pulsos e a chegada mostrada (outra URL, aba oculta, movimento reduzido ligado). */
  clear(): void {
    this.layer?.pulses.clear();
    this.shortQueue.clear();
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.stopReveal();
  }

  /** O caminho da chegada no desenho de agora (o mesmo para as que respondem igual: guardado por resposta). */
  private shapeOf(request: WebhookRequest): Shape | null {
    const layout = untracked(this.layout);
    if (!layout || this.line()) {
      return null;
    }
    if (layout !== this.shapesFor) {
      this.shapesFor = layout;
      this.shapes = new Map();
    }
    const key = request.rule ? `rule:${request.rule.id}` : request.near_miss ? 'near' : 'none';
    const known = this.shapes.get(key);
    if (known) {
      return known;
    }
    const { route, hops, lit, edges } = circuitOf({
      ...layout,
      requests: [],
      selected: request,
      filter: NO_FILTER,
    });
    const layoutKey = edges.map((edge) => edge.d).join();
    if (layoutKey !== this.layoutKey) {
      // As regras ou a escala mudaram: as arestas são outras.
      this.layoutKey = layoutKey;
      this.segments = new Map();
      this.widths.set({});
    }
    const shape = { route, hops, lit };
    this.shapes.set(key, shape);
    return shape;
  }

  /** Conta a chegada nas arestas dela; no fluxo, a espessura de todas segue as contagens (demo, `thickness`). */
  private countSegments(shape: Shape, step: Step): void {
    for (const id of shape.route) {
      this.segments.set(id, (this.segments.get(id) ?? 0) + 1);
    }
    if (step === 'flow') {
      const widths: Record<string, number> = {};
      for (const [id, count] of this.segments) {
        widths[id] = flowWidth(count);
      }
      this.widths.set(widths);
    }
  }

  /** Os tempos e as curvas dos tokens, lidos uma vez: sob rajada, ler o estilo a cada chegada custaria quadros. */
  private motion(): Motion {
    this.tokensRead ??= readMotion(this.host);
    return this.tokensRead;
  }

  private pulses(): PulseLayer | null {
    const host = this.fx()?.nativeElement;
    if (!host) {
      return null;
    }
    if (this.layer?.host !== host) {
      this.layer?.pulses.clear();
      this.layer = { host, pulses: new PulseLayer(host, () => this.motion()) };
    }
    return this.layer.pulses;
  }

  /** O pulso curto (90 ms por aresta, sem rastro): as chegadas de um quadro com o mesmo caminho dividem um. */
  private queueShort(hops: string[]): void {
    this.shortQueue.set(hops.join('|'), hops);
    if (this.frame !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const motion = this.motion();
      for (const hops of this.shortQueue.values()) {
        this.pulses()?.launch({ hops, hopMs: motion.hopShort, trail: false, discharge: false });
      }
      this.shortQueue.clear();
    });
  }

  /**
   * A chegada que a tela vai abrir aparece no circuito enquanto o pulso passa (demo, R1): cada aresta acende quando
   * o ponto a termina, e o que a mensagem mostra num nó (o IP, ✓ válida, a resposta) aparece em 231 ms quando ele
   * chega ao nó. Quando a linha nasce, o caminho fica em tinta cheia e assenta em 1,5 s.
   */
  private startReveal(request: WebhookRequest, born: number, motion: Motion): void {
    this.stopReveal();
    this.reveal.set({ request, before: untracked(this.requests.selected)?.uuid ?? null });
    clearTimeout(this.revealTimer);
    this.revealTimer = setTimeout(() => this.reveal.set(null), born + REVEAL_GRACE_MS);
    afterNextRender(() => this.animateReveal(request, born, motion), { injector: this.injector });
  }

  private animateReveal(request: WebhookRequest, born: number, motion: Motion): void {
    const stage = this.stage()?.nativeElement;
    const view = untracked(this.view);
    if (!stage || !view || typeof stage.animate !== 'function') {
      return;
    }
    const at = (hops: number) => hops * motion.hop;
    const animations: Animation[] = [];
    stage.querySelectorAll<SVGPathElement>('.route path').forEach((path) => {
      const lit = view.lit[path.dataset['edge'] ?? ''];
      if (lit) {
        animations.push(path.animate([{ opacity: 0 }, { opacity: 0 }], { duration: at(lit) }));
      }
    });
    const off = getComputedStyle(stage.querySelector('.edge') ?? stage).stroke;
    for (const mark of view.marks) {
      const circle = stage.querySelector<SVGElement>(`[data-mark="${mark.id}"]`);
      if (mark.on && mark.reveal && circle) {
        animations.push(
          circle.animate([{ stroke: off }, { stroke: off }], { duration: at(mark.reveal) }),
        );
      }
    }
    for (const label of view.labels) {
      const element = stage.querySelector<HTMLElement>(`[data-key="${label.key}"]`);
      if (label.reveal !== undefined && element) {
        animations.push(
          element.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: motion.effects.duration,
            delay: at(label.reveal),
            easing: motion.effects.easing,
            fill: 'backwards',
          }),
        );
      }
    }
    // Os números ①②③ dos nós chegam com o detalhe, quando a linha nasce.
    stage.querySelectorAll<HTMLElement>('.badge').forEach((badge) => {
      animations.push(badge.animate([{ opacity: 0 }, { opacity: 0 }], { duration: born }));
    });
    this.revealing = animations;
    const route = stage.querySelector<SVGElement>('.route');
    if (route) {
      const total = born + motion.settle;
      this.settling = {
        id: request.uuid,
        animation: route.animate(
          [
            { opacity: 1 },
            { opacity: 1, offset: born / total, easing: motion.effects.easing },
            { opacity: 0.7 },
          ],
          { duration: total },
        ),
      };
    }
  }

  /** A segunda da rajada chegou: a chegada aberta aparece inteira já, e o caminho dela fica assentado. */
  private finishReveal(): void {
    for (const animation of this.revealing) {
      animation.finish();
    }
    this.revealing = [];
    this.settling?.animation.cancel();
    this.settling = null;
  }

  private stopReveal(): void {
    this.finishReveal();
    clearTimeout(this.revealTimer);
    if (untracked(this.reveal)) {
      this.reveal.set(null);
    }
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
    // "+N regras": as regras de lá se filtram no painel Filtros (o controle equivalente, D-F1-15).
    if (node.opens === 'filters') {
      this.chips.askPanel();
      return;
    }
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
