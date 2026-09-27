import { Injectable } from '@angular/core';
import { urlDraftKey } from '../token/url-lock';
import { Rule, ValueMatcher } from './rule';

/** Rascunho de uma regra guardado na aba (E-04). */
export interface RuleDraft {
  /** Quando foi gravado (ms desde a época). */
  savedAt: number;
  rule: Rule;
  /** Algum valor de cabeçalho sensível ficou de fora. */
  omitted: boolean;
}

/**
 * Cabeçalhos cujo valor não vai para o rascunho: credenciais e assinaturas. O nome vem como a
 * regra casa (sem caixa, `_` vale `-`).
 */
export function isSensitiveHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase().replaceAll('_', '-');
  return (
    ['authorization', 'proxy-authorization', 'cookie', 'x-api-key'].includes(normalized) ||
    normalized.endsWith('-signature')
  );
}

/**
 * A regra sem os valores de cabeçalhos sensíveis (condições e cabeçalhos da resposta): a condição
 * e o cabeçalho ficam, com o valor vazio. `omitted` diz se algum valor não vazio saiu.
 */
export function withoutSecrets(rule: Rule): { rule: Rule; omitted: boolean } {
  let omitted = false;
  const conditions = Object.entries(rule.match?.headers ?? {}).map(
    ([name, condition]): [string, ValueMatcher] => {
      if (!isSensitiveHeader(name) || 'present' in condition) {
        return [name, condition];
      }
      const [operator, value] = Object.entries(condition)[0] as [string, string];
      omitted ||= value !== '';
      return [name, { [operator]: '' } as ValueMatcher];
    },
  );
  const headers = Object.entries(rule.response?.headers ?? {}).map(([name, value]) => {
    if (!isSensitiveHeader(name)) {
      return [name, value];
    }
    omitted ||= value !== '';
    return [name, ''];
  });
  return {
    rule: {
      ...rule,
      ...(rule.match && { match: { ...rule.match, headers: Object.fromEntries(conditions) } }),
      ...(rule.response && {
        response: {
          ...rule.response,
          headers: Object.fromEntries(headers) as Record<string, string>,
        },
      }),
    },
    omitted,
  };
}

/**
 * Rascunhos das regras na memória da aba (`sessionStorage`), um por URL e regra (`new` para a
 * regra nova): somem ao fechar a aba, ao salvar, ao descartar de propósito e ao trancar a URL.
 * Sem `sessionStorage` (bloqueado, cheio), o editor funciona sem rascunho.
 */
@Injectable({ providedIn: 'root' })
export class RuleDrafts {
  save(tokenId: string, ruleId: string | undefined, rule: Rule, now = Date.now()): void {
    const { rule: kept, omitted } = withoutSecrets(rule);
    const draft: RuleDraft = { savedAt: now, rule: kept, omitted };
    try {
      sessionStorage.setItem(key(tokenId, ruleId), JSON.stringify(draft));
    } catch {
      // Sem espaço ou sem storage: fica sem rascunho.
    }
  }

  load(tokenId: string, ruleId: string | undefined): RuleDraft | null {
    try {
      const text = sessionStorage.getItem(key(tokenId, ruleId));
      const draft = text ? (JSON.parse(text) as Partial<RuleDraft>) : null;
      return draft && typeof draft.savedAt === 'number' && typeof draft.rule === 'object'
        ? (draft as RuleDraft)
        : null;
    } catch {
      return null;
    }
  }

  clear(tokenId: string, ruleId: string | undefined): void {
    try {
      sessionStorage.removeItem(key(tokenId, ruleId));
    } catch {
      // Nada a limpar.
    }
  }
}

function key(tokenId: string, ruleId: string | undefined): string {
  return urlDraftKey(tokenId, `rule:${ruleId ?? 'new'}`);
}
