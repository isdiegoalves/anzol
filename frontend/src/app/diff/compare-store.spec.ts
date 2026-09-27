import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from './compare-store';

describe('Dado o "Compare with…" e a página do Compare', () => {
  const [A, B, C] = [webhookRequest(1), webhookRequest(2), webhookRequest(3)];
  let compare: CompareStore;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate } }] });
    compare = TestBed.inject(CompareStore);
  });

  it('deve esperar a escolha da B Quando a comparação começa pela mensagem aberta', () => {
    compare.start(A);

    expect(compare.picking()).toEqual(A);
    expect(compare.pair()).toBeNull();
  });

  it('deve abrir a rota do Compare (link compartilhável) Quando a B é escolhida', () => {
    compare.start(A);
    compare.choose(B);

    expect(compare.picking()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'compare', A.uuid, B.uuid]);
  });

  it('deve continuar esperando Quando a escolhida é a própria A', () => {
    compare.start(A);
    compare.choose(A);

    expect(compare.picking()).toEqual(A);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('deve sair do modo de escolha, sem navegar, Quando fecha na Inbox', () => {
    compare.start(A);
    compare.close();

    expect(compare.picking()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('Dado o par mostrado na página', () => {
    beforeEach(() => compare.show(A, B));

    it('deve trocar A e B pela rota', () => {
      compare.swap();

      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'compare', B.uuid, A.uuid]);
    });

    it('deve trocar a B pela escolhida na lista e ignorar A e B', () => {
      compare.compareWith(A);
      compare.compareWith(B);
      compare.compareWith(C);

      expect(navigate.mock.calls).toEqual([[['/', TOKEN_ID, 'compare', A.uuid, C.uuid]]]);
    });

    it('deve voltar à mensagem de onde o "Compare with…" saiu Quando fecha depois do Swap', () => {
      compare.forget();
      compare.start(A);
      compare.choose(B);
      compare.show(B, A);

      compare.close();

      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, A.uuid, 1]);
    });

    it('deve voltar à Inbox com a A aberta Quando fecha (link direto)', () => {
      compare.close();

      expect(compare.pair()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, A.uuid, 1]);
    });
  });
});
