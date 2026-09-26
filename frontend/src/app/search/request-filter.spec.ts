import { NO_FILTER, isFilterActive, sameFilter, searchBody } from './request-filter';

describe('Dado o filtro da lista', () => {
  it('deve estar inativo Quando não há texto nem filtro rápido (espaços não contam)', () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
    expect(isFilterActive({ ...NO_FILTER, text: '   ' })).toBe(false);
  });

  it('deve estar ativo Quando qualquer filtro está ligado', () => {
    expect(isFilterActive({ ...NO_FILTER, text: 'pedido' })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, methods: ['GET'] })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, signature: 'invalid' })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, schema: 'valid' })).toBe(true);
  });

  it('deve ser o mesmo filtro Quando só a ordem dos métodos ou espaços nas pontas mudam', () => {
    expect(
      sameFilter(
        { ...NO_FILTER, text: ' a ', methods: ['GET', 'POST'] },
        { ...NO_FILTER, text: 'a', methods: ['POST', 'GET'] },
      ),
    ).toBe(true);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, methods: ['GET'] })).toBe(false);
  });

  it('deve montar o corpo da busca com o match das regras e a ordem da lista', () => {
    expect(
      searchBody(
        { text: ' pedido-42 ', methods: ['POST', 'PUT'], signature: 'invalid', schema: 'valid' },
        3,
      ),
    ).toEqual({
      text: 'pedido-42',
      match: { method: ['POST', 'PUT'], signature: 'invalid', schema: 'valid' },
      sorting: 'oldest',
      page: 3,
      per_page: 50,
    });
  });

  it('deve deixar o texto e as condições fora Quando não estão ligados', () => {
    expect(searchBody({ ...NO_FILTER, methods: ['GET'] }, 1)).toEqual({
      match: { method: ['GET'] },
      sorting: 'oldest',
      page: 1,
      per_page: 50,
    });
  });
});
