import { JsonSchema } from './token';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Schema de partida para "Create schema from this request": o dono revisa e salva. Objeto exige
 * todas as chaves presentes (sem `additionalProperties`, permissivo); lista infere `items` do
 * primeiro elemento (lista vazia fica sem `items`); número inteiro é `integer`, o resto `number`.
 */
export function inferSchema(body: unknown): JsonSchema {
  return { $schema: DRAFT_2020_12, ...schemaOf(body) };
}

function schemaOf(value: unknown): JsonSchema {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? { type: 'array' } : { type: 'array', items: schemaOf(value[0]) };
  }
  switch (typeof value) {
    case 'object': {
      const entries = Object.entries(value);
      return {
        type: 'object',
        properties: Object.fromEntries(entries.map(([key, item]) => [key, schemaOf(item)])),
        required: entries.map(([key]) => key),
      };
    }
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    default:
      return { type: typeof value };
  }
}
