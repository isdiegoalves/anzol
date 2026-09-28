import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';

/** O que o endereço pedia: uma URL que não existe mais, ou um endereço que não é id de URL. */
export interface MissingUrl {
  /** O que veio no endereço (o UUID apagado, ou o texto malformado). */
  id: string;
  reason: 'gone' | 'malformed';
}

/**
 * URL que não existe (B1): o shell troca a página do destino pela página única de URL inexistente,
 * em qualquer destino, e nenhuma tela cria outra URL no lugar. Quem marca é o
 * `urlMissingInterceptor`, com o primeiro 410 (ou 404 do próprio `GET /token/{id}`) da URL; o
 * endereço malformado vem da rota.
 */
@Injectable({ providedIn: 'root' })
export class UrlMissing {
  private readonly state = signal<MissingUrl | null>(null);
  readonly missing = this.state.asReadonly();

  mark(id: string, reason: MissingUrl['reason'] = 'gone'): void {
    const current = this.state();
    if (current?.id !== id || current.reason !== reason) {
      this.state.set({ id, reason });
    }
  }

  /** Outra URL abriu (ou esta voltou a existir). */
  clear(id?: string): void {
    if (id === undefined || this.state()?.id === id) {
      this.state.set(null);
    }
  }
}

/** `/token/{id}` e o que vem embaixo dele. */
const TOKEN_CALL = /^\/token\/([^/?]+)([/?].*)?$/;

/**
 * O servidor responde 410 em toda rota de uma URL que não existe; o 404 embaixo dela é de outra
 * coisa (a requisição que sumiu), então só vale no próprio `/token/{id}`. Apagar a URL não conta:
 * quem apaga já sabe.
 */
export const urlMissingInterceptor: HttpInterceptorFn = (request, next) => {
  const [, tokenId, rest] = TOKEN_CALL.exec(request.url) ?? [];
  if (!tokenId || request.method === 'DELETE') {
    return next(request);
  }
  const missing = inject(UrlMissing);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        if (status === 410 || (status === 404 && !rest)) {
          missing.mark(tokenId);
        }
      },
    }),
  );
};
