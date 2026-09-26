import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Shell } from './shell/shell';
import { ShellSettings } from './shell/shell-settings';
import { Icon } from './ui/icon';

/**
 * Raiz: o shell (rail, cabeçalho da URL, página da rota) em toda tela, menos na página do link
 * só-leitura (`#/share/{id}`), que fica só com a marca: quem abre o link só lê, sem nenhum botão.
 */
@Component({
  imports: [Icon, RouterLink, RouterOutlet, Shell],
  selector: 'app-root',
  styleUrl: './app.scss',
  template: `
    @if (sharing()) {
      <header class="brand-bar">
        <a class="brand" routerLink="/"><app-icon name="anchor" [size]="22" />Webhook Tester</a>
      </header>
      <router-outlet />
    } @else {
      <app-shell />
    }
  `,
})
export class App {
  /**
   * `/share/{id}`: página só-leitura de um link compartilhado. Decidido no início da navegação,
   * para a página nascer já no `router-outlet` certo (e não ser criada duas vezes).
   */
  protected readonly sharing = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationStart),
      map((event) => isShare(event.url)),
    ),
    { initialValue: isShare(inject(DOCUMENT).location.hash.replace(/^#/, '')) },
  );

  constructor() {
    // O tema escolhido em Settings vale também na página do link, que não tem o shell.
    inject(ShellSettings);
  }
}

function isShare(url: string): boolean {
  return url.startsWith('/share/');
}
