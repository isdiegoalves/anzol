import path from 'node:path';

/** Raiz do repositório (tests/cli/support → ../../..). */
export const RAIZ = path.resolve(import.meta.dirname, '..', '..', '..');

/** Script do CLI sob teste; relativo à raiz do repositório quando não absoluto. */
export const CLI = path.resolve(RAIZ, process.env.ANZOL_CLI ?? 'cli/build/install/anzol/bin/anzol');

/** App Anzol real (só HTTP). Sem barra final: é assim que o CLI a recebe em --server. */
export const SERVIDOR = (process.env.ANZOL_SERVER ?? 'http://localhost:8084').replace(/\/+$/, '');

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Escapa texto para uso literal numa RegExp. */
export function literal(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
