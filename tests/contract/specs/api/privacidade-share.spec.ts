import { randomBytes, randomUUID } from 'node:crypto';
import { BASE_URL, CHAVES_MENSAGEM, type Mensagem } from '../../support/contrato.js';
import {
  CHAVES_DO_LINK, DIA, HORA, capturar, idDeLinkQualquer, comSegredo, compartilhar, expect, http, httpCruCompleto, instante, lerLink,
  mensagem, novoSegredo, type Link, type MensagemCompartilhada, test,
} from '../../support/privacidade.js';

// CA-3 do item 12 (§1 do plano "privacidade"): link só-leitura de UMA mensagem.
// `POST /token/{id}/request/{rid}/share {"expires_in": "1h"|"1d"|"7d"|"30d" (padrão 7d), "redact": bool (padrão true)}`
// → `{id, url: "/#/share/{id}", expires_at, redact}`; `GET /token/{id}/shares` lista os ativos; `DELETE
// /token/{id}/shares/{sid}` revoga; no máximo 50 ativos por URL (422 acima). Público: `GET /share/{sid}` → o JSON
// de `GET /token/{id}/request/{rid}` + `shared_at` e `expires_at`, sem credencial nenhuma, mesmo com a URL
// protegida; expirado, revogado ou mensagem apagada → o mesmo 404. `redact=true` troca por "[redacted]" os valores
// dos headers da lista da §1 (e o de assinatura do provedor configurado) e os valores de query cujo nome contém
// token, key, secret, password ou signature, sem diferenciar maiúsculas; o corpo não é mascarado.
//
// Correções da refutação (fatia 05, decisões do dono, 2026-09-26): o link público nunca traz o UUID da URL — sem
// `token_id`, e com o UUID da `url` trocado por "[redacted]", com ou sem `redact` —; `redact` também mascara os headers
// cujo NOME contém token, key, secret, password ou auth (sem diferenciar maiúsculas); definir, trocar ou remover o
// segredo de leitura revoga todos os links da URL.
//
// Expiração: o menor prazo é 1 h, e o contrato não espera. O link expirado some pelo TTL de `share:{sid}` no Redis,
// então responde como um link que nunca existiu, e é assim que o contrato o cobre ("404 igual" ao de um sid
// inexistente); o corte no tempo fica com os testes do backend.

const REDACTED = '[redacted]';

function linksAtivos(uuid: string, headers: Record<string, string> = {}) {
  return http('GET', `/token/${uuid}/shares`, { headers });
}

async function idsAtivos(uuid: string, headers: Record<string, string> = {}): Promise<string[]> {
  const res = await linksAtivos(uuid, headers);
  expect(res.status, `GET /token/{id}/shares: ${res.texto.slice(0, 300)}`).toBe(200);
  const lista = res.json<Link[]>();
  expect(Array.isArray(lista), 'GET /shares devolve uma lista JSON').toBe(true);
  return lista.map((l) => l.id).sort();
}

function revogar(uuid: string, sid: string, headers: Record<string, string> = {}) {
  return http('DELETE', `/token/${uuid}/shares/${sid}`, { headers });
}

/** A mensagem pública sem `shared_at` e `expires_at`: o que se compara com `semUuidDaUrl` da mensagem gravada. */
function semCamposDoLink(m: MensagemCompartilhada): Omit<Mensagem, 'token_id'> {
  const { shared_at: _s, expires_at: _e, ...resto } = m;
  return resto;
}

/** O que o link público mostra da mensagem gravada: sem `token_id` e com o UUID da URL trocado na `url`. */
function semUuidDaUrl(m: Mensagem): Omit<Mensagem, 'token_id'> {
  const { token_id: uuid, ...resto } = m;
  return { ...resto, url: resto.url.split(uuid).join(REDACTED) };
}

/** `GET /share/{sid}` → 200 com as chaves da mensagem, menos `token_id`, mais `shared_at` e `expires_at`. */
async function lerLinkOk(sid: string): Promise<MensagemCompartilhada> {
  const res = await lerLink(sid);
  expect(res.status, `GET /share/${sid}: ${res.texto.slice(0, 300)}`).toBe(200);
  const msg = res.json<MensagemCompartilhada>();
  for (const chave of [...CHAVES_MENSAGEM.filter((c) => c !== 'token_id'), 'shared_at', 'expires_at']) {
    expect(msg, `chave ${chave} no link`).toHaveProperty(chave);
  }
  expect(msg, 'o link público não traz token_id').not.toHaveProperty('token_id');
  return msg;
}

