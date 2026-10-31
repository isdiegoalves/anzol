import { Escada, Step } from './escada';

/** A rajada de referência da especificação: #i em i × 75 ms, 13 por segundo. */
const R2 = Array.from({ length: 40 }, (_, i) => (i + 1) * 75);

describe('Dado a escada de rajada do circuito', () => {
  it('deve dar pulso inteiro à chegada isolada', () => {
    const escada = new Escada();

    expect(escada.arrive(1000)).toBe('full');
    expect(escada.arrive(5000)).toBe('full');
  });

  it('deve começar a rajada inteira, dar pulso curto até 5 na janela de 1 s e virar fluxo da 6.ª em diante', () => {
    const escada = new Escada();

    const steps = R2.map((at) => escada.arrive(at));

    expect(steps.slice(0, 5)).toEqual<Step[]>(['full', 'short', 'short', 'short', 'short']);
    expect(steps.slice(5).every((step) => step === 'flow')).toBe(true);
  });

  it('não deve reabrir o pulso na pausa de 1,075 s entre as duas partes da rajada (histerese)', () => {
    const escada = new Escada();
    R2.forEach((at) => escada.arrive(at));

    expect(escada.arrive(4000 + 1000 / 60)).toBe('flow');
  });

  it('deve descer só 2 s depois de a janela voltar abaixo do limiar', () => {
    const escada = new Escada();
    R2.forEach((at) => escada.arrive(at));

    // A última acima do limiar chegou em 3000; a janela dela fecha em 4000, e a escada desce em 6000.
    expect(escada.settlesAt(3001)).toBe(6000);
    expect(escada.stepAt(5999)).toBe('flow');
    expect(escada.stepAt(6000)).toBe('full');
    expect(escada.arrive(6001)).toBe('full');
  });

  it('deve manter o pulso curto 2 s depois da última dupla, e voltar ao inteiro depois', () => {
    const escada = new Escada();
    escada.arrive(0);
    expect(escada.arrive(400)).toBe('short');

    expect(escada.arrive(3000)).toBe('short');
    expect(escada.settlesAt(3000)).toBe(3400);
    expect(escada.arrive(4100)).toBe('full');
    expect(escada.settlesAt(4100)).toBeNull();
  });

  it('deve medir as chegadas do último segundo (o medidor "N/s")', () => {
    const escada = new Escada();
    R2.forEach((at) => escada.arrive(at));

    expect(escada.rate(3000)).toBe(14);
    expect(escada.rate(3999)).toBe(1);
    expect(escada.rate(4000)).toBe(0);
  });
});

describe('Dado chegadas sustentadas entre 1 e 5 por segundo', () => {
  /** 3 por segundo durante 8 s, sem pausa. */
  const TRES_POR_SEGUNDO = Array.from({ length: 25 }, (_, i) => Math.round(i * 333.3));

  it('deve parar o pulso curto depois de 5 s sem pausa de 2 s, como no fluxo, até a próxima pausa', () => {
    const escada = new Escada();

    const steps = TRES_POR_SEGUNDO.map((at) => escada.arrive(at));

    expect(steps[0]).toBe('full');
    const curtos = TRES_POR_SEGUNDO.filter((at, i) => steps[i] === 'short');
    expect(curtos.at(-1)).toBeLessThan(5000);
    expect(
      TRES_POR_SEGUNDO.filter((at) => at >= 5000).every(
        (at) => steps[TRES_POR_SEGUNDO.indexOf(at)] === 'flow',
      ),
    ).toBe(true);
    // A pausa de 2 s volta ao degrau de antes; depois, o pulso volta.
    const ultima = TRES_POR_SEGUNDO[TRES_POR_SEGUNDO.length - 1];
    expect(escada.stepAt(ultima + 1999)).toBe('flow');
    expect(escada.settlesAt(ultima)).toBe(ultima + 2000);
    expect(escada.stepAt(ultima + 2000)).toBe('short');
    expect(escada.arrive(ultima + 3100)).toBe('full');
  });

  it('não deve mudar a rajada da demo (R2): curto até a 5.ª, fluxo dali até o fim das duas partes', () => {
    const escada = new Escada();
    const parte1 = R2.map((at) => escada.arrive(at));
    const parte2 = Array.from({ length: 300 }, (_, j) =>
      escada.arrive(4000 + ((j + 1) * 1000) / 60),
    );

    expect(parte1.slice(0, 5)).toEqual<Step[]>(['full', 'short', 'short', 'short', 'short']);
    expect([...parte1.slice(5), ...parte2].every((step) => step === 'flow')).toBe(true);
  });
});

describe('Dado uma cadência regular de 1 por segundo', () => {
  it('deve ficar sempre no pulso inteiro, com o atraso da rede variando ±10 ms', () => {
    const escada = new Escada();
    // Um a cada segundo, com o atraso alternando entre −10 e +10 ms (a pior combinação: 980 ms entre duas).
    const chegadas = Array.from({ length: 20 }, (_, i) => i * 1000 + (i % 2 === 0 ? 10 : -10));

    expect(chegadas.map((at) => escada.arrive(at)).every((step) => step === 'full')).toBe(true);
  });

  it('deve dar pulso curto a duas chegadas a menos de 900 ms uma da outra', () => {
    const escada = new Escada();
    escada.arrive(0);

    expect(escada.arrive(899)).toBe('short');
  });
});
