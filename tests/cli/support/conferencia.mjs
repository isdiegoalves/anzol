/**
 * O que a §1 manda reenviar, conferido contra a mensagem gravada (lida pela API):
 * método; `<forward>` + caminho após o token + query crua da `url`; cabeçalhos gravados menos
 * hop-by-hop, `host` e `content-length`; corpo = `content` em UTF-8.
 */
import assert from 'node:assert/strict';
import { valores } from './capturador.mjs';
import { caminhoGravado } from './servidor.mjs';

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade'];

export function descartado(nome) {
  return HOP_BY_HOP.includes(nome) || nome.startsWith('proxy-') || nome === 'host' || nome === 'content-length';
}

/** Alvo esperado no app local: caminho do --forward + caminho após o token + query gravada. */
export function alvoEsperado(forward, msg) {
  const base = new URL(forward).pathname.replace(/\/$/, '');
  const alvo = base + caminhoGravado(msg);
  if (alvo === '') return '/';
  return alvo.startsWith('?') ? `/${alvo}` : alvo;
}

/** Cabeçalhos: preservados como gravados; descartados não chegam com o valor gravado. */
export function conferirCabecalhos(msg, rec, forward) {
  for (const [nome, gravados] of Object.entries(msg.headers)) {
    if (descartado(nome)) continue;
    assert.deepEqual(valores(rec, nome), gravados, `cabeçalho ${nome}: gravado ${JSON.stringify(gravados)}, chegou ${JSON.stringify(valores(rec, nome))}`);
  }
  for (const [nome, gravados] of Object.entries(msg.headers)) {
    if (!descartado(nome) || nome === 'host' || nome === 'content-length') continue;
    const chegaram = valores(rec, nome);
    for (const v of gravados) {
      assert.ok(!chegaram.includes(v), `cabeçalho ${nome} deveria ser descartado, mas chegou com o valor gravado ${JSON.stringify(v)}`);
    }
  }
  assert.deepEqual(valores(rec, 'host'), [new URL(forward).host], 'host deve ser o do --forward, não o gravado');
  assert.deepEqual(valores(rec, 'transfer-encoding'), [], 'transfer-encoding não deve chegar: o content-length é recalculado');
  assert.deepEqual(valores(rec, 'content-length'), [String(rec.corpo.length)], 'content-length deve ser o tamanho do corpo reenviado');
}

/** Reenvio completo de uma mensagem que não é multipart. */
export function conferirReenvio(msg, rec, forward) {
  assert.equal(rec.metodo, msg.method, 'método');
  assert.equal(rec.url, alvoEsperado(forward, msg), 'caminho + query');
  const corpo = Buffer.from(msg.content, 'utf8');
  assert.ok(rec.corpo.equals(corpo), `corpo difere do content gravado: chegaram ${rec.corpo.length} bytes, esperados ${corpo.length}`);
  conferirCabecalhos(msg, rec, forward);
}
