import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompareStore } from '../diff/compare-store';
import { explainOutcome } from '../diff/outcome';
import { RequestCompare } from '../diff/request-compare';
import { EventGrouping } from '../requests/event-grouping';
import { WebhookRequest } from '../requests/webhook-request';
import { Icon } from '../ui/icon';
import { LiveRegion } from '../ui/live-region';
import { ACTION_TABS, ActionPanelStore, ActionTab, PANEL_MIN_PX } from './action-panel-store';
import { ReplayPanel } from './replay-panel';

let nextId = 0;
const RESIZE_STEP_PX = 40;
/** O tempo para o leitor de tela conhecer a região viva vazia (o mesmo do `LiveAnnouncer` do CDK). */
const REGION_READY_MS = 100;

/**
 * Replay, Compare, Create rule e Explain na base da coluna do detalhe, que continua à vista acima.
 * Abaixo de 840 px (`sheet`), é uma folha de tela cheia, modal.
 */
@Component({
  selector: 'app-action-panel',
  imports: [CdkTrapFocus, Icon, LiveRegion, ReplayPanel, RequestCompare, RouterLink],
  templateUrl: './action-panel.html',
  styleUrl: './action-panel.scss',
  host: {
    '[class.sheet]': 'sheet()',
    '[class.expanded]': 'store.expanded()',
    '[style.height]': 'sheet() ? null : height()',
    '(keydown.escape)': 'escape($event)',
  },
})
export class ActionPanel {
  protected readonly store = inject(ActionPanelStore);
  protected readonly compare = inject(CompareStore);
  private readonly grouping = inject(EventGrouping);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly request = input.required<WebhookRequest>();
  readonly sheet = input(false);

  private readonly id = nextId++;
  protected readonly panelId = `action-panel-${this.id}`;
  protected readonly tabId = (tab: ActionTab) => `action-tab-${this.id}-${tab}`;
  protected readonly tabs: readonly { id: ActionTab; label: string }[] = [
    { id: 'replay', label: $localize`:action|Aba do painel de ação:Replay` },
    { id: 'compare', label: $localize`:action panel tab:Compare` },
    { id: 'rule', label: $localize`:action panel tab:Create rule` },
    { id: 'explain', label: $localize`:action panel tab:Explain` },
  ];
  protected readonly measured = signal(0);
  protected readonly height = computed(() => {
    if (this.store.expanded()) {
      return '100%';
    }
    const chosen = this.store.height();
    return chosen === null ? '40%' : `${chosen}px`;
  });
  protected readonly id5 = computed(() => this.request().uuid.slice(0, 5));
  private readonly explainAsked = computed(() => this.store.explainFor() === this.request().uuid);

  protected readonly pair = this.compare.inPanel;

  private readonly ruleHost = viewChild('ruleHost', { read: ViewContainerRef });
  private readonly explainHost = viewChild('explainHost', { read: ViewContainerRef });

