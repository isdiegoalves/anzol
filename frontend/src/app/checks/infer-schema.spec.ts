import { inferSchema } from './infer-schema';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

describe('Dado o corpo JSON de uma mensagem como ponto de partida de um schema', () => {
  it('deve declarar o draft 2020-12 só na raiz Quando o corpo é um objeto com objeto aninhado', () => {
    const schema = inferSchema({ cliente: { nome: 'Ana' } });

    expect(schema).toEqual({
      $schema: DRAFT,
      type: 'object',
      properties: {
        cliente: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
      },
      required: ['cliente'],
    });
  });

  it('deve exigir todas as chaves presentes, sem additionalProperties, Quando o corpo é um pedido', () => {
    const schema = inferSchema({
      id: 42,
      total: 10.5,
      pago: true,
      cupom: null,
      itens: [{ sku: 'A1', qtd: 2 }],
    });

    expect(schema).toEqual({
      $schema: DRAFT,
      type: 'object',
      properties: {
        id: { type: 'integer' },
        total: { type: 'number' },
        pago: { type: 'boolean' },
        cupom: { type: 'null' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, qtd: { type: 'integer' } },
            required: ['sku', 'qtd'],
          },
        },
      },
      required: ['id', 'total', 'pago', 'cupom', 'itens'],
    });
  });

  it('deve inferir items só do primeiro elemento Quando a lista mistura tipos', () => {
    expect(inferSchema([1, 'dois', { tres: 3 }])).toEqual({
      $schema: DRAFT,
      type: 'array',
      items: { type: 'integer' },
    });
  });

  it('deve deixar items de fora Quando a lista é vazia', () => {
    expect(inferSchema({ tags: [] })).toEqual({
      $schema: DRAFT,
      type: 'object',
      properties: { tags: { type: 'array' } },
      required: ['tags'],
    });
  });

  it('deve ficar com properties e required vazios Quando o objeto é vazio', () => {
    expect(inferSchema({})).toEqual({
      $schema: DRAFT,
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it.each([
    ['texto', 'pago', 'string'],
    ['texto vazio', '', 'string'],
    ['verdadeiro', true, 'boolean'],
    ['falso', false, 'boolean'],
    ['nulo', null, 'null'],
    ['inteiro', 7, 'integer'],
    ['zero', 0, 'integer'],
    ['inteiro negativo', -3, 'integer'],
    ['decimal', 0.1, 'number'],
    ['decimal negativo', -2.5, 'number'],
    ['número grande em notação científica', 1e21, 'integer'],
  ])('deve inferir só o tipo Quando o corpo é %s', (_caso, valor, tipo) => {
    expect(inferSchema(valor)).toEqual({ $schema: DRAFT, type: tipo });
  });

  it('deve inferir listas aninhadas pelo primeiro elemento de cada nível Quando a lista é de listas', () => {
    expect(inferSchema([[1.5], []])).toEqual({
      $schema: DRAFT,
      type: 'array',
      items: { type: 'array', items: { type: 'number' } },
    });
  });
});
