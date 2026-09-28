import { Injectable, computed, signal } from '@angular/core';

/** Uma URL que este navegador conhece, como fica em `localStorage.anzol.urls`. */
export interface KnownUrl {
  uuid: string;
  /** Apelido dado aqui, só neste navegador; vazio quando não há. */
  nickname: string;
  /** Última abertura com sucesso nesta tela (ISO). */
  openedAt: string;
}

/** Chave da lista (guia da combinação, §4.1). */
export const KNOWN_URLS_KEY = 'anzol.urls';
/** A lista guarda até 50; a de abertura mais antiga sai. */
export const KNOWN_URLS_MAX = 50;
export const NICKNAME_MAX = 40;

/**
 * As URLs que este navegador já abriu, com o apelido de cada uma (B1). Fica só no navegador: o
 * servidor não tem rota que liste URLs, e o endereço de uma URL é segredo. Por isso a lista nunca
 * entra em texto copiado, e sai por "Forget a URL…", "Forget all URLs", "Delete URL" e pela página
 * de URL inexistente.
 */
@Injectable({ providedIn: 'root' })
export class KnownUrls {
  /** `false` quando o navegador não deixa gravar: o seletor mostra só a URL aberta. */
  readonly available = signal(true);
  private readonly list = signal<readonly KnownUrl[]>(this.read());

  /** Da abertura mais recente para a mais antiga. */
  readonly urls = computed(() =>
    [...this.list()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
  );

  /** A URL abriu com sucesso nesta tela (criada, aberta por link ou destrancada). */
  opened(uuid: string): void {
    const known = this.list().find((url) => url.uuid === uuid);
    const openedAt = new Date().toISOString();
    const others = this.list().filter((url) => url.uuid !== uuid);
    this.keep([{ uuid, nickname: known?.nickname ?? '', openedAt }, ...others]);
  }

  /** Apelido de até 40 caracteres; vazio apaga o apelido. */
  rename(uuid: string, nickname: string): void {
    const name = nickname.trim().slice(0, NICKNAME_MAX);
    this.keep(this.list().map((url) => (url.uuid === uuid ? { ...url, nickname: name } : url)));
  }

  /** Esquecer não apaga a URL no servidor. */
  forget(uuids: readonly string[]): void {
    this.keep(this.list().filter((url) => !uuids.includes(url.uuid)));
  }

  forgetAll(): void {
    this.keep([]);
  }

  nicknameOf(uuid: string): string {
    return this.list().find((url) => url.uuid === uuid)?.nickname ?? '';
  }

  /** O rótulo da URL na tela: o apelido ou, sem ele, "URL d0620". */
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

  /**
   * A lista gravada. Na primeira carga com a lista (sem a chave), a URL que a tela já guardava (a
   * última vista, `localStorage.token`) vira o primeiro item.
   */
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
