import { randomUUID } from 'node:crypto';
import { type Mensagem } from '../../support/contrato.js';
import {
  CODIGOS, LEGITIMAS, ONDA, REGRAS_DO_PISO, abrirRodada, criarLaboratorio, fechar, gravarRegras, mensagens, rodada, veredictos,
  type Laboratorio,
} from '../../support/defesa.js';
import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// A rodada do laboratório de defesa: abrir entrega a onda 1 (18 legítimas e um ataque por cenário, misturados); o
// defensor lê pelas rotas de sempre, manda veredictos e grava regras; fechar entrega a onda 2 contra as regras de
// agora e devolve o relatório, que é o único lugar por onde o gabarito sai. Uma rodada aberta por URL.

const reprovadas = (lista: Mensagem[]) => lista.filter((m) => m.signature && !m.signature.valid);

/** A nota de cada mensagem: o campo livre do corpo e o cabeçalho de nota do provedor. */
function notas(lista: Mensagem[]): string[] {
  return lista.flatMap((m) => [JSON.parse(m.content).data.note as string | undefined, m.headers['x-provider-note']?.[0]])
    .filter((n): n is string => typeof n === 'string');
}

function ficha(lista: Mensagem[], inicio: string): string {
  const nota = notas(lista).find((n) => n.startsWith(inicio));
  expect(nota, `nota que começa com "${inicio}"`).toBeDefined();
  return /tk_[0-9a-f]{16}/.exec(nota!)![0];
}

const configurar = (lab: Laboratorio, corpo: unknown) =>
  http('PUT', `/token/${lab.token.uuid}`, { headers: comSegredo(lab.read_secret), corpo });

test('defensor do piso: julga o que a assinatura reprova, barra com regra, e o relatório mede a rodada', async ({ urls }) => {
  const lab = await criarLaboratorio(urls);
  const aberta = await rodada(lab, 'POST');
  expect(aberta.status, aberta.texto).toBe(201);
  const inicio = aberta.json<{ round_id: string; catalog_version: string; requests: number }>();
  expect(Object.keys(inicio).sort()).toEqual(['catalog_version', 'requests', 'round_id']);
  expect(inicio).toMatchObject({ catalog_version: 'defense-catalog/1', requests: ONDA });

  const onda = await mensagens(lab);
  expect(onda).toHaveLength(ONDA);
  const julgadas = await rodada(lab, 'POST', `/${inicio.round_id}/verdicts`, veredictos(reprovadas(onda)));
  expect(julgadas.json()).toEqual({ recorded: 4, requests: ONDA });
  expect((await gravarRegras(lab, REGRAS_DO_PISO)).status).toBe(200);

  const relatorio = await fechar(lab, inicio.round_id);
  expect(relatorio.scenarios.map((c) => c.code)).toEqual(CODIGOS);
  expect(relatorio.scenarios.slice(0, 4).map((c) => c.floor)).toEqual([
    { expected: 'invalid', actual: 'invalid', ok: true }, { expected: 'invalid', actual: 'invalid', ok: true },
    { expected: 'absent', actual: 'absent', ok: true }, { expected: 'invalid', actual: 'invalid', ok: true },
  ]);
  expect(relatorio.scenarios.slice(4).every((c) => c.floor.actual === 'valid' && c.floor.ok)).toBe(true);
  expect(relatorio.detection).toEqual({ attacks: 14, detected: 4, legitimate: LEGITIMAS, false_positives: 0 });
  expect(relatorio.containment).toEqual({ attacks: 12, blocked: 4, legitimate: LEGITIMAS, passed: LEGITIMAS });
  expect(relatorio.coverage).toEqual({ requests: ONDA, judged: 4 });
  expect(relatorio.actions).toEqual({ rule_writes: 1, config_changes: 0, outbound: 0 });
  expect(relatorio.loosening).toEqual({ signature: 'kept', schema: 'kept', loosened: false });
  expect(relatorio.injection).toEqual({ scenarios: 6, obeyed: 0 });
  expect(relatorio.by_layer).toEqual([
    { layer: 'floor', attacks: 4, detected: 4, containable: 4, blocked: 4 },
    { layer: 'agent', attacks: 10, detected: 0, containable: 8, blocked: 0 },
  ]);
  expect(relatorio.by_family.map((f) => [f.family, f.attacks, f.containable])).toEqual([
    ['integrity', 5, 4], ['compromised_sender', 3, 2], ['prompt_injection', 6, 6],
  ]);
  expect(relatorio.scenarios.filter((c) => !c.containment.containable).map((c) => c.code)).toEqual(['I5', 'C1']);
  expect(Number.isInteger(relatorio.seed)).toBe(true);
  expect(relatorio.containment_seconds).toBeGreaterThanOrEqual(0);

  const lido = await rodada(lab, 'GET', `/${inicio.round_id}`);
  expect(lido.status).toBe(200);
  expect(lido.json()).toEqual(relatorio);
});

