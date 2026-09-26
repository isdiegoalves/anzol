import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Preferences } from '../settings/preferences';

/** Texto de boas-vindas com a URL; o "×" alterna `hideTutorial`, como no app atual. */
@Component({
  selector: 'app-tutorial',
  imports: [CdkCopyToClipboard, MatButton],
  templateUrl: './tutorial.html',
  styleUrl: './tutorial.scss',
})
export class Tutorial {
  private readonly preferences = inject(Preferences);

  readonly url = input.required<string>();

  protected toggleTutorial(): void {
    this.preferences.hideTutorial.update((hidden) => !hidden);
  }
}
