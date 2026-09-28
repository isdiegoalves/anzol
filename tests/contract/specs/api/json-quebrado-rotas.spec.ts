import {
  HORA, capturar, comSegredo, cookieDeAcesso, desbloquear, expect, expect401Protegida, http, instante, test,
  type Link, type Resposta,
} from '../../support/privacidade.js';

// Patamar, fatia D1, complemento do DX-02: o JSON quebrado também é recusado nas outras duas rotas de gestão que leem
// campos do corpo. Com `Content-Type` JSON, corpo com bytes que não é um objeto JSON → 400 no envelope de erro, com a
// MESMA resposta do `POST /token` para o mesmo corpo, e nada é criado:
// - `POST /token/{id}/request/{rid}/share`: antes criava o link com os padrões (201);
// - `POST /token/{id}/unlock`: antes lia como pedido sem `secret` (422).
// Corpo vazio e `{}` ficam como sempre, e o objeto válido sem `secret` continua 422. As rotas que leem o corpo cru
// (regras, cenários, busca, espera, envio, reenvio, IA) já recusavam com o 422 delas e não mudam.

/** Os mesmos corpos de `token-json.spec.ts`: os que não se leem e os JSON válidos que não são objeto. */
const NAO_OBJETO: Array<[string, string]> = [
  ['truncado', '{"redact": false'],
  ['chave sem aspas', '{secret: "x"}'],
  ['lixo depois do objeto', '{"redact": false} x'],
  ['texto solto', 'secret=abc'],
  ['lista', '[1,2]'],
  ['lista de objetos', '[{"secret": "x"}]'],
  ['texto JSON', '"x"'],
  ['número', '42'],
  ['booleano', 'true'],
  ['null', 'null'],
];

const TIPOS_JSON = ['application/json', 'application/json; charset=utf-8', 'application/vnd.api+json'];

/** O 400 que o `POST /token` dá para o mesmo corpo: a referência de "a mesma mensagem". */
async function referencia(corpo: string): Promise<unknown> {
  const res = await http('POST', '/token', { corpo });
  if (res.status === 201) await http('DELETE', `/token/${res.json<{ uuid: string }>().uuid}`);
  expect(res.status, `pré-condição: o POST /token recusa ${JSON.stringify(corpo)}: ${res.texto.slice(0, 200)}`).toBe(400);
  return res.json();
}

/** 400 em JSON, no envelope de erro, igual ao do `POST /token`. */
function expect400(res: Resposta, igualA: unknown, contexto: string): void {
  expect(res.status, `${contexto}: ${res.texto.slice(0, 300)}`).toBe(400);
  expect(res.headers.get('content-type') ?? '', contexto).toMatch(/^application\/json/i);
  const corpo = res.json<{ success?: unknown; error?: { message?: unknown; id?: unknown } }>();
  expect(corpo.success, contexto).toBe(false);
  expect(corpo.error, contexto).toHaveProperty('id', null);
  expect(String(corpo.error?.message), contexto).toMatch(/JSON/);
  expect(corpo, `${contexto}: a mesma resposta do POST /token`).toEqual(igualA);
}

async function links(uuid: string, headers: Record<string, string> = {}): Promise<Array<{ id: string }>> {
  const res = await http('GET', `/token/${uuid}/shares`, { headers });
  expect(res.status, res.texto.slice(0, 300)).toBe(200);
  return res.json();
}

test.describe('JSON quebrado ao criar o link só-leitura', () => {
  test('cada corpo que não é objeto: 400 igual ao do POST /token, e nenhum link criado', async ({ urls }) => {
    const url = await urls.abrir();
    const rid = await capturar(url.uuid, '/pedido');
    for (const [caso, corpo] of NAO_OBJETO) {
      const esperado = await referencia(corpo);
      const res = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo });
      expect400(res, esperado, caso);
    }
    expect(await links(url.uuid)).toEqual([]);
  });

  test('charset e +json também contam; sem Accept o 400 é o mesmo', async ({ urls }) => {
    const url = await urls.abrir();
    const rid = await capturar(url.uuid, '/pedido');
    const corpo = '{"redact": false';
    const esperado = await referencia(corpo);
    for (const tipo of TIPOS_JSON) {
      const res = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo, headers: { 'Content-Type': tipo } });
      expect400(res, esperado, tipo);
    }
    const semAccept = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo, headers: { Accept: '*/*' } });
    expect400(semAccept, esperado, 'Accept */*');
    expect(await links(url.uuid)).toEqual([]);
  });

  test('URL protegida: com o segredo, 400 e nenhum link; sem o segredo, o 401 de sempre', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const rid = await capturar(url.uuid, '/pedido');
    const corpo = '{"expires_in": "1h"';
    expect400(await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo, headers: h }), await referencia(corpo), 'com o segredo');
    expect401Protegida(await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo }), 'sem o segredo');
    expect(await links(url.uuid, h)).toEqual([]);
  });

  test('continua valendo: corpo vazio e {} criam o link com os padrões; objeto válido com valor inválido → 422', async ({ urls }) => {
    const url = await urls.abrir();
    const rid = await capturar(url.uuid, '/pedido');
    const casos: Array<[string, string | undefined, Record<string, string>]> = [
      ['sem corpo e sem Content-Type', undefined, {}],
      ['JSON sem corpo', '', { 'Content-Type': 'application/json' }],
      ['JSON {}', '{}', {}],
    ];
    for (const [caso, corpo, headers] of casos) {
      const antes = Date.now();
      const res = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo, headers });
      expect([200, 201], `${caso}: ${res.status} ${res.texto.slice(0, 200)}`).toContain(res.status);
      const link = res.json<Link>();
      expect(link.redact, caso).toBe(true);
      expect(Math.abs(instante(link.expires_at) - (antes + 7 * 24 * HORA)), `${caso}: expira em 7 dias`).toBeLessThanOrEqual(120_000);
    }
    expect(await links(url.uuid)).toHaveLength(3);

    const invalido = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { corpo: { expires_in: '2h' } });
    expect(invalido.status, invalido.texto.slice(0, 200)).toBe(422);
    expect(invalido.json()).toHaveProperty('expires_in');
    expect(await links(url.uuid)).toHaveLength(3);
  });
});