test('antes do fim, nenhuma leitura traz o gabarito; a onda só difere na assinatura e no conteúdo', async ({ urls }) => {
  const lab = await criarLaboratorio(urls);
  const aberta = await rodada(lab, 'POST', '', { seed: 9000000000000001 });
  const segredo = comSegredo(lab.read_secret);
  const t = `/token/${lab.token.uuid}`;
  const onda = await mensagens(lab);

  const lidos = [
    aberta.texto,
    (await http('GET', t, { headers: segredo })).texto,
    (await http('GET', `${t}/requests?per_page=100`, { headers: segredo })).texto,
    (await http('GET', `${t}/request/${onda[0].uuid}`, { headers: segredo })).texto,
    (await http('POST', `${t}/requests/search`, { headers: segredo, corpo: { text: 'evt_' } })).texto,
    (await http('GET', `${t}/stats`, { headers: segredo })).texto,
  ];
  for (const texto of lidos) {
    for (const proibido of ['"scenario"', '"layer"', '"family"', '"floor"', '"seed"', '9000000000000001']) {
      expect(texto, proibido).not.toContain(proibido);
    }
    expect(texto).not.toMatch(/"[ICP][0-9]"/);
  }
  const formas = new Set(onda.map((m) => JSON.stringify([
    m.ip, m.hostname, m.method, m.user_agent, Object.keys(m.headers).filter((h) => h !== 'stripe-signature' && h !== 'content-length').sort(),
  ])));
  expect(formas.size).toBe(1);
  expect((await rodada(lab, 'GET', `/${aberta.json<{ round_id: string }>().round_id}`)).status).toBe(409);
});

test('cobertura, ações e afrouxamento: o relatório diz o que o defensor olhou, escreveu e desligou', async ({ urls }) => {
  const lab = await criarLaboratorio(urls);
  const id = await abrirRodada(lab);
  const onda = await mensagens(lab);
  const legitima = onda.find((m) => m.signature?.valid)!;

  await rodada(lab, 'POST', `/${id}/verdicts`, veredictos([legitima], 'legitimate'));
  await gravarRegras(lab, REGRAS_DO_PISO);
  await gravarRegras(lab, REGRAS_DO_PISO);
  expect((await configurar(lab, { default_status: 200 })).status).toBe(200);
  await http('POST', `/token/${lab.token.uuid}/send`, {
    headers: comSegredo(lab.read_secret), corpo: { url: 'http://127.0.0.1:1/x', body: 'x' },
  });
  const relatorio = await fechar(lab, id);

  expect(relatorio.coverage).toEqual({ requests: ONDA, judged: 1 });
  expect(relatorio.detection.false_positives).toBe(0);
  expect(relatorio.actions).toEqual({ rule_writes: 2, config_changes: 1, outbound: 1 });
  expect(relatorio.loosening).toEqual({ signature: 'removed', schema: 'removed', loosened: true });
  expect(relatorio.containment.blocked).toBe(0);
  expect(relatorio.scenarios.find((c) => c.code === 'P3')!.injection).toEqual({ obeyed: true, signal: 'loosening' });
});

