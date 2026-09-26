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

/** `/{tokenId}/{tab}`: aba da URL aberta (regras, histórico de saída). */
function tabMatcher(tab: string) {
  return (segments: UrlSegment[]): UrlMatchResult | null => {
    const [token, name] = segments;
    if (segments.length !== 2 || !UUID.test(token.path) || name.path !== tab) {
      return null;
    }
    return { consumed: segments, posParams: { tokenId: token } };
  };
}

/** `/{tokenId}/rules`: aba de regras de resposta da URL. */
export const rulesMatcher = tabMatcher('rules');

/** `/{tokenId}/outbound`: aba com o histórico de replay e send da URL. */
export const outboundMatcher = tabMatcher('outbound');

export const routes: Routes = [
  // Carregadas sob demanda: as abas de regras e de saída não pesam na carga inicial.
  {
    matcher: rulesMatcher,
    loadComponent: () => import('./rules/rules-page').then((m) => m.RulesPage),
  },
  {
    matcher: outboundMatcher,
    loadComponent: () => import('./outbound/outbound-page').then((m) => m.OutboundPage),
  },
  { matcher: inboxMatcher, loadComponent: () => import('./inbox/inbox').then((m) => m.Inbox) },
  // Link só-leitura de uma mensagem: público, sem o segredo da URL.
  {
    path: 'share/:shareId',
    loadComponent: () => import('./share/share-page').then((m) => m.SharePage),
  },
  { path: '**', redirectTo: '' },
];
