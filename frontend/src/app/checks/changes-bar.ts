import { Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Icon } from '../ui/icon';
import { LiveRegion } from '../ui/live-region';
import { ChecksDraft, changeText } from './checks-draft';

/**
 * A barra de salvar de Verificações (B3, UX-03): `region "Unsaved changes"`, fixa no pé da página,
 * que só aparece com alteração pendente. Diz o que muda, abre a lista com o valor antigo e o novo
 * ("Review changes") e tem um "Save changes" só, que nunca fica desabilitado (S12).
 *
 * O resumo é a região viva persistente da §4.3: existe vazia desde a carga e recebe o texto 1 s
 * depois da última mudança; no erro de validação vira `alert`. O texto à vista é o mesmo, na hora,
 * e fica fora da árvore de acessibilidade para não ser lido duas vezes.
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
  /** Com alteração pendente, ou com o erro do último salvar à espera de resposta. */
  protected readonly shown = computed(() => this.draft.dirty() || this.draft.failure() !== null);
  /** O que se vê na barra, na hora; no celular, só a contagem (wireframe 390). */
  protected readonly visible = computed(() => this.draft.alert() || this.draft.preview());
  protected readonly count = computed(() => countOf(this.draft.changes().length));
  /** O que a região viva diz: o erro de validação na hora (`alert`), o resumo quando a pessoa para. */
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

/** "4 unsaved changes": a contagem sem os nomes, para a barra do celular. */
function countOf(changes: number): string {
  if (changes === 0) {
    return '';
  }
  return changes === 1 ? $localize`1 unsaved change` : $localize`${changes}:count: unsaved changes`;
}
