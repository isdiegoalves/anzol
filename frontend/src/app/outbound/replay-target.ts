import { readSetting } from '../settings/preferences';

/** Chave do localStorage com o último destino de replay de cada URL: `{tokenId: url}`. */
export const REPLAY_TARGETS_KEY = 'replayTargets';

/** Último destino de replay usado nesta URL de webhook; vazio se nunca houve. */
export function rememberedTarget(tokenId: string): string {
  return readSetting<Record<string, string>>(REPLAY_TARGETS_KEY, {})[tokenId] ?? '';
}

/** Lembra o destino desta URL, sem mexer no das outras. */
export function rememberTarget(tokenId: string, url: string): void {
  const targets = readSetting<Record<string, string>>(REPLAY_TARGETS_KEY, {});
  localStorage.setItem(REPLAY_TARGETS_KEY, JSON.stringify({ ...targets, [tokenId]: url }));
}
