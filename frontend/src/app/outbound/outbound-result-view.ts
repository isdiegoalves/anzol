import { Component, computed, input } from '@angular/core';
import { MethodLabel } from '../requests/method-label';
import { OutboundResult, headerEntries, outboundErrorText } from './outbound';

/**
 * Resultado de um replay ou send: alvo efetivo, status e tempo, headers e corpo da resposta
 * (com aviso quando o corpo veio cortado), ou o erro de saída em texto claro. `sentHeaders`
 * mostra também os headers enviados (detalhe do histórico).
 */
@Component({
  selector: 'app-outbound-result-view',
  imports: [MethodLabel],
  templateUrl: './outbound-result-view.html',
  styleUrl: './outbound-result-view.scss',
})
export class OutboundResultView {
  readonly result = input.required<OutboundResult>();
  readonly sentHeaders = input(false);
  /** URL digitada no diálogo: se o servidor trocou o host (`localhost`), o aviso diz para onde foi. */
  readonly typedUrl = input<string>();

  protected readonly error = computed(() => {
    const error = this.result().error;
    return error ? outboundErrorText(error) : null;
  });
  /** Classe da cor do status: `s2`, `s3`, `s4`, `s5`. */
  protected readonly statusClass = computed(() => Math.floor((this.result().status ?? 0) / 100));
  protected readonly requestHeaders = computed(() => headerEntries(this.result().request_headers));
  protected readonly responseHeaders = computed(() => headerEntries(this.result().headers));
  protected readonly redirectedHost = computed(() => {
    const typed = this.typedUrl();
    return typed ? changedHost(typed, this.result().target) : null;
  });
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
