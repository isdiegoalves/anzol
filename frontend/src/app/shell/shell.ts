import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import {
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { EMPTY, map, switchMap } from 'rxjs';
import { Connection } from '../realtime/connection-store';
import { RequestStream } from '../realtime/request-stream';
import { RulesSeen } from '../rules/rules-seen';
import { RequestStore } from '../requests/request-store';
import { injectCopyCliCommand } from '../token/copy-cli-command';
import { KnownUrls } from '../token/known-urls';
import { TokenStore } from '../token/token-store';
import { UrlLock } from '../token/url-lock';
import { MissingUrl, UrlMissing } from '../token/url-missing';
import { Icon } from '../ui/icon';
import { Menu, MenuItem } from '../ui/menu';
import { DESTINATIONS, Destination, placeOf } from './destinations';
import { Hotkeys } from './hotkeys';
import { ScreenState } from './screen-state';
import { ChecksSeen } from './checks-seen';
import { ShellSettings } from './shell-settings';
import { SkipLink } from './skip-link';
import type { TokenActions } from '../token/token-actions';
import { ConnectionBand } from './connection-band';
import { OpenFailed } from './open-failed';
import { UrlHeader } from './url-header';

/** O `import()` do pedaço de um destino falhou (rede): cada navegador diz de um jeito. */
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically/i;

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
  imports: [ConnectionBand, Icon, Menu, OpenFailed, RouterLink, RouterOutlet, SkipLink, UrlHeader],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly tokens = inject(TokenStore);
  protected readonly settings = inject(ShellSettings);
  private readonly router = inject(Router);
  private readonly urlLock = inject(UrlLock);
  private readonly urlMissing = inject(UrlMissing);
  private readonly injector = inject(Injector);
  private readonly clipboard = inject(Clipboard);
  private readonly requests = inject(RequestStore);
  private readonly rulesSeen = inject(RulesSeen);
  private readonly checksSeen = inject(ChecksSeen);
  private readonly document = inject(DOCUMENT);
  protected readonly screen = inject(ScreenState);
  private readonly known = inject(KnownUrls);
  private readonly title = inject(Title);
  private readonly stream = inject(RequestStream);
  private readonly connection = inject(Connection);
  private readonly copyCliCommand = injectCopyCliCommand();
  private readonly unlockHost = viewChild.required('unlockHost', { read: ViewContainerRef });
  private readonly missingHost = viewChild.required('missingHost', { read: ViewContainerRef });
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
  private readonly compareLabel = $localize`Compare`;
  /** A URL escolhida no seletor, até ela abrir: o anúncio sai uma vez, com ela já na tela. */
  private readonly switching = signal<string | null>(null);
  protected readonly sheet = signal<Sheet | null>(null);
  private opener: HTMLElement | null = null;
  private searchWait: ReturnType<typeof setTimeout> | undefined;

  /** O endereço do destino cujo pedaço não carregou; `null` quando a navegação dá certo. */
  protected readonly failedUrl = signal<string | null>(null);

  /** Onde a tela está: a rota, ou o destino que não abriu (o rail troca mesmo assim). */
  private readonly place = computed(() => {
    const failed = this.failedUrl();
    const url = failed
      ? this.router.parseUrl(failed)
      : this.router.lastSuccessfulNavigation()?.finalUrl;
    return placeOf(url?.root.children['primary']?.segments.map((segment) => segment.path) ?? []);
  });

  protected readonly failed = computed(() => {
    const { tokenId, destination } = this.place();
    return this.failedUrl() ? { tokenId, destination } : null;
  });

  /** O endereço de agora, para o "Skip to content" ser um link de verdade. */
  protected readonly here = computed(() => {
    this.place();
    return `#${this.router.url}`;
  });

  /** A URL aberta de fato: a da rota, já carregada, sem tranca e existente. */
  private readonly openId = computed(() => {
    const tokenId = this.place().tokenId;
    const open = this.tokens.token()?.uuid === tokenId && !this.locked() && !this.missing();
    return open ? tokenId : null;
  });

  /** Destino marcado no rail (`aria-current="page"`); nenhum no Compare. */
  protected readonly current = computed(() => this.place().destination);

  /** URL protegida sem acesso, enquanto a rota for dela. */
  protected readonly locked = computed(() => {
    const tokenId = this.urlLock.tokenId();
    return tokenId !== null && this.place().tokenId === tokenId ? tokenId : null;
  });

  /**
   * A URL da rota não existe (o servidor disse 410), ou o endereço não é id de URL: a página única
   * de URL inexistente entra no lugar da página da rota, em qualquer destino (B1).
   */
  protected readonly missing = computed<MissingUrl | null>(() => {
    const { tokenId, first } = this.place();
    if (!tokenId) {
      return first && !['share', '_catalog'].includes(first)
        ? { id: first, reason: 'malformed' }
        : null;
    }
    const missing = this.urlMissing.missing();
    return missing?.id === tokenId ? missing : null;
  });

  constructor() {
    effect(async () => {
      const missing = this.missing();
      const host = this.missingHost();
      host.clear();
      if (missing) {
        const { UrlMissingPage } = await import('./url-missing-page');
        if (this.missing() === missing && host.length === 0) {
          host.createComponent(UrlMissingPage).setInput('missing', missing);
        }
      }
    });

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart && event.navigationTrigger === 'popstate') {
        // Voltar ou avançar para outra URL é uma troca de URL como a do seletor, e é anunciada igual.
        const { tokenId } = placeOf(
          this.router
            .parseUrl(event.url)
            .root.children['primary']?.segments.map((segment) => segment.path) ?? [],
        );
        if (tokenId && tokenId !== this.place().tokenId) {
          this.switching.set(tokenId);
        }
      } else if (event instanceof NavigationError && CHUNK_ERROR.test(String(event.error))) {
        this.failedUrl.set(event.url);
      } else if (event instanceof NavigationEnd) {
        this.failedUrl.set(null);
        this.seeChecks(event.urlAfterRedirects);
      }
    });

    // O tempo real fica aberto em todo destino (o "Live" do cabeçalho, UX-12). Fora da Entrada,
    // quem conta as que chegam é o shell; nela, a própria Entrada, que assina a mesma conexão.
    toObservable(this.openId)
      .pipe(
        switchMap((tokenId) =>
          tokenId ? this.stream.connect(tokenId).pipe(map((event) => ({ tokenId, event }))) : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ tokenId, event }) => {
        if (this.current()?.path !== null) {
          this.requests.arrivedOutside(tokenId, event.request, event.total);
        }
      });
    effect(() => {
      const tokenId = this.openId();
      const inbox = this.current()?.path === null;
      if (tokenId) {
        untracked(() => {
          this.connection.probe.set(`/token/${tokenId}`);
          if (!inbox) {
            this.requests.peek(tokenId).catch(() => undefined);
          }
        });
      }
    });

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

    // O título da aba por destino (UX-21): "(3) Inbox · Pagamentos · Anzol".
    effect(() => this.title.setTitle(this.pageTitle()));

    // "Pagamentos opened. Inbox, 34 requests.": uma vez, quando a URL escolhida já abriu.
    effect(() => {
      const uuid = this.switching();
      if (!uuid || this.tokens.token()?.uuid !== uuid) {
        return;
      }
      const inbox = this.current()?.path === null;
      if (inbox && (this.requests.tokenId() !== uuid || this.requests.loading())) {
        return;
      }
      untracked(() => {
        this.switching.set(null);
        void this.announce(this.openedText(uuid, inbox));
      });
    });

    inject(Hotkeys).register(
      {
        goTo: (key) => this.goTo(DESTINATIONS.find((destination) => destination.key === key)),
        copyUrl: () => this.tokens.webhookUrl() && this.clipboard.copy(this.tokens.webhookUrl()),
        newUrl: () => void this.createUrl(),
        help: () => this.sheet.set('help'),
        search: () => this.openSearch(),
        switchUrl: () => {
          if ((this.tokens.token() && !this.locked()) || this.missing()) {
            this.screen.switcherOpen.set(true);
          }
        },
        close: () => {
          const open = this.sheet() !== null;
          this.sheet.set(null);
          return open;
        },
        enabled: () => this.settings.shortcuts(),
      },
      inject(DestroyRef),
    );
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchWait));
  }

  /** O destino que o rail marcou e o `main` não conseguiu mostrar. */
  protected failedName(destination: Destination | null): string {
    return destination ? this.label(destination) : this.compareLabel;
  }

  protected retryOpen(): void {
    const url = this.failedUrl();
    if (url) {
      void this.router.navigateByUrl(url).catch(() => undefined);
    }
  }

  /** Escolhida no seletor: a mesma tela (Regras segue em Regras) na outra URL, com histórico. */
  protected switchTo(uuid: string): void {
    const destination = this.current() ?? DESTINATIONS[0];
    this.switching.set(uuid);
    void this.router.navigate(this.link(destination, uuid));
  }

  /** O `LiveAnnouncer` (e o a11y do CDK com ele) vem sob demanda: fica fora do pacote inicial. */
  private async announce(text: string): Promise<void> {
    const { LiveAnnouncer } = await import('@angular/cdk/a11y');
    await this.injector.get(LiveAnnouncer).announce(text);
  }

  private openedText(uuid: string, inbox: boolean): string {
    const name = this.known.nameOf(uuid);
    const destination = this.label(this.current() ?? DESTINATIONS[0]);
    if (!inbox) {
      return $localize`${name}:name: opened. ${destination}:destination:.`;
    }
    const total = this.requests.total();
    return total === 1
      ? $localize`${name}:name: opened. ${destination}:destination:, 1 request.`
      : $localize`${name}:name: opened. ${destination}:destination:, ${total}:count: requests.`;
  }

  /** `{destino} · {apelido ou URL xxxxx} · Anzol`, com as não lidas na frente. */
  private readonly pageTitle = computed(() => {
    if (this.missing()) {
      return $localize`:browser tab title:URL not found · Anzol`;
    }
    if (this.locked()) {
      return $localize`:browser tab title:Locked · Anzol`;
    }
    const { tokenId, destination, compare } = this.place();
    if (!tokenId) {
      return 'Anzol';
    }
    const where = compare ? this.compareLabel : destination ? this.label(destination) : null;
    const unread = this.unread() > 0 ? `(${this.unread()}) ` : '';
    const name = this.known.nameOf(tokenId);
    return where ? `${unread}${where} · ${name} · Anzol` : `${unread}${name} · Anzol`;
  });

  protected label(destination: Destination): string {
    return this.labels[destination.label];
  }

  /** "Rules (G then R)": o atalho junto do nome, na dica. */
  protected hint(destination: Destination): string {
    return $localize`${this.label(destination)}:destination: (G then ${destination.key.toUpperCase()}:key:)`;
  }

  /** Não lidas da URL aberta (o badge do destino Inbox). */
  private readonly unread = computed(() => this.requests.unreadOf(this.place().tokenId).length);
  /** WM-01: mensagens sem regra desde a última visita a Regras (o ponto em "Rules"). */
  private readonly unruled = computed(() => this.rulesSeen.unseen().length);
  /** O que pede atenção em Checks: as assinaturas inválidas não vistas; sem elas, os schemas. */
  private readonly attention = computed(() => {
    const token = this.tokens.token();
    if (!token || this.requests.tokenId() !== token.uuid) {
      return null;
    }
    const unseen = this.checksSeen.unseen();
    const signatures = unseen.filter((request) => request.signature?.valid === false);
    const found = signatures.length > 0 ? signatures : unseen;
    if (found.length === 0) {
      return null;
    }
    const oldest = found.map((request) => request.created_at).sort()[0];
    // A API grava "Y-m-d H:i:s" em UTC.
    const since = new Date(`${oldest.replace(' ', 'T')}Z`).toLocaleTimeString(
      this.document.documentElement.lang || 'en',
      { hour: 'numeric', minute: '2-digit' },
    );
    return { signatures: signatures.length > 0, count: found.length, since };
  });

  /** Abrir Checks, ou a Entrada filtrada pela assinatura inválida, apaga o ponto. */
  private seeChecks(url: string): void {
    const tree = this.router.parseUrl(url);
    const [tokenId, section] = (tree.root.children['primary']?.segments ?? []).map(
      (segment) => segment.path,
    );
    if (tokenId && (section === 'checks' || tree.queryParams['signature'] === 'invalid')) {
      this.checksSeen.markSeen(tokenId);
    }
  }

  /** O badge ou o ponto do destino, com o nome acessível que diz o que ele quer dizer. */
  protected statusOf(destination: Destination): { name: string; badge: number | null } | null {
    const label = this.label(destination);
    if (destination.path === null && this.unread() > 0) {
      const count = this.unread();
      return { name: $localize`${label}:destination:, ${count}:count: unread`, badge: count };
    }
    if (destination.path === 'rules' && this.unruled() > 0) {
      const count = this.unruled();
      const name =
        count === 1
          ? $localize`${label}:destination: · 1 request without a rule`
          : $localize`${label}:destination: · ${count}:count: requests without a rule`;
      return { name, badge: null };
    }
    const attention = this.attention();
    if (destination.path === 'checks' && attention) {
      const { count, since } = attention;
      const name = attention.signatures
        ? count === 1
          ? $localize`${label}:destination:, 1 invalid signature since ${since}:time:`
          : $localize`${label}:destination:, ${count}:count: invalid signatures since ${since}:time:`
        : count === 1
          ? $localize`${label}:destination:, 1 invalid schema since ${since}:time:`
          : $localize`${label}:destination:, ${count}:count: invalid schemas since ${since}:time:`;
      return { name, badge: null };
    }
    return null;
  }

  /** O ⋮ da barra do celular: o que a barra do topo e o cabeçalho da URL deixam de mostrar. */
  protected readonly topActions = computed<MenuItem[]>(() => {
    const token = this.tokens.token();
    const open = !this.locked() && !this.missing();
    const url: MenuItem[] =
      token && open
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
      token && open
        ? [
            {
              label: $localize`Edit URL`,
              icon: 'settings',
              action: () => void this.router.navigate(['/', token.uuid, 'checks']),
            },
            {
              label: $localize`Open in new tab`,
              icon: 'outbound',
              href: this.tokens.webhookUrl(),
            },
            {
              label: $localize`Copy CLI command`,
              icon: 'copy',
              action: () => this.copyCli(),
            },
            {
              label: $localize`Guides`,
              icon: 'help',
              items: [
                {
                  label: $localize`First webhook`,
                  action: () => this.openGuide(token.uuid, 'first'),
                },
                {
                  label: $localize`Test a retry`,
                  action: () => this.openGuide(token.uuid, 'retry'),
                },
              ],
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

  private openGuide(tokenId: string, guide: 'first' | 'retry'): void {
    void this.router.navigate(['/', tokenId], { queryParams: { guide } });
  }

  /**
   * "Search requests": na Entrada, mostra a busca da lista (com o foco nela) ou a recolhe; fora
   * dela, leva à Entrada com o foco na busca.
   */
  protected toggleSearch(): void {
    if (this.current()?.path !== null) {
      this.openSearch();
    } else if (this.screen.searchOpen()) {
      this.screen.searchOpen.set(false);
    } else {
      this.openSearch();
    }
  }

  /** Põe o foco na busca da lista; fora da Entrada, vai a ela antes. */
  private openSearch(): void {
    const token = this.tokens.token();
    if (this.current()?.path !== null && token && !this.locked() && !this.missing()) {
      void this.router.navigate(['/', token.uuid]).then(() => this.focusSearchWhenReady());
      return;
    }
    this.screen.searchOpen.set(true);
    afterNextRender(() => this.focusSearch(), { injector: this.injector });
  }

  /** A busca só existe com a lista carregada: espera por ela (até 3 s, ou até o shell sair). */
  private focusSearchWhenReady(left = 60): void {
    this.screen.searchOpen.set(true);
    if (!this.focusSearch() && left > 0) {
      this.searchWait = setTimeout(() => this.focusSearchWhenReady(left - 1), 50);
    }
  }

  /** Copia no clique; o aviso vem com o chunk de `TokenActions`. */
  private copyCli(): void {
    if (this.copyCliCommand()) {
      void this.withActions((actions) => actions.cliCommandCopied());
    }
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
    if (destination && token && !this.locked() && !this.missing()) {
      void this.router.navigate(this.link(destination, token.uuid));
    }
  }

  private focusSearch(): boolean {
    const box = this.document.querySelector<HTMLInputElement>('[role="search"] input');
    box?.focus();
    return !!box;
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
