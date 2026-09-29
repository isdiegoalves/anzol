/**
 * App local para o caos: servidor HTTP que registra cada requisição como chegou, inclusive a cortada no meio do
 * corpo (`completa: false`), com a hora dos cabeçalhos (`inicio`, ms) e de cada pedaço do corpo (`pedacos`, ms), e
 * responde às completas o que `responder(requisicao, indice)` devolver (`{ status, cabecalhos, atraso }`, cada
 * campo opcional; padrão 200 na hora).
 */
import http from 'node:http';
import { saidaDosClis } from './cli.mjs';
import { aoFinal } from './limpeza.mjs';

export async function iniciarReceptor({ responder } = {}) {
  const recebidas = [];
  const ouvintes = new Set();
  const servidor = http.createServer((req, res) => {
    const inicio = Date.now();
    const cabecalhos = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) cabecalhos.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]]);
    const partes = [];
    const pedacos = [];
    let registrada = null;
    const registrar = (completa) => {
      if (registrada) return registrada;
      const requisicao = {
        metodo: req.method,
        url: req.url,
        cabecalhos,
        corpo: Buffer.concat(partes),
        declarado: Number(req.headers['content-length'] ?? 0),
        completa,
        inicio,
        pedacos,
      };
      registrada = { requisicao, indice: recebidas.push(requisicao) - 1 };
      for (const f of [...ouvintes]) f();
      return registrada;
    };
    req.on('data', (parte) => {
      partes.push(parte);
      pedacos.push(Date.now());
    });
    req.on('error', () => {});
    req.on('close', () => {
      if (!req.complete) registrar(false);
    });
    req.on('end', () => {
      const { requisicao, indice } = registrar(true);
      const resposta = { status: 200, atraso: 0, cabecalhos: {}, ...responder?.(requisicao, indice) };
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(resposta.status, { 'Content-Type': 'text/plain', ...resposta.cabecalhos });
        res.end('ok');
      }, resposta.atraso);
    });
  });
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const porta = servidor.address().port;
  let aberto = true;
  const fechar = async () => {
    if (!aberto) return;
    aberto = false;
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(() => r()));
  };
  aoFinal(fechar);

  const resumo = () =>
    recebidas.map((r) => `  ${r.metodo} ${r.url} (${r.corpo.length}/${r.declarado} bytes${r.completa ? '' : ', cortada'})`).join('\n') ||
    '  (nenhuma)';

  return {
    url: `http://127.0.0.1:${porta}`,
    recebidas,
    resumo,
    /** Espera até ter chegado `quantas` requisições (completas ou cortadas) e devolve todas. */
    esperarQuantas(quantas, { prazo = 20_000 } = {}) {
      return new Promise((resolve, reject) => {
        const verificar = () => {
          if (recebidas.length < quantas) return;
          clearTimeout(timer);
          ouvintes.delete(verificar);
          resolve([...recebidas]);
        };
        const timer = setTimeout(() => {
          ouvintes.delete(verificar);
          reject(new Error(`o app local recebeu ${recebidas.length} de ${quantas} em ${prazo} ms:\n${resumo()}\n${saidaDosClis()}`));
        }, prazo);
        ouvintes.add(verificar);
        verificar();
      });
    },
  };
}
