import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, buscarMensagem, disparar, expect, listar, test } from '../../support/contrato.js';
import { buscar } from '../../support/busca.js';
import { lerTrace, putRegras, salvarRegras, testarRegra, type Regra, type ResultadoTesteDeRegra } from '../../support/regras.js';
import type { ResultadoDaEspera } from '../../support/espera.js';

// Decisões do Anzol, T1 (ReDoS; `.docs-arquivo/decisoes-anzol/api.md`): toda regex das condições (regras, busca,
// wait-for, trace, rules/test) e todo `pattern` de JSON Schema roda com teto de custo por avaliação. Estourou, a
// condição conta como "não casou", com a frase `<alvo>: expected to match "<padrão>", regex timed out` (o contrato
// casa `^<alvo>\b.*timed out`), e a resposta sai dentro do teto. Salvar não muda: nenhum 422 novo.
//
// `(a+)+$`, o exemplo clássico, não é catastrófico no JDK 25 (memoiza o laço simples: 24 `a` levam 9 ms). Estes são,
// medidos contra o app sem teto: `((a+)*)+$` com `a`×24 + `!` leva ~0,5 s e dobra a cada ~1 caractere a mais (×30 ≈
// 26 s); `(.*a){12}` com `a`×24 + `!` leva ~0,17 s e é polinomial de grau 12 (×40 passa de minutos). Sem o teto, cada
// requisição destes testes prende uma thread do servidor por dezenas de segundos ou mais.

const EXPONENCIAL = '((a+)*)+$';
const VALOR_EXPONENCIAL = `${'a'.repeat(30)}!`;
const POLINOMIAL = '(.*a){12}';
const VALOR_POLINOMIAL = `${'a'.repeat(40)}!`;
/** Teto medido no cliente, com folga sobre o teto do servidor (100 ms por avaliação no api.md). */
const TETO_MS = 5_000;
/** O cliente desiste antes do servidor sem teto, para o teste falhar logo (e não pelo timeout do Playwright). */
const DESISTE_MS = 15_000;
const TIMED_OUT = /timed out/i;

async function medir<T>(fazer: () => Promise<T>): Promise<{ valor: T; ms: number }> {
  const inicio = performance.now();
  const valor = await fazer();
  return { valor, ms: performance.now() - inicio };
}

/** Frase que diz que a regex estourou, para o alvo dado. */
function estourou(alvo: string): RegExp {
  return new RegExp(`^${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*timed out`, 'i');
}

const REGRA_QUERY: Regra = { name: 'catastrófica', priority: 1, match: { query: { q: { regex: EXPONENCIAL } } }, response: { status: 201 } };

async function capturar(request: APIRequestContext, tokenId: string, caminho: string, opcoes: Parameters<APIRequestContext['fetch']>[1] = {}) {
  const { valor: res, ms } = await medir(() => request.fetch(`/${tokenId}${caminho}`, { timeout: DESISTE_MS, ...opcoes }));
  return { res, ms };
}

