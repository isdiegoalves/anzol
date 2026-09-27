import { Component, input, linkedSignal, output } from '@angular/core';

/**
 * Interruptor "Enable rule {nome}" da linha da lista (AZ-05), com o visual do switch do M3 num
 * alvo de toque de 44 px (F8, WCAG 2.5.8): o `mat-slide-toggle` mede 32 px de altura, e a altura
 * dele só muda pelo próprio trilho. Muda na hora ao clicar; se a gravação falhar, quem chamou
 * devolve o estado com `revert()`.
 */
@Component({
  selector: 'app-rule-switch',
  template: `
    <button
      type="button"
      role="switch"
      class="switch"
      [attr.aria-checked]="on()"
      [attr.aria-label]="label()"
      (click)="toggle()"
    >
      <span class="track" aria-hidden="true"><span class="handle"></span></span>
    </button>
  `,
  styleUrl: './rule-switch.scss',
})
export class RuleSwitch {
  readonly checked = input(true);
  readonly label = input.required<string>();
  readonly changed = output<boolean>();

  /** O estado mostrado: o salvo, ou o do clique enquanto a gravação não volta. */
  protected readonly on = linkedSignal(() => this.checked());

  protected toggle(): void {
    const next = !this.on();
    this.on.set(next);
    this.changed.emit(next);
  }

  /** A gravação falhou: volta ao que está salvo. */
  revert(): void {
    this.on.set(this.checked());
  }
}
