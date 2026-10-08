import { randomUUID } from 'node:crypto';
import { expectConformeAoDocumento } from '../../support/openapi.js';
import { ALVO_BLOQUEADO, capturar, comSegredo, expect, http, test, type Resposta } from '../../support/privacidade.js';

// O documento OpenAPI 3.1 (`GET /openapi.json` e `/openapi.yaml`) descreve as respostas reais: cada chamada aqui tem
// o corpo validado contra o schema que o documento declara para o método, o caminho e o status. Um campo novo na API
// sem o documento, ou um schema que não bate com o que sai, falha aqui. A cobertura das rotas (toda rota do Spring
// no documento e nenhuma a mais) e a validade do documento contra o schema oficial ficam com os testes do backend.

async function conferir(metodo: string, caminho: string, res: Resposta, status: number): Promise<any> {
  expect(res.status, `${metodo} ${caminho}: ${res.texto.slice(0, 300)}`).toBe(status);
  const corpo = res.json<unknown>();
  await expectConformeAoDocumento(metodo, caminho, status, corpo);
  return corpo;
}

test('o documento é OpenAPI 3.1.0 em JSON e em YAML', async () => {
  const json = await http('GET', '/openapi.json');
  const yaml = await http('GET', '/openapi.yaml');
  expect(json.status).toBe(200);
  expect(json.json<{ openapi: string }>().openapi).toBe('3.1.0');
  expect(yaml.status).toBe(200);
  expect(yaml.texto).toMatch(/^openapi: ["']?3\.1\.0/m);
});

test('URL, captura, mensagens, regras, busca, espera, estatísticas e links seguem o documento', async ({ urls }) => {
  const token = await conferir('POST', '/token', await http('POST', '/token', { corpo: { default_status: 201, retry_after: 30 } }), 201);
  urls.lembrar(token.uuid);
  const t = `/token/${token.uuid}`;
  await conferir('GET', '/token/{tokenId}', await http('GET', t), 200);
  await conferir('PUT', '/token/{tokenId}', await http('PUT', t, { corpo: { default_status: 202, schema: { type: 'object' } } }), 200);
  await conferir('PUT', '/token/{tokenId}/cors/toggle', await http('PUT', `${t}/cors/toggle`), 200);

  const rid = await capturar(token.uuid, '/pedidos', { body: JSON.stringify({ id: 7 }), headers: { 'Content-Type': 'application/json' } });
  await conferir('GET', '/token/{tokenId}/request/{requestId}', await http('GET', `${t}/request/${rid}`), 200);
  await conferir('GET', '/token/{tokenId}/requests', await http('GET', `${t}/requests?sorting=newest`), 200);

  const regras = [{ name: 'pedido', match: { method: ['POST'], path: { prefix: '/pedidos' } }, response: { status: 201, body: 'ok' } }];
  await conferir('PUT', '/token/{tokenId}/rules', await http('PUT', `${t}/rules`, { corpo: regras }), 200);
  await conferir('GET', '/token/{tokenId}/rules', await http('GET', `${t}/rules`), 200);
  await conferir('POST', '/token/{tokenId}/rules/test', await http('POST', `${t}/rules/test`, { corpo: regras[0] }), 200);
  await conferir('GET', '/token/{tokenId}/request/{requestId}/rules/trace', await http('GET', `${t}/request/${rid}/rules/trace`), 200);
  await conferir('GET', '/token/{tokenId}/scenarios', await http('GET', `${t}/scenarios`), 200);

  await conferir('POST', '/token/{tokenId}/requests/search', await http('POST', `${t}/requests/search`, { corpo: { text: 'id' } }), 200);
  await conferir('POST', '/token/{tokenId}/requests/wait', await http('POST', `${t}/requests/wait`, { corpo: { timeout: 0 } }), 200);
  await conferir('GET', '/token/{tokenId}/stats', await http('GET', `${t}/stats`), 200);

  const envio = await http('POST', `${t}/send`, { corpo: { url: ALVO_BLOQUEADO, method: 'POST', body: 'x' } });
  await conferir('POST', '/token/{tokenId}/send', envio, envio.status);
  await conferir('GET', '/token/{tokenId}/outbound', await http('GET', `${t}/outbound`), 200);

  const link = await conferir('POST', '/token/{tokenId}/request/{requestId}/share', await http('POST', `${t}/request/${rid}/share`, { corpo: {} }), 201);
  await conferir('GET', '/token/{tokenId}/shares', await http('GET', `${t}/shares`), 200);
  await conferir('GET', '/share/{shareId}', await http('GET', `/share/${link.id}`), 200);

  await conferir('DELETE', '/token/{tokenId}/request', await http('DELETE', `${t}/request`), 200);
});

test('chaves, JWKS e laboratório E2EE seguem o documento', async ({ urls }) => {
  const lab = await conferir('POST', '/e2ee-lab', await http('POST', '/e2ee-lab', { corpo: {} }), 201);
  urls.lembrar(lab.token.uuid, lab.read_secret);
  const t = `/token/${lab.token.uuid}`;
  const segredo = comSegredo(lab.read_secret);
  await conferir('GET', '/e2ee-lab/scenarios', await http('GET', '/e2ee-lab/scenarios'), 200);
  await conferir('GET', '/token/{tokenId}/jwks.json', await http('GET', `${t}/jwks.json`), 200);
  await conferir('POST', '/token/{tokenId}/e2ee-lab/run', await http('POST', `${t}/e2ee-lab/run`, { headers: segredo, corpo: { scenarios: ['P1', 'N3'] } }), 200);

  const protegida = await urls.proteger();
  const p = `/token/${protegida.uuid}`;
  const chave = await http('POST', `${p}/keys`, { headers: comSegredo(protegida.segredo), corpo: { kid: 'enc-v1' } });
  await conferir('POST', '/token/{tokenId}/keys', chave, 201);
});

test('os erros seguem o documento: 422, 401, 404 e 410', async ({ urls }) => {
  await conferir('POST', '/token', await http('POST', '/token', { corpo: { timeout: 11 } }), 422);

  const protegida = await urls.proteger();
  await conferir('GET', '/token/{tokenId}', await http('GET', `/token/${protegida.uuid}`), 401);

  const aberta = await urls.abrir();
  await conferir('GET', '/token/{tokenId}/request/{requestId}', await http('GET', `/token/${aberta.uuid}/request/${randomUUID()}`), 404);

  const apagada = await urls.abrir();
  await http('DELETE', `/token/${apagada.uuid}`);
  await conferir('GET', '/token/{tokenId}', await http('GET', `/token/${apagada.uuid}`), 410);
});
