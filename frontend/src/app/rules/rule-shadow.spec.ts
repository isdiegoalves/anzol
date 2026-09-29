import { rule } from '../../testing/rule-fixtures';
import { Rule, RuleMatch } from './rule';
import {
  catchAllPlacement,
  diagnose,
  isCatchAll,
  neverMatches,
  sameMatch,
  shadowedBy,
  shadows,
} from './rule-shadow';

/** Regra só com o `match` dado (o resto no padrão do servidor). */
const com = (match: RuleMatch, overrides: Partial<Rule> = {}): Rule =>
  rule(1, {
    match: { method: [], path: null, query: {}, headers: {}, body: [], ...match },
    ...overrides,
  });

describe('Dado duas regras A (antes) e B (depois) (shadows, E-01)', () => {
  it.each<[string, RuleMatch, RuleMatch]>([
    ['A sem condição nenhuma', {}, { method: ['POST'], path: { equals: '/x' } }],
    ['método de B contido no de A', { method: ['GET', 'POST'] }, { method: ['post'] }],
    ['caminho igual', { path: { equals: '/pagamentos' } }, { path: { equals: '/pagamentos' } }],
    [
      'prefixo de A antes do caminho de B',
      { path: { prefix: '/api' } },
      { path: { equals: '/api/v1' } },
    ],
    [
      'prefixo de A antes do prefixo de B',
      { path: { prefix: '/api' } },
      { path: { prefix: '/api/v' } },
    ],
    ['regex com o mesmo texto', { path: { regex: '/p.*' } }, { path: { regex: '/p.*' } }],
    [
      'query pelo mesmo nome e valor',
      { query: { env: { equals: 'prod' } } },
      { query: { env: { equals: 'prod' } } },
    ],
    [
      'cabeçalho por nome normalizado (_ vira -, sem caixa)',
      { headers: { 'X-Tenant': { equals: 'acme' } } },
      { headers: { x_tenant: { equals: 'acme' } } },
    ],
    [
      'present ⇐ qualquer condição que exige o cabeçalho',
      { headers: { 'x-sig': { present: true } } },
      { headers: { 'X-Sig': { regex: '[a-f0-9]+' } } },
    ],
    [
      'absent ⇐ absent',
      { query: { debug: { present: false } } },
      { query: { debug: { present: false } } },
    ],
    [
      'contains ⇐ B contém o trecho',
      { headers: { ua: { contains: 'curl' } } },
      { headers: { ua: { contains: 'curl/8' } } },
    ],
    [
      'contains ⇐ B igual a um valor que contém',
      { headers: { ua: { contains: 'curl' } } },
      { headers: { ua: { equals: 'curl/8.1' } } },
    ],
    [
      'regex de cabeçalho idêntica',
      { headers: { a: { regex: 'x+' } } },
      { headers: { A: { regex: 'x+' } } },
    ],
    [
      'corpo item a item por identidade',
      { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] },
      { body: [{ contains: 'pix' }, { jsonPath: { path: '$.status', equals: 'pago' } }] },
    ],
    [
      'equalToJson pela árvore, sem ordem de chaves',
      { body: [{ equalToJson: { a: 1, b: [1, 2] } }] },
      { body: [{ equalToJson: '{"b":[1,2],"a":1}' }] },
    ],
    ['assinatura igual', { signature: 'invalid' }, { signature: 'invalid', method: ['POST'] }],
    ['schema ausente em A', {}, { schema: 'valid' }],
  ])('deve sombrear B Quando %s', (_caso, a, b) => {
    expect(shadows(com(a), com(b))).toBe(true);
  });

  it.each<[string, RuleMatch, RuleMatch]>([
    [
      'regex contra literal (nunca avalia regex)',
      { path: { regex: '/pagamentos' } },
      { path: { equals: '/pagamentos' } },
    ],
    ['regex com texto diferente', { path: { regex: '/p.*' } }, { path: { regex: '/p.+' } }],
    ['caminho igual contra prefixo', { path: { equals: '/api' } }, { path: { prefix: '/api' } }],
    [
      'prefixo que não é o começo do de B',
      { path: { prefix: '/api/v2' } },
      { path: { prefix: '/api' } },
    ],
    ['caminho com caixa diferente', { path: { equals: '/Pix' } }, { path: { equals: '/pix' } }],
    ['A exige um caminho e B aceita qualquer', { path: { equals: '/x' } }, {}],
    ['A exige método e B aceita qualquer', { method: ['POST'] }, {}],
    ['método de B fora do de A', { method: ['POST'] }, { method: ['POST', 'PUT'] }],
    [
      'query com outro nome',
      { query: { env: { equals: 'prod' } } },
      { query: { ENV: { equals: 'prod' } } },
    ],
    [
      'cabeçalho com outro valor',
      { headers: { 'x-tenant': { equals: 'acme' } } },
      { headers: { 'x-tenant': { equals: 'outra' } } },
    ],
    [
      'present contra absent',
      { headers: { 'x-sig': { present: true } } },
      { headers: { 'x-sig': { present: false } } },
    ],
    [
      'absent contra igual',
      { headers: { a: { present: false } } },
      { headers: { a: { equals: '' } } },
    ],
    [
      'contains que B não contém',
      { headers: { ua: { contains: 'curl/8' } } },
      { headers: { ua: { contains: 'curl' } } },
    ],
    [
      'igual contra contains',
      { headers: { ua: { equals: 'curl' } } },
      { headers: { ua: { contains: 'curl' } } },
    ],
    [
      'regex de cabeçalho contra igual',
      { headers: { a: { regex: 'x' } } },
      { headers: { a: { equals: 'x' } } },
    ],
    ['corpo que B não tem', { body: [{ contains: 'pix' }] }, { body: [{ contains: 'pix pago' }] }],
    [
      'equalToJson com lista em outra ordem',
      { body: [{ equalToJson: [1, 2] }] },
      { body: [{ equalToJson: [2, 1] }] },
    ],
    ['assinatura diferente', { signature: 'valid' }, { signature: 'invalid' }],
    ['schema em A e não em B', { schema: 'valid' }, {}],
    ['condição que a tela não conhece em A', { futura: { x: 1 } }, { futura: { x: 1 } }],
  ])('não deve sombrear B Quando %s', (_caso, a, b) => {
    expect(shadows(com(a), com(b))).toBe(false);
  });

  it('não deve sombrear Quando A está desligada', () => {
    expect(shadows(com({}, { enabled: false }), com({ method: ['GET'] }))).toBe(false);
  });

  it.each<[string, Partial<Rule>]>([
    ['chance', { chance: 30 }],
    ['janela com começo', { active_from: '2026-09-29T12:00:00Z' }],
    ['janela com fim', { active_until: '2099-01-01T00:00:00Z' }],
  ])('não deve sombrear Quando A tem %s (deixa passar parte do que casa)', (_caso, campos) => {
    expect(shadows(com({}, campos), com({ method: ['GET'] }))).toBe(false);
  });

  it('deve sombrear Quando só B tem chance ou janela', () => {
    expect(shadows(com({}), com({ method: ['GET'] }, { chance: 30, active_from: 'x' }))).toBe(true);
  });

  it.each<[string, Rule['scenario'], Rule['scenario'], boolean]>([
    ['A sem cenário', null, { name: 'e', requiredState: 'x' }, true],
    [
      'A em qualquer estado do cenário',
      { name: 'e', newState: 'y' },
      { name: 'e', requiredState: 'x' },
      true,
    ],
    [
      'mesmo nome e mesmo estado',
      { name: 'e', requiredState: 'x' },
      { name: 'e', requiredState: 'x' },
      true,
    ],
    [
      'mesmo nome e estado diferente',
      { name: 'e', requiredState: 'x' },
      { name: 'e', requiredState: 'y' },
      false,
    ],
    [
      'outro cenário com o mesmo estado',
      { name: 'e', requiredState: 'x' },
      { name: 'f', requiredState: 'x' },
      false,
    ],
    ['A exige estado e B não', { name: 'e', requiredState: 'x' }, null, false],
  ])('cenário: %s → %s', (_caso, a, b, esperado) => {
    expect(shadows(com({}, { scenario: a }), com({ method: ['GET'] }, { scenario: b }))).toBe(
      esperado,
    );
  });
});

