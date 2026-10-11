import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { RowSizeStrategy } from './row-sizes';

describe('Dado a rolagem virtual com uma altura por linha', () => {
  /** Dez linhas de 40 px numa janela de `size` px rolada até `top`. */
  const shownAt = (top: number, size: number) => {
    const strategy = new RowSizeStrategy();
    strategy.setSizes(Array.from({ length: 10 }, () => 40));
    strategy.attach({
      getDataLength: () => 10,
      measureScrollOffset: () => top,
      getViewportSize: () => size,
      setTotalContentSize: () => undefined,
      setRenderedRange: () => undefined,
      setRenderedContentOffset: () => undefined,
    } as unknown as CdkVirtualScrollViewport);
    return strategy.shown();
  };

  it('deve dizer as linhas que aparecem inteiras, sem a cortada em cada borda', () => {
    expect(shownAt(0, 200)).toEqual({ first: 0, last: 4 });
    expect(shownAt(100, 200)).toEqual({ first: 3, last: 6 });
    expect(shownAt(200, 200)).toEqual({ first: 5, last: 9 });
  });

  it('não deve dizer nenhuma Quando a janela ainda não tem altura', () => {
    expect(shownAt(0, 0)).toBeNull();
  });
});