function perto(valor: string, esperadoMs: number, contexto: string): void {
  const diferenca = Math.abs(instante(valor) - esperadoMs);
  expect(diferenca, `${contexto}: ${valor}`).toBeLessThanOrEqual(120_000);
}

test.describe('criar, listar e revogar (CA-3)', () => {
  test('numa URL protegida: cria com os padrões, lista, o público lê sem credencial, revoga', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const rid = await capturar(url.uuid, '/pedido?x=1', { body: '{"ok":true}', headers: { 'Content-Type': 'application/json' } });

    const antes = Date.now();
    const link = await compartilhar(url.uuid, rid, {}, h);
    expect(link.url).toBe(`/#/share/${link.id}`);
    expect(link.redact).toBe(true);
    perto(link.expires_at, antes + 7 * DIA, 'expires_at padrão (7d)');

    expect(await idsAtivos(url.uuid, h)).toEqual([link.id]);

    const publico = await lerLinkOk(link.id);
    const original = await mensagem(url.uuid, rid, h);
    expect(semCamposDoLink(publico)).toEqual(semUuidDaUrl(original));
    expect(instante(publico.expires_at)).toBe(instante(link.expires_at));
    perto(publico.shared_at, antes, 'shared_at');

    const revogado = await revogar(url.uuid, link.id, h);
    expect([200, 204], `DELETE /shares/{sid}: ${revogado.status} ${revogado.texto.slice(0, 200)}`).toContain(revogado.status);
    expect(await idsAtivos(url.uuid, h)).toEqual([]);
    expect((await lerLink(link.id)).status).toBe(404);
  });

  test('expires_in 1h, 1d, 7d e 30d; redact false volta false; ids distintos; a lista traz só os da URL', async ({ urls }) => {
    const token = await urls.abrir();
    const vizinha = await urls.abrir();
    const rid = await capturar(token.uuid);
    const ridVizinha = await capturar(vizinha.uuid);
    const criados: Link[] = [];
    for (const [expiresIn, prazo] of [['1h', HORA], ['1d', DIA], ['7d', 7 * DIA], ['30d', 30 * DIA]] as const) {
      const antes = Date.now();
      const link = await compartilhar(token.uuid, rid, { expires_in: expiresIn, redact: false });
      expect(link.redact).toBe(false);
      perto(link.expires_at, antes + prazo, `expires_in ${expiresIn}`);
      criados.push(link);
    }
    expect(new Set(criados.map((l) => l.id)).size).toBe(4);
    const daVizinha = await compartilhar(vizinha.uuid, ridVizinha);
    expect(await idsAtivos(token.uuid)).toEqual(criados.map((l) => l.id).sort());
    expect(await idsAtivos(vizinha.uuid)).toEqual([daVizinha.id]);

    // Revogar pela URL errada não revoga.
    const errada = await revogar(vizinha.uuid, criados[0].id);
    expect(errada.status, `revogar pela URL errada: ${errada.texto.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    expect((await lerLink(criados[0].id)).status).toBe(200);
    expect(await idsAtivos(token.uuid)).toContain(criados[0].id);
  });

  test('validação: expires_in fora da lista → 422 em expires_in; mensagem inexistente → 404; nada criado', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid);
    for (const expiresIn of ['2h', '1w', '', 7, '7D']) {
      const res = await http('POST', `/token/${token.uuid}/request/${rid}/share`, { corpo: { expires_in: expiresIn } });
      expect(res.status, `expires_in ${JSON.stringify(expiresIn)}: ${res.texto.slice(0, 200)}`).toBe(422);
      expect(res.json<Record<string, unknown>>()).toHaveProperty('expires_in');
    }
    const inexistente = await http('POST', `/token/${token.uuid}/request/${randomUUID()}/share`, { corpo: {} });
    expect(inexistente.status, inexistente.texto.slice(0, 200)).toBe(404);
    expect(await idsAtivos(token.uuid)).toEqual([]);
  });

  test('no máximo 50 ativos por URL: o 51º → 422; revogar um libera a vaga', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid, '/um');
    const outra = await capturar(token.uuid, '/outra');
    const links: Link[] = [];
    for (let i = 0; i < 50; i++) links.push(await compartilhar(token.uuid, i % 2 === 0 ? rid : outra));
    expect((await idsAtivos(token.uuid)).length).toBe(50);

    const excedente = await http('POST', `/token/${token.uuid}/request/${rid}/share`, { corpo: {} });
    expect(excedente.status, `51º link: ${excedente.texto.slice(0, 200)}`).toBe(422);
    expect((await idsAtivos(token.uuid)).length).toBe(50);

    const revogado = await revogar(token.uuid, links[7].id);
    expect([200, 204]).toContain(revogado.status);
    await compartilhar(token.uuid, outra);
    expect((await idsAtivos(token.uuid)).length).toBe(50);
  });
});

test.describe('o link não entrega a URL (CA-3, fatia 05)', () => {
  test('com e sem redact: sem token_id, e o UUID da URL não aparece em lugar nenhum (a url traz [redacted])', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const rid = await capturar(url.uuid, '/caminho?page=2', { body: 'x' });
    for (const redact of [true, false]) {
      const link = await compartilhar(url.uuid, rid, { redact }, h);
      const res = await lerLink(link.id);
      expect(res.status).toBe(200);
      expect(res.texto, `redact ${redact}: o UUID da URL no link público`).not.toContain(url.uuid);
      const publico = res.json<Record<string, unknown>>();
      expect(publico, `redact ${redact}`).not.toHaveProperty('token_id');
      expect(String(publico.url), `redact ${redact}`).toMatch(/\/\[redacted\]\/caminho\?page=2$/);
    }
  });
});

test.describe('trocar o segredo revoga os links (CA-3, fatia 05)', () => {
  test('definir, trocar e remover o segredo: todos os links da URL → o 404 de sempre, e a lista fica vazia', async ({ urls }) => {
    const aberta = await urls.abrir();
    const nunca = await lerLink(idDeLinkQualquer());
    const igualAoInexistente = async (sid: string, caso: string) => {
      const res = await lerLink(sid);
      expect({ status: res.status, corpo: res.texto }, caso).toEqual({ status: nunca.status, corpo: nunca.texto });
    };

    // Definir numa URL aberta.
    const antes = [await compartilhar(aberta.uuid, await capturar(aberta.uuid)), await compartilhar(aberta.uuid, await capturar(aberta.uuid))];
    const segredo = novoSegredo();
    const definido = await http('PUT', `/token/${aberta.uuid}`, { corpo: { read_secret: segredo } });
    expect(definido.status, definido.texto.slice(0, 200)).toBe(200);
    for (const l of antes) await igualAoInexistente(l.id, 'link de antes de definir o segredo');
    expect((await http('GET', `/token/${aberta.uuid}/shares`, { headers: comSegredo(segredo) })).json()).toEqual([]);

    // Trocar.
    const h = comSegredo(segredo);
    const deAntesDaTroca = await compartilhar(aberta.uuid, await capturar(aberta.uuid), {}, h);
    const outro = novoSegredo();
    expect((await http('PUT', `/token/${aberta.uuid}`, { headers: h, corpo: { read_secret: outro } })).status).toBe(200);
    await igualAoInexistente(deAntesDaTroca.id, 'link de antes de trocar o segredo');

    // Remover.
    const h2 = comSegredo(outro);
    const deAntesDeRemover = await compartilhar(aberta.uuid, await capturar(aberta.uuid), {}, h2);
    expect((await http('PUT', `/token/${aberta.uuid}`, { headers: h2, corpo: { read_secret: null } })).status).toBe(200);
    await igualAoInexistente(deAntesDeRemover.id, 'link de antes de remover o segredo');
    expect((await http('GET', `/token/${aberta.uuid}/shares`)).json()).toEqual([]);

    // Editar sem mexer no segredo não revoga.
    const fica = await compartilhar(aberta.uuid, await capturar(aberta.uuid));
    expect((await http('PUT', `/token/${aberta.uuid}`, { corpo: { default_status: 201 } })).status).toBe(200);
    expect((await lerLink(fica.id)).status).toBe(200);
  });
});

test.describe('404 igual (CA-3)', () => {
  test('revogado, mensagem apagada, todas apagadas, URL apagada e inexistente → o mesmo 404; os links somem com a URL', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const [r1, r2, r3] = [await capturar(url.uuid, '/1'), await capturar(url.uuid, '/2'), await capturar(url.uuid, '/3')];
    const revogado = await compartilhar(url.uuid, r1, {}, h);
    const deApagada = await compartilhar(url.uuid, r2, {}, h);
    for (const l of [revogado, deApagada]) expect((await lerLink(l.id)).status).toBe(200);

    const nunca = await lerLink(idDeLinkQualquer());
    expect(nunca.status).toBe(404);
    const referencia = { status: nunca.status, tipo: nunca.headers.get('content-type'), corpo: nunca.texto };
    const igual = async (sid: string, caso: string) => {
      const res = await lerLink(sid);
      expect({ status: res.status, tipo: res.headers.get('content-type'), corpo: res.texto }, caso).toEqual(referencia);
    };

    await revogar(url.uuid, revogado.id, h);
    await igual(revogado.id, 'revogado');

    expect((await http('DELETE', `/token/${url.uuid}/request/${r2}`, { headers: h })).status).toBe(200);
    await igual(deApagada.id, 'mensagem apagada');

    const deTodas = await compartilhar(url.uuid, r3, {}, h);
    expect((await http('DELETE', `/token/${url.uuid}/request`, { headers: h })).status).toBe(200);
    await igual(deTodas.id, 'todas as mensagens apagadas');

    const r4 = await capturar(url.uuid, '/4');
    const daUrl = [await compartilhar(url.uuid, r4, {}, h), await compartilhar(url.uuid, r4, { redact: false }, h)];
    for (const l of daUrl) expect((await lerLink(l.id)).status).toBe(200);
    expect((await http('DELETE', `/token/${url.uuid}`, { headers: h })).status).toBe(204);
    for (const l of daUrl) await igual(l.id, 'URL apagada');
    expect((await linksAtivos(url.uuid, h)).status).toBe(410);

    // Formatos que não são id de link: 404 (o corpo fica livre).
    for (const sid of ['x', 'a'.repeat(40), 'não-é-id']) expect((await lerLink(encodeURIComponent(sid))).status, `sid ${sid}`).toBe(404);
  });
});

test.describe('máscara (CA-3)', () => {
  const v = (nome: string) => `v-${nome}-${randomBytes(6).toString('hex')}`;

  /** Mensagem com os headers e a query da §1 (e vizinhos que não entram na máscara), por HTTP cru. */
  async function capturarSensivel(uuid: string, extra: Record<string, string> = {}) {
    const sensiveisHeader: Record<string, string> = {
      authorization: `Bearer ${v('authz')}`,
      'proxy-authorization': `Basic ${v('proxy')}`,
      cookie: `sessao=${v('cookie')}`,
      'set-cookie': `id=${v('setcookie')}`,
      'x-api-key': v('apikey'),
      'x-anzol-secret': v('whsecret'),
      // Pelo nome (fatia 05): contém token, key, secret, password ou auth.
      'x-auth-token': v('xauthtoken'),
      'x-api-keys': v('xapikeys'),
      'x-client-secret': v('xclientsecret'),
      'x-db-password': v('xdbpassword'),
      'x-authenticated-user': v('xauthuser'),
      'x-monkey': v('xmonkey'),
    };
    const comunsHeader: Record<string, string> = {
      'x-comum': v('comum'),
      'x-tok': v('xtok'),
      'stripe-signature': `t=1,v1=${v('stripe')}`,
      ...extra,
    };
    const sensiveisQuery: Record<string, string> = {
      access_token: v('qtoken'),
      API_KEY: v('qkey'),
      clientSecret: v('qsecret'),
      Password: v('qpass'),
      'x-signature': v('qsig'),
      monkey: v('qmonkey'),
      TOKENS: v('qtokens'),
    };
    const comunsQuery: Record<string, string> = { page: '2', usuario: 'ana', tok: v('qtok'), segredo: v('qsegredo') };
    const query = Object.entries({ ...sensiveisQuery, ...comunsQuery }).map(([n, x]) => `${n}=${encodeURIComponent(x)}`).join('&');
    const corpo = JSON.stringify({ password: 'corpo-nao-mascarado', token: 'no-corpo' });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...comunsHeader };
    for (const [n, x] of Object.entries(sensiveisHeader)) headers[n] = x;
    const res = await httpCruCompleto('POST', `/${uuid}/mascara?${query}`, new URL(BASE_URL).host, headers, corpo);
    expect(res.status).toBe(200);
    return { rid: res.headers['x-request-id']!, sensiveisHeader, comunsHeader, sensiveisQuery, comunsQuery, corpo };
  }

  /** Os valores aleatórios dos headers e da query sensíveis (sem prefixos como `Bearer ` e `sessao=`). */
  function valores(cap: Awaited<ReturnType<typeof capturarSensivel>>): string[] {
    return [...Object.values(cap.sensiveisHeader).map((x) => x.split(/[ =]/).pop()!), ...Object.values(cap.sensiveisQuery)];
  }

  function conferirMascara(
    compartilhada: MensagemCompartilhada,
    original: Mensagem,
    sensiveis: { headers: string[]; query: string[] },
    valoresSensiveis: string[],
  ): void {
    const esperado = semUuidDaUrl(JSON.parse(JSON.stringify(original)) as Mensagem);
    for (const n of sensiveis.headers) {
      expect(original.headers[n], `pré-condição: a mensagem gravou o header ${n}`).toBeDefined();
      esperado.headers[n] = original.headers[n].map(() => REDACTED);
    }
    for (const n of sensiveis.query) {
      expect((original.query ?? {})[n], `pré-condição: a mensagem gravou a query ${n}`).toBeDefined();
      (esperado.query as Record<string, unknown>)[n] = REDACTED;
    }
    const { url: urlCompartilhada, ...resto } = semCamposDoLink(compartilhada);
    const { url: _u, ...restoEsperado } = esperado;
    expect(resto, 'tudo fora a url: a mensagem com exatamente os valores da §1 mascarados').toEqual(restoEsperado);
    // A query também aparece na `url` gravada: os valores mascarados não podem sair por ali.
    expect(urlCompartilhada).toContain('/mascara');
    const texto = JSON.stringify(compartilhada);
    expect(texto, 'o UUID da URL no link público').not.toContain(original.token_id);
    for (const valor of valoresSensiveis) {
      expect(texto, `valor sensível ${valor} fora da máscara`).not.toContain(valor);
      expect(texto, `valor sensível ${valor} codificado fora da máscara`).not.toContain(encodeURIComponent(valor));
    }
  }

  test('redact padrão numa URL com GitHub: exatamente os headers da §1, o de assinatura do provedor e a query sensível', async ({ urls }) => {
    const token = await urls.abrir({ signature: { provider: 'github', secret: 'segredo-github-123' } });
    const hub = v('hub');
    const cap = await capturarSensivel(token.uuid, { 'x-hub-signature-256': `sha256=${hub}` });
    const link = await compartilhar(token.uuid, cap.rid);
    expect(link.redact).toBe(true);
    const publico = await lerLinkOk(link.id);
    conferirMascara(
      publico,
      await mensagem(token.uuid, cap.rid),
      { headers: [...Object.keys(cap.sensiveisHeader), 'x-hub-signature-256'], query: Object.keys(cap.sensiveisQuery) },
      [...valores(cap), hub],
    );
    // O corpo não é mascarado.
    expect(publico.content).toBe(cap.corpo);
  });

  test('provedor generic: o header configurado é mascarado; sem assinatura configurada, x-hub-signature-256 fica', async ({ urls }) => {
    const generic = await urls.abrir({ signature: { provider: 'generic', secret: 'segredo-generic-123', header: 'X-Minha-Assinatura' } });
    const assinatura = v('generic');
    const cap = await capturarSensivel(generic.uuid, { 'x-minha-assinatura': assinatura });
    const link = await compartilhar(generic.uuid, cap.rid, { redact: true });
    conferirMascara(
      await lerLinkOk(link.id),
      await mensagem(generic.uuid, cap.rid),
      { headers: [...Object.keys(cap.sensiveisHeader), 'x-minha-assinatura'], query: Object.keys(cap.sensiveisQuery) },
      [...valores(cap), assinatura],
    );

    const semAssinatura = await urls.abrir();
    const hub = `sha256=${v('hub')}`;
    const cap2 = await capturarSensivel(semAssinatura.uuid, { 'x-hub-signature-256': hub });
    const link2 = await compartilhar(semAssinatura.uuid, cap2.rid);
    conferirMascara(
      await lerLinkOk(link2.id),
      await mensagem(semAssinatura.uuid, cap2.rid),
      { headers: Object.keys(cap2.sensiveisHeader), query: Object.keys(cap2.sensiveisQuery) },
      valores(cap2),
    );
    expect((await lerLinkOk(link2.id)).headers['x-hub-signature-256']).toEqual([hub]);
  });

  test('redact false: a mensagem inteira, igual ao GET /request sem o UUID da URL, mais shared_at e expires_at', async ({ urls }) => {
    const token = await urls.abrir({ signature: { provider: 'github', secret: 'segredo-github-123' } });
    const cap = await capturarSensivel(token.uuid, { 'x-hub-signature-256': `sha256=${v('hub')}` });
    const link = await compartilhar(token.uuid, cap.rid, { redact: false });
    expect(link.redact).toBe(false);
    const publico = await lerLinkOk(link.id);
    expect(semCamposDoLink(publico)).toEqual(semUuidDaUrl(await mensagem(token.uuid, cap.rid)));
    expect(Object.keys(link)).toEqual(expect.arrayContaining(CHAVES_DO_LINK));
  });
});
