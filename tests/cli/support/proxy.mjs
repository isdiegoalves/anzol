/**
 * Proxy TCP entre o CLI e o app real. `derrubar()` fecha a porta e corta todas as conexões
 * abertas (o SSE do CLI cai); `religar()` volta a escutar na mesma porta.
 *
 * Ganchos opcionais (sem eles, é um repasse cego de bytes):
 * - `aoEvento(evento)`: chamado depois de entregar ao CLI cada evento `request.created` do SSE (o
 *   JSON do `data:`), com o SSE parado até o gancho terminar: `derrubar()` dentro dele corta a
 *   conexão logo depois daquele evento, antes do próximo byte.
 * - `antesDaResposta(linha)`: chamado com `MÉTODO alvo` de cada requisição que não é o SSE; se
 *   devolver uma função, ela é esperada quando a resposta começa a chegar do servidor e só então a
 *   resposta segue para o CLI (o servidor já montou a resposta; o CLI ainda não a viu).
 * Exceções dos ganchos ficam em `erros`.
 */
import net from 'node:net';
import { aoFinal } from './limpeza.mjs';

export async function iniciarProxy(destino, { aoEvento, antesDaResposta } = {}) {
  const alvo = new URL(destino);
  const portaAlvo = Number(alvo.port || 80);
  const conexoes = new Set();
  const erros = [];
  let servidor = null;
  let porta = 0;
  const comGanchos = Boolean(aoEvento || antesDaResposta);

  const abrir = () => new Promise((resolve, reject) => {
    servidor = net.createServer((cliente) => {
      const remoto = net.connect(portaAlvo, alvo.hostname);
      conexoes.add(cliente);
      conexoes.add(remoto);
      const fechar = () => {
        cliente.destroy();
        remoto.destroy();
        conexoes.delete(cliente);
        conexoes.delete(remoto);
      };
      cliente.on('error', fechar).on('close', fechar);
      remoto.on('error', fechar).on('close', fechar);
      if (comGanchos) repassarComGanchos(cliente, remoto);
      else {
        cliente.pipe(remoto);
        remoto.pipe(cliente);
      }
    });
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', () => {
      porta = servidor.address().port;
      resolve();
    });
  });

  const escrever = (socket, dados) => new Promise((r) => {
    if (socket.destroyed) r();
    else socket.write(dados, () => r());
  });

  function repassarComGanchos(cliente, remoto) {
    let sse = null; // leitor do SSE, quando esta conexão é o /stream
    const pendentes = []; // funções de antesDaResposta, na ordem das requisições
    cliente.on('data', (dados) => {
      const m = /^([A-Z]+) (\S+) HTTP\/1\.[01]\r\n/.exec(dados.toString('latin1', 0, Math.min(dados.length, 4096)));
      if (m) {
        if (/\/stream(\?|$)/.test(m[2])) sse = sse ?? leitorSse();
        else if (antesDaResposta) {
          try {
            const f = antesDaResposta(`${m[1]} ${m[2]}`);
            if (typeof f === 'function') pendentes.push(f);
          } catch (e) {
            erros.push(e);
          }
        }
      }
      remoto.write(dados);
    });
    remoto.on('data', async (dados) => {
      remoto.pause();
      try {
        if (sse && aoEvento) {
          for (const { bytes, eventos } of sse.alimentar(dados)) {
            await escrever(cliente, bytes);
            for (const ev of eventos) {
              if (cliente.destroyed) return;
              await aoEvento(ev);
            }
          }
          return;
        }
        const f = pendentes.shift();
        if (f) await f();
        await escrever(cliente, dados);
      } catch (e) {
        erros.push(e);
        await escrever(cliente, dados);
      } finally {
        if (!remoto.destroyed) remoto.resume();
      }
    });
  }

  const derrubar = async () => {
    if (!servidor) return;
    const s = servidor;
    servidor = null;
    const fechado = new Promise((r) => s.close(() => r()));
    for (const c of conexoes) c.destroy();
    conexoes.clear();
    await fechado;
  };

  await abrir();
  aoFinal(derrubar);

  return {
    get url() {
      return `http://127.0.0.1:${porta}`;
    },
    erros,
    derrubar,
    religar: abrir,
  };
}

/**
 * Lê a resposta do SSE em bytes crus e a devolve em pedaços que terminam em fronteira de chunk
 * (Transfer-Encoding: chunked) ou, sem chunked, do jeito que chegaram; cada pedaço traz os eventos
 * `request.created` que ele completou.
 */
function leitorSse() {
  let cru = Buffer.alloc(0);
  let cabecalhoLido = false;
  let chunked = false;
  let texto = '';
  const decodificador = new TextDecoder();

  const eventosDe = (carga) => {
    texto += decodificador.decode(carga, { stream: true }).replace(/\r\n?/g, '\n');
    const eventos = [];
    let i;
    while ((i = texto.indexOf('\n\n')) >= 0) {
      const bloco = texto.slice(0, i);
      texto = texto.slice(i + 2);
      let nome = '';
      const dados = [];
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith(':')) continue;
        const p = linha.indexOf(':');
        const campo = p < 0 ? linha : linha.slice(0, p);
        let valor = p < 0 ? '' : linha.slice(p + 1);
        if (valor.startsWith(' ')) valor = valor.slice(1);
        if (campo === 'event') nome = valor;
        else if (campo === 'data') dados.push(valor);
      }
      if (nome === 'request.created' && dados.length > 0) eventos.push(JSON.parse(dados.join('\n')));
    }
    return eventos;
  };

  return {
    alimentar(dados) {
      cru = Buffer.concat([cru, dados]);
      const pedacos = [];
      if (!cabecalhoLido) {
        const fim = cru.indexOf('\r\n\r\n');
        if (fim < 0) return pedacos;
        const cabeca = cru.subarray(0, fim + 4);
        chunked = /\r\ntransfer-encoding:\s*chunked/i.test(cabeca.toString('latin1'));
        pedacos.push({ bytes: cabeca, eventos: [] });
        cru = cru.subarray(fim + 4);
        cabecalhoLido = true;
      }
      if (!chunked) {
        if (cru.length > 0) pedacos.push({ bytes: cru, eventos: eventosDe(cru) });
        cru = Buffer.alloc(0);
        return pedacos;
      }
      for (;;) {
        const fimLinha = cru.indexOf('\r\n');
        if (fimLinha < 0) break;
        const tamanho = parseInt(cru.subarray(0, fimLinha).toString('latin1').split(';')[0], 16);
        const total = fimLinha + 2 + tamanho + 2;
        if (cru.length < total) break;
        pedacos.push({ bytes: cru.subarray(0, total), eventos: eventosDe(cru.subarray(fimLinha + 2, fimLinha + 2 + tamanho)) });
        cru = cru.subarray(total);
      }
      return pedacos;
    },
  };
}
