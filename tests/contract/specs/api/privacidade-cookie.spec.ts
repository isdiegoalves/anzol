import { randomBytes } from 'node:crypto';
import type { Token } from '../../support/contrato.js';
import {
  COOKIE_DE_ACESSO, abrirStream, capturar, comCookie, comSegredo, cookieDeAcesso, desbloquear, expect, expect401Protegida,
  http, lerSetCookie, longeDaViradaDoMinuto, novoSegredo, test,
} from '../../support/privacidade.js';

// CA-2 do item 12 (§1 do plano "privacidade"): `POST /token/{id}/unlock {"secret"}` com o segredo certo → 204 e
// `Set-Cookie: wh_access=…; Path=/token/{id}; HttpOnly; SameSite=Strict; Max-Age=30 dias` (sem `Secure` em HTTP),
// que dá acesso às rotas de gestão, inclusive ao SSE. Errado → 401; 10 falhas por minuto por URL → 429 com
// `Retry-After` na 11ª. Trocar o segredo invalida o cookie. `lock` apaga o cookie. No `PUT`, `read_secret` ausente
// mantém a proteção e `null` a remove. O navegador mandaria o cookie pelo `Path`; aqui ele vai à mão.

const TRINTA_DIAS = 30 * 24 * 3600;

test.describe('unlock e cookie (CA-2)', () => {
  test('segredo certo → 204 e cookie HttpOnly, SameSite=Strict, Path da URL, 30 dias, sem Secure em HTTP', async ({ urls }) => {
    const url = await urls.proteger();
    const res = await desbloquear(url.uuid, url.segredo);
    expect(res.status, res.texto).toBe(204);
    expect(res.texto).toBe('');
    const cookie = cookieDeAcesso(res);
    expect(cookie.valor.length).toBeGreaterThan(0);
    expect(cookie.valor).not.toContain(url.segredo);
    expect(cookie.atributos).toHaveProperty('httponly');
    expect(cookie.atributos['samesite']?.toLowerCase()).toBe('strict');
    expect(cookie.atributos['path']).toBe(`/token/${url.uuid}`);
    expect(Number(cookie.atributos['max-age'])).toBe(TRINTA_DIAS);
    expect(cookie.atributos).not.toHaveProperty('secure');
    expect(cookie.atributos).not.toHaveProperty('domain');

    // Dois unlocks da mesma URL e versão dão o mesmo cookie (HMAC de id:versão), e os dois abrem.
    const outro = cookieDeAcesso(await desbloquear(url.uuid, url.segredo));
    expect(outro.valor).toBe(cookie.valor);
  });

  test('o cookie dá acesso às rotas de gestão e ao SSE; forjado ou de outra URL → 401', async ({ urls }) => {
    const url = await urls.proteger();
    const cookie = cookieDeAcesso(await desbloquear(url.uuid, url.segredo)).valor;
    const c = comCookie(cookie);

    expect((await http('GET', `/token/${url.uuid}`, { headers: c })).status).toBe(200);
    const rid = await capturar(url.uuid, '/antes');
    expect((await http('GET', `/token/${url.uuid}/requests`, { headers: c })).status).toBe(200);
    expect((await http('GET', `/token/${url.uuid}/request/${rid}`, { headers: c })).status).toBe(200);
    const editada = await http('PUT', `/token/${url.uuid}`, { headers: c, corpo: { default_status: 202 } });
    expect(editada.status, editada.texto).toBe(200);
    expect(editada.json<Token>()).toMatchObject({ default_status: 202, protected: true });
    expect((await http('PUT', `/token/${url.uuid}/rules`, { headers: c, corpo: [] })).status).toBe(200);

    const stream = await abrirStream(url.uuid, c);
    try {
      expect(stream.status, stream.texto.slice(0, 300)).toBe(200);
      expect(stream.contentType.toLowerCase()).toMatch(/^text\/event-stream/);
      const nova = await capturar(url.uuid, '/pelo-sse');
      expect((await stream.proximo()).request.uuid).toBe(nova);
    } finally {
      stream.fechar();
    }

    // Cookie forjado, vazio e o de outra URL protegida não abrem.
    expect401Protegida(await http('GET', `/token/${url.uuid}`, { headers: comCookie(randomBytes(32).toString('hex')) }), 'cookie forjado');
    expect401Protegida(await http('GET', `/token/${url.uuid}`, { headers: comCookie('') }), 'cookie vazio');
    const vizinha = await urls.proteger();
    expect401Protegida(await http('GET', `/token/${vizinha.uuid}`, { headers: c }), 'cookie de outra URL');
    const sseVizinha = await abrirStream(vizinha.uuid, c);
    sseVizinha.fechar();
    expect(sseVizinha.status, 'SSE com o cookie de outra URL').toBe(401);
  });

  test('segredo errado → 401 sem cookie; a 11ª falha no minuto → 429 com Retry-After; outra URL segue', async ({ urls }) => {
    await longeDaViradaDoMinuto();
    const url = await urls.proteger();
    const outra = await urls.proteger();
    for (let i = 1; i <= 10; i++) {
      const res = await desbloquear(url.uuid, `${url.segredo}-${i}`);
      expect(res.status, `falha nº ${i}: ${res.texto.slice(0, 200)}`).toBe(401);
      expect(res.setCookies.map(lerSetCookie).filter((k) => k.nome === COOKIE_DE_ACESSO && k.valor !== ''), `falha nº ${i} sem cookie`).toEqual([]);
    }
    const decima = await desbloquear(url.uuid, novoSegredo());
    expect(decima.status, `11ª falha: ${decima.texto.slice(0, 200)}`).toBe(429);
    const retry = decima.headers.get('retry-after');
    expect(retry, 'Retry-After no 429').toMatch(/^\d+$/);
    expect(Number(retry)).toBeGreaterThanOrEqual(1);
    expect(Number(retry)).toBeLessThanOrEqual(60);
    expect(decima.setCookies.map(lerSetCookie).filter((k) => k.nome === COOKIE_DE_ACESSO && k.valor !== '')).toEqual([]);

    // O limite é por URL.
    expect((await desbloquear(outra.uuid, novoSegredo())).status).toBe(401);
    expect((await desbloquear(outra.uuid, outra.segredo)).status).toBe(204);
  });

  test('trocar o segredo invalida o cookie e o header antigos; o novo segredo abre', async ({ urls }) => {
    const url = await urls.proteger();
    const antigo = cookieDeAcesso(await desbloquear(url.uuid, url.segredo)).valor;
    expect((await http('GET', `/token/${url.uuid}`, { headers: comCookie(antigo) })).status).toBe(200);

    const novo = novoSegredo();
    const troca = await http('PUT', `/token/${url.uuid}`, { headers: comCookie(antigo), corpo: { read_secret: novo } });
    expect(troca.status, troca.texto).toBe(200);
    urls.lembrar(url.uuid, novo);
    expect(troca.json<Token>().protected).toBe(true);

    expect401Protegida(await http('GET', `/token/${url.uuid}`, { headers: comCookie(antigo) }), 'cookie de antes da troca');
    expect401Protegida(await http('GET', `/token/${url.uuid}`, { headers: comSegredo(url.segredo) }), 'header com o segredo antigo');
    expect((await http('GET', `/token/${url.uuid}`, { headers: comSegredo(novo) })).status).toBe(200);
    expect((await desbloquear(url.uuid, url.segredo)).status).toBe(401);
    const cookieNovo = cookieDeAcesso(await desbloquear(url.uuid, novo)).valor;
    expect(cookieNovo).not.toBe(antigo);
    expect((await http('GET', `/token/${url.uuid}`, { headers: comCookie(cookieNovo) })).status).toBe(200);
  });

  test('lock apaga o cookie (mesmo nome e Path, expirado) e responde sem acesso', async ({ urls }) => {
    const url = await urls.proteger();
    const cookie = cookieDeAcesso(await desbloquear(url.uuid, url.segredo)).valor;
    for (const credencial of [comCookie(cookie), {}]) {
      const res = await http('POST', `/token/${url.uuid}/lock`, { headers: credencial });
      expect(res.status, `lock ${JSON.stringify(credencial)}: ${res.texto.slice(0, 200)}`).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      const apagado = cookieDeAcesso(res);
      expect(apagado.atributos['path']).toBe(`/token/${url.uuid}`);
      const maxAge = apagado.atributos['max-age'];
      const expires = apagado.atributos['expires'];
      const expirado = (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) < Date.now());
      expect(expirado, `cookie apagado: ${JSON.stringify(apagado)}`).toBe(true);
      expect(apagado.valor).not.toBe(cookie);
    }
  });

  test('unlock e lock respondem numa URL protegida sem acesso (as duas exceções da §1)', async ({ urls }) => {
    const url = await urls.proteger();
    expect((await desbloquear(url.uuid, url.segredo)).status).toBe(204);
    const lock = await http('POST', `/token/${url.uuid}/lock`);
    expect(lock.status).not.toBe(401);
  });
});

