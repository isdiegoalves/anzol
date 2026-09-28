import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';
import { CLI } from './support/ambiente.mjs';
import { garantirCli } from './support/cli.mjs';

// Patamar, fatia D1, DX-05 (`.docs-arquivo/patamar/api-defeitos.md`, item 6): o CLI roda em Java 21. O teste não roda
// Java nenhum: abre os `.jar` de `<instalação>/lib` (o CLI e as dependências), lê a versão do bytecode de cada
// `.class` (bytes 6 e 7, depois do `CAFEBABE`) e exige `major` ≤ 65, o do Java 21. Classes em
// `META-INF/versions/N/` com N > 21 ficam fora: o Java 21 não as carrega (jar multi-release).

const MAJOR_DO_JAVA_21 = 65;
const JAVA_ALVO = 21;

/** Pasta `lib` da instalação: o script fica em `<instalação>/bin/anzol`. */
const LIB = path.resolve(path.dirname(CLI), '..', 'lib');

/**
 * As entradas `.class` de um zip, com os primeiros bytes de cada uma. Lê o diretório central (no fim do arquivo) e
 * descomprime só o começo de cada entrada; sem dependência de fora.
 */
function classesDoJar(arquivo) {
  const zip = fs.readFileSync(arquivo);
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fim >= 0, `${arquivo} não é um zip (sem o fim do diretório central)`);
  const entradas = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const classes = [];
  for (let i = 0; i < entradas; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50, `${arquivo}: entrada ${i} do diretório central`);
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const tamanhoDoNome = zip.readUInt16LE(p + 28);
    const tamanhoDoExtra = zip.readUInt16LE(p + 30);
    const tamanhoDoComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + tamanhoDoNome).toString('utf8');
    p += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
    if (!nome.endsWith('.class')) continue;
    // O cabeçalho local tem os próprios tamanhos de nome e de extra.
    const dados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bruto = zip.subarray(dados, dados + comprimido);
    const inicio = metodo === 0 ? bruto : zlib.inflateRawSync(bruto, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    classes.push({ nome, inicio: inicio.subarray(0, 8) });
  }
  return classes;
}

/** `N` de `META-INF/versions/N/…`; `null` fora de um jar multi-release. */
function versaoMultiRelease(nome) {
  const m = /^META-INF\/versions\/(\d+)\//.exec(nome);
  return m ? Number(m[1]) : null;
}

describe('bytecode do CLI', () => {
  test(`toda classe da instalação tem bytecode de Java ${JAVA_ALVO} ou anterior (major ≤ ${MAJOR_DO_JAVA_21})`, () => {
    garantirCli();
    const jars = fs.readdirSync(LIB).filter((f) => f.endsWith('.jar')).sort();
    assert.ok(jars.length > 0, `nenhum .jar em ${LIB}`);

    const resumo = [];
    const acima = [];
    let total = 0;
    for (const jar of jars) {
      let maior = 0;
      for (const { nome, inicio } of classesDoJar(path.join(LIB, jar))) {
        const multi = versaoMultiRelease(nome);
        if (multi !== null && multi > JAVA_ALVO) continue;
        assert.equal(inicio.readUInt32BE(0), 0xcafebabe, `${jar}!${nome} não começa com CAFEBABE`);
        const major = inicio.readUInt16BE(6);
        total++;
        maior = Math.max(maior, major);
        if (major > MAJOR_DO_JAVA_21) acima.push(`${jar}!${nome} (major ${major})`);
      }
      resumo.push(`${jar}: maior major ${maior} (Java ${maior - 44})`);
    }
    assert.ok(total > 0, `nenhuma classe lida em ${LIB}`);
    assert.deepEqual(
      acima.slice(0, 5),
      [],
      `${acima.length} classe(s) com bytecode acima do Java ${JAVA_ALVO}; o CLI não roda nele.\n${resumo.join('\n')}`,
    );
  });
});
