import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { BASE_URL, CHAVES_MENSAGEM, DATA_HORA, UUID, expect, test as base, type Mensagem, type Token } from './contrato.js';

export { expect };

// Privacidade e segurança da API (§1 do plano "privacidade", item 12):
// - segredo de leitura por URL (`read_secret` no `POST`/`PUT /token`, nunca devolvido; `protected` no token);
// - acesso a uma URL protegida pelo header `X-Anzol-Secret` ou pelo cookie `anzol_access` do `unlock`;
// - links só-leitura de uma mensagem (`/token/{id}/request/{rid}/share`, `/token/{id}/shares`, `/share/{sid}`);
// - `Host` e `Origin` conferidos nas rotas de gestão contra `anzol.allowed-hosts`.
//
// Os testes daqui falam HTTP pelo `fetch` do Node, e não pelo `request` do Playwright: o contexto do Playwright
// guarda cookies (o `Set-Cookie` do `unlock` iria sozinho nas chamadas seguintes), e aqui cada chamada diz
// exatamente que credencial leva. `Host` diferente só por HTTP cru (`httpCruCompleto`).

export const HEADER_SEGREDO = 'X-Anzol-Secret';
export const COOKIE_DE_ACESSO = 'anzol_access';

/** Corpo do 401 de toda rota de gestão de uma URL protegida sem acesso (§1). */
export const ERRO_PROTEGIDA = { error: 'This URL is protected', protected: true };
export const ERRO_HOST = { error: 'host not allowed' };
export const ERRO_ORIGEM = { error: 'origin not allowed' };

/** Com `ANZOL_ALLOWED_HOSTS=localhost,127.0.0.1,[::1],host.docker.internal` (o stack do `./ci.sh`). */
export const HOSTS_PERMITIDOS = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'];
export const PORTA = new URL(BASE_URL).port || '80';

/** Segredo novo, distinto por chamada (texto de 8 a 256 caracteres na §1). */
export function novoSegredo(): string {
  return `seg-${randomBytes(12).toString('hex')}`;
}

export function comSegredo(segredo: string): Record<string, string> {
  return { [HEADER_SEGREDO]: segredo };
}

export function comCookie(valor: string): Record<string, string> {
  return { Cookie: `${COOKIE_DE_ACESSO}=${valor}` };
}

// ---- HTTP sem cookie jar ----

export interface Resposta {
  status: number;
  headers: Headers;
  texto: string;
  /** Todos os `Set-Cookie` da resposta. */
  setCookies: string[];
  json<T = unknown>(): T;
}

export interface OpcoesHttp {
  headers?: Record<string, string>;
  /** Objeto → JSON com `Content-Type: application/json`; string → como veio. */
  corpo?: unknown;
}

