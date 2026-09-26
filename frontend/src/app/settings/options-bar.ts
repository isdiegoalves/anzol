import { Component, inject } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { Preferences } from './preferences';

/** Opções acima do detalhe: formatar JSON/XML e ocultar detalhes. */
@Component({
  selector: 'app-options-bar',
  imports: [MatSlideToggle],
  templateUrl: './options-bar.html',
  styleUrl: './options-bar.scss',
})
export class OptionsBar {
  protected readonly preferences = inject(Preferences);
}
