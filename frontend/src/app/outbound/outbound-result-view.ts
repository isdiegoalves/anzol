import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { localDate } from '../request-detail/dates';
import { Icon } from '../ui/icon';
import { KvRow, KvTable } from '../ui/kv-table';
import { MethodBadge } from '../ui/method-badge';
import { OutboundResult, apiDate, headerEntries, outboundErrorText } from './outbound';

/** Abas do resultado (OUTBOUND-09). */
type Tab = 'body' | 'response' | 'sent';
const TABS: readonly Tab[] = ['body', 'response', 'sent'];

/**
 * Resultado de um replay ou send (C §2.7, OUTBOUND-08/09): o status em destaque (ou o erro de
 * saída), o tempo, o tipo com o `#id` da mensagem de origem e a data; "Run again" e "Copy as curl";
 * o alvo efetivo; e as abas "Response body", "Response headers (n)" e "Sent headers (n)". Com erro
 * de saída não há resposta: o alerta e os headers enviados. `typedUrl` avisa quando o servidor
 * trocou o host (`localhost`).
 */
@Component({
  selector: 'app-outbound-result-view',
  imports: [Icon, KvTable, MatButton, MethodBadge],
  templateUrl: './outbound-result-view.html',
  styleUrl: './outbound-result-view.scss',
})
export class OutboundResultView {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly result = input.required<OutboundResult>();
  /** URL digitada no compositor: se o servidor trocou o host, o aviso diz para onde foi. */
  readonly typedUrl = input<string>();
  /** Dá para repetir (replay com a origem, ou send feito nesta tela). */
  readonly repeatable = input(false);
  readonly runAgain = output<void>();
  readonly copyCurl = output<void>();

  protected readonly tab = signal<Tab>('body');
  protected readonly error = computed(() => {
    const error = this.result().error;
    return error ? outboundErrorText(error) : null;
  });
  protected readonly requestHeaders = computed(() => rows(this.result().request_headers));
  protected readonly responseHeaders = computed(() => rows(this.result().headers));
  protected readonly redirectedHost = computed(() => {
    const typed = this.typedUrl();
    return typed ? changedHost(typed, this.result().target) : null;
  });
  /** Família do status (`s2`…`s5`) para a cor do número grande. */
  protected readonly family = computed(() => {
    const status = this.result().status;
    return status ? `s${Math.floor(status / 100)}` : 'failed';
  });
  protected readonly date = computed(() => localDate(apiDate(this.result().at)));

  protected chooseTab(tab: Tab): void {
    this.tab.set(tab);
  }

  /** Setas, Home e End no `tablist`: movem a aba escolhida e o foco (roving tabindex). */
  protected moveTab(event: KeyboardEvent): void {
    const index = TABS.indexOf(this.tab());
    const next: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index + TABS.length - 1) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    if (event.key in next) {
      event.preventDefault();
      const tab = TABS[next[event.key]];
      this.tab.set(tab);
      this.host.nativeElement.querySelector<HTMLElement>(`#outbound-tab-${tab}`)?.focus();
    }
  }
}

function rows(headers: OutboundResult['headers']): KvRow[] {
  return headerEntries(headers).map(([name, value]) => ({ name, value }));
}

/** Host efetivo (`host.docker.internal:3000`) quando difere do digitado; `null` se é o mesmo. */
export function changedHost(typed: string, target: string): string | null {
  try {
    const [from, to] = [new URL(typed), new URL(target)];
    return from.host === to.host ? null : to.host;
  } catch {
    return null;
  }
}
