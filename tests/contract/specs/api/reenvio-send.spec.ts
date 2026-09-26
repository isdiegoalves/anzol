import { expect, listar } from '../../support/contrato.js';
import { expectValida, type ConfigAssinatura } from '../../support/assinatura.js';
import {
  APP_PELO_ALVO, chamarSend, expect422, historico, send, test, valorDoHeader,
} from '../../support/reenvio.js';

// Envio montado (CA-2 do plano "reenvio-servidor", §1): `POST /token/{id}/send` `{url, method, headers, body,
// sign, timeout?}` sai com o método, os headers e o corpo pedidos. `sign=true` assina com a `signature` da URL
// como o CLI `send`; a prova é mandar para outra URL do próprio webhook.site com a mesma `signature` e ler
// `valid: true` na mensagem gravada lá. O segredo não aparece na resposta nem no histórico.

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const CORPO = '{"evento" : "pago",\r\n\t"valor": 10.5, "nome": "João 😀"}\n';

test.describe('send: método, headers e corpo (CA-2)', () => {
  test('os 7 métodos saem como pedidos', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ body: 'ok' });
    for (const method of METODOS) {
      const r = await send(request, t, { url: `${receptor.url}/m/${method}`, method });
      expect(r.kind).toBe('send');
      expect(r.method).toBe(method);
      expect(r.status).toBe(200);
      const chegou = receptor.recebidas[receptor.recebidas.length - 1];
      expect(chegou.method).toBe(method);
      expect(chegou.url).toBe(`/m/${method}`);
      if (method === 'HEAD') expect(r.body ?? '').toBe('');
    }
    expect(receptor.recebidas).toHaveLength(METODOS.length);
  });

  test('headers pedidos chegam com o valor; corpo chega byte a byte; target é a URL pedida', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir({ status: 202, headers: { 'X-Resposta': 'r1' }, body: 'aceito' });
    const url = `${receptor.url}/api/v1/eventos?origem=contrato&n=2`;

    const r = await send(request, t, {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Um': '1', 'X-Dois': 'dois dois', Authorization: 'Bearer abc' },
      body: CORPO,
    });

    expect(receptor.recebidas).toHaveLength(1);
    const chegou = receptor.recebidas[0];
    expect(chegou.url).toBe('/api/v1/eventos?origem=contrato&n=2');
    expect(chegou.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(chegou.headers['x-um']).toBe('1');
    expect(chegou.headers['x-dois']).toBe('dois dois');
    expect(chegou.headers['authorization']).toBe('Bearer abc');
    expect(chegou.body.equals(Buffer.from(CORPO, 'utf8')), JSON.stringify(chegou.body.toString('utf8'))).toBe(true);

    expect(r.target).toBe(url);
    expect(r.source_request ?? null).toBeNull();
    expect(valorDoHeader(r.request_headers, 'x-dois')).toBe('dois dois');
    expect(r.status).toBe(202);
    expect(valorDoHeader(r.headers, 'x-resposta')).toBe('r1');
    expect(r.body).toBe('aceito');
    expect(await historico(request, t)).toEqual([r]);
  });

  test('sem body → nada no corpo', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    await send(request, t, { url: receptor.url, method: 'POST' });
    expect(receptor.recebidas[0].body.length).toBe(0);
  });
});

const SEGREDO = 'whsec_reenvio_contrato_5b1f9d2e7a';

interface CasoAssinatura {
  config: ConfigAssinatura;
  /** Headers que a assinatura acrescenta ao envio. */
  cabecalhos: string[];
}

const CASOS: CasoAssinatura[] = [
  { config: { provider: 'github' }, cabecalhos: ['X-Hub-Signature-256'] },
  { config: { provider: 'stripe' }, cabecalhos: ['Stripe-Signature'] },
  { config: { provider: 'generic', header: 'X-Assinatura', algorithm: 'sha512', encoding: 'base64', prefix: 'sig=' }, cabecalhos: ['X-Assinatura'] },
  { config: { provider: 'shopify' }, cabecalhos: ['X-Shopify-Hmac-Sha256'] },
  { config: { provider: 'slack' }, cabecalhos: ['X-Slack-Signature', 'X-Slack-Request-Timestamp'] },
];

test.describe('send assinado (CA-2)', () => {
  for (const caso of CASOS) {
    test(`${caso.config.provider}: sign=true é aceito pela verificação de outra URL com a mesma signature; o segredo não volta`, async ({ request, tokens }) => {
      const signature = { ...caso.config, secret: SEGREDO };
      const origem = (await tokens.criar({ signature })).uuid;
      const destino = (await tokens.criar({ signature })).uuid;

      const r = await send(request, origem, {
        url: `${APP_PELO_ALVO}/${destino}/assinado`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: CORPO,
        sign: true,
      });

      expect(r.error ?? null, JSON.stringify(r.error)).toBeNull();
      expect(r.status).toBe(200);
      for (const nome of caso.cabecalhos) {
        expect(valorDoHeader(r.request_headers, nome), `request_headers sem ${nome}`).toBeTruthy();
      }

      const { data } = await listar(request, destino);
      expect(data).toHaveLength(1);
      expect(data[0].method).toBe('POST');
      expect(data[0].content).toBe(CORPO);
      expectValida(data[0].signature, caso.config.provider);
      for (const nome of caso.cabecalhos) {
        expect(data[0].headers[nome.toLowerCase()]?.at(-1)).toBe(valorDoHeader(r.request_headers, nome));
      }

      // O segredo não aparece no resultado, no histórico nem no que chegou ao destino.
      const lista = await historico(request, origem);
      expect(lista).toEqual([r]);
      expect(JSON.stringify(r)).not.toContain(SEGREDO);
      expect(JSON.stringify(lista)).not.toContain(SEGREDO);
      expect(JSON.stringify(data[0])).not.toContain(SEGREDO);
    });
  }

  test('sign=false (ou ausente) numa URL com signature → sai sem header de assinatura', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } })).uuid;
    const receptor = await receptores.subir();
    await send(request, t, { url: receptor.url, method: 'POST', body: CORPO, sign: false });
    await send(request, t, { url: receptor.url, method: 'POST', body: CORPO });
    expect(receptor.recebidas).toHaveLength(2);
    for (const chegou of receptor.recebidas) expect(chegou.headers['x-hub-signature-256']).toBeUndefined();
  });

  test('sign=true numa URL sem signature → 422; nada sai e nada entra no histórico', async ({ request, tokens, receptores }) => {
    const t = (await tokens.criar()).uuid;
    const receptor = await receptores.subir();
    const res = await chamarSend(request, t, { url: receptor.url, method: 'POST', body: CORPO, sign: true });
    await expect422(res, /^sign/, 'sign sem signature');
    expect(receptor.recebidas).toHaveLength(0);
    expect(await historico(request, t)).toEqual([]);
  });
});
