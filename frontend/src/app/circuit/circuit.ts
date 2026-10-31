import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { RequestStore } from '../requests/request-store';
import { CapturedRequest } from '../requests/webhook-request';
import { Rule } from '../rules/rule';
import { RuleStore } from '../rules/rule-store';
import { KnownUrls } from '../token/known-urls';
import { TokenStore } from '../token/token-store';
import { CircuitNode, circuitOf } from './circuit-model';

/**
 * O circuito da URL na Entrada, abaixo do cabeçalho (C-1, demo combinada): o desenho de 1248 × 120 com os nós da
 * configuração e, com uma mensagem aberta, o caminho dela e a regra que quase casou. Os nós são botões numa barra
 * (uma parada do Tab; as setas andam entre eles); clicar filtra a lista pelo que passou ali e clicar de novo tira,
 * sem motion. No celular (`line`), só a frase "caminho: …" da mensagem aberta, numa linha que rola.
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
  private readonly known = inject(KnownUrls);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Celular: a linha de glifos com o caminho da mensagem aberta, no lugar do desenho. */
  readonly line = input(false);

  /** As regras da URL; `loaded` também quando a leitura falhou (aí sem escada nem "sem regras"). */
  private readonly rules = signal<{ tokenId: string; rules: readonly Rule[] | null } | null>(null);
  private reads = 0;

  /**
   * As mensagens que contam nos nós: as carregadas sem filtro. Com a lista filtrada (pelo próprio circuito, por
   * exemplo), as contagens ficam as de antes do filtro, e não as do resultado dele.
   */
  private readonly counted = linkedSignal<
    { tokenId: string | null; filtering: boolean; list: readonly CapturedRequest[] },
    readonly CapturedRequest[]
  >({
    source: () => ({
      tokenId: this.requests.tokenId(),
      filtering: this.requests.filtering(),
      list: this.requests.requests(),
    }),
    computation: (source, previous) => {
      if (!source.filtering) {
        return source.list;
      }
      return previous && previous.source.tokenId === source.tokenId ? previous.value : [];
    },
  });

  protected readonly token = computed(() => {
    const token = this.tokens.shown();
    const read = this.rules();
    return token && read?.tokenId === token.uuid ? token : null;
  });

  protected readonly view = computed(() => {
    const token = this.token();
    if (!token) {
      return null;
    }
    return circuitOf({
      token,
      name: this.known.nameOf(token.uuid),
      rules: this.rules()?.rules ?? null,
      requests: this.counted(),
      selected: this.requests.selected() ?? null,
      filter: this.requests.filter(),
    });
  });

  /** As arestas do caminho da mensagem aberta, desenhadas por cima em tinta. */
  protected readonly routeEdges = computed(() => {
    const view = this.view();
    return view ? view.edges.filter((edge) => view.route.includes(edge.id)) : [];
  });

  /** O nó que o Tab alcança (os outros ficam com `tabindex="-1"`, e as setas andam entre eles). */
  protected readonly stop = signal(0);
  protected readonly tabStop = computed(() =>
    Math.min(this.stop(), Math.max(0, (this.view()?.nodes.length ?? 1) - 1)),
  );

  constructor() {
    // As regras de cada URL, lidas quando ela abre; voltar à mesma URL não lê de novo.
    effect(() => {
      const tokenId = this.tokens.shown()?.uuid;
      if (tokenId && untracked(this.rules)?.tokenId !== tokenId) {
        untracked(() => void this.readRules(tokenId));
      }
    });
  }

  private async readRules(tokenId: string): Promise<void> {
    const read = ++this.reads;
    let rules: readonly Rule[] | null;
    try {
      rules = await this.ruleStore.listRules(tokenId);
    } catch {
      rules = null;
    }
    if (read === this.reads) {
      this.rules.set({ tokenId, rules });
    }
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
    this.stop.set(next);
    nodes[next].focus();
  }
}
