import { Component, computed, input } from '@angular/core';

/** Frase padrão dos status mais comuns (a do protocolo, em inglês); o resto mostra só o número. */
const REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** A frase do protocolo de um status comum ("Too Many Requests"), em inglês; `null` para os outros. */
export function reasonPhrase(status: number): string | null {
  return REASONS[status] ?? null;
}

/**
 * Status HTTP de uma resposta (regra, resposta padrão, destino do Outbound), pela família: 2xx
 * sucesso, 3xx neutro, 4xx aviso, 5xx erro. Sem status (a conexão falhou), mostra o erro.
 */
@Component({
  selector: 'app-status-code',
  template: `
    @if (status(); as code) {
      <span class="code">{{ code }}</span>
      @if (reason()) {
        <!-- O espaço dentro do texto separa o número da frase para o leitor de tela. -->
        <span class="reason"> {{ reason() }}</span>
      }
    } @else {
      <span class="reason">{{ error() ?? noResponse }}</span>
    }
  `,
  styleUrl: './status-code.scss',
  host: { '[class]': '"status " + family()' },
})
export class StatusCode {
  readonly status = input<number | null>(null);
  /** Erro de saída quando não houve status ("Timed out", "Connection failed"). */
  readonly error = input<string | null>(null);

  protected readonly noResponse = $localize`No response`;

  protected readonly family = computed(() => {
    const status = this.status();
    return status === null ? 'failed' : `s${Math.floor(status / 100)}`;
  });

  protected readonly reason = computed(() => {
    const status = this.status();
    return status === null ? null : reasonPhrase(status);
  });
}
