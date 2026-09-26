import { spawn } from 'node:child_process';
import { BASE_URL, type Mensagem } from './contrato.js';

/** Payload do evento `request.created`, igual nos dois transportes. */
export interface EventoRequestCreated {
  request: Partial<Mensagem> & { uuid: string; token_id: string };
  total: number;
  truncated: boolean;
}

export interface Assinatura {
  /** Próximo evento `request.created` do canal; rejeita se nada chegar no prazo. */
  proximo(prazoMs?: number): Promise<EventoRequestCreated>;
  /** Garante que nenhum evento chega dentro da janela. */
  nenhum(janelaMs: number): Promise<void>;
  fechar(): Promise<void>;
}

export const ADAPTADOR = process.env.EVENT_ADAPTER ?? 'redis';
const CONTAINER_REDIS = process.env.REDIS_CONTAINER ?? 'webhook-redis';
const PRAZO_PADRAO = 30_000;

export function assinar(tokenId: string): Promise<Assinatura> {
  if (ADAPTADOR === 'redis') return assinarRedis(tokenId);
  if (ADAPTADOR === 'sse') return assinarSse(tokenId);
  throw new Error(`EVENT_ADAPTER desconhecido: ${ADAPTADOR} (use redis ou sse)`);
}

/** Fila de eventos com espera por prazo, comum aos dois adaptadores. */
class Caixa {
  private eventos: EventoRequestCreated[] = [];
  private esperando: Array<(e: EventoRequestCreated) => void> = [];
  erro: Error | null = null;

  entregar(evento: EventoRequestCreated): void {
    const quem = this.esperando.shift();
    if (quem) quem(evento);
    else this.eventos.push(evento);
  }

  proximo(prazoMs: number): Promise<EventoRequestCreated> {
    if (this.erro) return Promise.reject(this.erro);
    const pronto = this.eventos.shift();
    if (pronto) return Promise.resolve(pronto);
    return new Promise((resolve, reject) => {
      const quem = (e: EventoRequestCreated) => { clearTimeout(timer); resolve(e); };
      const timer = setTimeout(() => {
        this.esperando = this.esperando.filter((f) => f !== quem);
        reject(new Error(`nenhum evento request.created em ${prazoMs} ms (adaptador ${ADAPTADOR})`));
      }, prazoMs);
      this.esperando.push(quem);
    });
  }

  async nenhum(janelaMs: number): Promise<void> {
    await new Promise((r) => setTimeout(r, janelaMs));
    if (this.eventos.length > 0) throw new Error(`evento inesperado: ${JSON.stringify(this.eventos[0]).slice(0, 300)}`);
  }
}

/**
 * App atual: o broadcaster Redis do Laravel publica no canal `<token uuid>` a mensagem
 * `{"event":"request.created","data":{request,total,truncated},"socket":null}`.
 * O Redis não publica porta no host, então a assinatura roda dentro do container.
 */
function assinarRedis(tokenId: string): Promise<Assinatura> {
  const caixa = new Caixa();
  const proc = spawn('docker', ['exec', '-i', CONTAINER_REDIS, 'redis-cli', '--raw', 'SUBSCRIBE', tokenId], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let inscrito: () => void;
  const pronto = new Promise<void>((r) => { inscrito = r; });
  let linhasDeControle = 0;

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (parte: string) => {
    buffer += parte;
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      // Confirmação do SUBSCRIBE em --raw: "subscribe", "<canal>", "1".
      if (linhasDeControle < 3) {
        linhasDeControle++;
        if (linhasDeControle === 3) inscrito!();
        continue;
      }
      if (!linha.startsWith('{')) continue; // "message" e o nome do canal
      const envelope = JSON.parse(linha) as { event: string; data: EventoRequestCreated };
      if (envelope.event === 'request.created') caixa.entregar(envelope.data);
    }
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  proc.on('exit', (codigo) => {
    if (codigo !== null && codigo !== 0) caixa.erro = new Error(`redis-cli saiu com ${codigo}: ${stderr}`);
  });

  const assinatura: Assinatura = {
    proximo: (prazo = PRAZO_PADRAO) => caixa.proximo(prazo),
    nenhum: (janela) => caixa.nenhum(janela),
    async fechar() {
      proc.kill();
    },
  };
  return Promise.race([
    pronto.then(() => assinatura),
    new Promise<Assinatura>((_, reject) => setTimeout(() => {
      proc.kill();
      reject(new Error(`SUBSCRIBE não confirmou em 10 s: ${stderr}`));
    }, 10_000)),
  ]);
}

/**
 * App novo: `GET {BASE_URL}/token/{id}/stream` em `text/event-stream`, eventos
 * `event: request.created` com `data:` = JSON `{request, total, truncated}`.
 * A assinatura conta como pronta quando chegam o status 200 e o Content-Type do stream.
 */
async function assinarSse(tokenId: string): Promise<Assinatura> {
  const caixa = new Caixa();
  const abortar = new AbortController();
  const res = await fetch(`${BASE_URL}/token/${tokenId}/stream`, {
    headers: { Accept: 'text/event-stream' },
    signal: abortar.signal,
  });
  if (res.status !== 200) throw new Error(`stream respondeu ${res.status}`);
  const tipo = res.headers.get('content-type') ?? '';
  if (!tipo.toLowerCase().startsWith('text/event-stream')) throw new Error(`stream com Content-Type ${tipo}`);

  (async () => {
    const decodificador = new TextDecoder();
    let buffer = '';
    let evento = '';
    let dados: string[] = [];
    try {
      for await (const parte of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decodificador.decode(parte, { stream: true }).replace(/\r\n?/g, '\n');
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const linha = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          if (linha === '') {
            if (evento === 'request.created' && dados.length > 0) {
              caixa.entregar(JSON.parse(dados.join('\n')) as EventoRequestCreated);
            }
            evento = '';
            dados = [];
          } else if (linha.startsWith(':')) {
            // comentário / keep-alive
          } else {
            const doisPontos = linha.indexOf(':');
            const campo = doisPontos < 0 ? linha : linha.slice(0, doisPontos);
            let valor = doisPontos < 0 ? '' : linha.slice(doisPontos + 1);
            if (valor.startsWith(' ')) valor = valor.slice(1);
            if (campo === 'event') evento = valor;
            else if (campo === 'data') dados.push(valor);
          }
        }
      }
    } catch (e) {
      if (!abortar.signal.aborted) caixa.erro = e as Error;
    }
  })();

  return {
    proximo: (prazo = PRAZO_PADRAO) => caixa.proximo(prazo),
    nenhum: (janela) => caixa.nenhum(janela),
    async fechar() {
      abortar.abort();
    },
  };
}
