/**
 * Cliente do app webhook.site real: API de tokens e mensagens, webhook por HTTP cru (controle
 * total de cabeçalhos: repetidos, underscore, hop-by-hop, chunked) e assinatura do SSE.
 */
import net from 'node:net';
import { SERVIDOR, pausa } from './ambiente.mjs';
import { aoFinal } from './limpeza.mjs';

const ALVO = new URL(SERVIDOR);
if (ALVO.protocol !== 'http:') throw new Error(`WEBHOOK_SERVER precisa ser http:// (recebido ${SERVIDOR})`);
const PORTA = Number(ALVO.port || 80);
const JSON_ACCEPT = { Accept: 'application/json' };

let verificado = false;

/** Falha com mensagem clara se o app não responde. */
export async function verificarServidor() {
  if (verificado) return;
  try {
    await fetch(`${SERVIDOR}/token/00000000-0000-0000-0000-000000000000`, { headers: JSON_ACCEPT });
  } catch (e) {
    throw new Error(`servidor webhook.site não responde em ${SERVIDOR} (${e.cause?.code ?? e.message}); suba com \`docker compose up -d\` ou aponte WEBHOOK_SERVER`);
  }
  verificado = true;
}

/** Apaga mensagens e depois o token (a ordem do contrato). Token inexistente responde 410: ok. */
export async function apagarToken(uuid) {
  await fetch(`${SERVIDOR}/token/${uuid}/request`, { method: 'DELETE', headers: JSON_ACCEPT });
  await fetch(`${SERVIDOR}/token/${uuid}`, { method: 'DELETE', headers: JSON_ACCEPT });
}

const registrados = new Set();

/** Garante que o token some ao fim do teste, mesmo em falha. */
export function registrarToken(uuid) {
  if (registrados.has(uuid)) return;
  registrados.add(uuid);
  aoFinal(async () => {
    registrados.delete(uuid);
    await apagarToken(uuid);
  });
}

export async function criarToken() {
  await verificarServidor();
  const res = await fetch(`${SERVIDOR}/token`, { method: 'POST', headers: JSON_ACCEPT });
  if (res.status !== 201) throw new Error(`POST /token respondeu ${res.status}: ${await res.text()}`);
  const { uuid } = await res.json();
  registrarToken(uuid);
  return uuid;
}

export async function statusDoToken(uuid) {
  const res = await fetch(`${SERVIDOR}/token/${uuid}`, { headers: JSON_ACCEPT });
  await res.arrayBuffer();
  return res.status;
}

export async function buscarMensagem(token, requestId) {
  const res = await fetch(`${SERVIDOR}/token/${token}/request/${requestId}`, { headers: JSON_ACCEPT });
  if (res.status !== 200) throw new Error(`GET /token/${token}/request/${requestId} respondeu ${res.status}`);
  return res.json();
}

/**
 * Webhook por HTTP cru em `/{token}{caminho}`. `cabecalhos` é uma lista de pares [nome, valor]
 * (repetidos e nomes com underscore passam como estão). Com `chunked`, o corpo vai em
 * Transfer-Encoding chunked; senão, com Content-Length. Lê só a cabeça da resposta.
 */
export function enviarCru(token, caminho, { metodo = 'POST', cabecalhos = [], corpo, chunked = false } = {}) {
  const corpoBuf = corpo === undefined ? null : Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, 'utf8');
  const linhas = [`${metodo} /${token}${caminho} HTTP/1.1`, `Host: ${ALVO.host}`];
  for (const [nome, valor] of cabecalhos) linhas.push(`${nome}: ${valor}`);
  let resto = Buffer.alloc(0);
  if (corpoBuf && chunked) {
    linhas.push('Transfer-Encoding: chunked');
    resto = Buffer.concat([Buffer.from(`${corpoBuf.length.toString(16)}\r\n`), corpoBuf, Buffer.from('\r\n0\r\n\r\n')]);
  } else if (corpoBuf) {
    linhas.push(`Content-Length: ${corpoBuf.length}`);
    resto = corpoBuf;
  }
  const pedido = Buffer.concat([Buffer.from(`${linhas.join('\r\n')}\r\n\r\n`, 'latin1'), resto]);

  return new Promise((resolve, reject) => {
    const socket = net.connect(PORTA, ALVO.hostname);
    let recebido = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`webhook ${metodo} ${caminho}: sem resposta em 30 s`)); }, 30_000);
    socket.on('connect', () => socket.write(pedido));
    socket.on('data', (parte) => {
      recebido = Buffer.concat([recebido, parte]);
      const fim = recebido.indexOf('\r\n\r\n');
      if (fim < 0) return;
      clearTimeout(timer);
      socket.destroy();
      const [primeira, ...resto] = recebido.subarray(0, fim).toString('latin1').split('\r\n');
      const cabecalhosResposta = {};
      for (const l of resto) {
        const i = l.indexOf(':');
        cabecalhosResposta[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      const status = Number(primeira.split(' ')[1]);
      if (status !== 200) {
        reject(new Error(`webhook ${metodo} ${caminho} respondeu ${primeira} (esperado 200, o padrão do token)`));
        return;
      }
      resolve({ status, cabecalhos: cabecalhosResposta, requestId: cabecalhosResposta['x-request-id'] });
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(new Error(`webhook ${metodo} ${caminho}: ${e.message}`)); });
  });
}

/**
 * Assina o SSE do token (pronta quando chegam status e cabeçalhos) para o teste conferir pré-condições,
 * como o evento truncado do CA-3.
 */
