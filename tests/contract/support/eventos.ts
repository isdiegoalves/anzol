import { BASE_URL, type Mensagem } from './contrato.js';

/** Payload do evento `request.created`. */
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

/**
 * Transporte do evento. Só existe `sse`: o adaptador `redis`, que assinava o canal pub/sub do
 * app Laravel, saiu junto com ele.
 */
export const ADAPTADOR = process.env.EVENT_ADAPTER ?? 'sse';
const PRAZO_PADRAO = 30_000;

export function assinar(tokenId: string): Promise<Assinatura> {
  if (ADAPTADOR === 'sse') return assinarSse(tokenId);
  throw new Error(`EVENT_ADAPTER desconhecido: ${ADAPTADOR} (use sse)`);
}

/** Fila de eventos com espera por prazo. */
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
 * `GET {BASE_URL}/token/{id}/stream` em `text/event-stream`, eventos
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
