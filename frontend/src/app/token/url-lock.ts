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
  private readonly why = signal<string | null>(null);
  /**
   * Frase que a tela de desbloqueio mostra quando foi a própria tela que trancou (Verificações
   * salvou um segredo novo e não conseguiu destrancar com ele); `null` no 401 comum.
   */
  readonly notice = this.why.asReadonly();

  lock(tokenId: string, notice: string | null = null): void {
    clearUrlDrafts(tokenId);
    this.why.set(notice);
    this.locked.set(tokenId);
  }

  release(): void {
    this.locked.set(null);
    this.why.set(null);
  }
}

/** Prefixo dos rascunhos de uma URL na `sessionStorage` (regras em edição, E-04). */
function draftPrefix(tokenId: string): string {
  return `draft:${tokenId}:`;
}

/** Chave de um rascunho da URL; trancar a URL apaga todos eles. */
export function urlDraftKey(tokenId: string, name: string): string {
  return `${draftPrefix(tokenId)}${name}`;
}

/**
 * Trancar a URL leva junto o que se escreveu nela e não foi salvo: os rascunhos das regras e o de
 * Verificações (`anzol.checksDraft.{uuid}`, guia da combinação §4.1).
 */
function clearUrlDrafts(tokenId: string): void {
  try {
    const prefixes = [draftPrefix(tokenId), `anzol.checksDraft.${tokenId}`];
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    keys
      .filter((key) => prefixes.some((prefix) => key?.startsWith(prefix)))
      .forEach((key) => sessionStorage.removeItem(key ?? ''));
  } catch {
    // Sem storage, sem rascunhos.
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