  constructor() {
    effect(() => {
      const [tab, request] = [this.store.tab(), this.request()];
      untracked(() => {
        if (tab !== 'compare') {
          if (this.compare.picking()) {
            this.compare.close();
          }
          return;
        }
        const pair = this.pair();
        if (pair && (pair.a.uuid === request.uuid || pair.b.uuid === request.uuid)) {
          return;
        }
        const attempts = this.grouping.attemptsOf(request);
        const index = attempts?.findIndex((attempt) => attempt.uuid === request.uuid) ?? -1;
        if (attempts && index > 0) {
          this.compare.showInPanel(attempts[index - 1], request);
        } else {
          this.compare.start(request, 'panel');
        }
      });
    });
    let wasPicking = false;
    effect(() => {
      const picking = this.compare.picking() !== null;
      if (wasPicking && !picking && this.store.tab() === 'compare' && !this.pair()) {
        untracked(() => this.store.close());
      }
      wasPicking = picking;
    });
    // Um anúncio por par: o efeito roda de novo quando a requisição aberta muda. O painel pode nascer
    // já comparando, e a região viva que nasce com texto não fala: o texto entra depois dela.
    let said = '';
    let saying: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const pair = this.pair();
      if (!pair) {
        return;
      }
      const key = `${pair.a.uuid}/${pair.b.uuid}`;
      if (key === said) {
        return;
      }
      said = key;
      const causes = explainOutcome(pair.a, pair.b).causes.length;
      const [a, b] = [pair.a.uuid.slice(0, 5), pair.b.uuid.slice(0, 5)];
      const text =
        causes === 1
          ? $localize`Compared #${a}:a: with #${b}:b:. 1 change explains the outcome.`
          : $localize`Compared #${a}:a: with #${b}:b:. ${causes}:count: changes explain the outcome.`;
      clearTimeout(saying);
      saying = setTimeout(() => this.store.result.set(text), REGION_READY_MS);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(saying));
    effect((onCleanup) => {
      const [host, request] = [this.ruleHost(), this.request()];
      if (!host) {
        return;
      }
      let gone = false;
      onCleanup(() => {
        gone = true;
        host.clear();
      });
      void import('../rules/rule-actions').then(({ embedCreateRule }) => {
        if (!gone) {
          embedCreateRule(
            host,
            this.injector,
            request,
            ({ name, count }) =>
              this.store.result.set(
                count === null
                  ? $localize`Rule created: ${name}:name:.`
                  : $localize`Rule created: ${name}:name:. It answers ${count}:count: of the last 500.`,
              ),
            () => this.store.close(),
          );
        }
      });
    });
    effect((onCleanup) => {
      const [host, request, ask] = [this.explainHost(), this.request(), this.explainAsked()];
      if (!host) {
        return;
      }
      let gone = false;
      onCleanup(() => {
        gone = true;
        host.clear();
      });
      void import('./explain-panel').then(({ ExplainPanel }) => {
        if (!gone) {
          const panel = host.createComponent(ExplainPanel);
          panel.setInput('tokenId', request.token_id);
          panel.setInput('requestId', request.uuid);
          panel.setInput('ask', ask);
        }
      });
    });
    effect(() => {
      if (this.store.focusInside() > 0) {
        untracked(() =>
          setTimeout(() => {
            const target =
              this.host.querySelector<HTMLElement>('[aria-label="Target URL"]') ??
              this.host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
            target?.focus();
          }),
        );
      }
    });
    afterRenderEffect({
      read: () => {
        this.height();
        this.measured.set(Math.round(this.host.getBoundingClientRect().height));
      },
    });
  }

  protected select(tab: ActionTab): void {
    this.store.show(tab);
  }

  protected moveTab(event: KeyboardEvent): void {
    const at = ACTION_TABS.indexOf(this.store.tab());
    const last = ACTION_TABS.length - 1;
    const to: Record<string, number> = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in to)) {
      return;
    }
    event.preventDefault();
    const next = ACTION_TABS[to[event.key]];
    this.store.show(next);
    setTimeout(() => this.host.querySelector<HTMLElement>(`#${this.tabId(next)}`)?.focus());
  }

  protected resizeByKey(event: KeyboardEvent): void {
    const step = { ArrowUp: RESIZE_STEP_PX, ArrowDown: -RESIZE_STEP_PX }[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    this.store.expanded.set(false);
    this.store.resize(this.host.getBoundingClientRect().height + step);
  }

  protected startDrag(event: PointerEvent): void {
    const [startY, startHeight] = [event.clientY, this.measured()];
    const move = (moved: PointerEvent) => {
      this.store.expanded.set(false);
      this.store.resize(startHeight + (startY - moved.clientY));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  protected escape(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    this.store.close();
  }

  protected readonly minHeight = PANEL_MIN_PX;
  protected readonly regionName = $localize`Action panel`;
  protected readonly sheetName = $localize`Actions on this request`;
}