test.describe('PUT e a proteção (CA-2)', () => {
  test('PUT sem read_secret mantém a proteção e o segredo; read_secret null remove; texto protege de novo', async ({ urls }) => {
    const url = await urls.proteger({ default_status: 201 });
    const h = comSegredo(url.segredo);

    const semCampo = await http('PUT', `/token/${url.uuid}`, { headers: h, corpo: { default_status: 202 } });
    expect(semCampo.status, semCampo.texto).toBe(200);
    expect(semCampo.json<Token>()).toMatchObject({ protected: true, default_status: 202 });
    expect401Protegida(await http('GET', `/token/${url.uuid}`), 'depois do PUT sem o campo');
    expect((await http('GET', `/token/${url.uuid}`, { headers: h })).status).toBe(200);

    // PUT vazio (todo campo ausente volta ao padrão, menos o segredo, que fica).
    const vazio = await http('PUT', `/token/${url.uuid}`, { headers: h, corpo: {} });
    expect(vazio.status, vazio.texto).toBe(200);
    expect(vazio.json<Token>()).toMatchObject({ protected: true, default_status: 200 });
    expect401Protegida(await http('GET', `/token/${url.uuid}/requests`), 'depois do PUT vazio');

    const removida = await http('PUT', `/token/${url.uuid}`, { headers: h, corpo: { read_secret: null } });
    expect(removida.status, removida.texto).toBe(200);
    expect(removida.json<Token>().protected).toBe(false);
    for (const caminho of [`/token/${url.uuid}`, `/token/${url.uuid}/requests`, `/token/${url.uuid}/rules`]) {
      expect((await http('GET', caminho)).status, `${caminho} sem acesso depois de remover`).toBe(200);
    }
    const stream = await abrirStream(url.uuid);
    stream.fechar();
    expect(stream.status, 'SSE sem acesso depois de remover').toBe(200);

    const novo = novoSegredo();
    const deNovo = await http('PUT', `/token/${url.uuid}`, { corpo: { read_secret: novo } });
    expect(deNovo.status, deNovo.texto).toBe(200);
    urls.lembrar(url.uuid, novo);
    expect(deNovo.json<Token>().protected).toBe(true);
    expect401Protegida(await http('GET', `/token/${url.uuid}`), 'protegida de novo');
    expect((await http('GET', `/token/${url.uuid}`, { headers: comSegredo(novo) })).status).toBe(200);
  });
});