test.describe('T1: regex catastrófica nas regras', () => {
  test('salvar não muda: a regra com a regex catastrófica é aceita', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const res = await putRegras(request, t, [REGRA_QUERY, { name: 'corpo', match: { body: [{ regex: POLINOMIAL }] } }]);
    expect(res.status(), await res.text()).toBe(200);
  });

  test('webhook: a catastrófica conta como não casou e a seguinte responde, dentro do teto', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const [, reserva] = await salvarRegras(request, t, [REGRA_QUERY, { name: 'reserva', priority: 5, response: { status: 202 } }]);
    const { res, ms } = await capturar(request, t, `/x?q=${VALOR_EXPONENCIAL}`);
    expect(ms, 'teto de tempo do webhook').toBeLessThan(TETO_MS);
    expect(res.status()).toBe(202);
    const msg = await buscarMensagem(request, t, res.headers()['x-request-id']!);
    expect(msg.rule).toEqual({ id: reserva.id, name: 'reserva' });
  });

  test('webhook sem outra regra: resposta padrão e near miss com a frase de estouro, na chave da condição', async ({ request, tokens }) => {
    const t = (await tokens.criar({ default_status: 226 })).uuid;
    const [regra] = await salvarRegras(request, t, [REGRA_QUERY]);
    const { res, ms } = await capturar(request, t, `/x?q=${VALOR_EXPONENCIAL}`);
    expect(ms, 'teto de tempo do webhook').toBeLessThan(TETO_MS);
    expect(res.status()).toBe(226);
    const msg = await buscarMensagem(request, t, res.headers()['x-request-id']!);
    expect(msg.rule).toBeNull();
    expect(msg.near_miss).toMatchObject({ id: regra.id, conditions: ['match.query.q'] });
    expect(msg.near_miss!.failed).toHaveLength(1);
    expect(msg.near_miss!.failed[0]).toMatch(estourou('query q'));
    expect(msg.near_miss!.failed[0]).toContain(EXPONENCIAL);
  });

  test('corpo com regex polinomial: não casou, dentro do teto', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await salvarRegras(request, t, [{ name: 'corpo', match: { body: [{ regex: POLINOMIAL }] }, response: { status: 201 } }]);
    const { res, ms } = await capturar(request, t, '/x', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: Buffer.from(VALOR_POLINOMIAL) });
    expect(ms).toBeLessThan(TETO_MS);
    expect(res.status()).toBe(200);
    const msg = await buscarMensagem(request, t, res.headers()['x-request-id']!);
    expect(msg.near_miss?.conditions).toEqual(['match.body.0']);
    expect(msg.near_miss!.failed[0]).toMatch(estourou('body'));
  });

  test('rules/test sobre 10 mensagens catastróficas, em caminho, cabeçalho, query e corpo: frases de estouro, dentro do teto', async ({ request, tokens }) => {
    test.setTimeout(180_000);
    const t = (await tokens.criar()).uuid;
    await disparar(request, t, 10, {
      paralelas: 5,
      opcoes: { method: 'POST', headers: { 'X-A': VALOR_EXPONENCIAL, 'Content-Type': 'text/plain' }, data: Buffer.from(VALOR_POLINOMIAL) },
    });
    // O webhook das 10 acima não tem regra: nada a estourar na captura.
    const casos: Array<[string, Regra, string]> = [
      ['header x-a', { name: 'h', match: { headers: { 'X-A': { regex: EXPONENCIAL } } } }, 'match.headers.X-A'],
      ['body', { name: 'b', match: { body: [{ regex: POLINOMIAL }] } }, 'match.body.0'],
    ];
    for (const [alvo, regra, chave] of casos) {
      const { valor: res, ms } = await medir(() => request.post(`/token/${t}/rules/test`, { data: regra, headers: JSON_ACCEPT, timeout: 60_000 }));
      expect(ms, `rules/test ${alvo}`).toBeLessThan(TETO_MS);
      expect(res.status()).toBe(200);
      const resultado = (await res.json()) as ResultadoTesteDeRegra;
      expect(resultado.matches).toEqual([]);
      expect(resultado.misses).toHaveLength(10);
      for (const miss of resultado.misses) {
        expect(miss.conditions, alvo).toEqual([chave]);
        expect(miss.failed[0], alvo).toMatch(estourou(alvo));
      }
    }
  });

  test('caminho e query também estouram com a frase certa', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await capturar(request, t, `/${VALOR_EXPONENCIAL}?q=${VALOR_EXPONENCIAL}`);
    for (const [alvo, regra] of [
      ['path', { name: 'p', match: { path: { regex: `/${EXPONENCIAL}` } } }],
      ['query q', { name: 'q', match: { query: { q: { regex: EXPONENCIAL } } } }],
    ] as Array<[string, Regra]>) {
      const { valor: res, ms } = await medir(() => testarRegra(request, t, regra));
      expect(ms, alvo).toBeLessThan(TETO_MS);
      const resultado = (await res.json()) as ResultadoTesteDeRegra;
      expect(resultado.misses[0]?.failed[0], alvo).toMatch(estourou(alvo));
    }
  });

  test('trace da mensagem: a regra catastrófica aparece com a frase de estouro', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { res } = await capturar(request, t, `/x?q=${VALOR_EXPONENCIAL}`);
    const [regra] = await salvarRegras(request, t, [REGRA_QUERY]);
    const { valor: trace, ms } = await medir(() => lerTrace(request, t, res.headers()['x-request-id']!));
    expect(ms).toBeLessThan(TETO_MS);
    expect(trace.rules[0]).toMatchObject({ id: regra.id, matches: false, conditions: ['match.query.q'] });
    expect(trace.rules[0].failed[0]).toMatch(estourou('query q'));
  });
});

