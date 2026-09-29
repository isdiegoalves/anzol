import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';

export interface MissingUrl {
  id: string;
  reason: 'gone' | 'malformed';
}

/**
 * URL que não existe: o shell mostra a página única de URL inexistente em qualquer destino, e
 * nenhuma tela cria outra URL no lugar.
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

  clear(id?: string): void {
    if (id === undefined || this.state()?.id === id) {
      this.state.set(null);
    }
  }
}

const TOKEN_CALL = /^\/token\/([^/?]+)([/?].*)?$/;

/**
 * 410 vale em qualquer rota da URL; 404 só no próprio `/token/{id}`, porque embaixo dele é a
 * requisição que sumiu. DELETE não conta: quem apaga já sabe.
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
