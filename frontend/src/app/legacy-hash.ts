/**
 * Links do app antigo (AngularJS 1.7.8) usam o prefixo `#!`: `/#!/{uuid}/{requestUuid}/{page}`.
 * O roteador novo usa `#/`. Devolve o hash reescrito, ou `null` quando não há o que mudar.
 */
export function normalizeLegacyHash(hash: string): string | null {
  if (!hash.startsWith('#!')) {
    return null;
  }
  const path = hash.slice(2);
  return path.startsWith('/') ? `#${path}` : `#/${path}`;
}

/** Reescreve o `#!` na barra de endereço antes do bootstrap, sem criar entrada no histórico. */
export function applyLegacyHash(location: Location, history: History): void {
  const hash = normalizeLegacyHash(location.hash);
  if (hash !== null) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  }
}
