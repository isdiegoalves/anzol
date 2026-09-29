import {
  CdkVirtualScrollViewport,
  VIRTUAL_SCROLL_STRATEGY,
  VirtualScrollStrategy,
} from '@angular/cdk/scrolling';
import { Directive, effect, forwardRef, input } from '@angular/core';
import { Subject, distinctUntilChanged } from 'rxjs';

const BUFFER_PX = 600;

/**
 * A `FixedSizeVirtualScrollStrategy` do CDK com uma altura por linha: a lista agrupada mistura
 * linhas de alturas diferentes.
 */
export class RowSizeStrategy implements VirtualScrollStrategy {
  private readonly index = new Subject<number>();
  readonly scrolledIndexChange = this.index.pipe(distinctUntilChanged());
  private viewport: CdkVirtualScrollViewport | null = null;
  /** A última posição é a altura total. */
  private offsets: number[] = [0];

  setSizes(sizes: readonly number[]): void {
    const offsets = [0];
    for (const size of sizes) {
      offsets.push(offsets[offsets.length - 1] + size);
    }
    this.offsets = offsets;
    this.update();
  }

  offsetOf(index: number): number {
    return this.offsets[Math.max(0, Math.min(index, this.offsets.length - 1))];
  }

  attach(viewport: CdkVirtualScrollViewport): void {
    this.viewport = viewport;
    this.update();
  }

  detach(): void {
    this.index.complete();
    this.viewport = null;
  }

  onContentScrolled(): void {
    this.render();
  }

  onDataLengthChanged(): void {
    this.update();
  }

  onContentRendered(): void {
    // Nada: as alturas vêm prontas, não se medem.
  }

  onRenderedOffsetChanged(): void {
    // Idem.
  }

  scrollToIndex(index: number, behavior: ScrollBehavior): void {
    this.viewport?.scrollToOffset(this.offsetOf(index), behavior);
  }

  private update(): void {
    this.viewport?.setTotalContentSize(this.offsets[this.offsets.length - 1]);
    this.render();
  }

  private render(): void {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    const length = Math.min(viewport.getDataLength(), this.offsets.length - 1);
    const top = viewport.measureScrollOffset();
    const start = this.rowAt(top - BUFFER_PX);
    const end = Math.min(length, this.rowAt(top + viewport.getViewportSize() + BUFFER_PX) + 1);
    viewport.setRenderedRange({ start: Math.min(start, end), end });
    viewport.setRenderedContentOffset(this.offsetOf(start));
    this.index.next(this.rowAt(top));
  }

  private rowAt(offset: number): number {
    let [low, high] = [0, Math.max(0, this.offsets.length - 2)];
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.offsets[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }
}

@Directive({
  selector: 'cdk-virtual-scroll-viewport[appRowSizes]',
  providers: [
    {
      provide: VIRTUAL_SCROLL_STRATEGY,
      useFactory: (sizes: RowSizes) => sizes.strategy,
      deps: [forwardRef(() => RowSizes)],
    },
  ],
})
export class RowSizes {
  readonly appRowSizes = input.required<readonly number[]>();
  readonly strategy = new RowSizeStrategy();

  constructor() {
    effect(() => this.strategy.setSizes(this.appRowSizes()));
  }
}
