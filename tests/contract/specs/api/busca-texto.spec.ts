import { enviarEGuardar, expect, test, type Mensagem } from '../../support/contrato.js';
import { buscar, uuidsDaBusca } from '../../support/busca.js';

// Busca por texto (CA-1, plano "busca-filtro-diff" §1): `text` casa quando aparece como trecho, sem
// diferenciar maiúsculas, em qualquer um de: método, URL gravada, IP, nome ou valor de header, nome ou
// valor de query, corpo (`content`). Cada mensagem abaixo leva o texto procurado em UM campo só: a busca
// que devolve exatamente ela prova que aquele campo é varrido e que as outras não casam.

const TEXTO_PLANO = { 'Content-Type': 'text/plain' };

test.describe('busca por texto (CA-1)', () => {
  test('acha por corpo, nome e valor de header, nome e valor de query, URL e método, sem diferenciar maiúsculas', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const guardar = async (caminho: string, opcoes: Parameters<typeof enviarEGuardar>[3]) =>
      (await enviarEGuardar(request, t, caminho, opcoes)).msg;

    const corpo = await guardar('/a', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('Pedido Numero ABC-9911 confirmado') });
    const nomeHeader = await guardar('/b', { method: 'GET', headers: { 'X-Rastreio-Nome': '1' } });
    const valorHeader = await guardar('/c', { method: 'GET', headers: { 'X-Info': 'Valor-Cabecalho-QW7' } });
    // Nome e valor de query escolhidos para não aparecerem na URL gravada, que guarda a query
    // re-codificada (`chave%C3%BAnica`, `Valor%20Com%20Espaco`): só o campo `query` os tem assim.
    const nomeQuery = await guardar('/d?chave%C3%BAnica=1', { method: 'GET' });
    const valorQuery = await guardar('/e?p=Valor%20Com%20Espaco', { method: 'GET' });
    const url = await guardar('/Rota-Especial-UV8', { method: 'GET' });
    const metodo = await guardar('/f', { method: 'PATCH' });

    expect(nomeQuery.query).toEqual({ 'chaveúnica': '1' });
    expect(nomeQuery.url).not.toContain('chaveúnica');
    expect(valorQuery.query).toEqual({ p: 'Valor Com Espaco' });
    expect(valorQuery.url).not.toContain('Valor Com Espaco');

    const casos: Array<[campo: string, textos: string[], esperada: Mensagem]> = [
      ['corpo', ['Pedido Numero ABC-9911', 'pedido NUMERO abc-99', 'CONFIRMADO'], corpo],
      ['nome de header', ['x-rastreio-nome', 'X-RASTREIO-NOME', 'Rastreio-Nom'], nomeHeader],
      ['valor de header', ['Valor-Cabecalho-QW7', 'valor-CABECALHO-qw7', 'cabecalho-q'], valorHeader],
      ['nome de query', ['chaveúnica', 'CHAVEúNICA', 'aveún'], nomeQuery],
      ['valor de query', ['Valor Com Espaco', 'vALOR cOM eSPACO', 'com esp'], valorQuery],
      ['URL', ['Rota-Especial-UV8', 'rota-especial-uv8', 'ESPECIAL-uv'], url],
      ['método', ['PATCH', 'patch', 'PaTcH'], metodo],
    ];
    for (const [campo, textos, esperada] of casos) {
      for (const text of textos) {
        const pagina = await buscar(request, t, { text });
        expect(pagina.data.map((m) => m.uuid), `${campo}: text ${JSON.stringify(text)}`).toEqual([esperada.uuid]);
        expect(pagina.total, `${campo}: text ${JSON.stringify(text)}`).toBe(1);
      }
    }
  });

  test('acha pelo IP (inteiro e trecho); o IP não aparece em outro campo da mensagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg: primeira } = await enviarEGuardar(request, t, '/um', { method: 'GET' });
    const { msg: segunda } = await enviarEGuardar(request, t, '/dois', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('x') });
    expect(segunda.ip).toBe(primeira.ip);
    const ip = primeira.ip;
    expect(ip.length).toBeGreaterThan(3);
    // Sem isso o teste passaria com um servidor que não varre o IP.
    for (const m of [primeira, segunda]) {
      const outrosCampos = JSON.stringify([m.method, m.url, m.headers, m.query, m.content]);
      expect(outrosCampos, `o IP ${ip} aparece fora do campo ip`).not.toContain(ip);
    }

    const esperadas = [segunda.uuid, primeira.uuid].sort();
    expect((await uuidsDaBusca(request, t, { text: ip })).sort()).toEqual(esperadas);
    expect((await uuidsDaBusca(request, t, { text: ip.slice(1, -1) })).sort()).toEqual(esperadas);
    // O IP seguido de um caractere que ele não tem não casa.
    expect(await buscar(request, t, { text: `${ip}Z` })).toMatchObject({ data: [], total: 0 });
  });

  test('não acha o que não está lá: página vazia com total 0', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/pedido?id=ABC-9911', { method: 'POST', headers: { ...TEXTO_PLANO, 'X-Pedido': 'ABC-9911' }, data: Buffer.from('pedido ABC-9911') });
    for (const text of ['ABC-9912', 'inexistente-zz-404', 'ABC 9911', 'pedido  ABC']) {
      expect(await buscar(request, t, { text }), `text ${JSON.stringify(text)}`).toEqual({
        data: [], total: 0, per_page: 50, current_page: 1, is_last_page: true, from: 1, to: 0,
      });
    }
  });

  test('o texto é literal: caracteres de regex não são interpretados', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg } = await enviarEGuardar(request, t, '/p', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('preço (R$ 10.00) [total]* ok') });
    expect(await uuidsDaBusca(request, t, { text: '(r$ 10.00) [TOTAL]*' })).toEqual([msg.uuid]);
    // Como regex, `r. 10` e `total.` casariam; como texto, não aparecem.
    expect(await uuidsDaBusca(request, t, { text: 'r. 10' })).toEqual([]);
    expect(await uuidsDaBusca(request, t, { text: 'total.' })).toEqual([]);
  });

  test('text vazio ou ausente não filtra', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const ids = [
      (await enviarEGuardar(request, t, '/a', { method: 'GET' })).msg.uuid,
      (await enviarEGuardar(request, t, '/b', { method: 'POST', headers: TEXTO_PLANO, data: Buffer.from('b') })).msg.uuid,
    ];
    for (const pedido of [{}, { text: '' }]) {
      const pagina = await buscar(request, t, { ...pedido, sorting: 'oldest' });
      expect(pagina.data.map((m) => m.uuid), JSON.stringify(pedido)).toEqual(ids);
      expect(pagina.total).toBe(2);
    }
  });
});
