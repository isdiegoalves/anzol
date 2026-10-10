import {
  Agent,
  ClientRequest,
  IncomingMessage,
  Server,
  ServerResponse,
  createServer,
  request,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { test as base } from './fixtures';

interface Regra {
  rota: RegExp;
  metodo?: string;
}

interface Stream {
  token: string;
  res: ServerResponse;
  up?: ClientRequest;
  congelado: boolean;
}

interface Segura {
  respondeu: () => void;
  /** Resolve com o status que substitui a resposta do app, ou sem nada para entregá-la como veio. */
  solta: Promise<number | undefined>;
  liberar: (status?: number) => void;
}

const STREAM = /^\/token\/([^/?]+)\/stream(\?|$)/;

/**
 * Proxy HTTP entre o navegador e o app, que estraga de propósito o que o teste pede: o `/stream` de uma URL, ou a
 * resposta de uma rota. Repassa o `Host` como veio, para a conferência de Host e Origin do app valer como na porta
 * dele. `rota` é testada contra o caminho com a query (`/token/{id}/requests?page=1&sorting=newest`).
 */
export class ProxyDeCaos {
  private readonly streams = new Set<Stream>();
  private readonly cortados = new Set<string>();
  private readonly congelados = new Set<string>();
  private readonly descartados = new Map<string, number>();
  private readonly atrasos = new Set<Regra & { ms: number }>();
  private readonly seguras = new Set<Regra & Segura>();
  private readonly recusas = new Set<Regra & { status: number }>();
  private readonly agente = new Agent({ keepAlive: true });
  private readonly servidor: Server;

  private constructor(private readonly destino: URL) {
    this.servidor = createServer((req, res) => this.atender(req, res));
  }

  static async subir(destino: string): Promise<ProxyDeCaos> {
    const proxy = new ProxyDeCaos(new URL(destino));
    await new Promise<void>((ok) => proxy.servidor.listen(0, '127.0.0.1', ok));
    return proxy;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.servidor.address() as AddressInfo).port}`;
  }

  /** Fecha os `/stream` abertos da URL e derruba os novos até `soltar`. Devolve quantos fechou. */
  cortar(token: string): number {
    this.cortados.add(token);
    return this.fechar((stream) => stream.token === token);
  }

  /**
   * Os `/stream` abertos da URL param de receber bytes sem fechar, e os novos ficam sem resposta, até `soltar`.
   * Devolve quantos abertos congelou.
   */
  congelar(token: string): number {
    this.congelados.add(token);
    const abertos = [...this.streams].filter((stream) => stream.token === token);
    abertos.forEach((stream) => (stream.congelado = true));
    return abertos.length;
  }

  /** Bytes que o app mandou pelos `/stream` congelados da URL e não chegaram ao navegador. */
  engolidos(token: string): number {
    return this.descartados.get(token) ?? 0;
  }

  /** Desfaz `cortar` e `congelar`. Os congelados fecham, como a conexão meio morta que o navegador enfim larga. */
  soltar(token: string): void {
    this.cortados.delete(token);
    this.congelados.delete(token);
    this.fechar((stream) => stream.token === token && stream.congelado);
  }

  /** A resposta chega ao navegador `ms` depois de o app responder. Devolve a função que desfaz. */
  atrasar(rota: RegExp, ms: number, metodo?: string): () => void {
    const regra = { rota, ms, metodo };
    this.atrasos.add(regra);
    return () => this.atrasos.delete(regra);
  }

  /**
   * A resposta da rota fica no proxy até `soltar`: `respondida` resolve quando o app já respondeu, para o teste
   * agir entre a leitura no servidor e a chegada no navegador. `soltar(status)` troca a resposta do app por esse
   * status, como um proxy que desiste depois de o app ter feito o trabalho.
   */
  segurar(
    rota: RegExp,
    metodo?: string,
  ): { respondida: Promise<void>; soltar: (status?: number) => void } {
    let respondeu!: () => void;
    let liberar!: (status?: number) => void;
    const respondida = new Promise<void>((ok) => (respondeu = ok));
    const solta = new Promise<number | undefined>((ok) => (liberar = ok));
    const regra = { rota, metodo, respondeu, solta, liberar };
    this.seguras.add(regra);
    const soltar = (status?: number) => {
      this.seguras.delete(regra);
      liberar(status);
    };
    return { respondida, soltar };
  }

  /** O proxy responde `status` sem chegar ao app, como um proxy reverso com o app fora. Devolve a função que desfaz. */
  recusar(rota: RegExp, status = 503, metodo?: string): () => void {
    const regra = { rota, status, metodo };
    this.recusas.add(regra);
    return () => this.recusas.delete(regra);
  }

  restaurar(): void {
    this.cortados.clear();
    this.congelados.clear();
    this.descartados.clear();
    this.atrasos.clear();
    this.recusas.clear();
    this.seguras.forEach((segura) => segura.liberar());
    this.seguras.clear();
    this.fechar((stream) => stream.congelado);
  }

  async encerrar(): Promise<void> {
    this.servidor.closeAllConnections();
    await new Promise<void>((ok) => this.servidor.close(() => ok()));
    this.agente.destroy();
  }

  private atender(req: IncomingMessage, res: ServerResponse): void {
    const caminho = req.url ?? '/';
    const token = STREAM.exec(caminho)?.[1];
    const recusa = [...this.recusas].find((regra) => casa(regra, req));
    if (recusa) {
      req.resume();
      recusar(res, recusa.status);
    } else if (token && this.cortados.has(token)) {
      req.socket.destroy();
    } else if (token && this.congelados.has(token)) {
      this.acompanhar({ token, res, congelado: true });
    } else {
      this.repassar(req, res, token);
    }
  }

  private repassar(req: IncomingMessage, res: ServerResponse, token?: string): void {
    const atraso = [...this.atrasos].find((regra) => casa(regra, req));
    const segura = [...this.seguras].find((regra) => casa(regra, req));
    const up = request(
      {
        host: this.destino.hostname,
        port: this.destino.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
        agent: token ? false : this.agente,
      },
      (resposta) => {
        const entregar = () => this.entregar(resposta, res, up, token);
        if (segura) {
          segura.respondeu();
          void segura.solta.then((status) => {
            if (status) {
              resposta.resume();
              recusar(res, status);
            } else {
              entregar();
            }
          });
        } else {
          setTimeout(entregar, atraso?.ms ?? 0);
        }
      },
    );
    up.on('error', () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(502, { 'Content-Type': 'text/plain' }).end('proxy de caos: app fora');
      }
    });
    req.pipe(up);
  }

  private entregar(
    resposta: IncomingMessage,
    res: ServerResponse,
    up: ClientRequest,
    token?: string,
  ): void {
    if (res.destroyed) {
      resposta.destroy();
      return;
    }
    res.writeHead(resposta.statusCode ?? 502, resposta.statusMessage, resposta.headers);
    res.flushHeaders();
    const stream = token ? this.acompanhar({ token, res, up, congelado: false }) : undefined;
    resposta.on('data', (pedaco: Buffer) => {
      if (stream?.congelado) {
        this.descartados.set(stream.token, this.engolidos(stream.token) + pedaco.length);
      } else {
        res.write(pedaco);
      }
    });
    resposta.on('end', () => res.end());
    resposta.on('error', () => res.destroy());
  }

  private acompanhar(stream: Stream): Stream {
    this.streams.add(stream);
    stream.res.on('close', () => {
      this.streams.delete(stream);
      stream.up?.destroy();
    });
    return stream;
  }

  private fechar(alvo: (stream: Stream) => boolean): number {
    const fechados = [...this.streams].filter(alvo);
    for (const stream of fechados) {
      stream.res.socket?.destroy();
      stream.up?.destroy();
      this.streams.delete(stream);
    }
    return fechados.length;
  }
}

function recusar(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(`<html><body><h1>${status}</h1><p>proxy de caos</p></body></html>`);
}

function casa(regra: Regra, req: IncomingMessage): boolean {
  return (!regra.metodo || regra.metodo === req.method) && regra.rota.test(req.url ?? '/');
}

/**
 * `test` com o proxy de caos na frente do app, um por worker: `page` e `request` passam por ele (o `baseURL` vira o
 * dele), e o `caos` volta ao normal no fim de cada teste.
 */
export const test = base.extend<{ caos: ProxyDeCaos }, { proxyDeCaos: ProxyDeCaos }>({
  proxyDeCaos: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const proxy = await ProxyDeCaos.subir(
        workerInfo.project.use.baseURL ?? 'http://localhost:4200',
      );
      await use(proxy);
      await proxy.encerrar();
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ proxyDeCaos }, use) => use(proxyDeCaos.url),
  caos: async ({ proxyDeCaos }, use) => {
    await use(proxyDeCaos);
    proxyDeCaos.restaurar();
  },
});

export { expect } from './fixtures';
