import { Component, computed, input } from '@angular/core';
import { KvRow, KvTable } from '../ui/kv-table';
import { MethodBadge } from '../ui/method-badge';
import { StatusCode } from '../ui/status-code';
import { OutboundResult, headerEntries, outboundErrorText } from './outbound';

/**
 * Resultado de um replay ou send: alvo efetivo, status e tempo, headers recebidos e o corpo da
 * resposta (com aviso quando o corpo veio cortado), ou o erro de saída em texto claro; e sempre os
 * headers enviados. `typedUrl` avisa quando o servidor trocou o host (`localhost`).
 */
@Component({
  selector: 'app-outbound-result-view',
  imports: [KvTable, MethodBadge, StatusCode],
  templateUrl: './outbound-result-view.html',
  styleUrl: './outbound-result-view.scss',
})
export class OutboundResultView {
  readonly result = input.required<OutboundResult>();
  /** URL digitada no compositor: se o servidor trocou o host, o aviso diz para onde foi. */
  readonly typedUrl = input<string>();

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
