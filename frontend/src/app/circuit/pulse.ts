/**
 * O pulso do circuito (proposta 1 §4 M1 e §7, demo combinada): um ponto de 6 px em primária, com rastro de 24 px na
 * chegada isolada, que percorre as arestas do caminho por `offset-path`, um salto por trecho, com WAAPI (cancelável,
 * só `offset-distance`, `transform` e `opacity`). O caminho de cada salto vem do modelo (`CircuitView.hops`).
 */

/** Os tempos e as curvas do motion, lidos dos tokens do `styles.scss` (o tema é a fonte; aqui só se lê). */
export interface Motion {
  /** `--app-pulse-hop`: um salto da chegada isolada. */
  hop: number;
  /** `--app-pulse-hop-short`: um salto do pulso curto. */
  hopShort: number;
  /** `--app-pulse-trail`: o caminho percorrido assenta de 100 % a 70 %. */
  settle: number;
  /** `--app-spring-standard`: a curva de cada salto. */
  standard: string;
  /** `--app-spring-effects`: o aparecer do glifo e o esvaziar do ponto. */
  effects: { duration: number; easing: string };
}

/** Sem os tokens (o jsdom não calcula estilo), os valores da proposta 1 §6. */
const FALLBACK: Motion = {
  hop: 180,
  hopShort: 90,
  settle: 1500,
  standard: 'linear',
  effects: { duration: 231, easing: 'linear' },
};

function milliseconds(value: string, fallback: number): number {
  const match = /^\s*([\d.]+)(ms|s)\b/.exec(value);
  if (!match) {
    return fallback;
  }
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

/** Lê os tokens de motion no elemento (os custom properties do `html`). */
export function readMotion(element: Element): Motion {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const effects = read('--app-spring-effects');
  const curve = /\blinear\(.*\)/s.exec(effects)?.[0];
  return {
    hop: milliseconds(read('--app-pulse-hop'), FALLBACK.hop),
    hopShort: milliseconds(read('--app-pulse-hop-short'), FALLBACK.hopShort),
    settle: milliseconds(read('--app-pulse-trail'), FALLBACK.settle),
    standard: read('--app-spring-standard') || FALLBACK.standard,
    effects: {
      duration: milliseconds(effects, FALLBACK.effects.duration),
      easing: curve ?? FALLBACK.effects.easing,
    },
  };
}

type Point = readonly [number, number];

/**
 * O comprimento de um caminho com os comandos que o circuito usa (M, H, V, L e Q, absolutos). A curva dos cantos da
 * escada é medida em 16 pedaços: o erro fica abaixo de um décimo de pixel.
 */
export function pathLength(d: string): number {
  const tokens = d.match(/[MHVLQ]|-?[\d.]+/g) ?? [];
  let at: Point = [0, 0];
  let length = 0;
  let command = '';
  let i = 0;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MHVLQ]/.test(tokens[i])) {
      command = tokens[i++];
    }
    if (command === 'M') {
      at = [number(), number()];
    } else if (command === 'H') {
      const x = number();
      length += Math.abs(x - at[0]);
      at = [x, at[1]];
    } else if (command === 'V') {
      const y = number();
      length += Math.abs(y - at[1]);
      at = [at[0], y];
    } else if (command === 'L') {
      const to: Point = [number(), number()];
      length += Math.hypot(to[0] - at[0], to[1] - at[1]);
      at = to;
    } else if (command === 'Q') {
      const control: Point = [number(), number()];
      const to: Point = [number(), number()];
      let previous = at;
      for (let step = 1; step <= 16; step++) {
        const t = step / 16;
        const point: Point = [
          (1 - t) ** 2 * at[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0],
          (1 - t) ** 2 * at[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1],
        ];
        length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        previous = point;
      }
      at = to;
    } else {
      i++;
    }
  }
  return length;
}

/** Junta trechos contíguos num caminho só: o `M` de cada trecho depois do primeiro sai. */
export function joinPath(parts: readonly string[]): string {
  return parts
    .map((part, i) => (i === 0 ? part : part.replace(/^M\s*-?[\d.]+[ ,]-?[\d.]+\s*/, ' ')))
    .join('');
}

/** Um trecho reto (`M x,y V y2` ou `M x,y H x2`) percorrido ao contrário. */
export function reverseLine(d: string): string {
  const vertical = /^M(-?[\d.]+),(-?[\d.]+) V(-?[\d.]+)$/.exec(d);
  if (vertical) {
    return `M${vertical[1]},${vertical[3]} V${vertical[2]}`;
  }
  const horizontal = /^M(-?[\d.]+),(-?[\d.]+) H(-?[\d.]+)$/.exec(d);
  return horizontal ? `M${horizontal[3]},${horizontal[2]} H${horizontal[1]}` : d;
}

/**
 * Os quadros do ponto: um por fim de salto, todos com o mesmo tempo (o salto longo anda mais depressa), cada um com
 * a curva da mola, como na demo.
 */
