import { randomUUID } from 'node:crypto';
import { BASE_URL, type Token } from '../../support/contrato.js';
import {
  ERRO_HOST, ERRO_ORIGEM, HOSTS_PERMITIDOS, PORTA, capturar, compartilhar, expect, expect403, http, httpCruCompleto, idDeLinkQualquer,
  mensagem,
  test,
} from '../../support/privacidade.js';

// CA-4 do item 12 (§1 do plano "privacidade"): com `anzol.allowed-hosts` definido (o stack do `./ci.sh` roda com
// `ANZOL_ALLOWED_HOSTS=localhost,127.0.0.1,[::1],host.docker.internal`), as rotas de gestão (`/token`,
// `/token/**`, `/share/**`, `/mcp`) recusam `Host` fora da lista com 403 `{"error":"host not allowed"}`, e os
// métodos que mudam estado (POST, PUT, PATCH, DELETE) recusam `Origin` presente de host fora da lista com 403
// `{"error":"origin not allowed"}`. A captura `/{id}/**` e os arquivos da tela não mudam. O `Host` sai por HTTP
// cru; o `Origin`, pelo `fetch`.
//
// Com a lista vazia (padrão do app) nada disso vale; esse stack não é o do CI e o caso fica com os testes do backend.

const ESTRANHOS = ['evil.test', 'localhost.evil.test', `evil.test:${PORTA}`, '127.0.0.1.nip.io', 'rebind.localhost.evil.test'];
const ORIGENS_ESTRANHAS = ['http://evil.test', `http://evil.test:${PORTA}`, 'https://localhost.evil.test', 'http://127.0.0.1.nip.io'];
const TELA = new URL(BASE_URL).origin;

test.describe('Host (CA-4)', () => {
  test('Host estranho → 403 host not allowed em toda família de rota de gestão, e nada muda', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid);
    const pedidos: Array<[string, string, string]> = [
      ['POST', '/token', '{}'],
      ['GET', `/token/${token.uuid}`, ''],
      ['PUT', `/token/${token.uuid}`, '{"default_status":299}'],
      ['DELETE', `/token/${token.uuid}`, ''],
      ['GET', `/token/${token.uuid}/requests`, ''],
      ['GET', `/token/${token.uuid}/request/${rid}`, ''],
      ['GET', `/token/${token.uuid}/stream`, ''],
      ['PUT', `/token/${token.uuid}/rules`, '[]'],
      ['POST', `/token/${token.uuid}/unlock`, '{"secret":"qualquer-coisa"}'],
      ['GET', `/token/${token.uuid}/shares`, ''],
      ['POST', `/token/${token.uuid}/request/${rid}/share`, '{}'],
      ['GET', `/share/${idDeLinkQualquer()}`, ''],
      ['GET', `/share/${randomUUID()}`, ''],
      ['POST', '/mcp', '{}'],
    ];
    for (const host of ESTRANHOS) {
      for (const [metodo, alvo, corpo] of pedidos) {
        const res = await httpCruCompleto(metodo, alvo, host, corpo ? { 'Content-Type': 'application/json' } : {}, corpo);
        if (alvo === '/token' && res.status === 201) urls.lembrar(JSON.parse(res.corpo).uuid);
        expect403(res, ERRO_HOST, `${metodo} ${alvo} com Host ${host}`);
      }
    }
    const depois = await http('GET', `/token/${token.uuid}`);
    expect(depois.status).toBe(200);
    expect(depois.json<Token>().default_status).toBe(token.default_status);
    expect((await mensagem(token.uuid, rid)).uuid).toBe(rid);
  });

  test('Host estranho na captura → a resposta de sempre, e grava com esse hostname; a tela abre', async ({ urls }) => {
    const token = await urls.abrir({ default_status: 201, default_content: 'capturado' });
    for (const host of ESTRANHOS) {
      const res = await httpCruCompleto('POST', `/${token.uuid}/rebind`, host, { 'Content-Type': 'text/plain' }, 'oi');
      expect(res.status, `captura com Host ${host}`).toBe(201);
      expect(res.corpo).toBe('capturado');
      const msg = await mensagem(token.uuid, res.headers['x-request-id']!);
      expect(msg.hostname).toBe(host.replace(/:\d+$/, ''));
    }
    const tela = await httpCruCompleto('GET', '/', 'evil.test');
    expect(tela.status, 'a tela (/) com Host estranho').toBe(200);
  });

  test('os hosts da lista passam, com e sem porta', async ({ urls }) => {
    const token = await urls.abrir();
    for (const nome of HOSTS_PERMITIDOS) {
      for (const host of [`${nome}:${PORTA}`, nome]) {
        const res = await httpCruCompleto('GET', `/token/${token.uuid}`, host);
        expect(res.status, `GET /token/{id} com Host ${host}: ${res.corpo.slice(0, 200)}`).toBe(200);
        expect(JSON.parse(res.corpo).uuid).toBe(token.uuid);
      }
    }
    const criado = await httpCruCompleto('POST', '/token', `127.0.0.1:${PORTA}`, { 'Content-Type': 'application/json' }, '{}');
    expect(criado.status, criado.corpo.slice(0, 200)).toBe(201);
    urls.lembrar(JSON.parse(criado.corpo).uuid);
  });
});

