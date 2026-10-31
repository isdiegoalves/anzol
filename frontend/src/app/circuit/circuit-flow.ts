import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { WebhookRequest } from '../requests/webhook-request';
import { Escada, Step } from './escada';

/** Quem desenha as chegadas: o circuito da Entrada, enquanto está na tela (no celular ele não desenha). */
export interface FlowStage {
  /**
   * Desenha a chegada no degrau dado. Devolve em quantos ms a linha dela nasce (o pulso inteiro chegou à Resposta e
   * se desfez; com movimento reduzido, o instante em que ele terminaria) e como apressar o pulso; `null` quando a
   * linha entra já (rajada, ou nada a desenhar).
   */
  draw(request: WebhookRequest, step: Step, opens: boolean): { born: number; hurry(): void } | null;
  /** Tira os pulsos do desenho (a aba saiu da vista). */
  clear(): void;
}

interface Birth {
  resolve: () => void;
  hurry: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/** De quanto em quanto tempo o medidor "N/s" do modo fluxo se refaz (demo: 250 ms). */
export const METER_EVERY_MS = 250;

/**
 * As chegadas pelo tempo real no circuito (F2): a escada de rajada decide o degrau de cada uma; a chegada isolada
 * espera o pulso chegar ao nó Resposta para a linha nascer na lista (e o anúncio, no mesmo instante); a segunda de
 * uma rajada solta na hora a que esperava. Aba oculta: nada se enfileira, e a linha entra já.
 */
@Injectable({ providedIn: 'root' })
export class CircuitFlow {
  private readonly document = inject(DOCUMENT);
  private stage: FlowStage | null = null;
  private escada = new Escada();
  private tokenId: string | null = null;
  private readonly births = new Set<Birth>();
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private meterTimer: ReturnType<typeof setInterval> | undefined;

  /** O degrau de agora: o fluxo engrossa as arestas e mostra o medidor. */
  readonly step = signal<Step>('full');
  /** Quantas chegaram no último segundo, refeito a cada 250 ms no modo fluxo. */
  readonly rate = signal(0);
  /** Vira a cada chegada que entrou na lista: os contadores rolam só por ela (C-6), não por filtro nem por seleção. */
  readonly landed = signal(0);

  constructor() {
    const hidden = () => {
      if (this.document.hidden) {
        this.release();
        this.stage?.clear();
      }
    };
    this.document.addEventListener('visibilitychange', hidden);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', hidden);
      clearTimeout(this.settleTimer);
      clearInterval(this.meterTimer);
    });
  }

  /** O circuito entra na tela; devolve como sair dela. */
  attach(stage: FlowStage): () => void {
    this.stage = stage;
    return () => {
      if (this.stage === stage) {
        this.stage = null;
        this.release();
      }
    };
  }

  /**
   * Uma chegada pelo tempo real, na hora em que a sessão a recebeu (`at`, de `performance.now()`). `opens`: a tela vai
   * abri-la (a primeira de uma Entrada vazia, ou "Follow new"), e o circuito a mostra enquanto o pulso passa.
   * Devolve quando a linha dela nasce, ou `null` se ela entra já.
   */
  arrive(
    request: WebhookRequest,
    { at = performance.now(), opens = false }: { at?: number; opens?: boolean } = {},
  ): Promise<void> | null {
    if (request.token_id !== this.tokenId) {
      this.tokenId = request.token_id;
      this.escada = new Escada();
    }
    const step = this.escada.arrive(at);
    this.follow(at);
    if (step !== 'full') {
      // A segunda da rajada: a primeira, que esperava o pulso, entra já, e o pulso dela termina rebaixado.
      this.release();
    }
    if (!this.stage || this.document.hidden) {
      return null;
    }
    const drawn = this.stage.draw(request, step, opens);
    if (!drawn || drawn.born <= 0) {
      return null;
    }
    return new Promise<void>((resolve) => {
      const birth: Birth = {
        resolve,
        hurry: drawn.hurry,
        timer: setTimeout(() => {
          this.births.delete(birth);
          resolve();
        }, drawn.born),
      };
      this.births.add(birth);
    });
  }

  /** A chegada entrou na lista: os contadores podem rolar. */
  land(): void {
    this.landed.update((count) => count + 1);
  }

  /** As linhas que esperavam o pulso entram já, e os pulsos delas terminam rebaixados. */
  release(): void {
    for (const birth of this.births) {
      clearTimeout(birth.timer);
      birth.hurry();
      birth.resolve();
    }
    this.births.clear();
  }

  /** O degrau e o medidor acompanham a escada: sobem na chegada e descem sozinhos depois da histerese. */
  private follow(at: number): void {
    const step = this.escada.stepAt(at);
    this.step.set(step);
    if (step === 'flow') {
      this.rate.set(this.escada.rate(at));
      this.meterTimer ??= setInterval(
        () => this.rate.set(this.escada.rate(performance.now())),
        METER_EVERY_MS,
      );
    } else {
      clearInterval(this.meterTimer);
      this.meterTimer = undefined;
    }
    clearTimeout(this.settleTimer);
    const settles = this.escada.settlesAt(at);
    if (settles !== null) {
      this.settleTimer = setTimeout(
        () => this.follow(performance.now()),
        Math.max(0, settles - at),
      );
    }
  }
}
