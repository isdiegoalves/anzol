/**
 * "App local" do desenvolvedor: servidor HTTP que guarda cada requisição reenviada pelo CLI
 * (método, caminho+query, cabeçalhos crus na ordem e corpo em bytes) e responde `status`
 * depois de `atraso` ms.
 */
import http from 'node:http';
import { saidaDosClis } from './cli.mjs';
import { aoFinal } from './limpeza.mjs';

export async function iniciarCapturador({ status = 200, atraso = 0, porta = 0 } = {}) {
  const recebidas = [];
  const consumidas = new Set();
  const ouvintes = new Set();
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const cabecalhos = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) cabecalhos.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]]);
      recebidas.push({ metodo: req.method, url: req.url, cabecalhos, corpo: Buffer.concat(partes) });
      for (const f of [...ouvintes]) f();
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end('capturado');
      }, atraso);
    });
  });
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', resolve);
  });
  const portaReal = servidor.address().port;
  let aberto = true;
  const fechar = async () => {
    if (!aberto) return;
    aberto = false;
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(() => r()));
  };
  aoFinal(fechar);

  const resumo = () => recebidas.map((r) => `  ${r.metodo} ${r.url} (${r.corpo.length} bytes)`).join('\n') || '  (nenhuma)';

  return {
    porta: portaReal,
    url: `http://127.0.0.1:${portaReal}`,
    recebidas,
    fechar,
    resumo,
    /** Primeira requisição ainda não consumida que satisfaz `pred`. */
    esperar(pred, { prazo = 20_000, descricao = 'requisição' } = {}) {
      return new Promise((resolve, reject) => {
        const verificar = () => {
          const i = recebidas.findIndex((r, j) => !consumidas.has(j) && pred(r));
          if (i < 0) return;
          consumidas.add(i);
          clearTimeout(timer);
          ouvintes.delete(verificar);
          resolve(recebidas[i]);
        };
        const timer = setTimeout(() => {
          ouvintes.delete(verificar);
          reject(new Error(`o app local não recebeu ${descricao} em ${prazo} ms; recebidas:\n${resumo()}\n${saidaDosClis()}`));
        }, prazo);
        ouvintes.add(verificar);
        verificar();
      });
    },
    /** Requisição cujo caminho (sem query) termina em `sufixo`. */
    esperarCaminho(sufixo, opcoes = {}) {
      return this.esperar((r) => r.url.split('?')[0].endsWith(sufixo), { descricao: `requisição em …${sufixo}`, ...opcoes });
    },
  };
}

/** Valores crus de um cabeçalho (nome sem caixa), na ordem em que chegaram. */
export function valores(requisicao, nome) {
  const n = nome.toLowerCase();
  return requisicao.cabecalhos.filter(([k]) => k === n).map(([, v]) => v);
}

/** Campos de um corpo multipart/form-data: [{ nome, arquivo, valor }]. */
export function lerMultipart(corpo, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? '');
  if (!m) throw new Error(`Content-Type multipart sem boundary: ${contentType}`);
  const delim = `--${m[1] ?? m[2]}`;
  const texto = corpo.toString('latin1');
  if (!texto.includes(delim)) throw new Error(`corpo multipart sem o boundary ${delim}`);
  const partes = texto.split(delim).slice(1);
  const campos = [];
  for (const parte of partes) {
    if (parte.startsWith('--')) break;
    const cru = parte.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const fim = cru.indexOf('\r\n\r\n');
    const cabecalhos = fim < 0 ? cru : cru.slice(0, fim);
    const valor = fim < 0 ? '' : cru.slice(fim + 4);
    const disp = /content-disposition:[^\r\n]*/i.exec(cabecalhos)?.[0] ?? '';
    campos.push({
      nome: Buffer.from(/name="([^"]*)"/i.exec(disp)?.[1] ?? '', 'latin1').toString('utf8'),
      arquivo: /filename=/i.test(disp),
      valor: Buffer.from(valor, 'latin1').toString('utf8'),
    });
  }
  return campos;
}
