import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';

/**
 * URL protegida sem acesso neste navegador: a tela troca o conteúdo pela tela de desbloqueio.
 * Quem marca é o `urlLockInterceptor`, com o primeiro 401 `{"protected": true}` da URL.
 */
@Injectable({ providedIn: 'root' })
export class UrlLock {
  private readonly locked = signal<string | null>(null);
  /** Token cujo acesso foi recusado; `null` quando nada está trancado. */
  readonly tokenId = this.locked.asReadonly();

  lock(tokenId: string): void {
    this.locked.set(tokenId);
  }

  release(): void {
    this.locked.set(null);
  }
}

/** `/token/{id}` e as rotas embaixo dele, menos `unlock` e `lock`, que respondem por si. */
const MANAGED = /^\/token\/([^/?]+)(?:$|[/?])(?!(?:un)?lock(?:[/?]|$))/;

/** Qualquer chamada da URL recusada por falta do segredo tranca a tela nessa URL. */
export const urlLockInterceptor: HttpInterceptorFn = (request, next) => {
  const tokenId = MANAGED.exec(request.url)?.[1];
  if (!tokenId) {
    return next(request);
  }
  const lock = inject(UrlLock);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (isProtectedError(error)) {
          lock.lock(tokenId);
        }
      },
    }),
  );
};

/** O 401 da URL protegida: `{"error": "This URL is protected", "protected": true}`. */
export function isProtectedError(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 401 &&
    (error.error as { protected?: unknown } | null)?.protected === true
  );
}
