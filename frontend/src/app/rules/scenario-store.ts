import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Cenário da URL em `GET /token/{id}/scenarios`: estado atual e os estados que as regras citam. */
export interface Scenario {
  name: string;
  state: string;
  states: string[];
}

/**
 * Estados dos cenários da URL aberta. `PUT /scenarios/{nome}` define um estado à mão e
 * `DELETE /scenarios` volta todos a `Started`; depois de cada um, a lista é relida.
 */
@Injectable({ providedIn: 'root' })
export class ScenarioStore {
  private readonly http = inject(HttpClient);
  private tokenId: string | null = null;

  readonly scenarios = signal<readonly Scenario[]>([]);

  async load(tokenId: string): Promise<void> {
    if (tokenId !== this.tokenId) {
      this.scenarios.set([]);
    }
    this.tokenId = tokenId;
    this.scenarios.set(await firstValueFrom(this.http.get<Scenario[]>(this.url(tokenId))));
  }

  async setState(name: string, state: string): Promise<void> {
    const tokenId = this.requireToken();
    const url = `${this.url(tokenId)}/${encodeURIComponent(name)}`;
    await firstValueFrom(this.http.put(url, { state }));
    await this.load(tokenId);
  }

  async resetAll(): Promise<void> {
    const tokenId = this.requireToken();
    await firstValueFrom(this.http.delete(this.url(tokenId)));
    await this.load(tokenId);
  }

  private url(tokenId: string): string {
    return `/token/${tokenId}/scenarios`;
  }

  private requireToken(): string {
    if (!this.tokenId) {
      throw new Error('No URL loaded');
    }
    return this.tokenId;
  }
}