test.describe('Origin (CA-4)', () => {
  test('POST, PUT e DELETE com Origin estranho → 403 origin not allowed, e nada muda', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid);
    for (const origem of ORIGENS_ESTRANHAS) {
      const h = { Origin: origem };
      const chamadas: Array<[string, string, unknown]> = [
        ['POST', '/token', {}],
        ['PUT', `/token/${token.uuid}`, { default_status: 299 }],
        ['PUT', `/token/${token.uuid}/cors/toggle`, undefined],
        ['PUT', `/token/${token.uuid}/rules`, [{ name: 'intrusa' }]],
        ['POST', `/token/${token.uuid}/send`, { url: 'http://169.254.169.254/', method: 'POST' }],
        ['POST', `/token/${token.uuid}/request/${rid}/share`, {}],
        ['POST', `/token/${token.uuid}/unlock`, { secret: 'qualquer-coisa' }],
        ['DELETE', `/token/${token.uuid}/request/${rid}`, undefined],
        ['DELETE', `/token/${token.uuid}/request`, undefined],
        ['DELETE', `/token/${token.uuid}`, undefined],
      ];
      for (const [metodo, caminho, corpo] of chamadas) {
        const res = await http(metodo, caminho, { headers: h, corpo });
        if (caminho === '/token' && res.status === 201) urls.lembrar(res.json<Token>().uuid);
        expect403(res, ERRO_ORIGEM, `${metodo} ${caminho} com Origin ${origem}`);
      }
    }
    const depois = (await http('GET', `/token/${token.uuid}`)).json<Token>();
    expect(depois).toMatchObject({ default_status: token.default_status, cors: token.cors });
    expect((await http('GET', `/token/${token.uuid}/rules`)).json()).toEqual([]);
    expect((await http('GET', `/token/${token.uuid}/outbound`)).json()).toEqual([]);
    expect((await http('GET', `/token/${token.uuid}/shares`)).json()).toEqual([]);
    expect((await mensagem(token.uuid, rid)).uuid).toBe(rid);
  });

  test('POST /mcp com Origin estranho → 403 origin not allowed', async () => {
    for (const origem of ORIGENS_ESTRANHAS) {
      const res = await http('POST', '/mcp', {
        headers: { Origin: origem, Accept: 'application/json, text/event-stream' },
        corpo: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect403(res, ERRO_ORIGEM, `POST /mcp com Origin ${origem}`);
    }
  });

  test('GET com Origin estranho passa (só métodos que mudam estado conferem o Origin)', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid);
    const h = { Origin: 'http://evil.test' };
    for (const caminho of [`/token/${token.uuid}`, `/token/${token.uuid}/requests`, `/token/${token.uuid}/request/${rid}`]) {
      expect((await http('GET', caminho, { headers: h })).status, `GET ${caminho}`).toBe(200);
    }
    const link = await compartilhar(token.uuid, rid);
    expect((await http('GET', `/share/${link.id}`, { headers: h })).status, 'GET /share/{sid}').toBe(200);
  });

  test('Origin da própria tela e dos hosts da lista passam; sem Origin (CLI) passa', async ({ urls }) => {
    const origens = [TELA, `http://127.0.0.1:${PORTA}`, `http://[::1]:${PORTA}`, `http://host.docker.internal:${PORTA}`];
    for (const origem of [...origens, undefined]) {
      const h: Record<string, string> = origem ? { Origin: origem } : {};
      const contexto = `Origin ${origem ?? '(sem)'}`;
      const criado = await http('POST', '/token', { headers: h, corpo: { default_status: 201 } });
      expect(criado.status, `${contexto}: ${criado.texto.slice(0, 200)}`).toBe(201);
      const token = criado.json<Token>();
      urls.lembrar(token.uuid);
      expect((await http('PUT', `/token/${token.uuid}`, { headers: h, corpo: { default_status: 202 } })).status, contexto).toBe(200);
      expect((await http('PUT', `/token/${token.uuid}/rules`, { headers: h, corpo: [] })).status, contexto).toBe(200);
      const rid = await capturar(token.uuid);
      const share = await http('POST', `/token/${token.uuid}/request/${rid}/share`, { headers: h, corpo: {} });
      expect([200, 201], `${contexto}: share ${share.status} ${share.texto.slice(0, 200)}`).toContain(share.status);
      expect((await http('DELETE', `/token/${token.uuid}/request/${rid}`, { headers: h })).status, contexto).toBe(200);
      expect((await http('DELETE', `/token/${token.uuid}`, { headers: h })).status, contexto).toBe(204);
    }
  });

  test('captura com Origin estranho → a resposta de sempre', async ({ urls }) => {
    const token = await urls.abrir();
    for (const metodo of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(new URL(`/${token.uuid}/origem`, BASE_URL), { method: metodo, headers: { Origin: 'http://evil.test' }, body: metodo === 'DELETE' ? undefined : 'x' });
      expect(res.status, `captura ${metodo} com Origin estranho`).toBe(200);
    }
  });
});
