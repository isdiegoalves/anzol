import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RULE_DEFAULT_STATUS, Rule } from '../rules/rule';

/**
 * O status da resposta de cada regra da URL, para o selo e o cartão da regra que respondeu
 * ("201 · Pix", INBOX-13/18; e o Compare, RULES-30). A mensagem guarda só a regra: vale o status da
 * regra hoje. Lê `GET /rules` só quando aparece uma regra que ainda não conhece.
 */
@Injectable({ providedIn: 'root' })
export class RuleStatusStore {
  private readonly http = inject(HttpClient);
  private readonly loaded = signal<{ tokenId: string; statuses: ReadonlyMap<string, number> }>({
    tokenId: '',
    statuses: new Map(),
  });
  /** Ids já procurados na última leitura (a regra apagada não é pedida de novo). */
  private attempted = new Set<string>();
  private reading: Promise<void> | null = null;

  /** O status da regra, ou `undefined` sem ela (ainda não lida, ou apagada). */
  statusOf(ruleId: string): number | undefined {
    return this.loaded().statuses.get(ruleId);
  }

  /** As regras respondentes (`ruleIds`) da URL: lê a lista se alguma ainda não foi procurada. */
  async ensure(tokenId: string, ruleIds: readonly string[]): Promise<void> {
    if (this.reading) {
      await this.reading;
    }
    const known = this.loaded().tokenId === tokenId;
    if (ruleIds.length === 0 || (known && ruleIds.every((id) => this.attempted.has(id)))) {
      return;
    }
    this.reading = this.read(tokenId, ruleIds);
    await this.reading;
    this.reading = null;
  }

  private async read(tokenId: string, ruleIds: readonly string[]): Promise<void> {
    try {
      const rules = await firstValueFrom(this.http.get<Rule[]>(`/token/${tokenId}/rules`));
      const statuses = new Map<string, number>();
      for (const rule of rules) {
        if (rule.id) {
          statuses.set(rule.id, rule.response?.status ?? RULE_DEFAULT_STATUS);
        }
      }
      this.attempted = new Set([...statuses.keys(), ...ruleIds]);
      this.loaded.set({ tokenId, statuses });
    } catch {
      // Sem as regras (401, rede): o selo fica só com o nome.
    }
  }
}
