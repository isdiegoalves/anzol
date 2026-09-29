/**
 * O CLI como processo filho: stdout e stderr lidos linha a linha, espera por linha que casa com
 * uma regex (com prazo), espera pela saída e encerramento garantido ao fim do teste.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { CLI, SERVIDOR, UUID, literal as esc } from './ambiente.mjs';
import { aoFinal } from './limpeza.mjs';
import { apagarToken, verificarServidor } from './servidor.mjs';

const UUIDS_NA_URL = new RegExp(`/(${UUID.source})`, 'g');

/** Processos do teste em curso, para anexar a saída deles às falhas de outros ajudantes. */
const ativos = new Set();

export function saidaDosClis() {
  return [...ativos].map((p) => p.descricao()).join('\n') || '(nenhum CLI iniciado)';
}

export function garantirCli() {
  let ok = false;
  try {
    fs.accessSync(CLI, fs.constants.X_OK);
    ok = fs.statSync(CLI).isFile();
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(`CLI não encontrado em ${CLI}; rode ./gradlew installDist (cd cli && ./gradlew installDist) ou aponte WEBHOOK_CLI para o script`);
  }
}

class ProcessoCli {
  constructor(args, { criaToken }) {
    this.args = args;
    this.linhas = []; // { fluxo: 'stdout' | 'stderr', texto }
    this.consumidas = new Set();
    this.saida = null; // { codigo, sinal }
    this.ouvintes = new Set();
    this.filho = spawn(CLI, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    for (const fluxo of ['stdout', 'stderr']) {
      let resto = '';
      this.filho[fluxo].setEncoding('utf8');
      this.filho[fluxo].on('data', (parte) => {
        resto += parte;
        let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          this.linhas.push({ fluxo, texto: resto.slice(0, i).replace(/\r$/, '') });
          resto = resto.slice(i + 1);
        }
        this.avisar();
      });
      this.filho[fluxo].on('end', () => {
        if (resto) this.linhas.push({ fluxo, texto: resto.replace(/\r$/, '') });
        resto = '';
        this.avisar();
      });
    }
    this.encerrado = new Promise((resolve) => {
      this.filho.on('error', (e) => {
        this.saida = { codigo: null, sinal: null, erro: e };
        this.avisar();
        resolve(this.saida);
      });
      this.filho.on('close', (codigo, sinal) => {
        this.saida = { codigo, sinal };
        this.avisar();
        resolve(this.saida);
      });
    });
    ativos.add(this);
    aoFinal(async () => {
      ativos.delete(this);
      await this.encerrar();
      // Sem --token o CLI (listen, test) cria a URL: todo uuid que ele imprimiu atrás de uma barra é apagado.
      if (criaToken) {
        const vistos = new Set();
        for (const { texto } of this.linhas) for (const m of texto.matchAll(UUIDS_NA_URL)) vistos.add(m[1]);
        for (const uuid of vistos) await apagarToken(uuid);
      }
    });
  }

  avisar() {
    for (const f of [...this.ouvintes]) f();
  }

  /** Saída até aqui, para mensagens de falha. */
  descricao() {
    const ultimas = this.linhas.slice(-80).map(({ fluxo, texto }) => `  [${fluxo}] ${texto}`);
    const estado = this.saida ? `saiu (código ${this.saida.codigo}, sinal ${this.saida.sinal}${this.saida.erro ? `, erro ${this.saida.erro.message}` : ''})` : 'rodando';
    return `CLI ${estado}: webhook ${this.args.join(' ')}\n${ultimas.join('\n') || '  (nenhuma linha)'}`;
  }

