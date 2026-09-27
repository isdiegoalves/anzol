import { Rule } from './rule';
import { newRule } from './rule-form';

/** Um modelo do menu "Rule templates" (WM-11): a regra nova já preenchida, ou o assistente. */
export type RuleTemplate =
  { id: string; label: string; draft: Rule } | { id: 'sequence'; label: string; sequence: true };

/**
 * Os modelos, na ordem do menu. Função (e não constante do módulo) para o `$localize` rodar depois
 * de a tradução carregar; o nome sugerido é o que o editor mostra e dá para trocar.
 */
export function ruleTemplates(): RuleTemplate[] {
  const draft = (name: string, response: Rule['response'], match?: Rule['match']): Rule => {
    const base = newRule();
    return {
      ...base,
      name,
      match: { ...base.match, ...match },
      response: { ...base.response, ...response },
    };
  };
  return [
    {
      id: 'accept',
      label: $localize`Accept everything (200)`,
      draft: draft($localize`:template rule name:Accept all`, { status: 200 }),
    },
    {
      id: 'unavailable',
      label: $localize`Unavailable (503)`,
      draft: draft($localize`:template rule name:Unavailable`, { status: 503 }),
    },
    {
      id: 'invalid-signature',
      label: $localize`Reject invalid signature (401)`,
      draft: draft(
        $localize`:template rule name:Invalid signature`,
        { status: 401 },
        { signature: 'invalid' },
      ),
    },
    { id: 'sequence', label: $localize`Fail N times, then accept`, sequence: true },
    {
      id: 'rate-limited',
      label: $localize`429 with Retry-After`,
      draft: draft($localize`:template rule name:Rate limited`, {
        status: 429,
        headers: { 'Retry-After': '5' },
      }),
    },
    {
      id: 'echo',
      label: $localize`Echo the body (template)`,
      draft: draft($localize`:template rule name:Echo`, {
        status: 200,
        body: '{{request.body}}',
        template: true,
      }),
    },
    {
      id: 'slow',
      label: $localize`Delay 30 s`,
      draft: draft($localize`:template rule name:Slow`, { status: 200, delay: { fixed: 30_000 } }),
    },
    {
      id: 'dropped',
      label: $localize`Drop the connection`,
      draft: draft($localize`:template rule name:Dropped`, { fault: 'connection_reset' }),
    },
  ];
}
