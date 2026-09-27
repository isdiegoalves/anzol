import {
  NO_FILTER,
  isFilterActive,
  sameFilter,
  searchBody,
  waitForCommand,
} from './request-filter';

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

  it('deve aceitar a assinatura ausente no match (filtro "Signature absent")', () => {
    expect(searchBody({ ...NO_FILTER, signature: 'absent' }, 1).match).toEqual({
      signature: 'absent',
    });
  });
});

describe('Dado o "Copy as webhook wait-for" (S10)', () => {
  const target = { server: 'http://localhost:8084', tokenId: 'tok-1', protected: false };

  it('deve levar só o match dos filtros, sem o texto da busca', () => {
    const filter = {
      text: 'pedido',
      methods: ['POST'],
      signature: 'invalid' as const,
      schema: 'any' as const,
    };

    expect(waitForCommand(filter, target)).toBe(
      `webhook wait-for --server 'http://localhost:8084' --token tok-1 --match '{"method":["POST"],"signature":"invalid"}'`,
    );
  });

  it('deve omitir o --match Quando não há filtro rápido', () => {
    expect(waitForCommand(NO_FILTER, target)).toBe(
      `webhook wait-for --server 'http://localhost:8084' --token tok-1`,
    );
  });

  it('deve ler o segredo da variável, nunca o escrever, Quando a URL é protegida', () => {
    expect(waitForCommand(NO_FILTER, { ...target, protected: true })).toBe(
      `webhook wait-for --server 'http://localhost:8084' --token tok-1 --read-secret "$WEBHOOK_READ_SECRET"`,
    );
  });

  it('deve escapar a aspa simples do servidor como no shell POSIX', () => {
    expect(waitForCommand(NO_FILTER, { ...target, server: "http://a'b" })).toContain(
      `--server 'http://a'\\''b'`,
    );
  });
});
