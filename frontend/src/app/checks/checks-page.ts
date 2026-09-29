import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { fromNow } from '../request-detail/dates';
import { Viewport } from '../shell/viewport';
import { SIGNATURE_PROVIDER_LABELS, Token } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { ChangesBar } from './changes-bar';
import { ChecksDraft, SectionId, StoredDraft, changeText } from './checks-draft';
import { HealthCard } from './health-card';
import { PrivacyCard } from './privacy-card';
import { ResponseCard } from './response-card';
import { SchemaCard } from './schema-card';
import { SignatureCard } from './signature-card';

/**
 * Seções da página, na ordem do "On this page" (`?section=`) e dos cartões. Função, e não constante
 * do módulo, para o `$localize` rodar depois de a tradução carregar.
 */
export function checksSections() {
  return [
    {
      id: 'signature',
      label: $localize`Signature`,
      title: $localize`Signature verification`,
      icon: 'checks',
    },
    {
      id: 'schema',
      label: $localize`Schema`,
      title: $localize`Schema validation`,
      icon: 'braces',
    },
    { id: 'response', label: $localize`Response`, title: $localize`Response`, icon: 'reply' },
    { id: 'privacy', label: $localize`Privacy`, title: $localize`Privacy`, icon: 'lock' },
    { id: 'health', label: $localize`Health`, title: $localize`Health`, icon: 'activity' },
  ] as const;
}

type Section = ReturnType<typeof checksSections>[number];
type PageSection = Section['id'];

interface SectionState {
  shown: string;
  spoken: string;
}

/**
 * Checks (`#/{token}/checks`): o que a URL confere em cada mensagem e como responde.
 * `?section=` rola até o cartão; `?schema-from={requestId}` ("Create schema from this request")
 * abre o Schema com o schema inferido daquela mensagem. Os cartões só montam depois de a URL vir
 * do servidor (a do localStorage pode estar velha).
 */
@Component({
  selector: 'app-checks-page',
  imports: [
    Icon,
    MatButton,
    NgTemplateOutlet,
    RouterLink,
    ChangesBar,
    SignatureCard,
    SchemaCard,
    ResponseCard,
    PrivacyCard,
    HealthCard,
  ],
  templateUrl: './checks-page.html',
  styleUrl: './checks-page.scss',
  host: {
    '(document:keydown)': 'saveByKey($event)',
    '(window:beforeunload)': 'warnBeforeUnload($event)',
    '(focusin)': 'uncover($event.target)',
  },
})
export class ChecksPage {
  protected readonly tokens = inject(TokenStore);
  protected readonly draft = inject(ChecksDraft);
  private readonly viewport = inject(Viewport);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  protected readonly sections = checksSections();
  protected readonly section = computed(() => this.query()?.get('section') ?? null);
  protected readonly schemaFrom = computed(() => this.query()?.get('schema-from') ?? null);
  /** URL carregada do servidor para esta rota; `null` enquanto carrega. */
  private readonly loaded = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly ready = computed(
    () => this.loaded() === this.tokenId() && this.tokens.token()?.uuid === this.tokenId(),
  );

  protected readonly folding = computed(() =>
    ['compact', 'medium'].includes(this.viewport.windowClass()),
  );
  private readonly chosen = signal<Partial<Record<PageSection, boolean>>>({});
  private readonly inView = signal<PageSection | null>(null);
  protected readonly current = computed(
    () => this.inView() ?? this.target() ?? this.sections[0].id,
  );
  private readonly target = computed((): PageSection | null => {
    const wanted = this.schemaFrom() ? 'schema' : this.section();
    return this.sections.find(({ id }) => id === wanted)?.id ?? null;
  });

