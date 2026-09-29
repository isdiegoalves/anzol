import { buscarMensagem, enviarEGuardar, espera, expect, test, type Mensagem } from '../../support/contrato.js';
import {
  erros422, lerRegras, lerTrace, putRegras, salvarRegras, testarRegra, type ResultadoTesteDeRegra,
} from '../../support/regras.js';

/** Agora + `ms`, no segundo, em UTC sem fração: o formato em que a janela volta. */
function daquiA(ms: number): string {
  return new Date(Math.floor((Date.now() + ms) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function mais(instante: string, ms: number): string {
  return new Date(Date.parse(instante) + ms).toISOString().replace('.000Z', 'Z');
}

/** `created_at` da mensagem (`2026-09-29 12:00:00`, UTC) no formato das frases da janela. */
const chegou = (m: Mensagem): string => `${m.created_at.replace(' ', 'T')}Z`;

const abre = (de: string, m: Mensagem): string => `window: opens at ${de}, received at ${chegou(m)}`;
const fechou = (ate: string, m: Mensagem): string => `window: closed at ${ate}, received at ${chegou(m)}`;

async function esperarAte(instante: string, depois: number): Promise<void> {
  await espera(Math.max(0, Date.parse(instante) + depois - Date.now()));
}

test.describe('janela: ida e volta e validação', () => {
  test('volta em UTC, cortada no segundo, com Z; aceita fração e deslocamento', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const casos: Array<[string, string]> = [
      ['2026-09-29T12:00:00Z', '2026-09-29T12:00:00Z'],
      ['2026-09-29T12:00:00.789Z', '2026-09-29T12:00:00Z'],
      ['2026-09-29T09:00:00-03:00', '2026-09-29T12:00:00Z'],
      ['2026-09-29T12:00:00+00:00', '2026-09-29T12:00:00Z'],
    ];
    for (const [entrada, volta] of casos) {
      const [desde, ate] = await salvarRegras(request, token.uuid, [
        { name: 'desde', active_from: entrada },
        { name: 'até', active_until: entrada },
      ]);
      expect(desde.active_from, entrada).toBe(volta);
      expect('active_until' in desde, entrada).toBe(false);
      expect(ate.active_until, entrada).toBe(volta);
      expect('active_from' in ate, entrada).toBe(false);
    }
    const salvas = await salvarRegras(request, token.uuid, [
      { name: 'as duas', active_from: '2026-09-29T12:00:00Z', active_until: '2026-09-29T12:30:00.000Z' },
    ]);
    expect(salvas[0]).toMatchObject({ active_from: '2026-09-29T12:00:00Z', active_until: '2026-09-29T12:30:00Z' });
    expect(await lerRegras(request, token.uuid)).toEqual(salvas);
  });

  test('sem fuso, só data, texto livre, vazio ou não texto → 422 com a mensagem do formato', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const invalidos: unknown[] = ['2026-09-29', '2026-09-29T12:00:00', 'amanhã', '', 1759147200, true];
    for (const campo of ['active_from', 'active_until'] as const) {
      const atributo = campo.replace('_', ' ');
      for (const valor of invalidos) {
        const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', [campo]: valor }]));
        expect(corpo, `${campo} ${JSON.stringify(valor)}`).toEqual({
          [`0.${campo}`]: [`The ${atributo} must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.`],
        });
      }
    }
    expect(await erros422(await testarRegra(request, token.uuid, { name: 'x', active_from: 'amanhã' }))).toEqual({
      active_from: ['The active from must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.'],
    });
  });

  test('active_until igual ou antes de active_from (depois do corte no segundo) → 422 em "0.active_until"', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const pares: Array<[string, string]> = [
      ['2026-09-29T12:00:00Z', '2026-09-29T12:00:00Z'],
      ['2026-09-29T12:00:00Z', '2026-09-29T11:00:00Z'],
      ['2026-09-29T12:00:00.100Z', '2026-09-29T12:00:00.900Z'],
    ];
    for (const [de, ate] of pares) {
      const corpo = await erros422(await putRegras(request, token.uuid, [{ name: 'x', active_from: de, active_until: ate }]));
      expect(corpo, `${de} → ${ate}`).toEqual({ '0.active_until': ['The active until must be a date after active from.'] });
    }
    expect(await lerRegras(request, token.uuid)).toEqual([]);
  });
});

