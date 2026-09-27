import { Clipboard } from '@angular/cdk/clipboard';
import {
  Component,
  DestroyRef,
  Injector,
  OutputEmitterRef,
  Type,
  ViewContainerRef,
  computed,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { RequestStore } from '../requests/request-store';
import { TokenStore } from '../token/token-store';
import { UrlLock } from '../token/url-lock';
import { Icon } from '../ui/icon';
import { Menu, MenuItem } from '../ui/menu';
import { DESTINATIONS, Destination, placeOf } from './destinations';
import { Hotkeys } from './hotkeys';
import { ScreenState } from './screen-state';
import { ShellSettings } from './shell-settings';
import type { TokenActions } from '../token/token-actions';
import { UrlHeader } from './url-header';

/** Folha aberta pelo rail: Settings ou Help, carregadas sob demanda. */
type Sheet = 'settings' | 'help';

/** O que as folhas expõem: o pedido de fechar (botão Close). */
export interface SheetComponent {
  readonly closed: OutputEmitterRef<void>;
}

/**
 * O espaço de trabalho (C §3.1): rail com a marca, o FAB "New URL", os cinco destinos da URL,
 * Settings e Help; cabeçalho fixo da URL; e a página da rota. O destino Inbox mostra as não lidas e
 * Checks um ponto quando há assinatura ou schema inválido na lista (INBOX-02, CHECKS-23). Abaixo de
 * 600 px o rail vira barra no topo (marca, título do destino, busca e um ⋮ com o FAB, Settings,
 * Help e as ações da URL, INBOX-29) e os destinos, barra inferior. URL protegida sem acesso: a página sai (o SSE fecha junto) e entra a tela de desbloqueio,
 * sem os destinos nem o cabeçalho, que voltam ao destrancar.
 */
@Component({
  selector: 'app-shell',
  imports: [Icon, Menu, RouterLink, RouterOutlet, UrlHeader],
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
  private readonly requests = inject(RequestStore);
  protected readonly screen = inject(ScreenState);
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

  /** Não lidas da URL aberta (o badge do destino Inbox). */
  private readonly unread = computed(() => this.requests.unread().length);
  /**
   * Checks pede atenção quando alguma mensagem carregada desta URL tem a assinatura ou o schema
   * inválidos (o que o Health contaria como falha).
   */
  private readonly attention = computed(() => {
    const token = this.tokens.token();
    return (
      !!token &&
      this.requests.tokenId() === token.uuid &&
      this.requests
        .requests()
        .some((request) => request.signature?.valid === false || request.schema?.valid === false)
    );
  });

  /** O badge ou o ponto do destino, com o nome acessível que diz o que ele quer dizer. */
  protected statusOf(destination: Destination): { name: string; badge: number | null } | null {
    const label = this.label(destination);
    if (destination.path === null && this.unread() > 0) {
      const count = this.unread();
      return { name: $localize`${label}:destination:, ${count}:count: unread`, badge: count };
    }
    if (destination.path === 'checks' && this.attention()) {
      return { name: $localize`${label}:destination:, needs attention`, badge: null };
    }
    return null;
  }

  /** O ⋮ da barra do celular: o que a barra do topo e o cabeçalho da URL deixam de mostrar. */
  protected readonly topActions = computed<MenuItem[]>(() => {
    const token = this.tokens.token();
    const url: MenuItem[] =
      token && !this.locked()
        ? [
            {
              label: $localize`:action|Botão que manda a requisição:Send`,
              icon: 'outbound',
              action: () =>
                void this.router.navigate(['/', token.uuid, 'outbound'], {
                  queryParams: { send: 'new' },
                }),
            },
          ]
        : [];
    const more: MenuItem[] =
      token && !this.locked()
        ? [
            {
              label: $localize`Edit URL`,
              icon: 'settings',
              action: () => void this.router.navigate(['/', token.uuid, 'checks']),
            },
            {
              label: $localize`Open in new tab`,
              icon: 'outbound',
              action: () => window.open(this.tokens.webhookUrl(), '_blank', 'noopener'),
            },
            {
              label: $localize`Copy CLI command`,
              icon: 'copy',
              action: () => void this.withActions((actions) => actions.copyCliCommand()),
            },
            ...(token.protected
              ? [
                  {
                    label: $localize`Lock`,
                    icon: 'lock' as const,
                    action: () => void this.withActions((actions) => actions.lockUrl()),
                  },
                ]
              : []),
            {
              label: $localize`Delete URL`,
              icon: 'trash',
              action: () => void this.withActions((actions) => actions.deleteUrl()),
            },
          ]
        : [];
    return [
      ...url,
      { label: $localize`New URL`, icon: 'plus', action: () => void this.createUrl() },
      ...more,
      { label: $localize`Settings`, icon: 'settings', action: () => this.sheet.set('settings') },
      { label: $localize`Help`, icon: 'help', action: () => this.sheet.set('help') },
    ];
  });

  /** A lupa da barra do celular: mostra a busca da lista e põe o foco nela. */
  protected openSearch(): void {
    this.screen.searchOpen.set(true);
    afterNextRender(() => this.focusSearch(), { injector: this.injector });
  }

  private async withActions(run: (actions: TokenActions) => unknown): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await run(this.injector.get(TokenActions));
  }

  protected link(destination: Destination, tokenId: string): string[] {
    return destination.path ? ['/', tokenId, destination.path] : ['/', tokenId];
  }

  protected toggleSheet(sheet: Sheet): void {
    this.sheet.update((open) => (open === sheet ? null : sheet));
  }

  protected createUrl(): Promise<void> {
    return this.withActions((actions) => actions.createUrl());
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