export async function assinarEventos(token) {
  const abortar = new AbortController();
  const res = await fetch(`${SERVIDOR}/token/${token}/stream`, { headers: { Accept: 'text/event-stream' }, signal: abortar.signal });
  if (res.status !== 200) throw new Error(`stream respondeu ${res.status}`);
  const eventos = [];
  aoFinal(() => abortar.abort());
  (async () => {
    const dec = new TextDecoder();
    let buffer = '';
    let nome = '';
    let dados = [];
    try {
      for await (const parte of res.body) {
        buffer += dec.decode(parte, { stream: true }).replace(/\r\n?/g, '\n');
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const linha = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          if (linha === '') {
            if (nome === 'request.created' && dados.length > 0) eventos.push(JSON.parse(dados.join('\n')));
            nome = '';
            dados = [];
          } else if (!linha.startsWith(':')) {
            const p = linha.indexOf(':');
            const campo = p < 0 ? linha : linha.slice(0, p);
            let valor = p < 0 ? '' : linha.slice(p + 1);
            if (valor.startsWith(' ')) valor = valor.slice(1);
            if (campo === 'event') nome = valor;
            else if (campo === 'data') dados.push(valor);
          }
        }
      }
    } catch {
      // abortado ao fim do teste
    }
  })();
  return {
    /** Evento da mensagem `uuid`, esperando até `prazo` ms. */
    async evento(uuid, prazo = 15_000) {
      const limite = Date.now() + prazo;
      while (Date.now() < limite) {
        const e = eventos.find((ev) => ev.request?.uuid === uuid);
        if (e) return e;
        await pausa(50);
      }
      throw new Error(`nenhum evento request.created da mensagem ${uuid} em ${prazo} ms`);
    },
  };
}

/**
 * Todas as mensagens do token em ordem de `seq`, lidas por `after=<seq>` (a partir de 0). Falha se
 * a API não devolve `seq` inteiro e estritamente crescente.
 */
export async function mensagensPorSeq(token) {
  const msgs = [];
  let cursor = 0;
  for (;;) {
    const res = await fetch(`${SERVIDOR}/token/${token}/requests?after=${cursor}&per_page=100`, { headers: JSON_ACCEPT });
    if (res.status !== 200) throw new Error(`GET /token/${token}/requests?after=${cursor} respondeu ${res.status}: ${await res.text()}`);
    const { data, is_last_page } = await res.json();
    for (const m of data) {
      if (!Number.isInteger(m.seq)) throw new Error(`a API não devolve seq inteiro na listagem (mensagem ${m.uuid}: seq ${JSON.stringify(m.seq)})`);
      if (m.seq <= cursor) throw new Error(`after=${cursor} devolveu seq ${m.seq} (fora de ordem ou repetido)`);
      cursor = m.seq;
      msgs.push(m);
    }
    if (is_last_page || data.length === 0) return msgs;
  }
}

/** As `n` mensagens mais novas, da mais nova para a mais antiga (sorting=newest). */
export async function maisNovas(token, n) {
  const res = await fetch(`${SERVIDOR}/token/${token}/requests?sorting=newest&per_page=${n}`, { headers: JSON_ACCEPT });
  if (res.status !== 200) throw new Error(`listagem newest respondeu ${res.status}`);
  return (await res.json()).data;
}

/** Todos os uuids na ordem de chegada (sorting=oldest, página a página). */
export async function uuidsNaOrdemDeChegada(token) {
  const uuids = [];
  for (let pagina = 1; ; pagina++) {
    const res = await fetch(`${SERVIDOR}/token/${token}/requests?per_page=500&page=${pagina}`, { headers: JSON_ACCEPT });
    if (res.status !== 200) throw new Error(`listagem oldest respondeu ${res.status}`);
    const { data, is_last_page } = await res.json();
    uuids.push(...data.map((m) => m.uuid));
    if (is_last_page) return uuids;
  }
}

export async function apagarMensagem(token, uuid) {
  const res = await fetch(`${SERVIDOR}/token/${token}/request/${uuid}`, { method: 'DELETE', headers: JSON_ACCEPT });
  await res.arrayBuffer();
  if (res.status !== 200) throw new Error(`DELETE da mensagem ${uuid} respondeu ${res.status}`);
}

/**
 * Rajada: `quantidade` POSTs em `/{token}{prefixo}/<i>` (corpo = o caminho), no máximo `paralelas`
 * em voo ao mesmo tempo. Devolve os caminhos após o token, na ordem de disparo.
 */
export async function rajada(token, quantidade, { paralelas, prefixo = '/r' }) {
  const caminhos = Array.from({ length: quantidade }, (_, i) => `${prefixo}/${i}`);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < caminhos.length) {
      const caminho = caminhos[proximo++];
      await enviarCru(token, caminho, { corpo: caminho, cabecalhos: [['Content-Type', 'text/plain']] });
    }
  };
  await Promise.all(Array.from({ length: paralelas }, trabalhador));
  return caminhos;
}

/** Caminho após o token + `?` + query crua, como estão na `url` gravada (o que o CLI reenvia). */
export function caminhoGravado(msg) {
  const url = msg.url;
  const q = url.indexOf('?');
  const semQuery = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q);
  const marca = `/${msg.token_id}`;
  const i = semQuery.indexOf(marca);
  if (i < 0) throw new Error(`url gravada sem o token: ${url}`);
  return semQuery.slice(i + marca.length) + query;
}
