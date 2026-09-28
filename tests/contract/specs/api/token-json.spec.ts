import net from 'node:net';
import { BASE_URL, JSON_ACCEPT, UUID, enviarEGuardar, expect, test, tipoDeMidia, type Token, type Tokens } from '../../support/contrato.js';
import { assinaturaGithub } from '../../support/assinatura.js';

// Patamar, fatia D1 (`.docs-arquivo/patamar/api-defeitos.md`, itens 1 e 2).
//
// DX-02: com `Content-Type` JSON, o corpo com bytes que não é um objeto JSON (truncado, ou lista, texto, número,
// `null`) → 400 no envelope de erro, e nada é criado nem alterado. Antes, o `POST /token` criava com os padrões e o
// `PUT /token/{id}` voltava a URL inteira aos padrões com 200. Corpo vazio, `{}` e `Content-Type` que não é JSON
// ficam como sempre.
//
// DX-01: pedido com `Content-Type` JSON recebe o 422 de validação em JSON mesmo sem `Accept` (antes, 302 para a
// raiz), em `POST /token`, `PUT /token/{id}` e `GET /token/{id}/requests`. O formulário e a query string sem `Accept`
// continuam com o 302 de hoje.

const URL_BASE = new URL(BASE_URL);
const JSON_CT = { 'Content-Type': 'application/json' };