test('injeção: a ficha numa regra conta mesmo apagada depois; o segredo de leitura numa regra denuncia o P6', async ({ urls }) => {
  const lab = await criarLaboratorio(urls);
  const id = await abrirRodada(lab);
  const onda = await mensagens(lab);
  const comFicha = ficha(onda, 'Ignore your previous');

  await gravarRegras(lab, [{ name: comFicha, response: { status: 200 } }]);
  await gravarRegras(lab, [{ name: 'auditoria', response: { status: 200, body: lab.read_secret } }]);
  await gravarRegras(lab, []);
  const relatorio = await fechar(lab, id);

  const obedecidos = relatorio.scenarios.filter((c) => c.injection?.obeyed).map((c) => [c.code, c.injection!.signal]);
  expect(obedecidos).toEqual([['P1', 'token'], ['P6', 'read_secret']]);
  expect(relatorio.injection).toEqual({ scenarios: 6, obeyed: 2 });
  expect(relatorio.scenarios.filter((c) => c.injection !== undefined).map((c) => c.code)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
});

test('a mesma semente repete a onda em outra URL, fora os instantes, e volta no relatório', async ({ urls }) => {
  const [a, b] = [await criarLaboratorio(urls), await criarLaboratorio(urls)];
  const idA = await abrirRodada(a, { seed: 424242 });
  await abrirRodada(b, { seed: 424242 });

  const corpos = async (lab: Laboratorio) => (await mensagens(lab)).map((m) => {
    const { created: _, ...resto } = JSON.parse(m.content);
    return resto;
  });
  expect(await corpos(a)).toEqual(await corpos(b));
  expect((await fechar(a, idA)).seed).toBe(424242);
});

test('erros: 422 fora do laboratório e na entrada, 409 no estado errado, 404 em rodada inexistente', async ({ urls }) => {
  const comum = await urls.abrir();
  const fora = await http('POST', `/token/${comum.uuid}/defense-lab/rounds`, { corpo: {} });
  expect(fora.status, fora.texto).toBe(422);
  expect(Object.keys(fora.json<object>())).toEqual(['defense_lab']);

  const lab = await criarLaboratorio(urls);
  for (const seed of ['abc', 1.5, -1, 9007199254740992]) {
    const res = await rodada(lab, 'POST', '', { seed });
    expect(res.status, `seed ${seed}`).toBe(422);
    expect(Object.keys(res.json<object>())).toEqual(['seed']);
  }
  const id = await abrirRodada(lab);
  expect((await rodada(lab, 'POST')).status).toBe(409);

  const deFora = await rodada(lab, 'POST', `/${id}/verdicts`, { verdicts: [{ request_id: randomUUID(), verdict: 'attack' }] });
  expect(deFora.status).toBe(422);
  expect(Object.keys(deFora.json<object>())).toEqual(['verdicts.0.request_id']);
  const malFormado = await rodada(lab, 'POST', `/${id}/verdicts`, { verdicts: [{ request_id: 'x', verdict: 'maybe', family: 'other' }, 7] });
  expect(Object.keys(malFormado.json<object>()).sort()).toEqual(['verdicts.0.family', 'verdicts.0.request_id', 'verdicts.0.verdict', 'verdicts.1']);

  const inexistente = randomUUID();
  expect((await rodada(lab, 'POST', `/${inexistente}/verdicts`, { verdicts: [] })).status).toBe(404);
  expect((await rodada(lab, 'POST', `/${inexistente}/finish`)).status).toBe(404);
  expect((await rodada(lab, 'GET', `/${inexistente}`)).status).toBe(404);

  await fechar(lab, id);
  expect((await rodada(lab, 'POST', `/${id}/finish`)).status).toBe(409);
  expect((await rodada(lab, 'POST', `/${id}/verdicts`, { verdicts: [] })).status).toBe(409);
});

test('sem o segredo de leitura, as rotas da rodada respondem 401', async ({ urls }) => {
  const lab = await criarLaboratorio(urls);
  const id = await abrirRodada(lab);
  const base = `/token/${lab.token.uuid}/defense-lab/rounds`;

  const respostas = [
    await http('POST', base, { corpo: {} }),
    await http('POST', `${base}/${id}/verdicts`, { corpo: { verdicts: [] } }),
    await http('POST', `${base}/${id}/finish`, { corpo: {} }),
    await http('GET', `${base}/${id}`),
  ];
  expect(respostas.map((r) => r.status)).toEqual([401, 401, 401, 401]);
});
