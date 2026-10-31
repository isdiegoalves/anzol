import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { CircuitFlow, FlowStage, METER_EVERY_MS } from './circuit-flow';
import { Step } from './escada';

describe('Dado as chegadas pelo tempo real no circuito', () => {
  let flow: CircuitFlow;
  let drawn: { step: Step; opens: boolean }[];
  let hurried: number;
  let cleared: number;
  const stage: FlowStage = {
    draw: (_request, step, opens) => {
      drawn.push({ step, opens });
      return step === 'full' ? { born: 720, hurry: () => hurried++ } : null;
    },
    clear: () => cleared++,
  };
  const chegada = (n: number) => webhookRequest(n, { token_id: TOKEN_ID });

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    flow = TestBed.inject(CircuitFlow);
    [drawn, hurried, cleared] = [[], 0, 0];
  });

  afterEach(() => vi.useRealTimers());

  it('deve deixar a linha entrar já Quando não há circuito na tela (celular, outra tela)', () => {
    expect(flow.arrive(chegada(1), { at: 0 })).toBeNull();
  });

  it('deve esperar o pulso chegar ao nó Resposta para a linha nascer, na chegada isolada (CA-1)', async () => {
    flow.attach(stage);
    let nasceu = false;

    void flow.arrive(chegada(1), { at: 0, opens: true })?.then(() => (nasceu = true));
    await vi.advanceTimersByTimeAsync(719);
    expect(nasceu).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(nasceu).toBe(true);
    expect(drawn).toEqual([{ step: 'full', opens: true }]);
  });

  it('deve deixar a linha entrar já Quando o desenho da chegada falha', () => {
    const erros = TestBed.inject(ErrorHandler);
    const relatado = vi.spyOn(erros, 'handleError').mockImplementation(() => undefined);
    const falha = new TypeError("Failed to execute 'animate' on 'Element': Invalid easing");
    flow.attach({
      draw: () => {
        throw falha;
      },
      clear: () => undefined,
    });

    expect(flow.arrive(chegada(1), { at: 0, opens: true })).toBeNull();
    expect(relatado).toHaveBeenCalledWith(falha);
  });

  it('deve soltar na hora a primeira que esperava, e apressar o pulso dela, Quando a segunda da rajada chega (CA-2)', async () => {
    flow.attach(stage);
    let nasceu = false;
    void flow.arrive(chegada(1), { at: 0 })?.then(() => (nasceu = true));

    const segunda = flow.arrive(chegada(2), { at: 75 });
    await vi.advanceTimersByTimeAsync(0);

    expect(segunda).toBeNull();
    expect(nasceu).toBe(true);
    expect(hurried).toBe(1);
    expect(drawn.map((each) => each.step)).toEqual(['full', 'short']);
  });

  it('deve virar fluxo acima de 5 por segundo, medir as do último segundo a cada 250 ms e descer 2 s depois da janela', async () => {
    flow.attach(stage);
    for (let n = 1; n <= 6; n++) {
      flow.arrive(chegada(n), { at: performance.now() });
      await vi.advanceTimersByTimeAsync(75);
    }
    expect(flow.step()).toBe('flow');
    expect(flow.rate()).toBe(6);

    await vi.advanceTimersByTimeAsync(METER_EVERY_MS * 4);
    expect(flow.rate()).toBe(0);
    expect(flow.step()).toBe('flow');
    // A última acima do limiar chegou em 375 ms: a janela fecha em 1375, e a escada desce em 3375.
    await vi.advanceTimersByTimeAsync(3375 - 450 - METER_EVERY_MS * 4);
    expect(flow.step()).toBe('full');
  });

  it('deve parar os pulsos curtos de uma cadência de 3 por segundo depois de 5 s sem pausa, e voltar depois de 2 s parado (F2-R02)', async () => {
    flow.attach(stage);
    for (let n = 0; n < 25; n++) {
      flow.arrive(chegada(n), { at: performance.now() });
      await vi.advanceTimersByTimeAsync(333);
    }

    const passos = drawn.map((each) => each.step);
    expect(passos.slice(1, 15).every((step) => step === 'short')).toBe(true);
    expect(passos.slice(16).every((step) => step === 'flow')).toBe(true);
    expect(flow.step()).toBe('flow');
    await vi.advanceTimersByTimeAsync(2000);
    expect(flow.step()).not.toBe('flow');
  });

  it('não deve enfileirar pulso com a aba oculta, e deve soltar a que esperava quando a aba sai da vista', async () => {
    flow.attach(stage);
    let nasceu = false;
    void flow.arrive(chegada(1), { at: 0 })?.then(() => (nasceu = true));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(nasceu).toBe(true);
    expect(cleared).toBe(1);
    expect(flow.arrive(chegada(2), { at: 5000 })).toBeNull();
    expect(drawn).toHaveLength(1);
    hidden.mockRestore();
  });

  it('deve contar a escada de novo em outra URL', () => {
    flow.attach(stage);
    flow.arrive(chegada(1), { at: 0 });
    flow.arrive(webhookRequest(2, { token_id: 'outra' }), { at: 75 });

    expect(drawn.map((each) => each.step)).toEqual(['full', 'full']);
  });

  it('deve soltar a que esperava Quando o circuito sai da tela', async () => {
    const detach = flow.attach(stage);
    let nasceu = false;
    void flow.arrive(chegada(1), { at: 0 })?.then(() => (nasceu = true));

    detach();
    await vi.advanceTimersByTimeAsync(0);

    expect(nasceu).toBe(true);
    expect(flow.arrive(chegada(2), { at: 5000 })).toBeNull();
  });
});
