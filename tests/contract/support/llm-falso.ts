import http from 'node:http';
import { randomUUID } from 'node:crypto';

// LLM falso OpenAI-compatível para a IA local (§1 do plano "ia-local"). Sobe no host numa porta fixa
// (`LLM_FALSO_PORTA`, padrão 18099) no `globalSetup` do Playwright, no processo do runner, e vale para
// todos os workers; o app sob teste chega a ele por `ANZOL_AI_BASE_URL=http://host.docker.internal:18099`.
//
// Como os testes rodam em paralelo contra o mesmo falso, cada teste inventa um MARCADOR (texto sem
// espaço nem aspas, que sai igual no JSON) e o põe no prompt do suggest ou no corpo da mensagem do
// explain. O falso responde a cada `POST …/chat/completions` com o roteiro do marcador que aparece no
// corpo do pedido, na ordem programada (esgotado, repete a última), e guarda o pedido para o teste
// conferir o prompt. Pedido sem marcador conhecido → 500 (nenhum teste espera por ele).
//
// Controle (só para os testes): `POST /__falso/roteiros` `{marcador, respostas}`,
// `GET /__falso/pedidos?marcador=…` e `GET /__falso/saude`.

export const PORTA_LLM_FALSO = Number(process.env.LLM_FALSO_PORTA ?? 18099);

/** Uma resposta programada. `atraso` (ms) vale para qualquer uma: o falso espera antes de responder. */
export type RespostaProgramada = { atraso?: number } & (
  /**
   * Regra sugerida. O falso obedece ao `response_format` do pedido, como um modelo com decodificação
   * restrita: se o schema pedido tem a propriedade `rule`, o conteúdo é `{"rule": …, "explanation": …}`;
   * senão, a regra sozinha.
   */
  | { regra: unknown; explicacao?: string }
  /** Conteúdo cru de `choices[0].message.content` (texto do explain, ou algo que não é JSON). */
  | { conteudo: string; raciocinio?: string }
  /** Erro HTTP do LLM (ex.: 500). */
  | { status: number; corpo?: string }
  /** LLM fora: fecha a conexão sem responder. */
  | { derrubar: true }
);

/** Mensagem do chat como o app a mandou (`content` texto ou lista de partes). */
export interface MensagemDoChat {
  role: string;
  content: string | Array<{ type?: string; text?: string }> | null;
}

/** Pedido recebido pelo falso, como o teste o lê. */
export interface PedidoAoLlm {
  marcador: string | null;
  caminho: string;
  headers: Record<string, string | string[] | undefined>;
  corpo: {
    model?: string;
    messages?: MensagemDoChat[];
    temperature?: number;
    stream?: boolean;
    response_format?: { type?: string; json_schema?: { name?: string; strict?: boolean; schema?: unknown } };
    [chave: string]: unknown;
  };
  /** Relógio do falso (ms) na chegada e na resposta, para conferir chamadas simultâneas. */
  inicio: number;
  fim: number | null;
}

interface Roteiro {
  respostas: RespostaProgramada[];
  usadas: number;
}

function lerCorpo(req: http.IncomingMessage): Promise<string> {
  return new Promise((ok, erro) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', erro);
  });
}

function responderJson(res: http.ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) });
  res.end(texto);
}

/** O schema do `response_format` pede o envelope `{rule, explanation}`? */
function pedeEnvelope(corpo: PedidoAoLlm['corpo']): boolean {
  const schema = corpo.response_format?.json_schema?.schema as { properties?: Record<string, unknown> } | undefined;
  return schema?.properties !== undefined && 'rule' in schema.properties;
}

function conteudoDe(resposta: RespostaProgramada, corpo: PedidoAoLlm['corpo']): { conteudo: string; raciocinio?: string } {
  if ('regra' in resposta) {
    const explicacao = resposta.explicacao ?? 'Regra sugerida pelo LLM falso.';
    return { conteudo: JSON.stringify(pedeEnvelope(corpo) ? { rule: resposta.regra, explanation: explicacao } : resposta.regra) };
  }
  if ('conteudo' in resposta) return { conteudo: resposta.conteudo, raciocinio: resposta.raciocinio };
  throw new Error('resposta sem conteúdo');
}