test.describe('JSON quebrado no unlock', () => {
  test('cada corpo que não é objeto: 400 igual ao do POST /token, sem cookie', async ({ urls }) => {
    const url = await urls.proteger();
    for (const [caso, corpo] of NAO_OBJETO) {
      const esperado = await referencia(corpo);
      const res = await http('POST', `/token/${url.uuid}/unlock`, { corpo });
      expect400(res, esperado, caso);
      expect(res.setCookies, `${caso}: nenhum cookie`).toEqual([]);
    }
    for (const tipo of TIPOS_JSON) {
      const corpo = `{"secret": "${url.segredo}"`;
      const res = await http('POST', `/token/${url.uuid}/unlock`, { corpo, headers: { 'Content-Type': tipo } });
      expect400(res, await referencia(corpo), tipo);
      // O segredo certo dentro de um JSON truncado não desbloqueia, e não volta na resposta.
      expect(res.setCookies, tipo).toEqual([]);
      expect(res.texto, tipo).not.toContain(url.segredo);
    }
  });

  test('o corpo quebrado não conta como segredo errado: depois de 12, o segredo certo ainda desbloqueia', async ({ urls }) => {
    // SUPOSIÇÃO: o limite de 10 falhas por minuto conta segredos errados (401); o 400 não chegou a conferir segredo.
    const url = await urls.proteger();
    for (let i = 0; i < 12; i++) {
      const res = await http('POST', `/token/${url.uuid}/unlock`, { corpo: '{"secret": "errado"' });
      expect(res.status, `${i + 1}º corpo quebrado`).toBe(400);
    }
    const certo = await desbloquear(url.uuid, url.segredo);
    expect(certo.status, certo.texto.slice(0, 200)).toBe(204);
    cookieDeAcesso(certo);
  });

  test('URL aberta: o corpo quebrado também dá 400', async ({ urls }) => {
    const url = await urls.abrir();
    const corpo = '[1,2]';
    expect400(await http('POST', `/token/${url.uuid}/unlock`, { corpo }), await referencia(corpo), 'URL aberta');
  });

  test('continua valendo: corpo vazio, {} e objeto sem secret em texto → 422 em secret; certo → 204; errado → 401', async ({ urls }) => {
    const url = await urls.proteger();
    const semSegredo: Array<[string, string | undefined, Record<string, string>]> = [
      ['sem corpo e sem Content-Type', undefined, {}],
      ['JSON sem corpo', '', { 'Content-Type': 'application/json' }],
      ['JSON {}', '{}', {}],
      ['outro campo', '{"senha": "x"}', {}],
      ['secret null', '{"secret": null}', {}],
      ['secret vazio', '{"secret": ""}', {}],
      ['secret número', '{"secret": 5}', {}],
    ];
    for (const [caso, corpo, headers] of semSegredo) {
      const res = await http('POST', `/token/${url.uuid}/unlock`, { corpo, headers });
      expect(res.status, `${caso}: ${res.texto.slice(0, 200)}`).toBe(422);
      expect(res.json(), caso).toHaveProperty('secret');
      expect(res.setCookies, caso).toEqual([]);
    }
    expect((await desbloquear(url.uuid, `${url.segredo}x`)).status).toBe(401);
    const certo = await desbloquear(url.uuid, url.segredo);
    expect(certo.status).toBe(204);
    cookieDeAcesso(certo);
    // O formulário, que não é JSON, continua desbloqueando.
    const form = await http('POST', `/token/${url.uuid}/unlock`, {
      corpo: `secret=${encodeURIComponent(url.segredo)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status, form.texto.slice(0, 200)).toBe(204);
  });
});
