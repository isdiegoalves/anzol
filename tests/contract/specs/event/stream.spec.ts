import { randomUUID } from 'node:crypto';
import { BASE_URL, expect, test } from '../../support/contrato.js';

// O que a tela supõe do stream, sem travar a forma do heartbeat: comentário, evento ou mensagem, tudo é sinal. O
// heartbeat padrão é de 15 s; a tela dá a conexão por morta depois de dois intervalos sem nada.
const INTERVALO_MS = 15_000;

/**
 * Lê as linhas cruas do stream e diz quando chegaram (ms desde o pedido) o primeiro sinal e o seguinte. As linhas de
 * um mesmo sinal (comentário, `event:`, `data:`) chegam juntas: o seguinte é a primeira linha mais de 1 s depois.
 */
async function doisSinais(tokenId: string, prazoMs: number): Promise<{ primeiro?: number; seguinte?: number }> {
  const abortar = new AbortController();
  const inicio = performance.now();
  const prazo = setTimeout(() => abortar.abort(), prazoMs);
  let primeiro: number | undefined;
  try {
    const res = await fetch(`${BASE_URL}/token/${tokenId}/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: abortar.signal,
    });
    expect(res.status).toBe(200);
    const decodificador = new TextDecoder();
    for await (const parte of res.body as unknown as AsyncIterable<Uint8Array>) {
      const linhas = decodificador.decode(parte, { stream: true }).split(/\r\n?|\n/);
      if (linhas.some((linha) => linha !== '')) {
        const agora = performance.now() - inicio;
        primeiro ??= agora;
        if (agora - primeiro > 1_000) return { primeiro, seguinte: agora };
      }
    }
  } catch (erro) {
    if (!abortar.signal.aborted) throw erro;
  } finally {
    clearTimeout(prazo);
    abortar.abort();
  }
  return { primeiro };
}

test.describe('stream SSE de uma URL', () => {
  test('410 no stream de uma URL que não existe', async ({ request }) => {
    const res = await request.get(`/token/${randomUUID()}/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status()).toBe(410);
  });

  test('um sinal na abertura e outro em até dois intervalos do heartbeat, lido nas linhas cruas', async ({
    tokens,
  }) => {
    const token = await tokens.criar();

    const { primeiro, seguinte } = await doisSinais(token.uuid, 2 * INTERVALO_MS + 5_000);

    expect(primeiro, 'o primeiro sinal sai na abertura').toBeLessThan(5_000);
    expect(seguinte, 'outro sinal em até dois intervalos').toBeDefined();
    expect(seguinte! - primeiro!).toBeLessThanOrEqual(2 * INTERVALO_MS);
  });
});
