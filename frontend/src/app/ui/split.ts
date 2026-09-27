import { Component, computed, effect, input, model, untracked } from '@angular/core';

/** Passo das setas, em px; Home e End vão aos limites. */
export const SPLIT_STEP = 16;

/**
 * Dois painéis lado a lado com a divisória arrastável (ponteiro) e ajustável pelo teclado (setas,
 * Home, End; WCAG 2.1.1 e 2.5.7). A largura do primeiro painel é um `model()` em px e, com
 * `storageKey`, fica no `localStorage` (JSON, como as outras preferências).
 */
@Component({
  selector: 'app-split',
  template: `
    <div class="start" [style.width.px]="width()"><ng-content select="[splitStart]" /></div>
    <div
      class="separator"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      [attr.aria-label]="label()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="width()"
      [attr.aria-valuetext]="valueText()"
      (keydown)="resizeByKey($event)"
      (pointerdown)="startDrag($event)"
      (pointermove)="drag($event)"
      (pointerup)="endDrag($event)"
      (pointercancel)="endDrag($event)"
    >
      <span class="grip"></span>
    </div>
    <div class="end"><ng-content select="[splitEnd]" /></div>
  `,
  styleUrl: './split.scss',
})
export class Split {
  /** Nome acessível da divisória ("Resize list and detail"). */
  readonly label = input.required<string>();
  readonly min = input(280);
  readonly max = input(640);
  readonly storageKey = input<string | null>(null);
  readonly width = model(360);
  protected readonly valueText = computed(() => $localize`${this.width()}:width: pixels`);

  private dragFrom: { x: number; width: number } | null = null;

  constructor() {
    effect(() => {
      const key = this.storageKey();
      if (key) {
        untracked(() => this.restore(key));
      }
    });
  }

  protected resizeByKey(event: KeyboardEvent): void {
    const next: Record<string, number> = {
      ArrowLeft: this.width() - SPLIT_STEP,
      ArrowRight: this.width() + SPLIT_STEP,
      Home: this.min(),
      End: this.max(),
    };
    if (event.key in next) {
      event.preventDefault();
      this.resize(next[event.key]);
    }
  }

  protected startDrag(event: PointerEvent): void {
    this.dragFrom = { x: event.clientX, width: this.width() };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  protected drag(event: PointerEvent): void {
    if (this.dragFrom) {
      this.resize(this.dragFrom.width + event.clientX - this.dragFrom.x);
    }
  }

  protected endDrag(event: PointerEvent): void {
    this.dragFrom = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  }

  private resize(width: number): void {
    const clamped = Math.round(Math.min(this.max(), Math.max(this.min(), width)));
    this.width.set(clamped);
    const key = this.storageKey();
    if (key) {
      localStorage.setItem(key, JSON.stringify(clamped));
    }
  }

  private restore(key: string): void {
    const stored = Number(localStorage.getItem(key));
    if (Number.isFinite(stored) && stored > 0) {
      this.width.set(Math.min(this.max(), Math.max(this.min(), stored)));
    }
  }
}
