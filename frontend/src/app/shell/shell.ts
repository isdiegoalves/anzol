import { Clipboard } from '@angular/cdk/clipboard';
import {
  Component,
  DestroyRef,
  Injector,
  OutputEmitterRef,
  Type,
  ViewContainerRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { TokenStore } from '../token/token-store';
import { UrlLock } from '../token/url-lock';
import { Icon } from '../ui/icon';
import { DESTINATIONS, Destination, placeOf } from './destinations';
import { Hotkeys } from './hotkeys';
import { ShellSettings } from './shell-settings';
import { UrlHeader } from './url-header';

/** Folha aberta pelo rail: Settings ou Help, carregadas sob demanda. */
type Sheet = 'settings' | 'help';

/** O que as folhas expõem: o pedido de fechar (botão Close). */
export interface SheetComponent {
  readonly closed: OutputEmitterRef<void>;
}

/**
 * O espaço de trabalho (C §3.1): rail com a marca, o FAB "New URL", os cinco destinos da URL,
 * Settings e Help; cabeçalho fixo da URL; e a página da rota. Abaixo de 600 px o rail vira barra
 * no topo e os destinos, barra inferior; a partir de 1600 px o rail se expande com os rótulos ao
 * lado. URL protegida sem acesso: a página sai (o SSE fecha junto) e entra a tela de desbloqueio,
 * sem os destinos nem o cabeçalho, que voltam ao destrancar.
 */
@Component({
  selector: 'app-shell',
  imports: [Icon, RouterLink, RouterOutlet, UrlHeader],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly tokens = inject(TokenStore);
  protected readonly settings = inject(ShellSettings);
  private readonly router = inject(Router);
  private readonly urlLock = inject(UrlLock);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);
  private readonly unlockHost = viewChild.required('unlockHost', { read: ViewContainerRef });
  private readonly sheetHost = viewChild.required('sheetHost', { read: ViewContainerRef });

  protected readonly destinations = DESTINATIONS;
  /** Rótulos traduzidos na instância (o `DESTINATIONS` é do módulo, lido antes da tradução). */
  private readonly labels: Record<Destination['label'], string> = {
    Inbox: $localize`Inbox`,
    Rules: $localize`Rules`,
    Checks: $localize`Checks`,
    Outbound: $localize`Outbound`,
    Insights: $localize`Insights`,
  };
  protected readonly sheet = signal<Sheet | null>(null);
  private opener: HTMLElement | null = null;

  private readonly place = computed(() =>
    placeOf(
      this.router
        .lastSuccessfulNavigation()
        ?.finalUrl?.root.children['primary']?.segments.map((segment) => segment.path) ?? [],
    ),
  );

  /** Destino marcado no rail (`aria-current="page"`); nenhum no Compare. */
  protected readonly current = computed(() => this.place().destination);

  /** URL protegida sem acesso, enquanto a rota for dela. */
  protected readonly locked = computed(() => {
    const tokenId = this.urlLock.tokenId();
    return tokenId !== null && this.place().tokenId === tokenId ? tokenId : null;
  });

  constructor() {
    // A tela de desbloqueio vem sob demanda: quem nunca abre uma URL protegida não a baixa.
    effect(async () => {
      const tokenId = this.locked();
      const host = this.unlockHost();
      host.clear();
      if (tokenId) {
        const { UnlockScreen } = await import('../token/unlock-screen');
        if (this.locked() === tokenId && host.length === 0) {
          host.createComponent(UnlockScreen).setInput('tokenId', tokenId);
        }
      }
    });

    effect(() => {
      const sheet = this.sheet();
      untracked(() => void this.showSheet(sheet));
    });

    inject(Hotkeys).register(
      {
        goTo: (key) => this.goTo(DESTINATIONS.find((destination) => destination.key === key)),
        copyUrl: () => this.tokens.webhookUrl() && this.clipboard.copy(this.tokens.webhookUrl()),
        newUrl: () => void this.createUrl(),
        help: () => this.sheet.set('help'),
        search: () => this.focusSearch(),
        close: () => this.sheet.set(null),
        enabled: () => this.settings.shortcuts(),
      },
      inject(DestroyRef),
    );
  }

  protected label(destination: Destination): string {
    return this.labels[destination.label];
  }

  /** "Rules (G then R)": o atalho junto do nome, na dica. */
  protected hint(destination: Destination): string {
    return $localize`${this.label(destination)}:destination: (G then ${destination.key.toUpperCase()}:key:)`;
  }

  protected link(destination: Destination, tokenId: string): string[] {
    return destination.path ? ['/', tokenId, destination.path] : ['/', tokenId];
  }

  protected toggleSheet(sheet: Sheet): void {
    this.sheet.update((open) => (open === sheet ? null : sheet));
  }

  protected async createUrl(): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await this.injector.get(TokenActions).createUrl();
  }

  private goTo(destination: Destination | undefined): void {
    const token = this.tokens.token();
    if (destination && token && !this.locked()) {
      void this.router.navigate(this.link(destination, token.uuid));
    }
  }

  private focusSearch(): void {
    document.querySelector<HTMLInputElement>('[role="search"] input')?.focus();
  }

  /** Abre a folha no lugar da anterior; ao fechar, o foco volta para quem a abriu. */
  private async showSheet(sheet: Sheet | null): Promise<void> {
    const host = this.sheetHost();
    const hadSheet = host.length > 0;
    host.clear();
    if (!sheet) {
      if (hadSheet) {
        this.opener?.focus();
      }
      return;
    }
    this.opener = document.activeElement as HTMLElement | null;
    const component: Type<SheetComponent> =
      sheet === 'settings'
        ? (await import('./settings-sheet')).SettingsSheet
        : (await import('./help-sheet')).HelpSheet;
    if (this.sheet() === sheet && host.length === 0) {
      host.createComponent(component).instance.closed.subscribe(() => this.sheet.set(null));
    }
  }
}