test.describe('janela: liga e desliga', () => {
  test('antes de abrir, pulada; dentro, responde; depois de fechar, pulada; near_miss e trace dizem por quê', async ({ request, tokens }) => {
    test.setTimeout(60_000);
    const token = await tokens.criar();
    const de = daquiA(5000);
    const ate = mais(de, 6000);
    const [regra] = await salvarRegras(request, token.uuid, [{ name: 'janela', active_from: de, active_until: ate, response: { status: 201 } }]);
    expect(regra).toMatchObject({ active_from: de, active_until: ate });

    const antes = await enviarEGuardar(request, token.uuid, '', { method: 'POST' });
    expect(antes.res.status()).toBe(200);
    expect(antes.msg.rule).toBeNull();
    expect(antes.msg.near_miss).toEqual({ id: regra.id, name: 'janela', failed: [abre(de, antes.msg)], conditions: ['active_from'] });

    await esperarAte(de, 3000);
    const dentro = await enviarEGuardar(request, token.uuid, '', { method: 'POST' });
    expect(dentro.res.status()).toBe(201);
    expect(dentro.msg.rule).toEqual({ id: regra.id, name: 'janela' });

    await esperarAte(ate, 2500);
    const depois = await enviarEGuardar(request, token.uuid, '', { method: 'POST' });
    expect(depois.res.status()).toBe(200);
    expect(depois.msg.near_miss).toEqual({ id: regra.id, name: 'janela', failed: [fechou(ate, depois.msg)], conditions: ['active_until'] });

    const [noAntes] = (await lerTrace(request, token.uuid, antes.msg.uuid)).rules;
    expect(noAntes).toMatchObject({ matches: false, failed: [abre(de, antes.msg)], conditions: ['active_from'] });
    const [noDentro] = (await lerTrace(request, token.uuid, dentro.msg.uuid)).rules;
    expect(noDentro).toMatchObject({ matches: true, failed: [], conditions: [] });
    const [noDepois] = (await lerTrace(request, token.uuid, depois.msg.uuid)).rules;
    expect(noDepois).toMatchObject({ matches: false, failed: [fechou(ate, depois.msg)], conditions: ['active_until'] });
  });

  test('só active_from no passado: vale; só active_until no passado: nunca vale', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const ontem = daquiA(-86_400_000);
    const [desde, ateOntem] = await salvarRegras(request, token.uuid, [
      { name: 'desde ontem', active_from: ontem, match: { path: { equals: '/a' } }, response: { status: 201 } },
      { name: 'até ontem', active_until: ontem, match: { path: { equals: '/b' } }, response: { status: 202 } },
    ]);
    expect(desde.active_from).toBe(ontem);
    const a = await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });
    expect(a.res.status()).toBe(201);
    const b = await enviarEGuardar(request, token.uuid, '/b', { method: 'POST' });
    expect(b.res.status()).toBe(200);
    const trace = await lerTrace(request, token.uuid, b.msg.uuid);
    expect(trace.rules.find((r) => r.id === ateOntem.id)).toMatchObject({
      matches: false, failed: [fechou(ontem, b.msg)], conditions: ['active_until'],
    });
  });

  test('o trace julga pela hora em que a mensagem chegou, não pela de agora', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '', { method: 'POST' });
    await espera(3000);
    const de = mais(chegou(msg), 2000);
    const [regra] = await salvarRegras(request, token.uuid, [{ name: 'depois', active_from: de, response: { status: 201 } }]);

    const [naLista] = (await lerTrace(request, token.uuid, msg.uuid)).rules;
    expect(naLista).toMatchObject({ id: regra.id, matches: false, failed: [abre(de, msg)], conditions: ['active_from'] });
    expect((await request.post(`/${token.uuid}`, { data: 'x' })).status()).toBe(201);
  });

  test('ordem das frases: condições, depois a janela; com algo falhando, sem sorteio', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const passado = daquiA(-3_600_000);
    const [regra] = await salvarRegras(request, token.uuid, [
      { name: 'x', chance: 50, active_until: passado, match: { path: { equals: '/x' } } },
    ]);
    expect(regra.active_until).toBe(passado);
    const { msg } = await enviarEGuardar(request, token.uuid, '/y', { method: 'POST' });
    expect(msg.near_miss).toMatchObject({ id: regra.id, conditions: ['match.path', 'active_until'] });
    expect(msg.near_miss!.failed[1]).toBe(fechou(passado, msg));
  });

  test('rules/test julga a janela pela hora de chegada de cada mensagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await enviarEGuardar(request, token.uuid, '', { method: 'POST' })).msg.uuid);
    const futura = daquiA(3_600_000);

    const res = await testarRegra(request, token.uuid, { name: 'futura', active_from: futura });
    expect(res.status(), await res.text()).toBe(200);
    const fora = (await res.json()) as ResultadoTesteDeRegra;
    expect(fora.matches).toEqual([]);
    expect(new Set(fora.misses.map((m) => m.uuid))).toEqual(new Set(ids));
    for (const miss of fora.misses) {
      const msg = await buscarMensagem(request, token.uuid, miss.uuid);
      expect(miss.failed).toEqual([abre(futura, msg)]);
      expect(miss.conditions).toEqual(['active_from']);
    }

    const aberta = await testarRegra(request, token.uuid, { name: 'aberta', active_from: daquiA(-3_600_000), active_until: futura });
    expect(aberta.status(), await aberta.text()).toBe(200);
    const dentro = (await aberta.json()) as ResultadoTesteDeRegra;
    expect(new Set(dentro.matches.map((m) => m.uuid))).toEqual(new Set(ids));
    expect(dentro.misses).toEqual([]);
  });
});
