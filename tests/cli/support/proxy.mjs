/**
 * Proxy TCP entre o CLI e o app real. `derrubar()` fecha a porta e corta todas as conexões
 * abertas (o SSE do CLI cai); `religar()` volta a escutar na mesma porta.
 */
import net from 'node:net';
import { aoFinal } from './limpeza.mjs';

export async function iniciarProxy(destino) {
  const alvo = new URL(destino);
  const portaAlvo = Number(alvo.port || 80);
  const conexoes = new Set();
  let servidor = null;
  let porta = 0;

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
      cliente.pipe(remoto);
      remoto.pipe(cliente);
    });
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', () => {
      porta = servidor.address().port;
      resolve();
    });
  });

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
    derrubar,
    religar: abrir,
  };
}
