import { randomUUID } from 'node:crypto';
import { BASE_URL, CHAVES_TOKEN, type Token } from '../../support/contrato.js';
import {
  abrirStream, capturar, comExplainReal, comSegredo, emLotes, expect, expect401Protegida, http, mensagem, montarCenario,
  novoSegredo, retrato, rotasDeGestao, test,
} from '../../support/privacidade.js';

// CA-1 do item 12 (§1 do plano "privacidade"): numa URL protegida, toda rota `/token/{id}/**` (fora `unlock` e
// `lock`) responde 401 `{"error":"This URL is protected","protected":true}` sem acesso e com o header errado, e
// responde como numa URL aberta com o header `X-Anzol-Secret` certo. A captura `/{id}/**` não muda. O token
// informa `protected` e o segredo nunca volta.
//
// As varreduras usam uma URL nova a cada 8 rotas: a §1 limita as falhas de segredo a 10 por minuto por URL (429
// na 11ª), e o contrato não fixa se um pedido sem credencial ou com o header errado conta como falha.

const LOTE = 8;

test.describe('URL protegida: rotas de gestão (CA-1)', () => {
  test('sem acesso: toda rota de gestão → 401 com o corpo da §1, e nada muda', async ({ urls }) => {
    const modelo = rotasDeGestao('u', 'r', 's', 'x');
    for (const nomes of emLotes(modelo.map((r) => r.nome), LOTE)) {
      const c = await montarCenario(urls);
      const antes = await retrato(c);
      const rotas = comExplainReal(rotasDeGestao(c.url.uuid, c.rid, c.sid, randomUUID()), c.url.uuid, c.rid).filter((r) => nomes.includes(r.nome));
      for (const rota of rotas) {
        expect401Protegida(await http(rota.metodo, rota.caminho, { corpo: rota.corpo }), `${rota.nome} sem acesso`);
      }
      expect(await retrato(c), `nada mudou depois de ${nomes.join(', ')}`).toEqual(antes);
    }
  });

  test('header errado: toda rota de gestão → 401 com o corpo da §1, e nada muda', async ({ urls }) => {
    const modelo = rotasDeGestao('u', 'r', 's', 'x');
    for (const nomes of emLotes(modelo.map((r) => r.nome), LOTE)) {
      const c = await montarCenario(urls);
      const antes = await retrato(c);
      const rotas = comExplainReal(rotasDeGestao(c.url.uuid, c.rid, c.sid, randomUUID()), c.url.uuid, c.rid).filter((r) => nomes.includes(r.nome));
      for (const rota of rotas) {
        // Errado de três jeitos: outro segredo, o certo com um caractere a mais, o certo em maiúsculas.
        const errado = [novoSegredo(), `${c.url.segredo}x`, c.url.segredo.toUpperCase()][rotas.indexOf(rota) % 3];
        expect401Protegida(await http(rota.metodo, rota.caminho, { corpo: rota.corpo, headers: comSegredo(errado) }), `${rota.nome} com header errado`);
      }
      expect(await retrato(c), `nada mudou depois de ${nomes.join(', ')}`).toEqual(antes);
    }
  });

  test('header certo: toda rota de gestão responde como numa URL aberta', async ({ urls }) => {
    const c = await montarCenario(urls);
    const h = comSegredo(c.url.segredo);
    for (const rota of rotasDeGestao(c.url.uuid, c.rid, c.sid, randomUUID())) {
      const res = await http(rota.metodo, rota.caminho, { corpo: rota.corpo, headers: h });
      expect(rota.comAcesso, `${rota.nome} com o header certo: ${res.status} ${res.texto.slice(0, 300)}`).toContain(res.status);
    }
    // A última rota apagou a URL.
    expect((await http('GET', `/token/${c.url.uuid}`, { headers: h })).status).toBe(410);
  });

  test('stream SSE: sem acesso e header errado → 401; header certo → 200 e recebe o evento', async ({ urls }) => {
    const url = await urls.proteger();

    const semAcesso = await abrirStream(url.uuid);
    expect(semAcesso.status, semAcesso.texto.slice(0, 300)).toBe(401);
    expect(JSON.parse(semAcesso.texto)).toEqual({ error: 'This URL is protected', protected: true });

    const errado = await abrirStream(url.uuid, comSegredo(novoSegredo()));
    expect(errado.status, errado.texto.slice(0, 300)).toBe(401);
    expect(JSON.parse(errado.texto)).toEqual({ error: 'This URL is protected', protected: true });

    const certo = await abrirStream(url.uuid, comSegredo(url.segredo));
    try {
      expect(certo.status, certo.texto.slice(0, 300)).toBe(200);
      expect(certo.contentType.toLowerCase()).toMatch(/^text\/event-stream/);
      const rid = await capturar(url.uuid, '/evento');
      expect((await certo.proximo()).request.uuid).toBe(rid);
    } finally {
      certo.fechar();
    }
  });
});

