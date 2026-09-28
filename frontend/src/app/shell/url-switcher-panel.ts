import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { fromNow } from '../request-detail/dates';
import { KnownUrls } from '../token/known-urls';
import { UrlLock } from '../token/url-lock';
import { UrlMissing } from '../token/url-missing';
import { Icon } from '../ui/icon';
import { Viewport } from './viewport';

/** Uma URL no menu, com o nome acessível inteiro ("Pagamentos, d0620, open now"). */
interface Entry {
  uuid: string;
  name: string;
  id5: string;
  state: string;
  label: string;
  current: boolean;
}

/**
 * O painel do seletor de URLs (B1), carregado quando o botão o abre: o `menu "URLs in this
 * browser"` preso ao botão, com a aberta primeiro e marcada, as outras pela última abertura, e
 * "New URL…", "Rename this URL…" e "Forget a URL…". Padrão "menu button" da WAI-ARIA, sem o
 * Overlay do CDK: setas, Home e End andam; Esc fecha e devolve o foco; digitar filtra quando há a
 * busca (8 URLs ou mais). No celular, o mesmo painel é uma folha inferior modal.
 */
@Component({
  selector: 'app-url-switcher-panel',
  imports: [Icon],
  templateUrl: './url-switcher-panel.html',
  styleUrl: './url-switcher-panel.scss',
  host: {
    // No `pointerdown`, antes do clique: o botão de fora que abre o seletor ("Switch to another
    // URL") não o fecha no mesmo gesto.
    '(document:pointerdown)': 'closeOutside($event)',
    '(keydown)': 'move($event)',
  },
})
export class UrlSwitcherPanel {
  private readonly known = inject(KnownUrls);
  private readonly urlLock = inject(UrlLock);
  private readonly urlMissing = inject(UrlMissing);
  private readonly viewport = inject(Viewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** A URL da rota (aberta, trancada ou inexistente). */
  readonly current = input.required<string>();
  /** O id do painel, para o `aria-controls` do botão. */
  readonly panelId = input.required<string>();

  readonly chosen = output<string>();
  readonly newUrl = output<void>();
  readonly rename = output<void>();
  readonly forget = output<void>();
  /** Pede para fechar; `true` devolve o foco ao botão. */
  readonly closed = output<boolean>();

  protected readonly query = signal('');
  /** Celular: folha inferior modal, com "Close". */
  protected readonly compact = computed(() => this.viewport.windowClass() === 'compact');
  protected readonly available = this.known.available;
  protected readonly menuLabel = $localize`URLs in this browser`;
  protected readonly chooseLabel = $localize`Choose a URL`;

  /** A aberta primeiro; as outras pela última abertura. */
  private readonly entries = computed<Entry[]>(() => {
    const current = this.current();
    const others = this.known.urls().filter((url) => url.uuid !== current);
    const opened = this.known.urls().find((url) => url.uuid === current)?.openedAt;
    return [{ uuid: current, openedAt: opened ?? '' }, ...others].map(({ uuid, openedAt }) => {
      const name = this.known.nameOf(uuid);
      const id5 = uuid.slice(0, 5);
      const state = this.stateOf(uuid, openedAt, uuid === current);
      return {
        uuid,
        name,
        id5,
        state,
        current: uuid === current,
        label: $localize`${name}:name:, ${id5}:id:, ${state}:state:`,
      };
    });
  });
  /** A busca (com 8 URLs ou mais) filtra por apelido e por início do UUID. */
  protected readonly searchable = computed(() => this.entries().length >= 8);
  /**
   * O painel é o próprio `menu`, salvo quando leva mais que itens de menu: a folha do celular (com
   * "Close") e a lista com busca. Aí ele é um `dialog` com o menu dentro.
   */
  protected readonly boxed = computed(() => this.compact() || this.searchable());
  protected readonly shown = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query
      ? this.entries().filter(
          (entry) =>
            entry.name.toLowerCase().includes(query) || entry.uuid.toLowerCase().startsWith(query),
        )
      : this.entries();
  });

  constructor() {
    // Aberto: o foco vai ao primeiro item.
    afterNextRender(() => this.focusItem(0));
  }

  protected choose(entry: Entry): void {
    this.closed.emit(true);
    if (!entry.current) {
      this.chosen.emit(entry.uuid);
    }
  }

  protected run(action: 'newUrl' | 'rename' | 'forget'): void {
    this.closed.emit(true);
    this[action].emit();
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Setas, Home e End andam pelos itens; Esc fecha; Tab fica dentro (folha) ou fecha (menu). */
  protected move(event: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(event.target as HTMLElement);
    const step: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    const typing = (event.target as HTMLElement).tagName === 'INPUT';
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit(true);
    } else if (event.key in step && !(typing && (event.key === 'Home' || event.key === 'End'))) {
      event.preventDefault();
      this.focusItem(typing && event.key === 'ArrowUp' ? -1 : step[event.key]);
    } else if (event.key === 'Tab') {
      if (this.compact()) {
        this.keepInside(event);
      } else {
        this.closed.emit(false);
      }
    } else if (
      !typing &&
      this.searchable() &&
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      // Digitar filtra: a tecla vai para a busca.
      this.host.querySelector<HTMLInputElement>('.find')?.focus();
    }
  }

  /** Fora do painel e do botão (o pai): fecha. O clique no botão é dele. */
  protected closeOutside(event: Event): void {
    const switcher = this.host.parentElement ?? this.host;
    if (!switcher.contains(event.target as Node)) {
      this.closed.emit(false);
    }
  }

  private stateOf(uuid: string, openedAt: string, current: boolean): string {
    const missing = this.urlMissing.missing();
    if (missing?.id === uuid) {
      return $localize`:state of a URL in the switcher:deleted`;
    }
    if (this.urlLock.tokenId() === uuid) {
      return $localize`:state of a URL in the switcher:locked`;
    }
    if (current) {
      return $localize`:state of a URL in the switcher:open now`;
    }
    // `fromNow` lê a data como a API a grava ("Y-m-d H:i:s", UTC).
    const when = fromNow(openedAt.slice(0, 19).replace('T', ' '));
    return $localize`:state of a URL in the switcher:opened ${when}:time:`;
  }

  /** Folha modal: o Tab dá a volta dentro dela. */
  private keepInside(event: KeyboardEvent): void {
    const focusable = [
      ...this.host.querySelectorAll<HTMLElement>('.panel button, .panel input'),
    ].filter((element) => !element.hasAttribute('disabled'));
    const [first, last] = [focusable[0], focusable.at(-1)];
    const active = this.host.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusItem(index: number): void {
    const items = this.items();
    if (items.length > 0) {
      items[(index + items.length) % items.length].focus();
    }
  }

  private items(): HTMLElement[] {
    return [
      ...this.host.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]'),
    ];
  }
}
