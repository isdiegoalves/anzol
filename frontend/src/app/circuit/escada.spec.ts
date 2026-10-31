import { Escada, Step } from './escada';

/** A rajada canônica das demos (proposta 1, demo-spec §4 R2): #i em i × 75 ms, 13 por segundo. */
const R2 = Array.from({ length: 40 }, (_, i) => (i + 1) * 75);

describe('Dado a escada de rajada do circuito (CA-2)', () => {
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
