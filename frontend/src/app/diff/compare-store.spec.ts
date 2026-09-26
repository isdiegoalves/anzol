import { TestBed } from '@angular/core/testing';
import { webhookRequest } from '../../testing/fixtures';
import { CompareStore } from './compare-store';

describe('Dado o "Compare with…"', () => {
  const [A, B] = [webhookRequest(1), webhookRequest(2)];
  let compare: CompareStore;

  beforeEach(() => {
    compare = TestBed.inject(CompareStore);
  });

  it('deve esperar a escolha da B Quando a comparação começa pela mensagem aberta', () => {
    compare.start(A);

    expect(compare.picking()).toEqual(A);
    expect(compare.pair()).toBeNull();
  });

  it('deve abrir o par Quando a B é escolhida, e trocar A e B', () => {
    compare.start(A);
    compare.choose(B);

    expect(compare.picking()).toBeNull();
    expect(compare.pair()).toEqual({ a: A, b: B });
    compare.swap();
    expect(compare.pair()).toEqual({ a: B, b: A });
  });

  it('deve continuar esperando Quando a escolhida é a própria A', () => {
    compare.start(A);
    compare.choose(A);

    expect(compare.picking()).toEqual(A);
  });

  it('deve fechar tudo Quando close é chamado', () => {
    compare.start(A);
    compare.choose(B);
    compare.close();

    expect(compare.picking()).toBeNull();
    expect(compare.pair()).toBeNull();
  });
});
