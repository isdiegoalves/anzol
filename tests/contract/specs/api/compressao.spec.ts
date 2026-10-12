import http from 'node:http';
import zlib from 'node:zlib';
import { BASE_URL, JSON_ACCEPT, expect, test } from '../../support/contrato.js';

interface Resposta {
  status: number;
  headers: http.IncomingHttpHeaders;
  corpo: Buffer;
}

/**
 * Pedido pelo `node:http`, que não manda `Accept-Encoding` por conta própria nem descomprime a resposta: os bytes
 * e os cabeçalhos chegam como o servidor os mandou.
 */
function pedir(metodo: string, caminho: string, cabecalhos: Record<string, string>, corpo = ''): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const pedido = http.request(new URL(caminho, BASE_URL), { method: metodo, headers: cabecalhos }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, corpo: Buffer.concat(partes) }));
    });
    pedido.on('error', reject);
    pedido.end(corpo);
  });
}

const GZIP = { 'Accept-Encoding': 'gzip' } as const;
const JSON_ENVIADO = { ...JSON_ACCEPT, 'Content-Type': 'application/json' } as const;

/** Com e sem `Accept-Encoding: gzip`: comprimida para quem pede, e o mesmo conteúdo para os dois. */
async function expectGzipSoParaQuemPede(metodo: string, caminho: string, corpo = ''): Promise<void> {
  const cabecalhos = corpo ? JSON_ENVIADO : JSON_ACCEPT;
  const semPedir = await pedir(metodo, caminho, cabecalhos, corpo);
  const pedindo = await pedir(metodo, caminho, { ...cabecalhos, ...GZIP }, corpo);

  expect(semPedir.status).toBe(200);
  expect(semPedir.headers['content-encoding']).toBeUndefined();
  expect(JSON.parse(semPedir.corpo.toString('utf8')).data).toHaveLength(12);

  expect(pedindo.status).toBe(200);
  expect(pedindo.headers['content-encoding']).toBe('gzip');
  expect(String(pedindo.headers['vary']).toLowerCase()).toContain('accept-encoding');
  expect(pedindo.headers['content-length']).toBe(String(pedindo.corpo.length));
  expect(pedindo.headers['content-type']).toBe(semPedir.headers['content-type']);
  expect(pedindo.corpo.length).toBeLessThan(semPedir.corpo.length);
  expect(zlib.gunzipSync(pedindo.corpo).equals(semPedir.corpo), 'descomprimida, é a mesma resposta').toBe(true);
}

test.describe('Compressão das respostas da API de gestão', () => {
  test('listagem: em gzip para quem manda Accept-Encoding: gzip, e igual a antes para quem não manda', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (let i = 0; i < 12; i++) {
      await request.post(`/${token.uuid}/pedidos/${i}`, { data: { pedido: i, cliente: 'Maria' } });
    }

    await expectGzipSoParaQuemPede('GET', `/token/${token.uuid}/requests?sorting=oldest`);
  });

  test('busca: em gzip para quem manda Accept-Encoding: gzip, e igual a antes para quem não manda', async ({ request, tokens }) => {
    const token = await tokens.criar();
    for (let i = 0; i < 12; i++) {
      await request.post(`/${token.uuid}/pedidos/${i}`, { data: { pedido: i, cliente: 'Maria' } });
    }

    await expectGzipSoParaQuemPede('POST', `/token/${token.uuid}/requests/search`, JSON.stringify({ text: 'Maria', sorting: 'oldest' }));
  });

  test('captura: a resposta ao webhook nunca vem comprimida, nem JSON grande para quem aceita gzip', async ({ tokens }) => {
    const resposta = JSON.stringify({ itens: Array.from({ length: 300 }, (_, i) => `item-${i}`) });
    const token = await tokens.criar({ default_content: resposta, default_content_type: 'application/json' });

    for (const aceita of ['gzip', 'gzip, deflate, br, zstd']) {
      const res = await pedir('POST', `/${token.uuid}/pedidos`, { ...JSON_ENVIADO, 'Accept-Encoding': aceita }, '{"a":1}');

      expect(res.status, aceita).toBe(200);
      expect(res.headers['content-encoding'], aceita).toBeUndefined();
      expect(res.corpo.toString('utf8'), aceita).toBe(resposta);
    }
  });
});