describe('Dado a lista na ordem de avaliação (shadowedBy)', () => {
  const pix = rule(1, { name: 'Pix pago', priority: 2 });
  const copia = { ...pix, id: 'r2', name: 'Pix pago (copy)' };

  it('deve apontar a primeira regra ligada antes dela que casa tudo o que ela casa', () => {
    const tudo = rule(3, { name: 'Tudo', priority: 1, match: undefined });
    const map = shadowedBy([copia, pix, tudo]);

    expect(map.get(0)?.name).toBe('Tudo');
    expect(map.get(1)?.name).toBe('Tudo');
    expect(map.has(2)).toBe(false);
  });

  it('deve usar a ordem de avaliação: empate de prioridade vale a ordem da lista', () => {
    const map = shadowedBy([pix, copia]);

    expect(map.get(1)?.name).toBe('Pix pago');
    expect(map.has(0)).toBe(false);
  });

  it('não deve sombrear pela regra que vem depois, nem pela desligada', () => {
    // A cópia vem antes (P2 < P3): é ela que sombreia a original, e não o contrário.
    const depois = shadowedBy([copia, { ...pix, priority: 3 }]);
    expect(depois.has(0)).toBe(false);
    expect(depois.get(1)?.name).toBe('Pix pago (copy)');
    expect(shadowedBy([{ ...pix, enabled: false }, copia]).size).toBe(0);
  });

  it('deve calcular também a regra desligada (o tooltip "if turned on")', () => {
    expect(shadowedBy([pix, { ...copia, enabled: false }]).get(1)?.name).toBe('Pix pago');
  });
});

