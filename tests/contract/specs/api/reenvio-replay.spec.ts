import { enviarEGuardar, buscarMensagem, expect, httpCru, UUID } from '../../support/contrato.js';
import {
  ALVO_HOST, filtrado, historico, nomesDosHeaders, replay, test, valorDoHeader,
} from '../../support/reenvio.js';

// Replay pelo servidor (CA-1 do plano "reenvio-servidor", §1): `POST /token/{id}/request/{rid}/replay`
// `{url, keep_path (padrão true), timeout?}` reenvia a mensagem gravada com o método, os headers (menos os
// da lista da §1) e o corpo byte a byte; `keep_path` acrescenta ao alvo o caminho depois do token e a query
// da mensagem. A resposta do alvo volta no resultado e fica no histórico.

const JSON_CT = { 'Content-Type': 'application/json' };

/** JSON com CRLF, tab, espaços sobrando, acentos, emoji e escape de NUL: os bytes têm de chegar iguais. */
const CORPO_ESTRANHO = '{"a" : 1,\r\n\t"é": "ção 😀",   "nul": "\\u0000", "barra": "a\\/b"}  \n';

test.describe('replay: caminho e query (CA-1)', () => {
  test('keep_path ausente (padrão true) → caminho depois do token e query da mensagem acrescentados ao alvo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '/pedidos/42?pais=caf%C3%A9&n=1', { method: 'POST', headers: JSON_CT, data: Buffer.from('{}') });

    const r = await replay(request, t, msg.uuid, { url: receptor.url });

    expect(receptor.recebidas).toHaveLength(1);
    const chegou = new URL(receptor.recebidas[0].url, 'http://receptor');
    expect(chegou.pathname).toBe('/pedidos/42');
    expect(Object.fromEntries(chegou.searchParams)).toEqual({ pais: 'café', n: '1' });

    expect(r.kind).toBe('replay');
    expect(r.source_request).toBe(msg.uuid);
    expect(r.method).toBe('POST');
    const alvo = new URL(r.target);
    expect(alvo.hostname).toBe(ALVO_HOST);
    expect(Number(alvo.port)).toBe(receptor.porta);
    expect(alvo.pathname).toBe('/pedidos/42');
    expect(Object.fromEntries(alvo.searchParams)).toEqual({ pais: 'café', n: '1' });
  });

  test('keep_path true com caminho no alvo → o caminho da mensagem entra depois do caminho do alvo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '/eventos/novo?tipo=x', { method: 'PUT', headers: JSON_CT, data: Buffer.from('{}') });

    const r = await replay(request, t, msg.uuid, { url: `${receptor.url}/base`, keep_path: true });

    expect(receptor.recebidas).toHaveLength(1);
    const chegou = new URL(receptor.recebidas[0].url, 'http://receptor');
    expect(chegou.pathname).toBe('/base/eventos/novo');
    expect(Object.fromEntries(chegou.searchParams)).toEqual({ tipo: 'x' });
    expect(new URL(r.target).pathname).toBe('/base/eventos/novo');
  });

  test('keep_path true numa mensagem sem caminho nem query → o alvo como veio', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', headers: JSON_CT, data: Buffer.from('{}') });

    await replay(request, t, msg.uuid, { url: `${receptor.url}/fixo` });

    expect(receptor.recebidas.map((x) => x.url)).toEqual(['/fixo']);
  });

  test('keep_path false → exatamente o alvo pedido, sem o caminho nem a query da mensagem', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '/pedidos/42?pais=br', { method: 'POST', headers: JSON_CT, data: Buffer.from('{}') });
    const alvo = `${receptor.url}/exato?x=1`;

    const r = await replay(request, t, msg.uuid, { url: alvo, keep_path: false });

    expect(receptor.recebidas.map((x) => x.url)).toEqual(['/exato?x=1']);
    expect(r.target).toBe(alvo);
  });
});