/** Chamada à API com `Accept: application/json` e só as credenciais pedidas. */
export async function http(metodo: string, caminho: string, { headers = {}, corpo }: OpcoesHttp = {}): Promise<Resposta> {
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  let body: string | undefined;
  if (corpo !== undefined) {
    body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    if (!Object.keys(h).some((n) => n.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
  }
  const res = await fetch(new URL(caminho, BASE_URL), { method: metodo, headers: h, body });
  const texto = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    texto,
    setCookies: res.headers.getSetCookie(),
    json<T>() {
      try {
        return JSON.parse(texto) as T;
      } catch {
        throw new Error(`${metodo} ${caminho} respondeu ${res.status} sem JSON: ${texto.slice(0, 300)}`);
      }
    },
  };
}

/** Exige o 401 da §1: status, JSON e exatamente `{"error":"This URL is protected","protected":true}`. */
export function expect401Protegida(res: Resposta, contexto: string): void {
  expect(res.status, `${contexto}: ${res.texto.slice(0, 300)}`).toBe(401);
  expect(res.headers.get('content-type') ?? '', `${contexto}: Content-Type`).toMatch(/^application\/json/i);
  expect(res.json(), contexto).toEqual(ERRO_PROTEGIDA);
}

// ---- URLs protegidas, com limpeza ----

export interface UrlProtegida {
  uuid: string;
  segredo: string;
  /** O token como o `POST /token` devolveu. */
  token: Token;
}

export interface Urls {
  /** `POST /token` com `read_secret` (e os campos extras); exige 201 e registra para limpeza. */
  proteger(dados?: Record<string, unknown>, segredo?: string): Promise<UrlProtegida>;
  /** Cria sem segredo (a URL aberta de sempre), registrada para limpeza. */
  abrir(dados?: Record<string, unknown>): Promise<Token>;
  /**
   * Registra para limpeza uma URL criada por outro caminho e, se dado, um segredo a mais dela (depois de trocar
   * pelo `PUT`), para a limpeza ainda entrar.
   */
  lembrar(uuid: string, segredo?: string): void;
}

/**
 * Fixture `urls`: a limpeza do `tokens` do contrato apaga sem credencial e numa URL protegida levaria 401;
 * esta tenta sem credencial e depois com cada segredo conhecido da URL, do mais novo ao mais antigo.
 */
export const fixtureUrls = async ({}, use: (u: Urls) => Promise<void>): Promise<void> => {
  const segredos = new Map<string, string[]>();
  const lembrar = (uuid: string, segredo?: string) => {
    const lista = segredos.get(uuid) ?? [];
    if (segredo !== undefined) lista.unshift(segredo);
    segredos.set(uuid, lista);
  };
  await use({
    async proteger(dados = {}, segredo = novoSegredo()) {
      const res = await http('POST', '/token', { corpo: { ...dados, read_secret: segredo } });
      expect(res.status, `POST /token com read_secret: ${res.texto.slice(0, 300)}`).toBe(201);
      const token = res.json<Token>();
      lembrar(token.uuid, segredo);
      return { uuid: token.uuid, segredo, token };
    },
    async abrir(dados = {}) {
      const res = await http('POST', '/token', { corpo: dados });
      expect(res.status, res.texto.slice(0, 300)).toBe(201);
      const token = res.json<Token>();
      lembrar(token.uuid);
      return token;
    },
    lembrar,
  });
  for (const [uuid, lista] of segredos) {
    for (const credencial of [{}, ...lista.map(comSegredo)]) {
      await http('DELETE', `/token/${uuid}/request`, { headers: credencial });
      const res = await http('DELETE', `/token/${uuid}`, { headers: credencial });
      if (res.status !== 401) break;
    }
  }
};

export const test = base.extend<{ urls: Urls }>({ urls: fixtureUrls });

// ---- captura, mensagens e links ----

/** Webhook em `/{uuid}{caminho}` (a captura é aberta, sem credencial); devolve o `X-Request-Id`. */
export async function capturar(uuid: string, caminho = '', init: RequestInit = {}): Promise<string> {
  const res = await fetch(new URL(`/${uuid}${caminho}`, BASE_URL), { method: 'POST', body: 'corpo', ...init });
  await res.arrayBuffer();
  const id = res.headers.get('x-request-id');
  expect(id, `captura /${uuid}${caminho} (status ${res.status}) sem X-Request-Id`).toMatch(UUID);
  return id!;
}

export async function mensagem(uuid: string, rid: string, headers: Record<string, string> = {}): Promise<Mensagem> {
  const res = await http('GET', `/token/${uuid}/request/${rid}`, { headers });
  expect(res.status, `GET /token/{id}/request/{rid}: ${res.texto.slice(0, 300)}`).toBe(200);
  return res.json<Mensagem>();
}

/** Resposta do `POST /token/{id}/request/{rid}/share` (§1). */
export interface Link {
  id: string;
  url: string;
  expires_at: string;
  redact: boolean;
}

/** Id do link: 128 bits aleatórios em base62 (até 22 caracteres; 16 cobre zeros à esquerda sem enchimento). */
export const ID_DO_LINK = /^[0-9A-Za-z]{16,22}$/;

export const CHAVES_DO_LINK = ['expires_at', 'id', 'redact', 'url'];

export async function compartilhar(uuid: string, rid: string, corpo: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Link> {
  const res = await http('POST', `/token/${uuid}/request/${rid}/share`, { headers, corpo });
  expect([200, 201], `POST …/share ${JSON.stringify(corpo)}: ${res.status} ${res.texto.slice(0, 300)}`).toContain(res.status);
  const link = res.json<Link>();
  for (const chave of CHAVES_DO_LINK) expect(link, `chave ${chave} do link`).toHaveProperty(chave);
  expect(link.id).toMatch(ID_DO_LINK);
  return link;
}

/** Mensagem pública do link: o JSON de `GET /token/{id}/request/{rid}` mais `shared_at` e `expires_at`. */
export type MensagemCompartilhada = Mensagem & { shared_at: string; expires_at: string };

export async function lerLink(sid: string, headers: Record<string, string> = {}): Promise<Resposta> {
  return http('GET', `/share/${sid}`, { headers });
}

export async function lerLinkOk(sid: string): Promise<MensagemCompartilhada> {
  const res = await lerLink(sid);
  expect(res.status, `GET /share/${sid}: ${res.texto.slice(0, 300)}`).toBe(200);
  const msg = res.json<MensagemCompartilhada>();
  for (const chave of [...CHAVES_MENSAGEM, 'shared_at', 'expires_at']) expect(msg, `chave ${chave} no link`).toHaveProperty(chave);
  return msg;
}

/**
 * Instante de uma data da API em ms: o formato das datas do app (`YYYY-MM-DD HH:MM:SS`, UTC) ou ISO 8601.
 */
export function instante(valor: string): number {
  const ms = DATA_HORA.test(valor) ? Date.parse(valor.replace(' ', 'T') + 'Z') : Date.parse(valor);
  expect(Number.isNaN(ms), `data ilegível: ${valor}`).toBe(false);
  return ms;
}

export const HORA = 3_600_000;
export const DIA = 24 * HORA;

// ---- rotas de gestão de uma URL ----

export interface Rota {
  nome: string;
  metodo: string;
  caminho: string;
  corpo?: unknown;
  /** Status da resposta com acesso (a de uma URL aberta com o mesmo pedido). */
  comAcesso: number[];
}

/** Alvo bloqueado na hora pelo SSRF: replay e send passam da validação e voltam 200 sem sair para a rede. */
export const ALVO_BLOQUEADO = 'http://169.254.169.254/privacidade';

/** Regra com cenário, que nunca casa uma captura (o `PUT /scenarios/{nome}` precisa de um cenário existente). */
export const REGRA_COM_CENARIO = {
  name: 'privacidade',
  match: { path: { equals: '/nunca-casa' } },
  scenario: { name: 'fluxo', requiredState: 'Started', newState: 'ok' },
  response: { status: 202, body: 'regra' },
};

/**
 * Toda rota `/token/{id}/**` da API, fora `unlock`, `lock` e o stream SSE (conferido à parte, por ser longo).
 * As destrutivas vêm por último. `ridInexistente` é usado no explain com acesso, para responder 404 sem chamar o LLM.
 */
export function rotasDeGestao(uuid: string, rid: string, sid: string, ridInexistente: string): Rota[] {
  const t = `/token/${uuid}`;
  return [
    { nome: 'GET token', metodo: 'GET', caminho: t, comAcesso: [200] },
    { nome: 'PUT token', metodo: 'PUT', caminho: t, corpo: { default_status: 201 }, comAcesso: [200] },
    { nome: 'PUT cors/toggle', metodo: 'PUT', caminho: `${t}/cors/toggle`, comAcesso: [200] },
    { nome: 'GET requests', metodo: 'GET', caminho: `${t}/requests`, comAcesso: [200] },
    { nome: 'GET request', metodo: 'GET', caminho: `${t}/request/${rid}`, comAcesso: [200] },
    { nome: 'GET raw', metodo: 'GET', caminho: `${t}/request/${rid}/raw`, comAcesso: [200] },
    { nome: 'POST search', metodo: 'POST', caminho: `${t}/requests/search`, corpo: {}, comAcesso: [200] },
    { nome: 'POST wait', metodo: 'POST', caminho: `${t}/requests/wait`, corpo: { timeout: 0 }, comAcesso: [200] },
    // Item 14, B2: agregados da URL para Checks › Health e Insights.
    { nome: 'GET stats', metodo: 'GET', caminho: `${t}/stats`, comAcesso: [200] },
    { nome: 'GET rules', metodo: 'GET', caminho: `${t}/rules`, comAcesso: [200] },
    { nome: 'PUT rules', metodo: 'PUT', caminho: `${t}/rules`, corpo: [REGRA_COM_CENARIO], comAcesso: [200] },
    { nome: 'POST rules/test', metodo: 'POST', caminho: `${t}/rules/test`, corpo: { name: 't' }, comAcesso: [200] },
    { nome: 'GET scenarios', metodo: 'GET', caminho: `${t}/scenarios`, comAcesso: [200] },
    { nome: 'PUT scenarios/{nome}', metodo: 'PUT', caminho: `${t}/scenarios/fluxo`, corpo: { state: 'ok' }, comAcesso: [200] },
    { nome: 'DELETE scenarios', metodo: 'DELETE', caminho: `${t}/scenarios`, comAcesso: [200] },
    // Sem `prompt`: 422 sem chamar o LLM (503 num stack com a IA desligada).
    { nome: 'POST rules/suggest', metodo: 'POST', caminho: `${t}/rules/suggest`, corpo: {}, comAcesso: [422, 503] },
    { nome: 'POST explain', metodo: 'POST', caminho: `${t}/request/${ridInexistente}/explain`, corpo: {}, comAcesso: [404, 503] },
    { nome: 'POST replay', metodo: 'POST', caminho: `${t}/request/${rid}/replay`, corpo: { url: ALVO_BLOQUEADO }, comAcesso: [200] },
    { nome: 'POST send', metodo: 'POST', caminho: `${t}/send`, corpo: { url: ALVO_BLOQUEADO, method: 'POST' }, comAcesso: [200] },
    { nome: 'GET outbound', metodo: 'GET', caminho: `${t}/outbound`, comAcesso: [200] },
    { nome: 'POST share', metodo: 'POST', caminho: `${t}/request/${rid}/share`, corpo: {}, comAcesso: [200, 201] },
    { nome: 'GET shares', metodo: 'GET', caminho: `${t}/shares`, comAcesso: [200] },
    { nome: 'DELETE shares/{sid}', metodo: 'DELETE', caminho: `${t}/shares/${sid}`, comAcesso: [200, 204] },
    { nome: 'DELETE request', metodo: 'DELETE', caminho: `${t}/request/${rid}`, comAcesso: [200] },
    { nome: 'DELETE todas as requests', metodo: 'DELETE', caminho: `${t}/request`, comAcesso: [200] },
    { nome: 'DELETE token', metodo: 'DELETE', caminho: t, comAcesso: [204] },
  ];
}

/** O explain sem acesso usa a mensagem real (com acesso, a inexistente). */
export function comExplainReal(rotas: Rota[], uuid: string, rid: string): Rota[] {
  return rotas.map((r) => (r.nome === 'POST explain' ? { ...r, caminho: `/token/${uuid}/request/${rid}/explain` } : r));
}

export function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/** Uma URL protegida pronta para varrer as rotas: uma mensagem, uma regra com cenário e um link. */
export interface Cenario {
  url: UrlProtegida;
  rid: string;
  sid: string;
}

/**
 * O link é criado com o segredo; se a criação falhar, o cenário segue com um id qualquer, para a varredura ainda
 * dizer o que cada rota responde (criar links é o CA-3, e a rota `DELETE /shares/{sid}` com acesso falha sozinha).
 */
export async function montarCenario(urls: Urls): Promise<Cenario> {
  const url = await urls.proteger();
  const rid = await capturar(url.uuid, '/pedido?x=1');
  const regras = await http('PUT', `/token/${url.uuid}/rules`, { headers: comSegredo(url.segredo), corpo: [REGRA_COM_CENARIO] });
  expect(regras.status, `PUT rules com o segredo: ${regras.texto.slice(0, 300)}`).toBe(200);
  const link = await http('POST', `/token/${url.uuid}/request/${rid}/share`, { headers: comSegredo(url.segredo), corpo: {} });
  const sid = [200, 201].includes(link.status) ? link.json<Link>().id : idDeLinkQualquer();
  return { url, rid, sid };
}

/** Um id no formato de link (22 caracteres base62) que não foi criado. */
export function idDeLinkQualquer(): string {
  const alfabeto = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return Array.from(randomBytes(22), (b) => alfabeto[b % 62]).join('');
}

/** O que as rotas mudariam: lido com o segredo, para provar que um 401 não mudou nada. */
export async function retrato(c: Cenario): Promise<Record<string, unknown>> {
  const h = comSegredo(c.url.segredo);
  const token = (await http('GET', `/token/${c.url.uuid}`, { headers: h })).json<Token>();
  const listagem = await http('GET', `/token/${c.url.uuid}/requests`, { headers: h });
  const regras = await http('GET', `/token/${c.url.uuid}/rules`, { headers: h });
  const cenarios = await http('GET', `/token/${c.url.uuid}/scenarios`, { headers: h });
  const saidas = await http('GET', `/token/${c.url.uuid}/outbound`, { headers: h });
  const links = await http('GET', `/token/${c.url.uuid}/shares`, { headers: h });
  const publico = await lerLink(c.sid);
  return {
    token: { default_status: token.default_status, cors: token.cors, updated_at: token.updated_at, protected: token.protected },
    mensagens: listagem.status === 200 ? listagem.json<{ data: Mensagem[] }>().data.map((m) => m.uuid) : listagem.status,
    regras: regras.status === 200 ? regras.json<Array<{ id: string }>>().map((r) => r.id) : regras.status,
    cenarios: cenarios.status === 200 ? cenarios.json() : cenarios.status,
    saidas: saidas.status === 200 ? saidas.json<unknown[]>().length : saidas.status,
    links: links.status === 200 ? links.json<Array<{ id: string }>>().map((l) => l.id).sort() : links.status,
    linkPublico: publico.status,
  };
}

// ---- SSE ----

export interface Stream {
  status: number;
  contentType: string;
  texto: string;
  /** Próximo evento `request.created` (o `data` já como JSON). */
  proximo(prazoMs?: number): Promise<{ request: Mensagem }>;
  fechar(): void;
}

/** Abre `GET /token/{id}/stream` com as credenciais dadas; com 200 lê os eventos, senão o corpo. */
export async function abrirStream(uuid: string, headers: Record<string, string> = {}): Promise<Stream> {
  const abortar = new AbortController();
  const res = await fetch(new URL(`/token/${uuid}/stream`, BASE_URL), {
    headers: { Accept: 'text/event-stream', ...headers },
    signal: abortar.signal,
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status !== 200) {
    return { status: res.status, contentType, texto: await res.text(), proximo: () => Promise.reject(new Error('sem stream')), fechar: () => abortar.abort() };
  }
  const eventos: Array<{ request: Mensagem }> = [];
  (async () => {
    const dec = new TextDecoder();
    let buffer = '';
    let nome = '';
    let dados: string[] = [];
    try {
      for await (const parte of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += dec.decode(parte, { stream: true }).replace(/\r\n?/g, '\n');
        let i: number;
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
      // abortado
    }
  })();
  return {
    status: 200,
    contentType,
    texto: '',
    async proximo(prazo = 15_000) {
      const limite = Date.now() + prazo;
      while (Date.now() < limite) {
        const e = eventos.shift();
        if (e) return e;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`nenhum evento request.created em ${prazo} ms`);
    },
    fechar: () => abortar.abort(),
  };
}

// ---- cookie ----

export interface CookieLido {
  nome: string;
  valor: string;
  /** Atributos com o nome em minúsculas; flags (`HttpOnly`, `Secure`) valem `''`. */
  atributos: Record<string, string>;
}

export function lerSetCookie(linha: string): CookieLido {
  const [par, ...resto] = linha.split(';');
  const i = par.indexOf('=');
  const atributos: Record<string, string> = {};
  for (const a of resto) {
    const j = a.indexOf('=');
    const nome = (j < 0 ? a : a.slice(0, j)).trim().toLowerCase();
    if (nome) atributos[nome] = j < 0 ? '' : a.slice(j + 1).trim();
  }
  return { nome: par.slice(0, i).trim(), valor: par.slice(i + 1).trim(), atributos };
}

/** O `Set-Cookie` de `anzol_access` da resposta (exatamente um). */
export function cookieDeAcesso(res: Resposta): CookieLido {
  const cookies = res.setCookies.map(lerSetCookie).filter((c) => c.nome === COOKIE_DE_ACESSO);
  expect(cookies.length, `Set-Cookie ${COOKIE_DE_ACESSO} em ${JSON.stringify(res.setCookies)}`).toBe(1);
  return cookies[0];
}

/** `POST /token/{id}/unlock {"secret"}` sem credencial. */
export function desbloquear(uuid: string, segredo: unknown): Promise<Resposta> {
  return http('POST', `/token/${uuid}/unlock`, { corpo: { secret: segredo } });
}

// ---- HTTP cru com corpo ----

export interface RespostaCruaCompleta {
  status: number;
  headers: Record<string, string>;
  corpo: string;
}

/**
 * HTTP/1.1 à mão, para mandar um `Host` qualquer (o `fetch` não deixa); devolve também o corpo, com
 * `Transfer-Encoding: chunked` desfeito. `Connection: close` para ler até o fim.
 */
export function httpCruCompleto(metodo: string, alvo: string, host: string, headers: Record<string, string> = {}, corpo = ''): Promise<RespostaCruaCompleta> {
  const url = new URL(BASE_URL);
  const linhas = [`${metodo} ${alvo} HTTP/1.1`, `Host: ${host}`, 'Accept: application/json', 'Connection: close'];
  for (const [n, v] of Object.entries(headers)) linhas.push(`${n}: ${v}`);
  if (corpo || ['POST', 'PUT', 'PATCH'].includes(metodo)) linhas.push(`Content-Length: ${Buffer.byteLength(corpo)}`);
  const pedido = `${linhas.join('\r\n')}\r\n\r\n${corpo}`;
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port || 80), url.hostname, () => socket.write(pedido));
    const partes: Buffer[] = [];
    socket.on('data', (p) => partes.push(p));
    socket.on('error', reject);
    socket.setTimeout(20_000, () => socket.destroy(new Error('timeout no HTTP cru')));
    socket.on('close', () => {
      const bruto = Buffer.concat(partes);
      const fim = bruto.indexOf('\r\n\r\n');
      const [linhaStatus, ...linhasCabecalho] = bruto.subarray(0, fim).toString('latin1').split('\r\n');
      const h: Record<string, string> = {};
      for (const l of linhasCabecalho) {
        const i = l.indexOf(':');
        h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      let resto = bruto.subarray(fim + 4);
      if ((h['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
        const pedacos: Buffer[] = [];
        for (;;) {
          const eol = resto.indexOf('\r\n');
          if (eol < 0) break;
          const tamanho = parseInt(resto.subarray(0, eol).toString('latin1'), 16);
          if (!tamanho) break;
          pedacos.push(resto.subarray(eol + 2, eol + 2 + tamanho));
          resto = resto.subarray(eol + 2 + tamanho + 2);
        }
        resto = Buffer.concat(pedacos);
      }
      resolve({ status: Number(linhaStatus.split(' ')[1]), headers: h, corpo: resto.toString('utf8') });
    });
  });
}

/** Exige 403 com o corpo JSON dado. */
export function expect403(res: RespostaCruaCompleta | Resposta, corpo: Record<string, string>, contexto: string): void {
  const texto = 'corpo' in res ? res.corpo : res.texto;
  expect(res.status, `${contexto}: ${texto.slice(0, 300)}`).toBe(403);
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`${contexto}: 403 sem JSON: ${texto.slice(0, 300)}`);
  }
  expect(json, contexto).toEqual(corpo);
}

/** Espera a virada do minuto se faltam menos de 20 s (limites por minuto de relógio ou janela deslizante). */
export async function longeDaViradaDoMinuto(): Promise<void> {
  const s = new Date().getSeconds();
  if (s > 40) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
}
