import type { IconName } from '../ui/icon';

/** Os cinco lugares fixos do rail (e da barra inferior), cada um com a pergunta que responde. */
export interface Destination {
  label: 'Inbox' | 'Rules' | 'Checks' | 'Outbound' | 'Insights';
  /** Segmento depois de `/{token}`; `null` é a Inbox (a rota de hoje). */
  path: 'rules' | 'checks' | 'outbound' | 'insights' | null;
  icon: IconName;
  /** Tecla depois do G (C §3.2). */
  key: 'i' | 'r' | 'c' | 'o' | 'n';
}

export const DESTINATIONS: readonly Destination[] = [
  { label: 'Inbox', path: null, icon: 'inbox', key: 'i' },
  { label: 'Rules', path: 'rules', icon: 'rules', key: 'r' },
  { label: 'Checks', path: 'checks', icon: 'checks', key: 'c' },
  { label: 'Outbound', path: 'outbound', icon: 'outbound', key: 'o' },
  { label: 'Insights', path: 'insights', icon: 'insights', key: 'n' },
];

const UUID = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;

/**
 * Onde a rota está, pelos segmentos: o token da URL aberta e o destino do rail. A Inbox é
 * `/{token}` e `/{token}/{request}/{page}`; o Compare e rotas sem token não marcam destino.
 */
export function placeOf(segments: readonly string[]): {
  tokenId: string | null;
  destination: Destination | null;
} {
  const [first, second] = segments;
  if (!first || !UUID.test(first)) {
    return { tokenId: null, destination: null };
  }
  const inbox = segments.length === 1 || (segments.length === 3 && UUID.test(second));
  const destination = inbox
    ? DESTINATIONS[0]
    : (DESTINATIONS.find((candidate) => candidate.path === second) ?? null);
  return { tokenId: first, destination };
}