test.describe('replay: método, headers e corpo (CA-1)', () => {
  test('headers da lista da §1 não seguem; os demais seguem com o valor gravado', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const corpo = '{"ok":true}';
    // HTTP cru: um cliente comum não deixa mandar Keep-Alive, TE, Trailer e Upgrade como vieram.
    const res = await httpCru([
      `POST /${t}/h HTTP/1.1`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(corpo)}`,
      'User-Agent: contrato/replay',
      'Accept: text/plain',
      'Authorization: Bearer token-do-cliente',
      'X-Custom: valor custom',
      'X-Cf-Nao-Filtra: 1',
      'X-Proxy-Nao-Filtra: 2',
      'X-Forwarded-For: 10.1.2.3',
      'X-Forwarded-Proto: https',
      'X-Forwarded-Host: outro.test',
      'X-Real-IP: 10.9.9.9',
      'CF-Connecting-IP: 10.8.8.8',
      'CF-Ray: 1234-GRU',
      'Proxy-Authorization: Basic eDp5',
      'Proxy-Connection: keep-alive',
      'Keep-Alive: timeout=5',
      'TE: trailers',
      'Trailer: X-Fim',
      'Upgrade: websocket',
    ], corpo);
    expect(res.status).toBe(200);
    const msg = await buscarMensagem(request, t, res.headers['x-request-id']!);
    // Pré-condição: a mensagem gravou os headers que o replay tem de tirar.
    for (const nome of ['x-forwarded-for', 'x-real-ip', 'cf-ray', 'proxy-authorization', 'keep-alive', 'te', 'trailer', 'upgrade', 'connection', 'host']) {
      expect(msg.headers[nome], `pré-condição: ${nome} gravado`).toBeDefined();
    }

    const r = await replay(request, t, msg.uuid, { url: receptor.url, keep_path: false });

    expect(receptor.recebidas).toHaveLength(1);
    const chegou = receptor.recebidas[0].headers;
    for (const nome of Object.keys(chegou)) {
      if (['host', 'content-length', 'connection', 'transfer-encoding'].includes(nome)) continue; // do próprio cliente de saída
      expect(filtrado(nome), `header filtrado chegou ao alvo: ${nome}: ${chegou[nome]}`).toBe(false);
    }
    // Os que o cliente de saída põe por conta própria são dele, não da mensagem.
    expect(chegou.host).toBe(`${ALVO_HOST}:${receptor.porta}`);
    expect(chegou['content-length'] ?? String(Buffer.byteLength(corpo))).toBe(String(Buffer.byteLength(corpo)));
    // Os demais seguem com o valor gravado.
    for (const [nome, valores] of Object.entries(msg.headers)) {
      if (filtrado(nome)) continue;
      expect(chegou[nome], `header ${nome} devia chegar ao alvo`).toBe(valores[valores.length - 1]);
    }
    expect(chegou['x-custom']).toBe('valor custom');
    expect(chegou['authorization']).toBe('Bearer token-do-cliente');
    expect(chegou['x-cf-nao-filtra']).toBe('1');
    expect(chegou['x-proxy-nao-filtra']).toBe('2');

    // request_headers é o que foi enviado: os filtrados não estão lá.
    for (const nome of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'proxy-authorization', 'proxy-connection', 'keep-alive', 'te', 'trailer', 'upgrade']) {
      expect(nomesDosHeaders(r.request_headers), `request_headers com ${nome}`).not.toContain(nome);
    }
    expect(valorDoHeader(r.request_headers, 'x-custom')).toBe('valor custom');
  });

  test('corpo chega byte a byte, com o método gravado (POST, PUT, PATCH, DELETE)', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const bytes = Buffer.from(`${metodo}:${CORPO_ESTRANHO}`, 'utf8');
      const { msg } = await enviarEGuardar(request, t, `/${metodo.toLowerCase()}`, { method: metodo, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, data: bytes });
      const r = await replay(request, t, msg.uuid, { url: receptor.url, keep_path: false });
      const chegou = receptor.recebidas[receptor.recebidas.length - 1];
      expect(chegou.method).toBe(metodo);
      expect(r.method).toBe(metodo);
      expect(chegou.body.equals(bytes), `${metodo}: corpo diferente: ${JSON.stringify(chegou.body.toString('utf8'))}`).toBe(true);
    }
  });

  test('corpo de 300 KB chega inteiro; GET sem corpo chega sem corpo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const grande = Buffer.from(Array.from({ length: 30_000 }, (_, i) => `linha ${String(i).padStart(3, '0')}\n`).join('').slice(0, 300_000), 'utf8');
    const { msg: m1 } = await enviarEGuardar(request, t, '/grande', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, data: grande });
    await replay(request, t, m1.uuid, { url: receptor.url, keep_path: false });
    expect(receptor.recebidas[0].body.length).toBe(grande.length);
    expect(receptor.recebidas[0].body.equals(grande)).toBe(true);

    const { msg: m2 } = await enviarEGuardar(request, t, '/get', { method: 'GET' });
    await replay(request, t, m2.uuid, { url: receptor.url, keep_path: false });
    expect(receptor.recebidas[1].method).toBe('GET');
    expect(receptor.recebidas[1].body.length).toBe(0);
  });
});

test.describe('replay: resposta registrada (CA-1, CA-4)', () => {
  test('status, headers, corpo e duration_ms da resposta voltam no resultado e ficam no histórico', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({
      status: 201,
      headers: { 'X-Resposta': 'sim', 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from('recebido: ção', 'utf8'),
      atraso: 400,
    });
    const { msg } = await enviarEGuardar(request, t, '/r', { method: 'POST', headers: JSON_CT, data: Buffer.from('{"x":1}') });

    const r = await replay(request, t, msg.uuid, { url: receptor.url });

    expect(r.error ?? null).toBeNull();
    expect(r.status).toBe(201);
    expect(valorDoHeader(r.headers, 'x-resposta')).toBe('sim');
    expect(valorDoHeader(r.headers, 'content-type')).toBe('text/plain; charset=utf-8');
    expect(r.body).toBe('recebido: ção');
    expect(r.truncated ?? false).toBe(false);
    expect(r.duration_ms).toBeGreaterThanOrEqual(350);
    expect(r.duration_ms).toBeLessThan(10_000);

    const lista = await historico(request, t);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toEqual(r);
  });

  test('corpo da resposta acima de 64 KB → truncated true e os primeiros 65 536 bytes; exatamente 64 KB não trunca', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    // Texto sem repetição curta, para o corte ser conferido pelo conteúdo.
    const texto = Array.from({ length: 20_000 }, (_, i) => `${i};`).join('');
    expect(texto.length).toBeGreaterThan(70_000);
    const receptor = await receptores.subir({ body: texto.slice(0, 65_536 + 5_000) });
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', headers: JSON_CT, data: Buffer.from('{}') });

    const cortado = await replay(request, t, msg.uuid, { url: receptor.url });
    expect(cortado.status).toBe(200);
    expect(cortado.truncated).toBe(true);
    expect(cortado.body).toBe(texto.slice(0, 65_536));

    receptor.responder({ body: texto.slice(0, 65_536) });
    const inteiro = await replay(request, t, msg.uuid, { url: receptor.url });
    expect(inteiro.truncated ?? false).toBe(false);
    expect(inteiro.body).toBe(texto.slice(0, 65_536));

    const lista = await historico(request, t);
    expect(lista.map((x) => x.truncated ?? false)).toEqual([false, true]);
  });

  test('resultado tem id próprio e aponta a mensagem de origem em source_request', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', headers: JSON_CT, data: Buffer.from('{}') });
    const a = await replay(request, t, msg.uuid, { url: receptor.url });
    const b = await replay(request, t, msg.uuid, { url: receptor.url });
    expect(msg.uuid).toMatch(UUID);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(msg.uuid);
    expect([a.source_request, b.source_request]).toEqual([msg.uuid, msg.uuid]);
  });
});