  /**
   * Primeira linha ainda não consumida que casa com `regex` (no fluxo pedido, ou em qualquer um).
   * Devolve o resultado do `exec` e marca a linha como consumida.
   */
  esperarLinha(regex, { prazo = 20_000, fluxo } = {}) {
    return new Promise((resolve, reject) => {
      const procurar = () => {
        for (let i = 0; i < this.linhas.length; i++) {
          if (this.consumidas.has(i)) continue;
          const l = this.linhas[i];
          if (fluxo && l.fluxo !== fluxo) continue;
          const m = regex.exec(l.texto);
          if (m) {
            this.consumidas.add(i);
            return m;
          }
        }
        return null;
      };
      const terminar = (erro, valor) => {
        clearTimeout(timer);
        this.ouvintes.delete(verificar);
        if (erro) reject(erro);
        else resolve(valor);
      };
      const verificar = () => {
        const m = procurar();
        if (m) terminar(null, m);
        else if (this.saida) terminar(new Error(`o CLI terminou sem imprimir linha que casa com ${regex}${fluxo ? ` no ${fluxo}` : ''}\n${this.descricao()}`));
      };
      const timer = setTimeout(() => {
        terminar(new Error(`nenhuma linha casou com ${regex}${fluxo ? ` no ${fluxo}` : ''} em ${prazo} ms\n${this.descricao()}`));
      }, prazo);
      this.ouvintes.add(verificar);
      verificar();
    });
  }

  /** Linhas ainda não consumidas que casam com a regex (sem esperar). */
  linhasQueCasam(regex) {
    return this.linhas.filter((l, i) => !this.consumidas.has(i) && regex.test(l.texto)).map((l) => l.texto);
  }

  async esperarSaida(prazo = 20_000) {
    let timer;
    const limite = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`o CLI não terminou em ${prazo} ms\n${this.descricao()}`)), prazo);
    });
    try {
      return await Promise.race([this.encerrado, limite]);
    } finally {
      clearTimeout(timer);
    }
  }

  get rodando() {
    return this.saida === null;
  }

  interromper() {
    this.filho.kill('SIGINT');
  }

  /** SIGINT, e SIGKILL se não sair em 5 s. */
  async encerrar() {
    if (this.saida) return this.saida;
    this.filho.kill('SIGINT');
    const t = setTimeout(() => this.filho.kill('SIGKILL'), 5_000);
    try {
      return await this.encerrado;
    } finally {
      clearTimeout(t);
    }
  }
}

/** Inicia `webhook <args...>`. Falha com mensagem clara se o CLI ou o servidor não estão lá. */
export async function iniciarCli(args) {
  garantirCli();
  await verificarServidor();
  const criaToken = ['listen', 'test'].includes(args[0]) && !args.includes('--token');
  return new ProcessoCli(args, { criaToken });
}

// ---- formato das linhas (§1 do plano) ----

/** `Listening on <server>/<token> (forwarding to <url>)`; grupo 1 = token. */
export function linhaListening(servidor, forward, token) {
  const t = token ? `(${esc(token)})` : `(${UUID.source})`;
  return new RegExp(`^Listening on ${esc(servidor)}/${t} \\(forwarding to ${esc(forward)}\\)$`);
}

/**
 * `HH:mm:ss <MÉTODO> <caminho?query> -> <status> (<n> ms)[ sufixo]`. O token do caminho é
 * qualquer texto sem espaço que termine em `caminho` (o caminho após o token + query gravada).
 * Grupos: 1..3 = hora, 4 = caminho impresso, 5 = ms.
 */
export function linhaMensagem(metodo, caminho, status, sufixo = '') {
  return new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2}) ${esc(metodo)} (\\S*${esc(caminho)}) -> ${status} \\((\\d+) ms\\)${esc(sufixo)}$`);
}

/** `HH:mm:ss <MÉTODO> <caminho?query> -> error: <motivo>`; grupo 5 = motivo. */
export function linhaErro(metodo, caminho) {
  return new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2}) ${esc(metodo)} (\\S*${esc(caminho)}) -> error: (.+)$`);
}

export const AVISO_MULTIPART = ' [files were not forwarded: not stored by the server]';

/** `Reconnected; forwarding <n> missed request(s)`; grupo 1 = n. */
export const LINHA_RECONEXAO = /^Reconnected; forwarding (\d+) missed request\(s\)$/;

export { SERVIDOR };
