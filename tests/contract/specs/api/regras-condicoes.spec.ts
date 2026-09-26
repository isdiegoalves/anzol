import { enviarEGuardar, expect, listar, test, type Mensagem } from '../../support/contrato.js';
import { assinar } from '../../support/eventos.js';
import { buscar } from '../../support/busca.js';
import { esperar } from '../../support/espera.js';
import { compartilhar, lerLink } from '../../support/privacidade.js';
import { salvarRegras, testarRegra, type Regra, type ResultadoTesteDeRegra } from '../../support/regras.js';

// Item 14, B1 (§1 "API dos extras de backend"): o near miss diz QUAL condição produziu cada frase. `conditions[i]` é a
// chave da condição de `failed[i]`: mesmo tamanho, mesma ordem (método, caminho, query, cabeçalhos, corpo, assinatura,
// schema, cenário). Chaves: `match.method`, `match.path`, `match.query.<nome como na regra>`,
// `match.headers.<nome como na regra>`, `match.body.<índice em match.body>`, `match.signature`, `match.schema` e
// `scenario`, no formato das chaves do 422 do `rules/test` sem o índice da lista. Aparece no `near_miss` da mensagem
// (GET, listagem, busca, evento SSE, link só-leitura), em `rules/test` (`misses[].conditions`) e no `wait`
// (`near_miss.conditions`, só `match.*`).

const SEGREDO = 'segredo-das-condicoes';
const SCHEMA = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };
/** Com assinatura GitHub e schema: as condições `match.signature` e `match.schema` têm o que conferir. */
const CONFIG_DA_URL = { signature: { provider: 'github', secret: SEGREDO }, schema: SCHEMA };

