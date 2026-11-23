import { loadTranslations } from '@angular/localize';
import fc from 'fast-check';
import { translations } from '../../locale/pt-BR';
import { ruleArbitrary } from '../../testing/rule-arbitraries';
import { RULE_DEFAULT_STATUS, Rule } from './rule';
import { matchLine, ruleInWords, ruleWordSegments } from './rule-words';

function expectedMarks(rule: Rule): { strong: string[]; code: string[] } {
  const path = rule.match?.path;
  const response = rule.response ?? {};
  return {
    strong: [
      ...(rule.match?.method ?? []),
      ...(response.fault ? [] : [String(response.status ?? RULE_DEFAULT_STATUS)]),
    ],
    code: path ? [Object.values(path)[0]] : [],
  };
}

describe('Dado propriedades da regra em palavras (RULES-15)', () => {
  it.each([
    ['em inglês', () => undefined],
    ['em pt-BR', () => loadTranslations(translations)],
  ])(
    'deve juntar os pedaços no mesmo texto de ruleInWords e destacar só método, status e caminho, %s',
    (_, load) => {
      load();
      fc.assert(
        fc.property(ruleArbitrary(), (rule) => {
          const segments = ruleWordSegments(rule);
          const marked = (kind: string) =>
            segments.filter((segment) => segment.kind === kind).map(({ text }) => text);

          expect(segments.map(({ text }) => text).join('')).toBe(ruleInWords(rule));
          expect({ strong: marked('strong'), code: marked('code') }).toEqual(expectedMarks(rule));
        }),
      );
    },
  );

  it('deve descrever qualquer regra numa frase terminada em ponto', () => {
    fc.assert(
      fc.property(ruleArbitrary(), (rule) => {
        expect(ruleInWords(rule).endsWith('.')).toBe(true);
      }),
    );
  });

  it('deve citar o valor inteiro até 40 caracteres e, acima disso, o começo dele com reticências', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', size: 'max', maxLength: 60 }), (value) => {
        const line = matchLine({ name: 'x', match: { headers: { 'X-A': { equals: value } } } });
        const shown = line.slice('header X-A = '.length);
        const full = `"${value}"`;

        if (full.length <= 40) {
          expect(shown).toBe(full);
        } else {
          expect(shown).toHaveLength(40);
          expect(shown.endsWith('…')).toBe(true);
          expect(full.startsWith(shown.slice(0, -1))).toBe(true);
        }
      }),
    );
  });

  it('deve citar todo método da regra na linha 2 da lista e nunca deixá-la vazia', () => {
    fc.assert(
      fc.property(ruleArbitrary(), (rule) => {
        const line = matchLine(rule);

        expect(line).not.toBe('');
        for (const method of rule.match?.method ?? []) {
          expect(line).toContain(method);
        }
      }),
    );
  });
});