test.describe('URL protegida: captura aberta (CA-1)', () => {
  test('todos os métodos da captura → a resposta padrão da URL, e gravam', async ({ urls }) => {
    const url = await urls.proteger({ default_status: 201, default_content: 'capturado', default_content_type: 'text/plain' });
    for (const metodo of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(new URL(`/${url.uuid}/caminho/${metodo}?q=1`, BASE_URL), {
        method: metodo,
        body: metodo === 'GET' ? undefined : `corpo ${metodo}`,
      });
      expect(res.status, metodo).toBe(201);
      expect(await res.text()).toBe('capturado');
      const msg = await mensagem(url.uuid, res.headers.get('x-request-id')!, comSegredo(url.segredo));
      expect(msg.method).toBe(metodo);
    }
    // O header de acesso não abre nada na captura nem é exigido: sem ele, grava igual.
    const semHeader = await capturar(url.uuid, '/sem-header');
    expect((await mensagem(url.uuid, semHeader, comSegredo(url.segredo))).url).toContain('/sem-header');
  });
});

test.describe('protected e o segredo nunca volta (CA-1)', () => {
  test('sem read_secret → protected false; com → true; o segredo não aparece no create, get, update nem na listagem', async ({ urls }) => {
    const aberta = await urls.abrir();
    expect(Object.keys(aberta).sort()).toEqual(CHAVES_TOKEN);
    expect(aberta.protected).toBe(false);

    const segredo = novoSegredo();
    const criada = await http('POST', '/token', { corpo: { read_secret: segredo, default_status: 202 } });
    expect(criada.status, criada.texto).toBe(201);
    const token = criada.json<Token>();
    urls.lembrar(token.uuid, segredo);
    expect(Object.keys(token).sort()).toEqual(CHAVES_TOKEN);
    expect(token).toMatchObject({ protected: true, default_status: 202 });
    expect(criada.texto).not.toContain(segredo);

    const h = comSegredo(segredo);
    const lida = await http('GET', `/token/${token.uuid}`, { headers: h });
    expect(lida.status).toBe(200);
    expect(Object.keys(lida.json<Token>()).sort()).toEqual(CHAVES_TOKEN);
    expect(lida.json<Token>().protected).toBe(true);
    expect(lida.texto).not.toContain(segredo);

    const editada = await http('PUT', `/token/${token.uuid}`, { headers: h, corpo: { default_status: 203 } });
    expect(editada.status, editada.texto).toBe(200);
    expect(editada.json<Token>()).toMatchObject({ protected: true, default_status: 203 });
    expect(Object.keys(editada.json<Token>()).sort()).toEqual(CHAVES_TOKEN);
    expect(editada.texto).not.toContain(segredo);

    // Trocar o segredo: nem o novo nem o antigo voltam.
    const novo = novoSegredo();
    const trocada = await http('PUT', `/token/${token.uuid}`, { headers: h, corpo: { read_secret: novo } });
    expect(trocada.status, trocada.texto).toBe(200);
    urls.lembrar(token.uuid, novo);
    expect(trocada.json<Token>().protected).toBe(true);
    expect(trocada.texto).not.toContain(novo);
    expect(trocada.texto).not.toContain(segredo);

    // Mensagem gravada, listagem e 401 também não carregam o segredo.
    const rid = await capturar(token.uuid);
    const listagem = await http('GET', `/token/${token.uuid}/requests`, { headers: comSegredo(novo) });
    expect(listagem.status).toBe(200);
    expect(listagem.texto).not.toContain(novo);
    expect((await http('GET', `/token/${token.uuid}/request/${rid}`, { headers: comSegredo(novo) })).texto).not.toContain(novo);
    expect((await http('GET', `/token/${token.uuid}`)).texto).not.toContain(novo);
  });

  test('read_secret de 8 e de 256 caracteres protegem; 7 e 257 → 422 em read_secret, nada criado nem trocado', async ({ urls }) => {
    for (const tamanho of [8, 256]) {
      const segredo = 'a'.repeat(tamanho - 4) + novoSegredo().slice(-4);
      const url = await urls.proteger({}, segredo);
      expect(url.token.protected, `read_secret de ${tamanho}`).toBe(true);
      expect((await http('GET', `/token/${url.uuid}`, { headers: comSegredo(segredo) })).status).toBe(200);
      expect((await http('GET', `/token/${url.uuid}`)).status).toBe(401);
    }
    for (const tamanho of [7, 257]) {
      const res = await http('POST', '/token', { corpo: { read_secret: 'b'.repeat(tamanho) } });
      expect(res.status, `POST read_secret de ${tamanho}: ${res.texto.slice(0, 200)}`).toBe(422);
      expect(res.json<Record<string, unknown>>()).toHaveProperty('read_secret');
    }
    const url = await urls.proteger();
    for (const tamanho of [7, 257]) {
      const res = await http('PUT', `/token/${url.uuid}`, { headers: comSegredo(url.segredo), corpo: { read_secret: 'c'.repeat(tamanho) } });
      expect(res.status, `PUT read_secret de ${tamanho}: ${res.texto.slice(0, 200)}`).toBe(422);
      expect(res.json<Record<string, unknown>>()).toHaveProperty('read_secret');
    }
    // O segredo original continua valendo.
    expect((await http('GET', `/token/${url.uuid}`, { headers: comSegredo(url.segredo) })).status).toBe(200);
  });
});
