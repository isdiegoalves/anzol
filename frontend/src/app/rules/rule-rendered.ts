import { Component, ElementRef, computed, inject, input, linkedSignal } from '@angular/core';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { RenderedResponse } from './rule';
import { examplePath } from './rule-example';

/**
 * "Rendered responses" (C4, E-05): o que a regra, como está no editor, responderia a até 3 das
 * mensagens que ela casa — uma aba por mensagem ("{method} {path} · {time}") com status,
 * cabeçalhos e corpo; "Fault: {type}" e "Timed out (1 s)" nas que não renderizam. Carregado sob
 * demanda pelo editor, só quando o dono pede ("Preview response").
 */
@Component({
  selector: 'app-rule-rendered',
  templateUrl: './rule-rendered.html',
  styleUrl: './rule-rendered.scss',
})
export class RuleRendered {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly responses = input.required<readonly RenderedResponse[]>();
  /** As mensagens recentes, para o nome de cada aba. */
  readonly requests = input<ReadonlyMap<string, WebhookRequest>>(new Map());

  /** A aba aberta: a primeira, até o dono escolher outra (volta à primeira com respostas novas). */
  protected readonly current = linkedSignal(() => this.responses()[0]?.uuid ?? null);
  protected readonly selected = computed(
    () => this.responses().find(({ uuid }) => uuid === this.current()) ?? null,
  );

  protected tabLabel(uuid: string): string {
    const request = this.requests().get(uuid);
    return request
      ? `${request.method} ${examplePath(request)} · ${fromNow(request.created_at)}`
      : `#${uuid.substring(0, 5)}`;
  }

  protected headers(response: RenderedResponse): [string, string][] {
    return Object.entries(response.headers ?? {});
  }

  /** Setas, Home e End trocam de aba (padrão de abas da ARIA). */
  protected moveTab(event: KeyboardEvent, uuid: string): void {
    const ids = this.responses().map((response) => response.uuid);
    const index = ids.indexOf(uuid);
    const next: Record<string, number> = {
      ArrowRight: (index + 1) % ids.length,
      ArrowLeft: (index - 1 + ids.length) % ids.length,
      Home: 0,
      End: ids.length - 1,
    };
    if (!(event.key in next)) {
      return;
    }
    event.preventDefault();
    const target = ids[next[event.key]];
    this.current.set(target);
    this.host.querySelector<HTMLElement>(`[data-tab="${CSS.escape(target)}"]`)?.focus();
  }
}
