import { CanDeactivateFn, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { CATALOG_ROUTES } from './catalog/catalog-routes';

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

/** `/{tokenId}/{tab}`: um destino da URL aberta (Rules, Checks, Outbound, Insights). */
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

/** `/{tokenId}/checks`: configuração da URL (`?section=`, `?schema-from=`). */
export const checksMatcher = tabMatcher('checks');

/** `/{tokenId}/insights`: números da URL. */
export const insightsMatcher = tabMatcher('insights');

/** `/{tokenId}/rules/{ruleId}` e `/{tokenId}/rules/new` (`?from={requestId}`): uma regra aberta. */
export function ruleMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [token, name, ruleId] = segments;
  if (segments.length !== 3 || !UUID.test(token.path) || name.path !== 'rules' || !ruleId.path) {
    return null;
  }
  return { consumed: segments, posParams: { tokenId: token, ruleId } };
}

/** `/{tokenId}/compare/{a}/{b}`: duas mensagens lado a lado, com link compartilhável. */
export function compareMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [token, name, a, b] = segments;
  const valid =
    segments.length === 4 &&
    UUID.test(token.path) &&
    name.path === 'compare' &&
    UUID.test(a.path) &&
    UUID.test(b.path);
  return valid ? { consumed: segments, posParams: { tokenId: token, a, b } } : null;
}

/**
 * Endereço cujo primeiro segmento não é id de URL (`#/12345/rules`): cai na página única de URL
 * inexistente, que o shell mostra no lugar da rota (B1). Não redireciona nem cria URL.
 */
export function malformedMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  const [first] = segments;
  const known = !first || UUID.test(first.path) || ['share', '_catalog'].includes(first.path);
  return known ? null : { consumed: segments };
}

/**
 * Página que pergunta antes de sair: Rules com alterações não salvas no editor (E-04) e Checks com
 * alterações na barra de salvar (B3).
 */
interface LeaveGuarded {
  canLeave(): Promise<boolean>;
}

const askBeforeLeaving: CanDeactivateFn<LeaveGuarded> = (page) => page.canLeave();

/**
 * Todas as rotas da interface nova (§1 do plano do item 14), declaradas na E3: as fatias seguintes
 * trocam as páginas, não esta lista. Todo destino é carregado sob demanda.
 */
export const routes: Routes = [
  // `#/_catalog` em desenvolvimento; vazio no build de produção.
  ...CATALOG_ROUTES,
  {
    matcher: rulesMatcher,
    loadComponent: () => import('./rules/rules-page').then((m) => m.RulesPage),
    canDeactivate: [askBeforeLeaving],
  },
  {
    matcher: ruleMatcher,
    loadComponent: () => import('./rules/rules-page').then((m) => m.RulesPage),
    canDeactivate: [askBeforeLeaving],
  },
  {
    matcher: outboundMatcher,
    loadComponent: () => import('./outbound/outbound-page').then((m) => m.OutboundPage),
  },
  {
    matcher: checksMatcher,
    loadComponent: () => import('./checks/checks-page').then((m) => m.ChecksPage),
    canDeactivate: [askBeforeLeaving],
  },
  {
    matcher: insightsMatcher,
    loadComponent: () => import('./insights/insights-page').then((m) => m.InsightsPage),
  },
  {
    matcher: compareMatcher,
    loadComponent: () => import('./diff/compare-page').then((m) => m.ComparePage),
  },
  { matcher: inboxMatcher, loadComponent: () => import('./inbox/inbox').then((m) => m.Inbox) },
  // Link só-leitura de uma mensagem: público, sem o segredo da URL.
  {
    path: 'share/:shareId',
    loadComponent: () => import('./share/share-page').then((m) => m.SharePage),
  },
  // Sem página: o shell põe a de URL inexistente no lugar do `router-outlet`.
  { matcher: malformedMatcher, children: [] },
  { path: '**', redirectTo: '' },
];
