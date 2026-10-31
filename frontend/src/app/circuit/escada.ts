/**
 * O degrau da escada de rajada: `full`, o pulso inteiro da chegada isolada (180 ms
 * por aresta, com rastro); `short`, o pulso curto de 1 a 5 chegadas por segundo (90 ms, sem rastro); `flow`, acima de
 * 5 por segundo, sem pulso: as arestas engrossam e os contadores rolam.
 */
export type Step = 'full' | 'short' | 'flow';

/** A janela que a escada mede. */
export const WINDOW_MS = 1000;
/** Acima disto na janela, o circuito vira fluxo. */
export const FLOW_ABOVE = 5;
/**
 * O pulso curto pede duas chegadas a menos disto uma da outra: a folga de 100 ms sob a janela de 1 s deixa uma cadência
 * regular de 1 por segundo sempre no pulso inteiro, sem oscilar com o atraso da rede.
 */
export const SHORT_WITHIN_MS = 900;
/** Quanto a escada espera, depois de a janela voltar abaixo do limiar, para descer um degrau. */
export const HYSTERESIS_MS = 2000;
/**
 * O pulso curto não corre mais que isto sem uma pausa de `HYSTERESIS_MS` entre duas chegadas: daí em diante, como no
 * fluxo (sem pulso, os contadores rolando), até a pausa. Nada se move mais de 5 s sem parar (WCAG 2.2.2).
 */
export const SHORT_LIMIT_MS = 5000;

/**
 * A escada com histerese: sobe na hora e só desce 2 s depois de a janela (1 s) voltar abaixo do limiar, então uma
 * pausa curta no meio da rajada não reabre o pulso. Ela não vê o futuro: a primeira de uma rajada começa inteira, e
 * quem a desenha a rebaixa quando a segunda chega. As horas são as de chegada na sessão (`performance.now()`).
 */
export class Escada {
  private readonly times: number[] = [];
  private head = 0;
  private lastHigh = Number.NEGATIVE_INFINITY;
  private lastMid = Number.NEGATIVE_INFINITY;
  /** A última chegada e a primeira da sequência sem pausa em que ela está. */
  private lastAt = Number.NEGATIVE_INFINITY;
  private streak = Number.NEGATIVE_INFINITY;

  /** Conta a chegada de `at` e diz o degrau dela. */
  arrive(at: number): Step {
    if (at - this.lastAt >= HYSTERESIS_MS) {
      this.streak = at;
    }
    this.lastAt = at;
    this.times.push(at);
    const count = this.rate(at);
    if (count > FLOW_ABOVE) {
      this.lastHigh = at;
      return 'flow';
    }
    if (this.within(at, SHORT_WITHIN_MS) >= 2 && at - this.lastHigh >= WINDOW_MS + HYSTERESIS_MS) {
      this.lastMid = at;
    }
    return this.stepAt(at);
  }

  /** O degrau em `at` sem chegada nova: o de quem chegar agora sozinho. */
  stepAt(at: number): Step {
    if (at - this.lastHigh < WINDOW_MS + HYSTERESIS_MS) {
      return 'flow';
    }
    if (at - this.lastMid < WINDOW_MS + HYSTERESIS_MS) {
      return this.sustained(at) ? 'flow' : 'short';
    }
    return 'full';
  }

  /** O pulso curto passou do teto: a sequência sem pausa já dura `SHORT_LIMIT_MS` e não parou ainda. */
  private sustained(at: number): boolean {
    return at - this.lastAt < HYSTERESIS_MS && this.lastAt - this.streak >= SHORT_LIMIT_MS;
  }

  /** Quando o degrau de agora desce, se nada mais chegar; `null` quando ele já é o de baixo. */
  settlesAt(at: number): number | null {
    const step = this.stepAt(at);
    if (step === 'full') {
      return null;
    }
    if (at - this.lastHigh < WINDOW_MS + HYSTERESIS_MS) {
      return this.lastHigh + WINDOW_MS + HYSTERESIS_MS;
    }
    return step === 'flow' ? this.lastAt + HYSTERESIS_MS : this.lastMid + WINDOW_MS + HYSTERESIS_MS;
  }

  /** Quantas das que estão na janela chegaram nos últimos `ms`. */
  private within(at: number, ms: number): number {
    let count = 0;
    for (let i = this.times.length - 1; i >= this.head && this.times[i] > at - ms; i--) {
      count++;
    }
    return count;
  }

  /** Quantas chegaram no último segundo (o medidor "N/s" do Remetente). */
  rate(at: number): number {
    while (this.head < this.times.length && this.times[this.head] <= at - WINDOW_MS) {
      this.head++;
    }
    // A fila não cresce sem teto sob rajada longa: o que saiu da janela vai embora de vez em quando.
    if (this.head > 1024) {
      this.times.splice(0, this.head);
      this.head = 0;
    }
    return this.times.length - this.head;
  }
}