describe('Dado uma regra sem condições (isCatchAll, WM-30)', () => {
  it.each<[string, Rule, boolean]>([
    ['sem match', rule(1, { match: undefined }), true],
    ['match vazio', com({}), true],
    ['com cenário, sem estado exigido', com({}, { scenario: { name: 'e', newState: 'x' } }), true],
    ['só com método', com({ method: ['GET'] }), false],
    ['com estado exigido', com({}, { scenario: { name: 'e', requiredState: 'x' } }), false],
    ['com assinatura', com({ signature: 'valid' }), false],
    ['com condição desconhecida', com({ futura: true }), false],
    ['com chance', com({}, { chance: 50 }), false],
    ['com janela', com({}, { active_until: '2099-01-01T00:00:00Z' }), false],
    ['com chance de 100%', com({}, { chance: 100 }), true],
  ])('%s → %s', (_caso, regra, esperado) => {
    expect(isCatchAll(regra)).toBe(esperado);
  });
});

describe('Dado a lista e uma regra nova (catchAllPlacement, E-01)', () => {
  const tudo = com({}, { id: 'rt', name: 'Tudo o resto', priority: 9 });

  it('deve pôr a regra nova antes da primeira pega-tudo ligada, com a prioridade dela', () => {
    expect(catchAllPlacement([rule(1, { priority: 1 }), tudo, rule(2, { priority: 9 })])).toEqual({
      index: 1,
      priority: 9,
      before: 'Tudo o resto',
    });
  });

  it('deve ignorar a pega-tudo desligada e usar a ordem de avaliação', () => {
    const outra = com({}, { id: 'ro', name: 'Outra', priority: 3 });
    expect(catchAllPlacement([{ ...tudo, priority: 1, enabled: false }, tudo, outra])).toEqual({
      index: 2,
      priority: 3,
      before: 'Outra',
    });
  });

  it('não deve mudar nada Quando não há pega-tudo ligada', () => {
    expect(catchAllPlacement([rule(1), { ...tudo, enabled: false }])).toBeNull();
  });
});

