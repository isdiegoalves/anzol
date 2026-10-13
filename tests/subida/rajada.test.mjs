/**
 * O app recém-subido tem de aguentar a primeira leva de pedidos em paralelo. A cada subida o teste reinicia o
 * container do app (JVM nova), espera `GET /` responder e dispara na hora dezenas de clientes: metade abre a tela
 * (`GET /` e os `.js` e `.css` do build) e metade cria uma URL, captura e lê, como os workers de um E2E. Depois confere
 * que o app ainda responde.
 *
 * Reinicia o container de `ANZOL_APP_CONTAINER`: as duas variáveis são obrigatórias, para o teste nunca cair no app
 * de alguém por padrão.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const SERVIDOR = process.env.ANZOL_SERVER;
const CONTAINER = process.env.ANZOL_APP_CONTAINER;
const SUBIDAS = Number(process.env.SUBIDAS ?? 8);
const CLIENTES = 64;
const PRAZO_DO_PEDIDO = 8_000;
const PRAZO_DA_SONDA = 10_000;
const PRAZO_DA_SUBIDA = 90_000;
const JSON_ENVIADO = { Accept: 'application/json', 'Content-Type': 'application/json' };
const ESTATICO = /(?:main|chunk|styles|polyfills)-[A-Za-z0-9_-]+\.(?:js|css)/g;

/** O status, ou `null` quando o app não respondeu no prazo (ou recusou a conexão). */
async function pedir(metodo, caminho, corpo, prazo = PRAZO_DO_PEDIDO) {
  try {
    const res = await fetch(SERVIDOR + caminho, {
      method: metodo,
      headers: JSON_ENVIADO,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(prazo),
    });
    return { status: res.status, texto: await res.text() };
  } catch {
    return { status: null, texto: '' };
  }
}

async function esperarNoAr() {
  const limite = Date.now() + PRAZO_DA_SUBIDA;
  while (Date.now() < limite) {
    if ((await pedir('GET', '/', undefined, 2_000)).status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`o app não respondeu em ${SERVIDOR} em ${PRAZO_DA_SUBIDA / 1000} s`);
}

function reiniciar() {
  execFileSync('docker', ['restart', '-t', '5', CONTAINER], { stdio: 'ignore' });
}

/** Os `.js` e `.css` da tela: os do `index.html` e os que cada `.js` importa. */
async function descobrirEstaticos() {
  const vistos = new Set();
  let fila = [...(await pedir('GET', '/')).texto.matchAll(ESTATICO)].map((m) => m[0]);
  while (fila.length > 0) {
    const novos = fila.filter((nome) => !vistos.has(nome));
    novos.forEach((nome) => vistos.add(nome));
    const textos = await Promise.all(novos.filter((nome) => nome.endsWith('.js')).map((nome) => pedir('GET', `/${nome}`)));
    fila = textos.flatMap(({ texto }) => [...texto.matchAll(ESTATICO)].map((m) => m[0]));
  }
  return [...vistos].map((nome) => `/${nome}`);
}

/** Um navegador abrindo a tela: para no primeiro pedido sem resposta. */
async function abrirATela(indice, estaticos) {
  const inicio = indice % estaticos.length;
  for (const caminho of ['/', ...estaticos.slice(inicio), ...estaticos.slice(0, inicio)]) {
    if ((await pedir('GET', caminho)).status === null) return;
  }
}

/** Um cliente da API, como um teste que cria a própria URL; devolve o uuid criado. */
async function usarAApi(indice) {
  const criada = await pedir('POST', '/token', {});
  if (criada.status !== 201) return undefined;
  const { uuid } = JSON.parse(criada.texto);
  const passos = [
    ['POST', `/${uuid}/rajada/${indice}`, { pedido: indice }],
    ['GET', `/token/${uuid}`],
    ['PUT', `/token/${uuid}`, { default_status: 201 }],
    ['GET', `/token/${uuid}/requests?page=1&sorting=newest`],
    ['PUT', `/token/${uuid}/rules`, []],
    ['POST', `/${uuid}/rajada/${indice}/b`, { pedido: indice }],
  ];
  for (const [metodo, caminho, corpo] of passos) {
    if ((await pedir(metodo, caminho, corpo)).status === null) break;
  }
  return uuid;
}

test(`o app responde depois de uma rajada logo ao subir, em ${SUBIDAS} subidas`, { timeout: SUBIDAS * 150_000 }, async () => {
  assert.ok(SERVIDOR && CONTAINER, 'declare ANZOL_SERVER (ex.: http://localhost:8088) e ANZOL_APP_CONTAINER (ex.: anzolci-app-1)');
  await esperarNoAr();
  const estaticos = await descobrirEstaticos();
  assert.ok(estaticos.length > 0, 'nenhum .js ou .css achado no index.html: a imagem tem a tela?');

  const travadas = [];
  for (let subida = 1; subida <= SUBIDAS; subida++) {
    reiniciar();
    await esperarNoAr();
    const clientes = Array.from({ length: CLIENTES }, (_, i) => (i % 2 === 0 ? abrirATela(i, estaticos) : usarAApi(i)));
    const uuids = (await Promise.all(clientes)).filter(Boolean);
    const sonda = await pedir('POST', '/token', {}, PRAZO_DA_SONDA);
    if (sonda.status === 201) {
      uuids.push(JSON.parse(sonda.texto).uuid);
      await Promise.all(uuids.map((uuid) => pedir('DELETE', `/token/${uuid}`)));
    } else {
      travadas.push(subida);
    }
  }
  if (travadas.length > 0) {
    reiniciar();
    await esperarNoAr();
  }

  assert.deepEqual(travadas, [], `o app deixou de responder depois da rajada nas subidas ${travadas.join(', ')} de ${SUBIDAS}`);
});
