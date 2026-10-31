/**
 * O degrau da escada de rajada (proposta 1 §4 M2, demo combinada): `full`, o pulso inteiro da chegada isolada (180 ms
 * por aresta, com rastro); `short`, o pulso curto de 1 a 5 chegadas por segundo (90 ms, sem rastro); `flow`, acima de
 * 5 por segundo, sem pulso: as arestas engrossam e os contadores rolam.
 */
export type Step = 'full' | 'short' | 'flow';

/** A janela que a escada mede. */
export const WINDOW_MS = 1000;
/** Acima disto na janela, o circuito vira fluxo. */
export const FLOW_ABOVE = 5;
/** Quanto a escada espera, depois de a janela voltar abaixo do limiar, para descer um degrau. */
export const HYSTERESIS_MS = 2000;

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

  /** Conta a chegada de `at` e diz o degrau dela. */
  arrive(at: number): Step {
    this.times.push(at);
    const count = this.rate(at);
    if (count > FLOW_ABOVE) {
      this.lastHigh = at;
      return 'flow';
    }
    if (count >= 2 && at - this.lastHigh >= WINDOW_MS + HYSTERESIS_MS) {
      this.lastMid = at;
    }
    return this.stepAt(at);
  }

  /** O degrau em `at` sem chegada nova: o de quem chegar agora sozinho. */
  stepAt(at: number): Step {
    if (at - this.lastHigh < WINDOW_MS + HYSTERESIS_MS) {
      return 'flow';
    }
    return at - this.lastMid < WINDOW_MS + HYSTERESIS_MS ? 'short' : 'full';
  }

  /** Quando o degrau de agora desce, se nada mais chegar; `null` quando ele já é o de baixo. */
  settlesAt(at: number): number | null {
    const step = this.stepAt(at);
    if (step === 'full') {
      return null;
    }
    return (step === 'flow' ? this.lastHigh : this.lastMid) + WINDOW_MS + HYSTERESIS_MS;
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