describe('Dado uma regra que nunca pode casar (neverMatches, E-11)', () => {
  const semVerificacao = { signature: null, schema: null };

  it('deve acusar a assinatura ou o schema Quando a URL não os verifica', () => {
    expect(neverMatches(com({ signature: 'invalid' }), [], semVerificacao, [])).toEqual({
      cause: 'signature',
    });
    expect(neverMatches(com({ schema: 'valid' }), [], semVerificacao, [])).toEqual({
      cause: 'schema',
    });
  });

  it('não deve acusar Quando a URL verifica, ou quando a configuração ainda não é conhecida', () => {
    const regra = com({ signature: 'valid', schema: 'invalid' });
    expect(
      neverMatches(
        regra,
        [],
        { signature: { provider: 'stripe' }, schema: { type: 'object' } },
        [],
      ),
    ).toBeNull();
    expect(neverMatches(regra, [], {}, [])).toBeNull();
  });

  it('deve acusar o estado que nenhuma regra ligada produz (provável erro de digitação)', () => {
    const exige = com({}, { scenario: { name: 'e', requiredState: 'entrege' } });
    const leva = com({}, { id: 'rl', scenario: { name: 'e', newState: 'entrege' } });

    expect(neverMatches(exige, [exige], semVerificacao, [])).toEqual({
      cause: 'state',
      state: 'entrege',
    });
    expect(neverMatches(exige, [exige, leva], semVerificacao, [])).toBeNull();
    expect(neverMatches(exige, [exige, { ...leva, enabled: false }], semVerificacao, [])).toEqual({
      cause: 'state',
      state: 'entrege',
    });
    // Outro cenário com o mesmo estado não leva a ele.
    const outro = { ...leva, scenario: { name: 'f', newState: 'entrege' } };
    expect(neverMatches(exige, [exige, outro], semVerificacao, [])?.cause).toBe('state');
  });

  it('não deve acusar Started, nem o estado em que o cenário está agora (posto à mão)', () => {
    const started = com({}, { scenario: { name: 'e', requiredState: 'Started' } });
    const manual = com({}, { scenario: { name: 'e', requiredState: 'x' } });

    expect(neverMatches(started, [started], semVerificacao, [])).toBeNull();
    expect(
      neverMatches(manual, [manual], semVerificacao, [{ name: 'e', state: 'x', states: [] }]),
    ).toBeNull();
  });
});

describe('Dado o match testado e o salvo (sameMatch)', () => {
  it('deve ignorar o que vale "qualquer" e a ordem das chaves', () => {
    expect(
      sameMatch(
        { path: { equals: '/x' }, method: ['POST'], query: {}, signature: null },
        { method: ['POST'], headers: {}, body: [], path: { equals: '/x' } },
      ),
    ).toBe(true);
    expect(sameMatch(undefined, { method: [], path: null })).toBe(true);
  });

  it('deve diferenciar qualquer condição de verdade', () => {
    expect(sameMatch({ path: { equals: '/x' } }, { path: { equals: '/y' } })).toBe(false);
    expect(sameMatch({ method: ['POST'] }, {})).toBe(false);
  });
});

describe('Dado a lista inteira (diagnose)', () => {
  const token = { signature: null, schema: null };

  it('deve preferir "nunca casa" à sombra e dizer a sombra de quem', () => {
    const pix = rule(1, { name: 'Pix pago', priority: 2 });
    const copia = { ...pix, id: 'r2', name: 'Pix (copy)' };
    const assinatura = com({ signature: 'invalid' }, { id: 'r3', name: 'Assinatura', priority: 9 });
    const tudo = com({}, { id: 'r4', name: 'Tudo', priority: 3 });

    const result = diagnose([pix, copia, assinatura, tudo], token, []);

    expect(result.get(0)).toBeUndefined();
    expect(result.get(1)).toEqual({ kind: 'shadowed', by: pix });
    expect(result.get(2)).toEqual({ kind: 'never', cause: 'signature' });
    expect(result.get(3)).toBeUndefined();
  });

  it('deve dizer "Likely shadowed" só com o teste rodado e todas as casadas respondidas pela mesma regra antes', () => {
    const a = rule(1, { name: 'A', priority: 1 });
    const b = rule(2, { name: 'B', priority: 2 });
    const tested = new Map([['r2', ['m1', 'm2']]]);
    const answered = new Map([
      ['m1', 'r1'],
      ['m2', 'r1'],
    ]);

    expect(diagnose([a, b], token, [], { tested, answered }).get(1)).toEqual({
      kind: 'likely',
      by: a,
    });
    // Uma das casadas foi para outra regra (ou para a resposta padrão): não há evidência.
    const mixed = new Map([...answered, ['m2', 'r9']]);
    expect(diagnose([a, b], token, [], { tested, answered: mixed }).get(1)).toBeUndefined();
    // Sem nada casado, "todas" não prova nada.
    expect(
      diagnose([a, b], token, [], { tested: new Map([['r2', []]]), answered }).get(1),
    ).toBeUndefined();
    // Sem o teste, nada.
    expect(diagnose([a, b], token, []).get(1)).toBeUndefined();
  });
});
