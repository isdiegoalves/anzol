import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';

const UUID = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;
const PAGE = /^\d+$/;

/**
 * `/`, `/{tokenId}` e `/{tokenId}/{requestId}/{page}` (os estados do app atual) casam numa rota
 * só, para o componente ser reaproveitado ao abrir outra mensagem em vez de recarregar a lista.
 */
export function inboxMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [token, request, page] = segments.map((segment) => segment.path);
  const valid =
    segments.length === 0 ||
    (segments.length === 1 && UUID.test(token)) ||
    (segments.length === 3 && UUID.test(token) && UUID.test(request) && PAGE.test(page));
  if (!valid) {
    return null;
  }
  const [tokenId, requestId, pageParam] = segments;
  return {
    consumed: segments,
    posParams: {
      ...(tokenId && { tokenId }),
      ...(requestId && { requestId }),
      ...(pageParam && { page: pageParam }),
    },
  };
}

export const routes: Routes = [
  { matcher: inboxMatcher, loadComponent: () => import('./inbox/inbox').then((m) => m.Inbox) },
  { path: '**', redirectTo: '' },
];
