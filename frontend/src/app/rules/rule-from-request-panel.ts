import { Component, computed, input, output, signal } from '@angular/core';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { ExampleField, exampleFields, examplePath } from './rule-example';

let nextPanelId = 0;

/**
 * "From this request" (WM-16): os cabeçalhos, a query e os campos do corpo da mensagem de exemplo,
 * cada um um botão "Use {path}: {value}". Na aba Match o editor cria a condição; na Response,
 * insere o helper do campo no corpo. Sem mensagem, pede uma de teste.
 */
@Component({
  selector: 'app-rule-from-request-panel',
  templateUrl: './rule-from-request-panel.html',
  styleUrl: './rule-from-request-panel.scss',
})
export class RuleFromRequestPanel {
  readonly request = input<WebhookRequest | null>(null);
  readonly picked = output<ExampleField>();

  protected readonly titleId = `from-request-title-${nextPanelId++}`;
  protected readonly filter = signal('');
  private readonly fields = computed(() => {
    const request = this.request();
    return request ? exampleFields(request) : [];
  });
  /** Os campos que o filtro deixa (pelo caminho ou pelo valor), por grupo. */
  protected readonly groups = computed(() => {
    const wanted = this.filter().trim().toLowerCase();
    const shown = this.fields().filter(
      ({ path, display }) =>
        !wanted || path.toLowerCase().includes(wanted) || display.toLowerCase().includes(wanted),
    );
    const titles = { header: $localize`Headers`, query: $localize`Query`, body: $localize`Body` };
    return (['header', 'query', 'body'] as const)
      .map((kind) => ({ kind, title: titles[kind], fields: shown.filter((f) => f.kind === kind) }))
      .filter(({ fields }) => fields.length > 0);
  });
  protected readonly origin = computed(() => {
    const request = this.request();
    return request
      ? `${request.method} ${examplePath(request)} · ${fromNow(request.created_at)}`
      : '';
  });

  protected filterFields(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  protected useLabel(field: ExampleField): string {
    return $localize`Use ${field.path}:path:: ${field.display}:value:`;
  }
}