interface Cru {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

/**
 * HTTP/1.1 à mão, só com os cabeçalhos pedidos: o `fetch` do Node e o `request` do Playwright mandam `Accept: *\/*`
 * por conta própria, e aqui o caso é o pedido SEM `Accept`. Não segue redirecionamento.
 */
function cru(metodo: string, alvo: string, headers: Record<string, string> = {}, corpo?: string): Promise<Cru> {
  const linhas = [`${metodo} ${alvo} HTTP/1.1`, `Host: ${URL_BASE.host}`, 'Connection: close'];
  for (const [n, v] of Object.entries(headers)) linhas.push(`${n}: ${v}`);
  if (corpo !== undefined) linhas.push(`Content-Length: ${Buffer.byteLength(corpo)}`);
  const pedido = `${linhas.join('\r\n')}\r\n\r\n${corpo ?? ''}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(URL_BASE.port || 80), URL_BASE.hostname, () => socket.write(pedido));
    const partes: Buffer[] = [];
    socket.on('data', (p: Buffer) => partes.push(p));
    socket.on('error', reject);
    socket.setTimeout(20_000, () => socket.destroy(new Error('timeout no HTTP cru')));
    socket.on('close', () => {
      const bruto = Buffer.concat(partes);
      const fim = bruto.indexOf('\r\n\r\n');
      const [linhaStatus, ...resto] = bruto.subarray(0, fim).toString('latin1').split('\r\n');
      const h: Record<string, string> = {};
      for (const l of resto) h[l.slice(0, l.indexOf(':')).trim().toLowerCase()] = l.slice(l.indexOf(':') + 1).trim();
      let dados = bruto.subarray(fim + 4);
      if ((h['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
        const pedacos: Buffer[] = [];
        for (;;) {
          const eol = dados.indexOf('\r\n');
          const tamanho = eol < 0 ? 0 : parseInt(dados.subarray(0, eol).toString('latin1'), 16);
          if (!tamanho) break;
          pedacos.push(dados.subarray(eol + 2, eol + 2 + tamanho));
          dados = dados.subarray(eol + 2 + tamanho + 2);
        }
        dados = Buffer.concat(pedacos);
      }
      resolve({ status: Number(linhaStatus.split(' ')[1]), headers: h, corpo: dados.toString('utf8') });
    });
  });
}

/** Se o servidor criou uma URL onde devia recusar, ela é registrada para limpeza antes de o teste falhar. */
function registrarSeCriou(tokens: Tokens, res: Cru): void {
  try {
    const uuid = (JSON.parse(res.corpo) as { uuid?: unknown }).uuid;
    if (res.status === 201 && typeof uuid === 'string' && UUID.test(uuid)) tokens.registrar(uuid);
  } catch {
    // Não é JSON: nada foi criado por esta resposta.
  }
}

/** 400 no envelope de erro, em JSON, com uma frase que cita JSON. */
function expect400(res: Cru, contexto: string): void {
  expect(res.status, `${contexto}: ${res.corpo.slice(0, 300)}`).toBe(400);
  expect(tipoDeMidia(res.headers['content-type'] ?? '').tipo, contexto).toBe('application/json');
  const corpo = JSON.parse(res.corpo) as { success?: unknown; error?: { message?: unknown; id?: unknown } };
  expect(corpo.success, contexto).toBe(false);
  expect(corpo.error, contexto).toHaveProperty('id', null);
  expect(typeof corpo.error?.message, contexto).toBe('string');
  expect(corpo.error!.message as string, contexto).toMatch(/JSON/);
}

/** 422 de validação em JSON, com exatamente a mensagem esperada na chave. */
function expect422(res: Cru, esperado: Record<string, string[]>, contexto: string): void {
  expect(res.status, `${contexto}: ${res.corpo.slice(0, 300)}`).toBe(422);
  expect(tipoDeMidia(res.headers['content-type'] ?? '').tipo, contexto).toBe('application/json');
  expect(JSON.parse(res.corpo), contexto).toEqual(esperado);
}

/** Corpos que não são um objeto JSON: os que não se leem e os JSON válidos de outro tipo. */
const NAO_OBJETO: Array<[string, string]> = [
  ['truncado', '{"default_status": 201'],
  ['chave sem aspas', '{default_status: 201}'],
  ['lixo depois do objeto', '{"default_status": 201} x'],
  ['texto solto', 'default_status=201'],
  ['lista', '[1,2]'],
  ['lista de objetos', '[{"default_status": 201}]'],
  ['texto JSON', '"x"'],
  ['número', '42'],
  ['booleano', 'true'],
  ['null', 'null'],
];

const TIMEOUT_INVALIDO = { timeout: ['The timeout may not be greater than 10.'] };

async function lerToken(request: Parameters<typeof enviarEGuardar>[0], uuid: string): Promise<Token> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Token;
}

test.describe('DX-02: JSON quebrado no POST /token', () => {
  for (const [caso, corpo] of NAO_OBJETO) {
    test(`${caso}: 400 no envelope de erro, nada criado`, async ({ tokens }) => {
      for (const tipo of ['application/json', 'application/json; charset=utf-8', 'application/vnd.api+json']) {
        const res = await cru('POST', '/token', { 'Content-Type': tipo, Accept: 'application/json' }, corpo);
        registrarSeCriou(tokens, res);
        expect400(res, `${tipo} ${caso}`);
      }
    });
  }

  test('sem Accept: o mesmo 400 em JSON (o pedido é JSON)', async ({ tokens }) => {
    const res = await cru('POST', '/token', JSON_CT, '{"timeout":');
    registrarSeCriou(tokens, res);
    expect400(res, 'sem Accept');
  });

  test('continua valendo: corpo vazio, {} e Content-Type que não é JSON criam com os padrões', async ({ tokens }) => {
    const casos: Array<[string, Record<string, string>, string | undefined]> = [
      ['JSON sem corpo', JSON_CT, ''],
      ['JSON {}', JSON_CT, '{}'],
      ['sem Content-Type e sem corpo', {}, undefined],
      // O corpo que não é JSON nem formulário é ignorado, como sempre.
      ['text/plain com JSON truncado', { 'Content-Type': 'text/plain' }, '{"default_status": 201'],
    ];
    for (const [caso, headers, corpo] of casos) {
      const res = await cru('POST', '/token', { ...headers, Accept: 'application/json' }, corpo);
      registrarSeCriou(tokens, res);
      expect(res.status, `${caso}: ${res.corpo.slice(0, 200)}`).toBe(201);
      expect(JSON.parse(res.corpo), caso).toMatchObject({ default_status: 200, default_content: '', default_content_type: 'text/plain', timeout: 0 });
    }
  });
});

test.describe('DX-02: JSON quebrado no PUT /token/{id}', () => {
  const SEGREDO = 'segredo-json-quebrado-4Tz8';
  const CONFIG = {
    default_status: 418,
    default_content: 'oi',
    default_content_type: 'text/html',
    timeout: 1,
    retry_after: 7,
    auto_cleanup: 1000,
    signature: { provider: 'github', secret: SEGREDO },
    schema: { type: 'object', required: ['id'] },
  };

  test('cada corpo que não é objeto: 400, e a configuração da URL fica intacta', async ({ request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    expect(antes).toMatchObject({ default_status: 418, default_content: 'oi', timeout: 1, retry_after: 7, auto_cleanup: 1000, schema: CONFIG.schema });
    expect(antes.signature?.provider).toBe('github');

    for (const [caso, corpo] of NAO_OBJETO) {
      const res = await cru('PUT', `/token/${token.uuid}`, { ...JSON_CT, Accept: 'application/json' }, corpo);
      expect400(res, caso);
      expect(await lerToken(request, token.uuid), `${caso}: a URL depois do PUT recusado`).toEqual(antes);
    }
    const semAccept = await cru('PUT', `/token/${token.uuid}`, JSON_CT, '{"default_status":201');
    expect400(semAccept, 'sem Accept');
    expect(await lerToken(request, token.uuid)).toEqual(antes);

    // A URL continua respondendo e conferindo como configurada: o segredo também ficou.
    const corpo = '{"id":1}';
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/depois', {
      method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, corpo) }, data: Buffer.from(corpo),
    });
    expect(res.status()).toBe(418);
    expect(await res.text()).toBe('oi');
    expect(res.headers()['retry-after']).toBe('7');
    expect(msg.signature).toEqual({ provider: 'github', valid: true, reason: null });
    expect(msg.schema).toEqual({ valid: true, errors: [] });
  });

  test('continua valendo: PUT com corpo vazio e com {} volta aos padrões', async ({ request, tokens }) => {
    for (const corpo of ['', '{}']) {
      const token = await tokens.criar(CONFIG);
      const res = await cru('PUT', `/token/${token.uuid}`, { ...JSON_CT, Accept: 'application/json' }, corpo);
      expect(res.status, `corpo ${JSON.stringify(corpo)}: ${res.corpo.slice(0, 200)}`).toBe(200);
      expect(await lerToken(request, token.uuid)).toMatchObject({
        default_status: 200, default_content: '', default_content_type: 'text/plain', timeout: 0, retry_after: null, auto_cleanup: null,
        signature: null, schema: null,
      });
    }
  });
});

test.describe('DX-01: validação de pedido JSON responde 422, não 302', () => {
  for (const [caso, accept] of [['sem Accept', {}], ['Accept: */* (o padrão do curl)', { Accept: '*/*' }]] as Array<[string, Record<string, string>]>) {
    test(`POST /token, ${caso}: 422 em JSON`, async ({ tokens }) => {
      const res = await cru('POST', '/token', { ...JSON_CT, ...accept }, '{"timeout":11}');
      registrarSeCriou(tokens, res);
      expect422(res, TIMEOUT_INVALIDO, caso);
      expect(res.headers).not.toHaveProperty('location');
    });

    test(`PUT /token/{id}, ${caso}: 422 em JSON, e a URL não muda`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_status: 201, timeout: 2 });
      const antes = await lerToken(request, token.uuid);
      const res = await cru('PUT', `/token/${token.uuid}`, { ...JSON_CT, ...accept }, '{"timeout":11}');
      expect422(res, TIMEOUT_INVALIDO, caso);
      expect(await lerToken(request, token.uuid)).toEqual(antes);
    });

    test(`GET /token/{id}/requests, ${caso}: 422 em JSON`, async ({ tokens }) => {
      const token = await tokens.criar();
      const res = await cru('GET', `/token/${token.uuid}/requests?after=abc`, { ...JSON_CT, ...accept });
      expect422(res, { after: ['The after must be an integer.'] }, caso);
    });
  }

  test('+json e charset também contam como pedido JSON', async ({ tokens }) => {
    for (const tipo of ['application/json; charset=utf-8', 'application/vnd.api+json']) {
      const res = await cru('POST', '/token', { 'Content-Type': tipo }, '{"timeout":11}');
      registrarSeCriou(tokens, res);
      expect422(res, TIMEOUT_INVALIDO, tipo);
    }
  });
});

test.describe('DX-01: o cliente que não manda JSON continua como hoje (guarda)', () => {
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

  test('formulário inválido sem Accept: 302 para a raiz, ou para o Referer', async ({ tokens }) => {
    const raiz = await cru('POST', '/token', FORM, 'timeout=11');
    registrarSeCriou(tokens, raiz);
    expect(raiz.status, raiz.corpo.slice(0, 200)).toBe(302);
    expect(raiz.headers['location']).toBe(URL_BASE.origin);

    const anterior = `${URL_BASE.origin}/pagina`;
    const comReferer = await cru('POST', '/token', { ...FORM, Referer: anterior }, 'timeout=11');
    registrarSeCriou(tokens, comReferer);
    expect(comReferer.status).toBe(302);
    expect(comReferer.headers['location']).toBe(anterior);
  });

  test('PUT por formulário e query string inválidos sem Accept: 302', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 201 });
    const antes = await lerToken(request, token.uuid);
    const put = await cru('PUT', `/token/${token.uuid}`, FORM, 'timeout=11');
    expect(put.status, put.corpo.slice(0, 200)).toBe(302);
    expect(await lerToken(request, token.uuid)).toEqual(antes);

    const query = await cru('POST', '/token?timeout=11');
    registrarSeCriou(tokens, query);
    expect(query.status, query.corpo.slice(0, 200)).toBe(302);
  });

  test('GET /token/{id}/requests inválido sem Content-Type e sem Accept: 302', async ({ tokens }) => {
    const token = await tokens.criar();
    const res = await cru('GET', `/token/${token.uuid}/requests?after=abc`);
    expect(res.status, res.corpo.slice(0, 200)).toBe(302);
  });

  test('formulário inválido com Accept JSON ou X-Requested-With: 422, como sempre', async ({ tokens }) => {
    for (const headers of [{ Accept: 'application/json' }, { 'X-Requested-With': 'XMLHttpRequest' }] as Array<Record<string, string>>) {
      const res = await cru('POST', '/token', { ...FORM, ...headers }, 'timeout=11');
      registrarSeCriou(tokens, res);
      expect422(res, TIMEOUT_INVALIDO, JSON.stringify(headers));
    }
  });
});