/** Frase de `failed` que cada tipo de chave produz (o contrato casa o começo da frase, como `expectFalhas`). */
function fraseDa(chave: string): RegExp {
  const nome = /^match\.(query|headers)\.(.+)$/.exec(chave);
  if (nome) {
    const alvo = nome[1] === 'query' ? 'query' : 'header';
    return new RegExp(`^${alvo} ${nome[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  }
  if (/^match\.body\.\d+$/.test(chave)) return /^body\b/;
  const simples: Record<string, RegExp> = {
    'match.method': /^method\b/,
    'match.path': /^path\b/,
    'match.signature': /^signature\b/,
    'match.schema': /^schema\b/,
    scenario: /^scenario\b/,
  };
  expect(simples[chave], `chave desconhecida: ${chave}`).toBeDefined();
  return simples[chave];
}

/** `conditions` do tamanho de `failed`, e cada `failed[i]` é a frase da condição `conditions[i]`. */
function expectAlinhadas(quase: { failed: string[]; conditions: string[] | null } | null | undefined): string[] {
  expect(quase, 'near miss ausente').toBeTruthy();
  const { failed, conditions } = quase!;
  expect(Array.isArray(conditions), `conditions deve ser lista: ${JSON.stringify(quase)}`).toBe(true);
  expect(conditions!, JSON.stringify(quase)).toHaveLength(failed.length);
  conditions!.forEach((chave, i) => expect(failed[i], `failed[${i}] vs conditions[${i}] = ${chave}`).toMatch(fraseDa(chave)));
  return conditions!;
}

/** A regra que falha nas oito condições, uma de cada tipo, contra `POST /outra?tipo=boleto` com corpo `abc`. */
const FALHA_EM_TUDO: Regra = {
  name: 'falha em tudo',
  match: {
    method: ['PUT'],
    path: { equals: '/pagamentos' },
    query: { tipo: { equals: 'pix' } },
    headers: { 'X-Signature': { present: true } },
    // O primeiro item casa ("abc" contém "abc"): a chave aponta o índice do que falhou.
    body: [{ contains: 'abc' }, { contains: 'zzz' }],
    signature: 'valid',
    schema: 'valid',
  },
  scenario: { name: 'pagamento', requiredState: 'pago' },
  response: { status: 201 },
};

const TODAS_AS_CHAVES = [
  'match.method', 'match.path', 'match.query.tipo', 'match.headers.X-Signature', 'match.body.1',
  'match.signature', 'match.schema', 'scenario',
];

const enviarFalhaEmTudo = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('abc') };

test.describe('near_miss.conditions (item 14, B1)', () => {
  test('uma chave por frase de failed, na ordem da avaliação: método, caminho, query, cabeçalho, corpo, assinatura, schema, cenário', async ({ request, tokens }) => {
    const token = await tokens.criar(CONFIG_DA_URL);
    const [salva] = await salvarRegras(request, token.uuid, [FALHA_EM_TUDO]);

    const { res, msg } = await enviarEGuardar(request, token.uuid, '/outra?tipo=boleto', enviarFalhaEmTudo);

    expect(res.status()).toBe(200);
    expect(msg.rule).toBeNull();
    expect(Object.keys(msg.near_miss!).sort()).toEqual(['conditions', 'failed', 'id', 'name']);
    expect(msg.near_miss).toMatchObject({ id: salva.id, name: 'falha em tudo' });
    expect(expectAlinhadas(msg.near_miss)).toEqual(TODAS_AS_CHAVES);
  });

  // Cada tipo de chave sozinho: a regra falha só naquela condição.
  const CASOS: Array<{ tipo: string; regra: Regra; caminho: string; envio: Parameters<typeof enviarEGuardar>[3]; chave: string }> = [
    { tipo: 'método', regra: { match: { method: ['POST'] } }, caminho: '', envio: { method: 'GET' }, chave: 'match.method' },
    { tipo: 'caminho', regra: { match: { path: { equals: '/a' } } }, caminho: '/b', envio: { method: 'GET' }, chave: 'match.path' },
    {
      tipo: 'query, com o nome como na regra', regra: { match: { query: { Pedido: { equals: '1' } } } },
      caminho: '?Pedido=2', envio: { method: 'GET' }, chave: 'match.query.Pedido',
    },
    {
      tipo: 'cabeçalho, com o nome como na regra (não o normalizado)', regra: { match: { headers: { 'X-Canal': { equals: 'pix' } } } },
      caminho: '', envio: { method: 'GET', headers: { 'x-canal': 'boleto' } }, chave: 'match.headers.X-Canal',
    },
    {
      tipo: 'corpo, com o índice em match.body', regra: { match: { body: [{ contains: 'a' }, { contains: 'b' }, { contains: 'z' }] } },
      caminho: '', envio: { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from('ab') }, chave: 'match.body.2',
    },
    {
      tipo: 'assinatura', regra: { match: { signature: 'valid' } },
      caminho: '', envio: { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from('{"id":1}') }, chave: 'match.signature',
    },
    {
      tipo: 'schema', regra: { match: { schema: 'valid' } },
      caminho: '', envio: { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from('{"id":"um"}') }, chave: 'match.schema',
    },
    {
      tipo: 'cenário', regra: { scenario: { name: 'fluxo', requiredState: 'pago' } },
      caminho: '', envio: { method: 'GET' }, chave: 'scenario',
    },
  ];

  test('cada tipo de chave, sozinho', async ({ request, tokens }) => {
    const token = await tokens.criar(CONFIG_DA_URL);
    for (const caso of CASOS) {
      const [salva] = await salvarRegras(request, token.uuid, [{ name: caso.tipo, ...caso.regra }]);
      const { msg } = await enviarEGuardar(request, token.uuid, caso.caminho, caso.envio);
      expect(msg.near_miss, caso.tipo).toMatchObject({ id: salva.id, name: caso.tipo });
      expect(expectAlinhadas(msg.near_miss), caso.tipo).toEqual([caso.chave]);
    }
  });

  test('o mesmo conditions no GET da mensagem, na listagem, na busca, no evento SSE e no link só-leitura (mascarado)', async ({ request, tokens }) => {
    const token = await tokens.criar(CONFIG_DA_URL);
    await salvarRegras(request, token.uuid, [FALHA_EM_TUDO]);
    const canal = await assinar(token.uuid);
    try {
      const { msg } = await enviarEGuardar(request, token.uuid, '/outra?tipo=boleto', enviarFalhaEmTudo);
      expect(msg.near_miss!.conditions).toEqual(TODAS_AS_CHAVES);

      const evento = await canal.proximo();
      expect(evento.request.uuid).toBe(msg.uuid);
      expect(evento.request.near_miss, 'evento request.created').toEqual(msg.near_miss);

      const [listada] = (await listar(request, token.uuid)).data;
      expect(listada.near_miss, 'listagem').toEqual(msg.near_miss);

      const [achada] = (await buscar(request, token.uuid, { match: { method: ['POST'] } })).data;
      expect(achada.near_miss, 'busca').toEqual(msg.near_miss);

      // A máscara do link não mexe em `conditions`: o campo não carrega valores.
      const link = await compartilhar(token.uuid, msg.uuid, { redact: true });
      const publica = await lerLink(link.id);
      expect(publica.status, publica.texto.slice(0, 300)).toBe(200);
      expect(publica.json<Mensagem>().near_miss, 'link só-leitura').toEqual(msg.near_miss);
    } finally {
      await canal.fechar();
    }
  });

  test('rules/test: misses[].conditions alinhado com failed', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const json = { 'Content-Type': 'application/json' };
    const { msg: pendente } = await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'POST', headers: json, data: Buffer.from('{"status":"pendente"}') });
    const { msg: outra } = await enviarEGuardar(request, token.uuid, '/outra?tipo=boleto', { method: 'GET' });

    const res = await testarRegra(request, token.uuid, {
      name: 'pago',
      match: {
        method: ['POST'],
        path: { equals: '/pagamentos' },
        query: { tipo: { present: false } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const resultado = (await res.json()) as ResultadoTesteDeRegra;

    expect(resultado.misses).toHaveLength(2);
    for (const miss of resultado.misses) expect(Object.keys(miss).sort()).toEqual(['conditions', 'failed', 'seq', 'uuid']);
    expect(expectAlinhadas(resultado.misses.find((m) => m.uuid === pendente.uuid))).toEqual(['match.body.0']);
    expect(expectAlinhadas(resultado.misses.find((m) => m.uuid === outra.uuid)))
      .toEqual(['match.method', 'match.path', 'match.query.tipo', 'match.body.0']);
  });

  test('wait: near_miss.conditions com as chaves match.* do match da espera', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'GET', headers: { 'x-canal': 'boleto' } });

    const { resultado } = await esperar(request, token.uuid, {
      match: {
        method: ['POST'],
        path: { equals: '/pagamentos' },
        headers: { 'X-Signature': { present: true }, 'X-Canal': { equals: 'pix' } },
      },
      timeout: 0,
    });

    expect(resultado.matched).toBe(false);
    expect(resultado.near_miss).toMatchObject({ uuid: msg.uuid, seq: msg.seq });
    const chaves = expectAlinhadas(resultado.near_miss);
    // A ordem entre dois cabeçalhos é a da avaliação, que o contrato não fixa; o método vem antes deles.
    expect(chaves[0]).toBe('match.method');
    expect([...chaves].sort()).toEqual(['match.headers.X-Canal', 'match.headers.X-Signature', 'match.method']);
    expect(chaves).not.toContain('scenario');
  });
});
