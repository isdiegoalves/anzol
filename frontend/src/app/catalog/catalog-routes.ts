import { Routes } from '@angular/router';

/**
 * `#/_catalog`: o catálogo de `ui/`, só em desenvolvimento. O build de produção troca este arquivo
 * pelo `catalog-routes.prod.ts` (`fileReplacements` do `angular.json`), e o catálogo não entra.
 */
export const CATALOG_ROUTES: Routes = [
  { path: '_catalog', loadComponent: () => import('./catalog').then((m) => m.Catalog) },
];
