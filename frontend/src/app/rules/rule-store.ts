import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Rule } from './rule';

/**
 * Regras da URL aberta. A API só tem a lista inteira: `GET` lê, `PUT` substitui (e é o import).
 * Toda mudança da tela — criar, editar, ligar, reordenar, apagar — é um `PUT` da lista.
 */
@Injectable({ providedIn: 'root' })
export class RuleStore {
  private readonly http = inject(HttpClient);

  readonly tokenId = signal<string | null>(null);
  readonly rules = signal<readonly Rule[]>([]);

  async load(tokenId: string): Promise<void> {
    this.tokenId.set(tokenId);
    this.rules.set([]);
    this.rules.set(await firstValueFrom(this.http.get<Rule[]>(this.url(tokenId))));
  }

  /** Lista atual do servidor (o export baixa o que está salvo, não o que a tela mostra). */
  fetchAll(): Promise<Rule[]> {
    return firstValueFrom(this.http.get<Rule[]>(this.url(this.requireToken())));
  }

  /**
   * Substitui a lista no servidor. A tela mostra a mudança na hora (o toggle não pula de volta)
   * e fica com a lista que o servidor devolve, com os `id`s e padrões; se o `PUT` falha, volta à
   * lista anterior e repassa o erro (o 422 é mostrado por quem chamou).
   */
  async save(rules: readonly Rule[]): Promise<void> {
    const tokenId = this.requireToken();
    const previous = this.rules();
    this.rules.set(rules);
    try {
      this.rules.set(await firstValueFrom(this.http.put<Rule[]>(this.url(tokenId), rules)));
    } catch (error) {
      this.rules.set(previous);
      throw error;
    }
  }

  private url(tokenId: string): string {
    return `/token/${tokenId}/rules`;
  }

  private requireToken(): string {
    const tokenId = this.tokenId();
    if (!tokenId) {
      throw new Error('No URL loaded');
    }
    return tokenId;
  }
}

/**
 * Frases para o usuário a partir do erro do `PUT`: no 422, uma por mensagem, com a regra
 * numerada a partir de 1 (`0.match.path.regex` → `Rule 1 › match.path.regex: ...`).
 */
export function validationMessages(error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse)) {
    return ['Could not save the rules (unknown).'];
  }
  if (error.status === 422 && error.error && typeof error.error === 'object') {
    return Object.entries(error.error as Record<string, string[]>).flatMap(([key, messages]) =>
      messages.map((message) => `${describeKey(key)}${message}`),
    );
  }
  if (error.status === 404 || error.status === 410) {
    return [`This URL no longer exists (${error.status}).`];
  }
  return [`Could not save the rules (${error.status}).`];
}

function describeKey(key: string): string {
  const indexed = /^(\d+)\.(.+)$/.exec(key);
  if (indexed) {
    return `Rule ${Number(indexed[1]) + 1} › ${indexed[2]}: `;
  }
  return key === 'rules' ? '' : `${key}: `;
}
