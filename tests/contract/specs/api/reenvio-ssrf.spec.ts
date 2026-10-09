import { lookup } from 'node:dns/promises';
import { enviarEGuardar, espera, expect } from '../../support/contrato.js';
import {
  ALIAS_LOCALHOST, expectErroDeSaida, historico, replay, send, test, valorDoHeader,
} from '../../support/reenvio.js';

// Proteções contra SSRF observáveis pela API (CA-3 do plano "reenvio-servidor", §1). Destino bloqueado não é
// erro da API: 200 com `error.kind=blocked`, sem `status`, e o resultado entra no histórico. O stack de teste
// roda com `allow-private=true` (o receptor mora no host), então loopback e redes privadas bloqueados com
// `allow-private=false` e o DNS rebinding ficam com os testes do backend (a tabela de destinos está em
// docs/api.md, "Reenvio e envio pelo servidor").

/** Nome público que resolve para 169.254.169.254 (nip.io devolve o IP escrito no nome). */
const NOME_LINK_LOCAL = '169.254.169.254.nip.io';

test.describe('SSRF: destinos sempre bloqueados (CA-3)', () => {
  test('metadados de nuvem, 0.0.0.0, fe80::, multicast, broadcast e :: → blocked', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const alvos = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254:80/',
      'http://169.254.0.1:8080/',
      `http://0.0.0.0:${receptor.porta}/`,
      'http://0.0.0.0/',
      'http://[fe80::1]/',
      'http://224.0.0.1/',
      'http://255.255.255.255/',
      'http://[::]/',
    ];
    for (const url of alvos) {
      const r = await send(request, t, { url, method: 'GET' });
      expectErroDeSaida(r, 'blocked');
      expect(r.kind).toBe('send');
    }
    expect(receptor.recebidas).toHaveLength(0);
    // Bloqueado também é registrado.
    const lista = await historico(request, t);
    expect(lista).toHaveLength(alvos.length);
    for (const r of lista) expect(r.error?.kind).toBe('blocked');
  });

  test('IPv4 mapeado em IPv6 que cai em faixa bloqueada → blocked', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const url of ['http://[::ffff:169.254.169.254]/', 'http://[::ffff:a9fe:a9fe]/latest/', 'http://[::ffff:0.0.0.0]/']) {
      expectErroDeSaida(await send(request, t, { url, method: 'GET' }), 'blocked');
    }
  });

  test('esquema que não é http(s) → blocked, sem sair', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const porta = receptor.porta;
    for (const url of [`ftp://${new URL(receptor.url).hostname}:${porta}/arquivo`, 'file:///etc/passwd', `gopher://${new URL(receptor.url).hostname}:${porta}/_INFO`]) {
      expectErroDeSaida(await send(request, t, { url, method: 'GET' }), 'blocked');
    }
    expect(receptor.recebidas).toHaveLength(0);
  });

  test('nome que resolve para link-local → blocked', async ({ request, tokens }) => {
    const resolvido = await lookup(NOME_LINK_LOCAL, { family: 4 }).catch(() => null);
    test.skip(resolvido?.address !== '169.254.169.254', `${NOME_LINK_LOCAL} não resolve para 169.254.169.254 daqui (sem DNS externo?)`);
    const t = (await tokens.criar()).uuid;
    expectErroDeSaida(await send(request, t, { url: `http://${NOME_LINK_LOCAL}/latest/meta-data/`, method: 'GET' }), 'blocked');
  });

  test('169.254.169.254 em notação decimal e hexadecimal não sai: blocked, dns ou invalid_url', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const url of ['http://2852039166/', 'http://0xA9FEA9FE/']) {
      // connect/timeout seriam tentativa de conexão ao endereço de metadados.
      expectErroDeSaida(await send(request, t, { url, method: 'GET', timeout: 3_000 }), ['blocked', 'dns', 'invalid_url']);
    }
  });

  test('replay para destino bloqueado → blocked, com source_request', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/x', { method: 'POST', data: Buffer.from('{}') });
    const r = await replay(request, t, msg.uuid, { url: 'http://169.254.169.254/' });
    expectErroDeSaida(r, 'blocked');
    expect(r.kind).toBe('replay');
    expect(r.source_request).toBe(msg.uuid);
    expect(await historico(request, t)).toEqual([r]);
  });
});

test.describe('SSRF: redirecionamento não é seguido (CA-3)', () => {
  test('send para um receptor que responde 302 → o resultado mostra o 302 e o destino não recebe nada', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const destino = await receptores.subir();
    const origem = await receptores.subir({ status: 302, headers: { Location: `${destino.url}/destino` }, body: 'redirecionando' });

    const r = await send(request, t, { url: `${origem.url}/inicio`, method: 'GET' });

    expect(r.status).toBe(302);
    expect(valorDoHeader(r.headers, 'location')).toBe(`${destino.url}/destino`);
    expect(r.body).toBe('redirecionando');
    expect(origem.recebidas).toHaveLength(1);
    await espera(1_000);
    expect(destino.recebidas).toHaveLength(0);
  });

  test('replay para um receptor que responde 307 → o resultado mostra o 307 e o destino não recebe nada', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const destino = await receptores.subir();
    const origem = await receptores.subir({ status: 307, headers: { Location: `${destino.url}/destino` } });
    const { msg } = await enviarEGuardar(request, t, '/x', { method: 'POST', data: Buffer.from('{"a":1}') });

    const r = await replay(request, t, msg.uuid, { url: origem.url });

    expect(r.status).toBe(307);
    expect(valorDoHeader(r.headers, 'location')).toBe(`${destino.url}/destino`);
    await espera(1_000);
    expect(destino.recebidas).toHaveLength(0);
  });
});

test.describe('localhost com localhost-alias (§1)', () => {
  test('localhost e 127.0.0.1 no alvo viram o alias: chegam ao receptor do host e target mostra o alvo efetivo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ body: 'via alias' });
    for (const host of ['localhost', '127.0.0.1']) {
      const r = await send(request, t, { url: `http://${host}:${receptor.porta}/via-${host}?q=1`, method: 'GET' });
      expect(r.error ?? null, JSON.stringify(r.error)).toBeNull();
      expect(r.body).toBe('via alias');
      const alvo = new URL(r.target);
      expect(alvo.hostname).toBe(ALIAS_LOCALHOST);
      expect(Number(alvo.port)).toBe(receptor.porta);
      expect(`${alvo.pathname}${alvo.search}`).toBe(`/via-${host}?q=1`);
    }
    expect(receptor.recebidas.map((x) => x.url)).toEqual(['/via-localhost?q=1', '/via-127.0.0.1?q=1']);
  });
});
