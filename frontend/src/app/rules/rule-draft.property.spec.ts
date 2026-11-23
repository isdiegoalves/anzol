import fc from 'fast-check';
import { ruleText, valueMatcher } from '../../testing/rule-arbitraries';
import { Rule } from './rule';
import { isSensitiveHeader, withoutSecrets } from './rule-draft';

const sensitiveName = fc
  .tuple(
    fc.oneof(
      fc.constantFrom('authorization', 'proxy-authorization', 'cookie', 'x-api-key'),
      fc.stringMatching(/^[a-z0-9-]{0,12}$/).map((prefix) => `${prefix}-signature`),
    ),
    fc.array(fc.boolean(), { minLength: 25, maxLength: 25 }),
    fc.constantFrom('', ' ', '\t'),
  )
  .map(([name, flips, pad]) => {
    const written = [...name]
      .map((char, i) => (char === '-' && flips[i] ? '_' : flips[i] ? char.toUpperCase() : char))
      .join('');
    return `${pad}${written}${pad}`;
  });

const headerName = fc.oneof(sensitiveName, ruleText);

const ruleWithHeaders: fc.Arbitrary<Rule> = fc.record({
  name: ruleText,
  match: fc.record({
    path: fc.record({ equals: ruleText }),
    headers: fc.dictionary(headerName, valueMatcher, { maxKeys: 4, noNullPrototype: true }),
  }),
  response: fc.record({
    status: fc.integer({ min: 100, max: 599 }),
    headers: fc.dictionary(headerName, ruleText, { maxKeys: 4, noNullPrototype: true }),
  }),
});

function sensitiveValues(rule: Rule): string[] {
  const conditions = Object.entries(rule.match?.headers ?? {})
    .filter(([name, condition]) => isSensitiveHeader(name) && !('present' in condition))
    .map(([, condition]) => Object.values(condition)[0] as string);
  const headers = Object.entries(rule.response?.headers ?? {})
    .filter(([name]) => isSensitiveHeader(name))
    .map(([, value]) => value);
  return [...conditions, ...headers];
}

describe('Dado propriedades do rascunho sem segredos (E-04)', () => {
  it('deve reconhecer o cabeçalho sensível em qualquer caixa, com _ no lugar de - e espaço em volta', () => {
    fc.assert(
      fc.property(sensitiveName, (name) => {
        expect(isSensitiveHeader(name)).toBe(true);
      }),
    );
  });

  it('deve esvaziar todo valor sensível e dizer se algum não vazio saiu', () => {
    fc.assert(
      fc.property(ruleWithHeaders, (rule) => {
        const { rule: kept, omitted } = withoutSecrets(rule);

        expect(sensitiveValues(kept).every((value) => value === '')).toBe(true);
        expect(omitted).toBe(sensitiveValues(rule).some((value) => value !== ''));
      }),
    );
  });

  it('deve manter os nomes, os operadores, os cabeçalhos comuns e o resto da regra', () => {
    fc.assert(
      fc.property(ruleWithHeaders, (rule) => {
        const { rule: kept } = withoutSecrets(rule);
        const shape = (headers: Record<string, object> = {}) =>
          Object.entries(headers).map(([name, value]) => [name, Object.keys(value)]);
        const common = (headers: Record<string, unknown> = {}) =>
          Object.entries(headers).filter(([name]) => !isSensitiveHeader(name));

        expect(shape(kept.match?.headers)).toEqual(shape(rule.match?.headers));
        expect(Object.keys(kept.response?.headers ?? {})).toEqual(
          Object.keys(rule.response?.headers ?? {}),
        );
        expect(common(kept.match?.headers)).toEqual(common(rule.match?.headers));
        expect(common(kept.response?.headers)).toEqual(common(rule.response?.headers));
        expect(kept.name).toBe(rule.name);
        expect(kept.match?.path).toEqual(rule.match?.path);
        expect(kept.response?.status).toBe(rule.response?.status);
      }),
    );
  });

  it('deve ser idempotente: o rascunho do rascunho é o mesmo e não omite mais nada', () => {
    fc.assert(
      fc.property(ruleWithHeaders, (rule) => {
        const once = withoutSecrets(rule).rule;
        const twice = withoutSecrets(once);

        expect(twice.rule).toEqual(once);
        expect(twice.omitted).toBe(false);
      }),
    );
  });
});
