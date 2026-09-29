import { Injectable, computed, signal } from '@angular/core';

export interface KnownUrl {
  uuid: string;
  nickname: string;
  /** ISO 8601: a lista ordena comparando o texto. */
  openedAt: string;
}

export const KNOWN_URLS_KEY = 'anzol.urls';
export const KNOWN_URLS_MAX = 50;
export const NICKNAME_MAX = 40;

/**
 * As URLs que este navegador já abriu. Ficam só aqui: o servidor não lista URLs, e o endereço de
 * uma URL é segredo, por isso a lista nunca entra em texto copiado.
 */
@Injectable({ providedIn: 'root' })
export class KnownUrls {
  /** `false` quando o navegador não deixa gravar no storage. */
  readonly available = signal(true);
  private readonly list = signal<readonly KnownUrl[]>(this.read());

  /** Da abertura mais recente para a mais antiga. */
  readonly urls = computed(() =>
    [...this.list()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
  );

  opened(uuid: string): void {
    const known = this.list().find((url) => url.uuid === uuid);
    const openedAt = new Date().toISOString();
    const others = this.list().filter((url) => url.uuid !== uuid);
    this.keep([{ uuid, nickname: known?.nickname ?? '', openedAt }, ...others]);
  }

  rename(uuid: string, nickname: string): void {
    const name = nickname.trim().slice(0, NICKNAME_MAX);
    this.keep(this.list().map((url) => (url.uuid === uuid ? { ...url, nickname: name } : url)));
  }

  forget(uuids: readonly string[]): void {
    this.keep(this.list().filter((url) => !uuids.includes(url.uuid)));
  }

  forgetAll(): void {
    this.keep([]);
  }

  nicknameOf(uuid: string): string {
    return this.list().find((url) => url.uuid === uuid)?.nickname ?? '';
  }

  nameOf(uuid: string): string {
    return this.nicknameOf(uuid) || $localize`URL ${uuid.slice(0, 5)}:id:`;
  }

  private keep(urls: readonly KnownUrl[]): void {
    const kept = [...urls]
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, KNOWN_URLS_MAX);
    this.list.set(kept);
    try {
      localStorage.setItem(KNOWN_URLS_KEY, JSON.stringify(kept));
    } catch {
      this.available.set(false);
    }
  }

  private read(): KnownUrl[] {
    try {
      const stored = localStorage.getItem(KNOWN_URLS_KEY);
      if (stored !== null) {
        const value: unknown = JSON.parse(stored);
        return Array.isArray(value) ? value.filter(isKnownUrl) : [];
      }
      const last = JSON.parse(localStorage.getItem('token') ?? 'null') as {
        uuid?: unknown;
      } | null;
      const migrated =
        typeof last?.uuid === 'string'
          ? [{ uuid: last.uuid, nickname: '', openedAt: new Date().toISOString() }]
          : [];
      localStorage.setItem(KNOWN_URLS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      this.available.set(false);
      return [];
    }
  }
}

function isKnownUrl(value: unknown): value is KnownUrl {
  const url = value as Partial<KnownUrl> | null;
  return (
    typeof url?.uuid === 'string' &&
    typeof url.nickname === 'string' &&
    typeof url.openedAt === 'string'
  );
}
