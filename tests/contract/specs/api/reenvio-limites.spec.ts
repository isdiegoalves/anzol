import type { APIResponse } from '@playwright/test';
import { enviarEGuardar, espera, expect } from '../../support/contrato.js';
import {
  chamarReplay, chamarSend, expect422, expectErroDeSaida, historico, send, test, type Receptor,
} from '../../support/reenvio.js';

// Limites do motor de saída (CA-4 do plano "reenvio-servidor", §1): `timeout` do disparo (padrão 10 s),
// corpo de até 1 MB, 30 disparos por minuto por URL (429 com `Retry-After`) e histórico com as últimas 50.

const MIB = 1_048_576;

/** Com janela por minuto de relógio, 31 disparos perto da virada cairiam em dois minutos: espera a virada. */
async function longeDaViradaDoMinuto(): Promise<void> {
  const segundos = new Date().getSeconds();
  if (segundos >= 40) await espera((61 - segundos) * 1_000);
}

function retryAfter(res: APIResponse): number {
  const valor = res.headers()['retry-after'];
  expect(valor, 'Retry-After ausente no 429').toMatch(/^\d+$/);
  const n = Number(valor);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(60);
  return n;
}

test.describe('limites: timeout (CA-4)', () => {
  test('receptor que demora mais que o timeout pedido → error.kind=timeout perto do prazo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ atraso: 5_000 });
    const inicio = Date.now();
    const r = await send(request, t, { url: receptor.url, method: 'GET', timeout: 1_000 });
    const ms = Date.now() - inicio;
    expectErroDeSaida(r, 'timeout');
    expect(r.duration_ms).toBeGreaterThanOrEqual(900);
    expect(r.duration_ms).toBeLessThan(4_500);
    expect(ms).toBeLessThan(4_500);
    expect((await historico(request, t))[0]).toEqual(r);
  });

  test('replay com timeout também corta', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor: Receptor = await receptores.subir({ atraso: 5_000 });
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', data: Buffer.from('{}') });
    const res = await chamarReplay(request, t, msg.uuid, { url: receptor.url, timeout: 1_500 });
    expect(res.status()).toBe(200);
    const r = await res.json();
    expectErroDeSaida(r, 'timeout');
    expect(r.duration_ms).toBeGreaterThanOrEqual(1_400);
    expect(r.duration_ms).toBeLessThan(5_000);
  });

  test('sem timeout → padrão de 10 s', async ({ request, tokens, receptores }) => {
    test.setTimeout(60_000);
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ atraso: 15_000 });
    const r = await send(request, t, { url: receptor.url, method: 'GET' });
    expectErroDeSaida(r, 'timeout');
    expect(r.duration_ms).toBeGreaterThanOrEqual(9_500);
    expect(r.duration_ms).toBeLessThan(14_000);
  });
});

test.describe('limites: corpo de 1 MB (CA-4)', () => {
  test('corpo de exatamente 1 MiB sai inteiro; 1 MiB + 1 byte → 422 em body, sem sair', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const corpo = 'x'.repeat(MIB - 10) + '0123456789';

    const r = await send(request, t, { url: receptor.url, method: 'POST', body: corpo });
    expect(r.status).toBe(200);
    expect(receptor.recebidas).toHaveLength(1);
    expect(receptor.recebidas[0].body.length).toBe(MIB);
    expect(receptor.recebidas[0].body.toString('utf8') === corpo).toBe(true);

    const res = await chamarSend(request, t, { url: receptor.url, method: 'POST', body: corpo + '!' });
    await expect422(res, /^body$/, 'body de 1 MiB + 1');
    expect(receptor.recebidas).toHaveLength(1);
    expect(await historico(request, t)).toHaveLength(1);
  });
});

test.describe('limites: 30 disparos por minuto por URL (CA-4)', () => {
  test('30 disparos (replay e send) passam; o 31º no mesmo minuto → 429 com Retry-After; outra URL não é afetada', async ({ request, tokens, receptores }) => {
    test.setTimeout(120_000);
    await longeDaViradaDoMinuto();
    const t = (await tokens.criar()).uuid;
    const outra = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const { msg } = await enviarEGuardar(request, t, '', { method: 'POST', data: Buffer.from('{}') });

    for (let i = 0; i < 15; i++) {
      const res = await chamarReplay(request, t, msg.uuid, { url: `${receptor.url}/r/${i}`, keep_path: false });
      expect(res.status(), `replay nº ${i + 1}`).toBe(200);
    }
    for (let i = 0; i < 15; i++) {
      const res = await chamarSend(request, t, { url: `${receptor.url}/s/${i}`, method: 'GET' });
      expect(res.status(), `send nº ${i + 1}`).toBe(200);
    }

    const excedenteSend = await chamarSend(request, t, { url: `${receptor.url}/s/31`, method: 'GET' });
    expect(excedenteSend.status()).toBe(429);
    retryAfter(excedenteSend);
    const excedenteReplay = await chamarReplay(request, t, msg.uuid, { url: `${receptor.url}/r/31`, keep_path: false });
    expect(excedenteReplay.status()).toBe(429);
    retryAfter(excedenteReplay);

    // O recusado não sai nem entra no histórico.
    expect(receptor.recebidas).toHaveLength(30);
    expect(await historico(request, t)).toHaveLength(30);

    // O limite é por URL.
    const r = await send(request, outra, { url: `${receptor.url}/outra`, method: 'GET' });
    expect(r.status).toBe(200);
  });
});

test.describe('limites: histórico com as últimas 50 (CA-4)', () => {
  test('51 disparos → as 50 mais novas, mais nova primeiro (teste lento: espera o limite por minuto)', async ({ request, tokens, receptores }) => {
    test.setTimeout(240_000);
    await longeDaViradaDoMinuto();
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();

    let enviados = 0;
    while (enviados < 51) {
      const res = await chamarSend(request, t, { url: `${receptor.url}/n/${enviados + 1}`, method: 'GET' });
      if (res.status() === 429) {
        await espera(retryAfter(res) * 1_000 + 500);
        continue;
      }
      expect(res.status(), (await res.text()).slice(0, 300)).toBe(200);
      enviados++;
    }

    const lista = await historico(request, t);
    expect(lista).toHaveLength(50);
    expect(lista.map((r) => new URL(r.target).pathname)).toEqual(Array.from({ length: 50 }, (_, i) => `/n/${51 - i}`));
  });
});