export function hopKeyframes(hops: readonly string[], easing: string): Keyframe[] {
  const ends = [0];
  for (const hop of hops) {
    ends.push(ends[ends.length - 1] + pathLength(hop));
  }
  return ends.map((distance, i) => ({
    offset: i / hops.length,
    offsetDistance: `${Math.round(distance * 100) / 100}px`,
    easing,
  }));
}

export interface PulseOptions {
  /** O caminho de cada salto, na ordem da viagem. */
  hops: readonly string[];
  hopMs: number;
  /** O rastro de 24 px: só a chegada isolada. */
  trail: boolean;
  /** Na chegada isolada, o ponto se desfaz no nó Resposta (o tempo de um salto) antes de a linha nascer. */
  discharge: boolean;
}

/** Um pulso no circuito: as animações dele, que o rebaixamento acelera e o fim cancela. */
export class Pulse {
  readonly animations: Animation[] = [];
  private trailElement: HTMLElement | null = null;
  private trailAnimation: Animation | null = null;
  private down = false;
  private ended = false;

  constructor(
    private readonly dot: HTMLElement,
    trail: HTMLElement | null,
    private readonly onEnd: (pulse: Pulse) => void,
  ) {
    this.trailElement = trail;
  }

  /** A animação do rastro, para o rebaixamento tirá-la. */
  setTrail(animation: Animation): void {
    this.trailAnimation = animation;
  }

  /** Chegou a segunda da rajada: o pulso inteiro termina na metade do tempo, sem rastro (demo, `downgrade`). */
  downgrade(): void {
    if (this.down || this.ended) {
      return;
    }
    this.down = true;
    this.trailAnimation?.cancel();
    this.trailElement?.remove();
    this.trailElement = null;
    for (const animation of this.animations) {
      animation.updatePlaybackRate(2);
    }
  }

  get downgraded(): boolean {
    return this.down;
  }

  /** Tira o pulso do desenho (troca de URL, aba oculta, movimento reduzido). */
  cancel(): void {
    for (const animation of this.animations) {
      animation.cancel();
    }
    this.trailAnimation?.cancel();
    this.finish();
  }

  /** O fim: os elementos saem e quem desenha esquece o pulso. */
  finish(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.dot.remove();
    this.trailElement?.remove();
    this.onEnd(this);
  }
}

/**
 * A camada dos pulsos, por cima do desenho (o `.fx` do circuito, com o mesmo sistema de coordenadas do SVG). Cada
 * pulso cria o ponto (e o rastro), anima e some sozinho no fim.
 */
export class PulseLayer {
  private readonly live = new Set<Pulse>();

  constructor(
    private readonly host: HTMLElement,
    private readonly motion: () => Motion,
  ) {}

  get size(): number {
    return this.live.size;
  }

  /** Os pulsos inteiros que ainda correm (a segunda da rajada os rebaixa). */
  get running(): Pulse[] {
    return [...this.live];
  }

  launch(options: PulseOptions): Pulse | null {
    if (typeof this.host.animate !== 'function' || options.hops.length === 0) {
      return null;
    }
    const motion = this.motion();
    const d = joinPath(options.hops);
    const keyframes = hopKeyframes(options.hops, motion.standard);
    const duration = options.hops.length * options.hopMs;
    const make = (kind: string) => {
      const element = this.host.ownerDocument.createElement('span');
      element.className = kind;
      // O estilo do componente vale para o que o template criou: o ponto leva a marca de escopo da camada.
      for (const { name } of [...this.host.attributes]) {
        if (name.startsWith('_ngcontent')) {
          element.setAttribute(name, '');
        }
      }
      element.style.setProperty('offset-path', `path("${d}")`);
      this.host.append(element);
      return element;
    };
    const dot = make('dot');
    const trail = options.trail ? make('trail') : null;
    const pulse = new Pulse(dot, trail, (ended) => this.live.delete(ended));
    this.live.add(pulse);
    const travel = dot.animate(keyframes, { duration, fill: 'forwards' });
    pulse.animations.push(travel);
    if (trail) {
      pulse.setTrail(
        trail.animate(
          keyframes.map((frame, i) => ({ ...frame, opacity: i === 0 ? 0 : 0.4 })),
          { duration, fill: 'forwards' },
        ),
      );
    }
    let last = travel;
    if (options.discharge) {
      // O ponto chega ao nó Resposta e se desfaz (cresce e some) no tempo de um salto, como na demo.
      last = dot.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(2.2)' },
        ],
        {
          duration: options.hopMs,
          delay: duration,
          easing: motion.effects.easing,
          fill: 'both',
        },
      );
      pulse.animations.push(last);
    }
    last.addEventListener('finish', () => pulse.finish());
    last.addEventListener('cancel', () => pulse.finish());
    return pulse;
  }

  /** Tira todos os pulsos (troca de URL, aba oculta, movimento reduzido). */
  clear(): void {
    for (const pulse of [...this.live]) {
      pulse.cancel();
    }
  }
}
