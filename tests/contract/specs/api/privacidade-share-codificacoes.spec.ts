import { randomUUID } from 'node:crypto';
import { capturar, comSegredo, compartilhar, expect, lerLink, test } from '../../support/privacidade.js';

// Decisões do Anzol, T2 (`.docs-arquivo/decisoes-anzol/api.md`): o link só-leitura já troca o UUID da URL por
// `[redacted]` cru, em qualquer caixa e com caracteres em `%hh` (privacidade-share.spec.ts). Passa a trocar também:
// escape JSON `\uXXXX` de qualquer caractere do UUID (o corpo JSON gravado com `-` no lugar do `-`), as 32 hex
// sem hífens em qualquer caixa, e o base64/base64url de um texto que contém o UUID (minúsculas ou maiúsculas, com ou
// sem hífens), nos 3 alinhamentos: o miolo que só depende dos bytes do UUID some. Com e sem `redact`. Outro UUID nas
// mesmas formas e o resto do conteúdo ficam.

/** Os caracteres de `base64(k bytes + texto)` que só dependem dos bytes de `texto`, para k = 0, 1, 2; base64 e base64url. */
function miolosBase64(texto: string): string[] {
  const miolos: string[] = [];
  for (const k of [0, 1, 2]) {
    const codificado = Buffer.concat([Buffer.alloc(k, 0x70), Buffer.from(texto)]).toString('base64');
    const miolo = codificado.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + texto.length)) / 6));
    miolos.push(miolo, miolo.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return [...new Set(miolos)];
}

/** As quatro grafias cujo base64 o link não pode entregar. */
function grafias(uuid: string): string[] {
  const compacto = uuid.replace(/-/g, '');
  return [uuid, uuid.toUpperCase(), compacto, compacto.toUpperCase()];
}

/** O UUID com o `-` e um dígito hexadecimal escritos como escape JSON (`-`, `a`…), dentro de uma string JSON. */
function escapadoJson(uuid: string): string {
  return [...uuid].map((c, i) => (c === '-' || i === 0 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c)).join('');
}

/** Um corpo JSON com o UUID nas formas novas, cada uma em um campo, e base64 em cada alinhamento. */
function corpoCom(uuid: string): { texto: string; blobs: string[] } {
  const compacto = uuid.replace(/-/g, '');
  const blobs: string[] = [];
  for (const forma of grafias(uuid)) {
    for (const k of [0, 1, 2]) blobs.push(Buffer.from(`${'p'.repeat(k)}https://destino.test/${forma}/volta`).toString('base64'));
  }
  const url64 = Buffer.from(`{"sub":"${uuid}","n":1}`).toString('base64url');
  const campos = [
    `"escapado":"${escapadoJson(uuid)}"`,
    `"compacto":"${compacto}"`,
    `"compactoMaiusculo":"${compacto.toUpperCase()}"`,
    `"jwt":"eyJhbGciOiJub25lIn0.${url64}."`,
    ...blobs.map((b, i) => `"b64_${i}":"${b}"`),
  ];
  return { texto: `{${campos.join(',')},"resto":"conteúdo que fica"}`, blobs: [...blobs, url64] };
}

/** Todas as strings de um JSON, em qualquer profundidade (chaves e valores), para procurar o que não pode sair. */
function strings(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) return valor.flatMap(strings);
  if (valor && typeof valor === 'object') return Object.entries(valor).flatMap(([k, v]) => [k, ...strings(v)]);
  return [];
}

/** Formas proibidas no link, procuradas no texto cru da resposta e em cada string dela, sem diferenciar caixa nas hex. */
function expectSemUuid(texto: string, valores: string[], uuid: string, contexto: string): void {
  const compacto = uuid.replace(/-/g, '').toLowerCase();
  const escapado = escapadoJson(uuid).toLowerCase();
  const vazou = new Set<string>();
  for (const alvo of [texto, ...valores]) {
    const minusculo = alvo.toLowerCase();
    if (minusculo.includes(uuid.toLowerCase())) vazou.add('cru');
    if (minusculo.includes(compacto)) vazou.add('sem hífens');
    if (minusculo.includes(escapado) || minusculo.replace(/\\\\/g, '\\').includes(escapado)) vazou.add('escape JSON');
    for (const forma of grafias(uuid)) {
      for (const miolo of miolosBase64(forma)) if (alvo.includes(miolo)) vazou.add(`base64 de ${forma === uuid ? 'minúsculas' : forma === uuid.toUpperCase() ? 'maiúsculas' : forma === forma.toUpperCase() ? 'sem hífens, maiúsculas' : 'sem hífens'}`);
    }
  }
  expect([...vazou].sort(), `${contexto}: formas do UUID da URL que saíram no link`).toEqual([]);
}

test.describe('T2: o UUID da URL em outras codificações no link só-leitura', () => {
  test('corpo, cabeçalho e query com o UUID em escape JSON, sem hífens e em base64: nada disso sai no link, com e sem redact', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const { texto } = corpoCom(url.uuid);
    const compactoMaiusculo = url.uuid.replace(/-/g, '').toUpperCase();
    const state = Buffer.from(`volta=${url.uuid}`).toString('base64url');
    const rid = await capturar(url.uuid, `/cb?state=${state}&id=${compactoMaiusculo}`, {
      body: texto, headers: { 'Content-Type': 'application/json', 'X-Destino': compactoMaiusculo, 'X-Estado': state },
    });

    for (const redact of [true, false]) {
      const link = await compartilhar(url.uuid, rid, { redact }, h);
      const res = await lerLink(link.id);
      expect(res.status, res.texto.slice(0, 300)).toBe(200);
      const publico = res.json<Record<string, unknown>>();
      expectSemUuid(res.texto, strings(publico), url.uuid, `redact ${redact}`);
      // O resto do corpo fica.
      expect(String(publico.content), `redact ${redact}`).toContain('"resto":"conteúdo que fica"');
    }
  });

  test('outro UUID nas mesmas formas fica como veio', async ({ urls }) => {
    const url = await urls.proteger();
    const h = comSegredo(url.segredo);
    const outro = randomUUID();
    const { texto, blobs } = corpoCom(outro);
    const rid = await capturar(url.uuid, '/cb', { body: texto, headers: { 'Content-Type': 'application/json' } });
    const link = await compartilhar(url.uuid, rid, { redact: false }, h);
    const res = await lerLink(link.id);
    expect(res.status).toBe(200);
    const content = String(res.json<Record<string, unknown>>().content);
    // Sem o UUID da URL em outra forma, o corpo é o gravado, byte a byte.
    expect(content).toBe(texto);
    for (const blob of blobs) expect(content).toContain(blob);
  });
});
