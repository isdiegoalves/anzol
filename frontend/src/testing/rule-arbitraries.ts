import fc from 'fast-check';
import {
  BodyMatcher,
  DECRYPTION_CONDITIONS,
  PathMatcher,
  RULE_FAULTS,
  Rule,
  RuleDelay,
  SCHEMA_CONDITIONS,
  SIGNATURE_CONDITIONS,
  ValueMatcher,
} from '../app/rules/rule';

/** Texto de regra; as marcas de destaque de `ruleWordSegments` (U+E000, U+E001) ficam de fora. */
export const ruleText = fc
  .string({ unit: 'grapheme', maxLength: 30 })
  .filter((text) => !/[]/.test(text));

export const valueMatcher: fc.Arbitrary<ValueMatcher> = fc.oneof(
  fc.record({ equals: ruleText }),
  fc.record({ contains: ruleText }),
  fc.record({ regex: ruleText }),
  fc.record({ present: fc.boolean() }),
);

const pathMatcher: fc.Arbitrary<PathMatcher> = fc.oneof(
  fc.record({ equals: ruleText }),
  fc.record({ prefix: ruleText }),
  fc.record({ regex: ruleText }),
);

const bodyMatcher: fc.Arbitrary<BodyMatcher> = fc.oneof(
  fc.record({ equals: ruleText }),
  fc.record({ contains: ruleText }),
  fc.record({ regex: ruleText }),
  fc.record({
    jsonPath: fc.record(
      { path: ruleText, equals: fc.jsonValue({ maxDepth: 2 }) },
      { requiredKeys: ['path'] },
    ),
  }),
  fc.record({ equalToJson: fc.jsonValue({ maxDepth: 2 }) }),
);

const delay: fc.Arbitrary<RuleDelay> = fc.oneof(
  fc.record({ fixed: fc.nat(60_000) }),
  fc.record({ uniform: fc.record({ min: fc.nat(30_000), max: fc.nat(60_000) }) }),
  fc.record({ lognormal: fc.record({ median: fc.nat(60_000), sigma: fc.nat(5) }) }),
);

/**
 * Regra no domínio do JSON de `GET/PUT /token/{id}/rules`: só valores que o JSON representa, com
 * os campos opcionais às vezes ausentes, às vezes `null` e às vezes com o padrão do servidor.
 */
export function ruleArbitrary(ids: fc.Arbitrary<string> = ruleText): fc.Arbitrary<Rule> {
  return fc.record(
    {
      id: ids,
      name: ruleText,
      enabled: fc.boolean(),
      priority: fc.integer({ min: 1, max: 10 }),
      chance: fc.option(fc.integer({ min: 1, max: 100 })),
      active_from: fc.option(ruleText),
      active_until: fc.option(ruleText),
      match: fc.record(
        {
          method: fc.uniqueArray(fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE'), {
            maxLength: 3,
          }),
          path: fc.option(pathMatcher),
          query: fc.dictionary(ruleText, valueMatcher, { maxKeys: 3, noNullPrototype: true }),
          headers: fc.dictionary(ruleText, valueMatcher, { maxKeys: 3, noNullPrototype: true }),
          body: fc.array(bodyMatcher, { maxLength: 3 }),
          signature: fc.option(fc.constantFrom(...SIGNATURE_CONDITIONS)),
          schema: fc.option(fc.constantFrom(...SCHEMA_CONDITIONS)),
          decryption: fc.option(fc.constantFrom(...DECRYPTION_CONDITIONS)),
        },
        { requiredKeys: [] },
      ),
      scenario: fc.option(
        fc.record(
          { name: ruleText, requiredState: fc.option(ruleText), newState: fc.option(ruleText) },
          { requiredKeys: ['name'] },
        ),
      ),
      response: fc.record(
        {
          status: fc.integer({ min: 100, max: 599 }),
          headers: fc.dictionary(ruleText, ruleText, { maxKeys: 3, noNullPrototype: true }),
          body: ruleText,
          template: fc.boolean(),
          delay: fc.option(delay),
          fault: fc.option(fc.constantFrom(...RULE_FAULTS)),
        },
        { requiredKeys: [] },
      ),
    },
    { requiredKeys: ['name'] },
  );
}
