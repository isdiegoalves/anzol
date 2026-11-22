import type { Mensagem, Token } from './contrato.js';
import { comSegredo, expect, http, type Resposta, type Urls } from './privacidade.js';

// Laboratório de defesa (`POST /defense-lab`): uma URL marcada recebe tráfego sintético com gabarito em duas ondas,
// um defensor julga as requisições e grava regras, e o servidor devolve o relatório. O gabarito só sai no relatório.

export interface Cenario {
  code: string;
  family: string;
  layer: string;
  title: string;
  reference: string;
  containable: boolean;
}

export interface Laboratorio {
  token: Token & { defense_lab?: { expires_at: string } };
  read_secret: string;
  briefing: string;
  scenarios: Cenario[];
}

export interface Relatorio {
  round_id: string;
  catalog_version: string;
  seed: number;
  containment_seconds: number;
  scenarios: {
    code: string;
    floor: { expected: string; actual: string | null; ok: boolean };
    detection: { request_id: string; verdict: string; detected: boolean };
    containment: { status: number; blocked: boolean; containable: boolean };
    injection?: { obeyed: boolean; signal: string | null };
  }[];
  detection: { attacks: number; detected: number; legitimate: number; false_positives: number };
  containment: { attacks: number; blocked: number; legitimate: number; passed: number };
  false_positives: string[];
  coverage: { requests: number; judged: number };
  actions: { rule_writes: number; config_changes: number; outbound: number };
  loosening: { signature: string; schema: string; loosened: boolean };
  injection: { scenarios: number; obeyed: number };
  by_family: { family: string; attacks: number; detected: number; containable: number; blocked: number }[];
  by_layer: { layer: string; attacks: number; detected: number; containable: number; blocked: number }[];
}

export const CODIGOS = ['I1', 'I2', 'I3', 'I4', 'I5', 'C1', 'C2', 'C3', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/** Legítimas e ataques de uma onda. */
export const LEGITIMAS = 18;
export const ONDA = LEGITIMAS + CODIGOS.length;

/** O que o piso sabe fazer sozinho: barrar o que a assinatura reprova. */
export const REGRAS_DO_PISO = [
  { name: 'signature: invalid → 401', match: { signature: 'invalid' }, response: { status: 401 } },
  { name: 'signature: absent → 401', match: { signature: 'absent' }, response: { status: 401 } },
];

export async function criarLaboratorio(urls: Urls): Promise<Laboratorio> {
  const res = await http('POST', '/defense-lab', { corpo: {} });
  expect(res.status, res.texto.slice(0, 300)).toBe(201);
  const lab = res.json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);
  return lab;
}

/** Uma rota da rodada, com o segredo de leitura da URL de laboratório. */
export function rodada(lab: Laboratorio, metodo: string, sufixo = '', corpo: unknown = {}): Promise<Resposta> {
  const opcoes = metodo === 'GET' ? {} : { corpo };
  return http(metodo, `/token/${lab.token.uuid}/defense-lab/rounds${sufixo}`, { headers: comSegredo(lab.read_secret), ...opcoes });
}

export async function abrirRodada(lab: Laboratorio, corpo: unknown = {}): Promise<string> {
  const res = await rodada(lab, 'POST', '', corpo);
  expect(res.status, res.texto.slice(0, 300)).toBe(201);
  return res.json<{ round_id: string }>().round_id;
}

export async function fechar(lab: Laboratorio, id: string): Promise<Relatorio> {
  const res = await rodada(lab, 'POST', `/${id}/finish`);
  expect(res.status, res.texto.slice(0, 300)).toBe(200);
  return res.json<Relatorio>();
}

export async function mensagens(lab: Laboratorio): Promise<Mensagem[]> {
  const res = await http('GET', `/token/${lab.token.uuid}/requests?per_page=100`, { headers: comSegredo(lab.read_secret) });
  expect(res.status, res.texto.slice(0, 300)).toBe(200);
  return res.json<{ data: Mensagem[] }>().data;
}

export function veredictos(alvo: Mensagem[], verdict = 'attack'): { verdicts: object[] } {
  return { verdicts: alvo.map((m) => ({ request_id: m.uuid, verdict })) };
}

export function gravarRegras(lab: Laboratorio, regras: unknown): Promise<Resposta> {
  return http('PUT', `/token/${lab.token.uuid}/rules`, { headers: comSegredo(lab.read_secret), corpo: regras });
}
