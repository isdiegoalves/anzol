import {
  Component,
  ElementRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { KnownUrls } from '../token/known-urls';
import { Icon } from '../ui/icon';
import { ScreenState } from './screen-state';

let nextId = 0;

/**
 * Seletor de URLs do cabeçalho (B1): o botão com o apelido da URL aberta (ou "URL d0620") abre o
 * `menu "URLs in this browser"`. Escolher uma URL leva ao mesmo destino nela (quem decide a
 * navegação é o shell). Aqui fica só o botão; o painel (a lista, a busca, o teclado, a folha do
 * celular) vem sob demanda, para não pesar na carga inicial.
 */
@Component({
  selector: 'app-url-switcher',
  imports: [Icon],
  templateUrl: './url-switcher.html',
  styleUrl: './url-switcher.scss',
})
export class UrlSwitcher {
  private readonly known = inject(KnownUrls);
  private readonly screen = inject(ScreenState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panelHost = viewChild.required('panelHost', { read: ViewContainerRef });

  /** A URL da rota (aberta, trancada ou inexistente). */
  readonly current = input.required<string>();

  readonly chosen = output<string>();
  readonly newUrl = output<void>();
  readonly rename = output<void>();
  readonly forget = output<void>();

  protected readonly id = `url-switcher-${nextId++}`;
  /** Aberto também por fora: a tecla U e o "Switch to another URL". */
  protected readonly open = this.screen.switcherOpen;

  protected readonly name = computed(() => this.known.nameOf(this.current()));
  /** O nome acessível começa pelo rótulo visível (WCAG 2.5.3). */
  protected readonly triggerLabel = computed(() => $localize`${this.name()}:name:. Switch URL`);
  protected readonly triggerHint = $localize`Switch URL (U)`;

  constructor() {
    effect(() => {
      const open = this.open();
      const host = this.panelHost();
      untracked(() => void this.show(open, host));
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
    if (!this.open()) {
      this.focusTrigger();
    }
  }

  protected openAt(event: Event): void {
    event.preventDefault();
    this.open.set(true);
  }

  protected close(refocus: boolean): void {
    this.open.set(false);
    if (refocus) {
      this.focusTrigger();
    }
  }

  private async show(open: boolean, host: ViewContainerRef): Promise<void> {
    host.clear();
    if (!open) {
      return;
    }
    const { UrlSwitcherPanel } = await import('./url-switcher-panel');
    if (!this.open() || host.length > 0) {
      return;
    }
    const panel = host.createComponent(UrlSwitcherPanel);
    panel.setInput('current', this.current());
    panel.setInput('panelId', this.id);
    const { instance } = panel;
    instance.closed.subscribe((refocus) => this.close(refocus));
    instance.chosen.subscribe((uuid) => this.chosen.emit(uuid));
    instance.newUrl.subscribe(() => this.newUrl.emit());
    instance.rename.subscribe(() => this.rename.emit());
    instance.forget.subscribe(() => this.forget.emit());
  }

  private focusTrigger(): void {
    this.host.querySelector<HTMLElement>('.trigger')?.focus();
  }
}