  protected readonly states = computed(() => statesOf(this.tokens.token()));

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => this.load(tokenId));
    });

    afterRenderEffect(() => {
      const target = this.target();
      if (this.ready() && target) {
        this.host.nativeElement
          .querySelector(`#checks-${target}`)
          ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      }
    });
    this.watchSections();
    // A barra surge com a primeira alteração e pode cobrir o campo em foco.
    afterRenderEffect(() => {
      if (this.draft.dirty()) {
        this.uncover(document.activeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => this.draft.flush());
  }

  /** "Save and leave" com campo inválido fica na página, como "Save changes". */
  async canLeave(): Promise<boolean> {
    if (!this.draft.dirty()) {
      return true;
    }
    const { askToLeave } = await import('./leave-dialog');
    const choice = await askToLeave(this.injector, this.draft.changes().map(changeText));
    if (choice === 'discard') {
      this.draft.discard(true);
      return true;
    }
    return choice === 'save' ? this.draft.save() : false;
  }

  protected load(tokenId: string): void {
    this.loaded.set(null);
    this.failed.set(false);
    // 401 de URL protegida tranca a tela pelo interceptor; o resto vira o estado de erro.
    this.tokens
      .load(tokenId)
      .then((token) => {
        this.draft.start(token);
        this.loaded.set(tokenId);
      })
      .catch(() => this.failed.set(true));
  }

  protected stateOf(id: PageSection): SectionState | null {
    return this.states()[id] ?? null;
  }

  protected unsaved(id: PageSection): boolean {
    return this.draft.dirtySections().includes(id as SectionId);
  }

  protected linkName(item: Section): string {
    const state = this.stateOf(item.id);
    const parts = [item.label, ...(state ? [state.spoken] : [])];
    return [...parts, ...(this.unsaved(item.id) ? [$localize`unsaved`] : [])].join(', ');
  }

  protected foldName(item: Section): string {
    const state = this.stateOf(item.id);
    return state ? `${item.title}, ${state.spoken}` : item.title;
  }

  protected isOpen(id: PageSection): boolean {
    if (!this.folding()) {
      return true;
    }
    if (this.unsaved(id) || this.draft.invalidSections().includes(id as SectionId)) {
      return true;
    }
    return this.chosen()[id] ?? id === (this.target() ?? this.sections[0].id);
  }

  protected toggle(id: PageSection): void {
    this.chosen.update((chosen) => ({ ...chosen, [id]: !this.isOpen(id) }));
  }

  protected draftAge(draft: StoredDraft): string {
    return fromNow(new Date(draft.savedAt).toISOString().slice(0, 19).replace('T', ' '));
  }

  protected saveByKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      if (document.querySelector('mat-dialog-container')) {
        return;
      }
      event.preventDefault();
      if (this.draft.dirty()) {
        void this.draft.save();
      }
    }
  }

  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.draft.dirty()) {
      event.preventDefault();
    }
  }

  /**
   * O navegador só rola até o campo com foco quando ele está fora da tela; o que a barra ou o
   * índice fixos cobrem, rola aqui (WCAG 2.4.11).
   */
  protected uncover(target: EventTarget | null): void {
    const page = this.host.nativeElement;
    const cards = page.querySelector('.cards');
    if (!(target instanceof HTMLElement) || !cards?.contains(target)) {
      return;
    }
    const field = target.getBoundingClientRect();
    const bar = page.querySelector('app-changes-bar.shown .bar')?.getBoundingClientRect();
    const index = page.querySelector('.jump')?.getBoundingClientRect();
    const below = bar ? field.bottom + COVER_GAP - bar.top : 0;
    // O índice só cobre os cartões quando é faixa no topo; à esquerda da coluna, não.
    const above = index && index.right > field.left ? index.bottom + COVER_GAP - field.top : 0;
    if (below > 0) {
      scrollerOf(page).scrollBy({ top: below });
    } else if (above > 0 && index && field.top < index.bottom + field.height) {
      scrollerOf(page).scrollBy({ top: -above });
    }
  }

  private watchSections(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target.id);
        } else {
          visible.delete(entry.target.id);
        }
      }
      const target = this.target();
      const first =
        target && visible.has(`checks-${target}`)
          ? target
          : this.sections.find(({ id }) => visible.has(`checks-${id}`))?.id;
      this.inView.set(first ?? null);
    });
    afterRenderEffect(() => {
      if (this.ready()) {
        observer.disconnect();
        visible.clear();
        this.host.nativeElement.querySelectorAll('.slot').forEach((slot) => observer.observe(slot));
      }
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}

const COVER_GAP = 12;

function scrollerOf(element: HTMLElement): Element | Window {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (/auto|scroll/.test(overflow) && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return window;
}

function statesOf(token: Token | null): Partial<Record<PageSection, SectionState>> {
  if (!token) {
    return {};
  }
  const same = (text: string): SectionState => ({ shown: text, spoken: text });
  const dialect = dialectOf(token);
  return {
    signature: same(
      token.signature ? SIGNATURE_PROVIDER_LABELS[token.signature.provider] : $localize`Off`,
    ),
    schema: token.schema
      ? {
          shown: dialect ? $localize`On · ${dialect}:dialect:` : $localize`On`,
          spoken: $localize`on`,
        }
      : { shown: $localize`Off`, spoken: $localize`off` },
    response: same(String(token.default_status)),
    privacy: token.protected
      ? { shown: $localize`Protected`, spoken: $localize`protected` }
      : { shown: $localize`Open`, spoken: $localize`open` },
  };
}

function dialectOf(token: Token): string | null {
  const declared = token.schema?.['$schema'];
  if (typeof declared !== 'string') {
    return null;
  }
  return /draft\/(\d{4}-\d{2})\//.exec(declared)?.[1] ?? /(draft-0\d)/.exec(declared)?.[1] ?? null;
}