function responderChat(res: http.ServerResponse, corpo: PedidoAoLlm['corpo'], conteudo: string, raciocinio?: string): void {
  const id = `chatcmpl-${randomUUID()}`;
  const criado = Math.floor(Date.now() / 1000);
  const modelo = corpo.model ?? 'falso';
  const mensagem: Record<string, unknown> = { role: 'assistant', content: conteudo };
  if (raciocinio !== undefined) mensagem.reasoning_content = raciocinio;
  if (corpo.stream === true) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const pedaco = (delta: Record<string, unknown>, fim: string | null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: criado, model: modelo, choices: [{ index: 0, delta, finish_reason: fim }] })}\n\n`;
    if (raciocinio !== undefined) res.write(pedaco({ role: 'assistant', reasoning_content: raciocinio }, null));
    res.write(pedaco({ role: 'assistant', content: conteudo }, null));
    res.write(pedaco({}, 'stop'));
    res.end('data: [DONE]\n\n');
    return;
  }
  responderJson(res, 200, {
    id,
    object: 'chat.completion',
    created: criado,
    model: modelo,
    choices: [{ index: 0, message: mensagem, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}

/** Sobe o falso; rejeita com o erro do `listen` (ex.: `EADDRINUSE`). */
export async function subirLlmFalso(porta = PORTA_LLM_FALSO): Promise<http.Server> {
  const roteiros = new Map<string, Roteiro>();
  const pedidos: PedidoAoLlm[] = [];

  const servidor = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://falso');
      const texto = await lerCorpo(req);

      if (url.pathname === '/__falso/saude') return responderJson(res, 200, { falso: 'llm' });
      if (url.pathname === '/__falso/roteiros' && req.method === 'POST') {
        const { marcador, respostas } = JSON.parse(texto) as { marcador: string; respostas: RespostaProgramada[] };
        roteiros.set(marcador, { respostas, usadas: 0 });
        return responderJson(res, 200, { ok: true });
      }
      if (url.pathname === '/__falso/pedidos') {
        const marcador = url.searchParams.get('marcador');
        return responderJson(res, 200, pedidos.filter((p) => p.marcador === marcador));
      }
      // O cliente pode montar o caminho com ou sem o `/v1` (depende de como a URL base foi configurada).
      if (req.method === 'GET' && url.pathname.endsWith('/models')) {
        const ids = ['NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit', 'KAT-Coder-V2.5-Dev-oQ4e-mtp'];
        return responderJson(res, 200, { object: 'list', data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'falso' })) });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
        let corpo: PedidoAoLlm['corpo'] = {};
        try {
          corpo = JSON.parse(texto) as PedidoAoLlm['corpo'];
        } catch {
          // Corpo que não é JSON fica registrado vazio; o teste vê pelo prompt ausente.
        }
        const marcador = [...roteiros.keys()].find((m) => texto.includes(m)) ?? null;
        const pedido: PedidoAoLlm = { marcador, caminho: url.pathname, headers: req.headers, corpo, inicio: Date.now(), fim: null };
        pedidos.push(pedido);
        const roteiro = marcador === null ? undefined : roteiros.get(marcador);
        if (roteiro === undefined || roteiro.respostas.length === 0) {
          pedido.fim = Date.now();
          return responderJson(res, 500, { error: { message: 'LLM falso: pedido sem roteiro', type: 'server_error' } });
        }
        const resposta = roteiro.respostas[Math.min(roteiro.usadas, roteiro.respostas.length - 1)];
        roteiro.usadas += 1;
        if (resposta.atraso) await new Promise((ok) => setTimeout(ok, resposta.atraso));
        pedido.fim = Date.now();
        if ('derrubar' in resposta) return req.socket.destroy();
        if ('status' in resposta) {
          const erro = resposta.corpo ?? JSON.stringify({ error: { message: 'LLM falso: erro programado', type: 'server_error' } });
          res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
          return res.end(erro);
        }
        const { conteudo, raciocinio } = conteudoDe(resposta, corpo);
        return responderChat(res, corpo, conteudo, raciocinio);
      }
      responderJson(res, 404, { error: { message: `LLM falso: ${req.method} ${url.pathname} não existe` } });
    })().catch((erro: unknown) => {
      if (!res.headersSent) responderJson(res, 500, { error: { message: String(erro) } });
    });
  });

  await new Promise<void>((ok, erro) => {
    servidor.once('error', erro);
    // Em todas as interfaces: o app, no container, chega pelo host.docker.internal.
    servidor.listen(porta, '0.0.0.0', () => ok());
  });
  return servidor;
}

// --- Cliente usado pelos testes (em qualquer worker) ------------------------------------------------

const CONTROLE = `http://127.0.0.1:${PORTA_LLM_FALSO}/__falso`;

/** Marcador único por teste: letras e dígitos, igual no texto e no JSON. */
export function novoMarcador(): string {
  return `mrc${randomUUID().replaceAll('-', '')}`;
}

async function controle(caminho: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${CONTROLE}${caminho}`, init);
  } catch (erro) {
    throw new Error(`LLM falso fora do ar na porta ${PORTA_LLM_FALSO} (o globalSetup não conseguiu subir?): ${String(erro)}`);
  }
}

/** Programa as respostas do LLM falso para os pedidos que contêm `marcador`. */
export async function programarLlm(marcador: string, respostas: RespostaProgramada[]): Promise<void> {
  const res = await controle('/roteiros', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marcador, respostas }),
  });
  if (!res.ok) throw new Error(`a porta ${PORTA_LLM_FALSO} não é o LLM falso: ${res.status} ${await res.text()}`);
}

/** Pedidos recebidos com `marcador`, em ordem de chegada. */
export async function pedidosAoLlm(marcador: string): Promise<PedidoAoLlm[]> {
  const res = await controle(`/pedidos?marcador=${encodeURIComponent(marcador)}`);
  return (await res.json()) as PedidoAoLlm[];
}

/** Texto de uma mensagem do chat (partes juntadas). */
export function textoDaMensagem(m: MensagemDoChat): string {
  if (typeof m.content === 'string') return m.content;
  return (m.content ?? []).map((p) => p.text ?? '').join('');
}

/** Todo o texto das mensagens do pedido, na ordem. */
export function textoDoPedido(p: PedidoAoLlm): string {
  return (p.corpo.messages ?? []).map(textoDaMensagem).join('\n');
}
