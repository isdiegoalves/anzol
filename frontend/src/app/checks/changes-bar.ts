import { Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Icon } from '../ui/icon';
import { LiveRegion } from '../ui/live-region';
import { ChecksDraft, changeText } from './checks-draft';

/**
 * O resumo à vista muda a cada tecla e fica fora da árvore de acessibilidade; quem fala é a região
 * viva, 1 s depois da última mudança, para não ser lido duas vezes.
 */
@Component({
  selector: 'app-changes-bar',
  imports: [Icon, LiveRegion, MatButton],
  templateUrl: './changes-bar.html',
  styleUrl: './changes-bar.scss',
  host: { '[class.shown]': 'shown()' },
})
export class ChangesBar {
  protected readonly draft = inject(ChecksDraft);

  protected readonly label = $localize`Unsaved changes`;
  protected readonly reviewing = signal(false);
  protected readonly shown = computed(() => this.draft.dirty() || this.draft.failure() !== null);
  protected readonly visible = computed(() => this.draft.alert() || this.draft.preview());
  protected readonly count = computed(() => countOf(this.draft.changes().length));
  protected readonly spoken = computed(() =>
    this.shown() ? this.draft.alert() || this.draft.summary() : '',
  );
  protected readonly lines = computed(() => this.draft.changes().map(changeText));

  protected save(force = false): void {
    void this.draft.save(force);
  }

  protected discard(): void {
    this.reviewing.set(false);
    this.draft.discard();
  }

  protected reload(): void {
    this.reviewing.set(false);
    void this.draft.reload();
  }
}

function countOf(changes: number): string {
  if (changes === 0) {
    return '';
  }
  return changes === 1 ? $localize`1 unsaved change` : $localize`${changes}:count: unsaved changes`;
}
