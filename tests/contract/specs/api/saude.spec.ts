import { MODO_IA, MODO_MCP } from '../../support/ia.js';
import { expectConformeAoDocumento } from '../../support/openapi.js';
import { PORTA, expect, http, httpCruCompleto, test } from '../../support/privacidade.js';

// Saúde e versão do servidor. `GET /health` responde 200 só com o Redis no ar: é a rota das probes do Kubernetes e do
// HEALTHCHECK da imagem. `GET /version` diz a versão que está rodando. As duas respondem com qualquer `Host`: a probe
// chega com o IP do pod. O 503 do Redis fora do ar não é observável daqui (o contrato não derruba o Redis do app sob
// teste) e fica com o teste do backend.

interface Saude {
  status: string;
  version: string;
  redis: string;
  ai: string;
  mcp: string;
}

const HOSTS_DE_FORA = [`10.42.0.17:${PORTA}`, 'evil.test', 'anzol.default.svc.cluster.local'];

test.describe('Saúde e versão do servidor', () => {
  test('GET /health → 200 com status ok, a versão, o redis e a IA e o MCP como o stack os ligou', async () => {
    const res = await http('GET', '/health');

    expect(res.status, res.texto.slice(0, 300)).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const saude = res.json<Saude>();
    expect(Object.keys(saude).sort()).toEqual(['ai', 'mcp', 'redis', 'status', 'version']);
    expect(saude.status).toBe('ok');
    expect(saude.redis).toBe('ok');
    expect(saude.version).toMatch(/\S/);
    expect(saude.ai).toBe(MODO_IA === 'desligada' ? 'off' : 'on');
    expect(saude.mcp).toBe(MODO_MCP === 'desligado' ? 'off' : 'on');
    await expectConformeAoDocumento('GET', '/health', 200, saude);
  });

  test('GET /version → 200 com a mesma versão do /health', async () => {
    const res = await http('GET', '/version');

    expect(res.status, res.texto.slice(0, 300)).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const corpo = res.json<{ version: string }>();
    expect(Object.keys(corpo)).toEqual(['version']);
    expect(corpo.version).toBe((await http('GET', '/health')).json<Saude>().version);
    await expectConformeAoDocumento('GET', '/version', 200, corpo);
  });

  test('Host fora da lista de aceitos → as duas respondem como com o Host da lista', async () => {
    for (const host of HOSTS_DE_FORA) {
      for (const alvo of ['/health', '/version']) {
        const res = await httpCruCompleto('GET', alvo, host);
        expect(res.status, `${alvo} com Host ${host}: ${res.corpo.slice(0, 300)}`).toBe(200);
        expect(JSON.parse(res.corpo).version, `${alvo} com Host ${host}`).toMatch(/\S/);
      }
    }
  });
});
