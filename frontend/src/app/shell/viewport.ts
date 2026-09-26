import { BreakpointObserver } from '@angular/cdk/layout';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** *Window size classes* do M3 (C §3.7). */
export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large' | 'extra-large';

const QUERIES = {
  medium: '(min-width: 600px)',
  expanded: '(min-width: 840px)',
  large: '(min-width: 1200px)',
  'extra-large': '(min-width: 1600px)',
} as const;

/** A maior classe cuja largura mínima a janela atinge. */
export function windowClassOf(matches: (query: string) => boolean): WindowClass {
  const order = ['extra-large', 'large', 'expanded', 'medium'] as const;
  return order.find((name) => matches(QUERIES[name])) ?? 'compact';
}

/**
 * A classe da janela como signal: o shell escolhe rail ou barra inferior e as páginas, um ou dois
 * painéis (`viewport.windowClass() === 'compact'`).
 */
@Injectable({ providedIn: 'root' })
export class Viewport {
  private readonly breakpoints = inject(BreakpointObserver);

  readonly windowClass = toSignal(
    this.breakpoints
      .observe(Object.values(QUERIES))
      .pipe(map(({ breakpoints }) => windowClassOf((query) => breakpoints[query] ?? false))),
    { initialValue: windowClassOf((query) => this.breakpoints.isMatched(query)) },
  );
}