test.describe('T1: regex catastrófica na busca e no wait-for', () => {
  test('busca com match catastrófico sobre 10 mensagens: 200 dentro do teto; a que casa sem estourar continua achada', async ({ request, tokens }) => {
    test.setTimeout(180_000);
    const t = (await tokens.criar()).uuid;
    await disparar(request, t, 10, { paralelas: 5, opcoes: { headers: { 'X-A': VALOR_EXPONENCIAL } } });
    const { res: limpa } = await capturar(request, t, '/limpa', { headers: { 'X-A': 'aaaa' } });
    const { valor: pagina, ms } = await medir(() => buscar(request, t, { match: { headers: { 'X-A': { regex: EXPONENCIAL } } } }));
    expect(ms, 'teto da busca').toBeLessThan(TETO_MS);
    expect(pagina.data.map((m) => m.uuid)).toEqual([limpa.headers()['x-request-id']]);
    expect(pagina.total).toBe(1);
  });

  test('wait-for com timeout 0: responde dentro do teto, sem casar, com a frase de estouro no near_miss', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await capturar(request, t, `/x?q=${VALOR_EXPONENCIAL}`);
    const { valor: res, ms } = await medir(() => request.post(`/token/${t}/requests/wait`, {
      data: { match: { query: { q: { regex: EXPONENCIAL } } }, timeout: 0 }, headers: JSON_ACCEPT, timeout: DESISTE_MS,
    }));
    expect(ms, 'teto do wait-for').toBeLessThan(TETO_MS);
    expect(res.status(), await res.text()).toBe(200);
    const espera = (await res.json()) as ResultadoDaEspera;
    expect(espera.matched).toBe(false);
    expect(espera.near_miss?.failed[0]).toMatch(estourou('query q'));
  });
});

test.describe('T1: pattern catastrófico no JSON Schema', () => {
  test('salvar é aceito; a captura responde dentro do teto e grava o schema inválido com o estouro no caminho', async ({ request, tokens }) => {
    const token = await tokens.criar({
      default_status: 202,
      schema: { type: 'object', properties: { nome: { type: 'string', pattern: `^${EXPONENCIAL}` }, ok: { type: 'integer' } } },
    });
    const { res, ms } = await capturar(request, token.uuid, '/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from(JSON.stringify({ nome: VALOR_EXPONENCIAL, ok: 1 })),
    });
    expect(ms, 'teto da captura com schema').toBeLessThan(TETO_MS);
    expect(res.status()).toBe(202);
    const msg = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(msg.schema?.valid).toBe(false);
    const erro = msg.schema!.errors.find((e) => e.path === '/nome');
    expect(erro, JSON.stringify(msg.schema)).toBeDefined();
    expect(erro!.message).toMatch(TIMED_OUT);

    // O mesmo pattern com um valor comum continua validando como sempre.
    const { res: comum } = await capturar(request, token.uuid, '/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from(JSON.stringify({ nome: 'aaaa', ok: 1 })),
    });
    expect((await buscarMensagem(request, token.uuid, comum.headers()['x-request-id']!)).schema).toEqual({ valid: true, errors: [] });
    expect((await listar(request, token.uuid)).total).toBe(2);
  });
});
