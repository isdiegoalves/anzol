import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BASE_URL, expect, test as base } from './contrato.js';

// Servidor MCP do Anzol (§1 do plano "ia-local"): Streamable HTTP em `{BASE_URL}/mcp`, falado aqui
// pelo SDK oficial (`@modelcontextprotocol/sdk`), como um agente de IA falaria.

/** As 14 ferramentas da §1. */
export const FERRAMENTAS = [
  'create_url', 'get_url', 'update_url', 'delete_url', 'list_requests', 'search_requests', 'get_request',
  'wait_for_request', 'get_rules', 'set_rules', 'test_rule', 'replay_request', 'send_request', 'get_outbound',
].sort();

/**
 * Nomes aceitos para o argumento com o UUID da URL ("todas por UUID de URL como a API"). A §1 não fixa o
 * nome; o contrato lê o `inputSchema` da ferramenta e usa o primeiro destes que ela declara.
 */
export const NOMES_DO_ARGUMENTO_DA_URL = ['token_id', 'tokenId', 'uuid', 'url_id', 'urlId', 'token', 'id'];

export type Ferramenta = Awaited<ReturnType<Client['listTools']>>['tools'][number];
export type ResultadoDeFerramenta = Awaited<ReturnType<Client['callTool']>>;

export async function conectar(): Promise<Client> {
  const cliente = new Client({ name: 'contrato-anzol', version: '1.0.0' });
  try {
    await cliente.connect(new StreamableHTTPClientTransport(new URL('/mcp', BASE_URL)));
  } catch (erro) {
    const status = (erro as { code?: number }).code;
    throw new Error(`MCP em ${BASE_URL}/mcp não conectou (HTTP ${status ?? '?'}): ${String(erro)}`);
  }
  return cliente;
}

export function argumentoDaUrl(ferramenta: Ferramenta): string | undefined {
  const propriedades = Object.keys(ferramenta.inputSchema.properties ?? {});
  return NOMES_DO_ARGUMENTO_DA_URL.find((n) => propriedades.includes(n));
}

/** Texto do resultado: as partes de texto juntadas (o JSON da resposta da API, na leitura do contrato). */
export function textoDo(resultado: ResultadoDeFerramenta): string {
  const partes = (resultado.content as Array<{ type: string; text?: string }>) ?? [];
  return partes.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n');
}

/** O JSON do resultado: `structuredContent` se houver; senão o texto, que deve ser JSON. */
export function jsonDo<T>(resultado: ResultadoDeFerramenta): T {
  if (resultado.structuredContent !== undefined) return resultado.structuredContent as T;
  const texto = textoDo(resultado);
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error(`o resultado da ferramenta não é JSON: ${texto.slice(0, 300)}`);
  }
}

export interface Mcp {
  cliente: Client;
  ferramentas: Map<string, Ferramenta>;
  /** Chama `nome` pondo o UUID da URL no argumento que a ferramenta declara. */
  chamar(nome: string, argumentos?: Record<string, unknown>, tokenId?: string): Promise<ResultadoDeFerramenta>;
  /** Como `chamar`, exigindo sucesso (`isError` falso); devolve o JSON do resultado. */
  chamarOk<T>(nome: string, argumentos?: Record<string, unknown>, tokenId?: string): Promise<T>;
}

/** `test` do contrato (com `tokens`) mais `mcp`, um cliente conectado que fecha ao fim do teste. */
export const test = base.extend<{ mcp: Mcp }>({
  // eslint-disable-next-line no-empty-pattern
  mcp: async ({}, use) => {
    const cliente = await conectar();
    const { tools } = await cliente.listTools();
    const ferramentas = new Map(tools.map((t) => [t.name, t]));
    const chamar: Mcp['chamar'] = async (nome, argumentos = {}, tokenId) => {
      const ferramenta = ferramentas.get(nome);
      expect(ferramenta, `ferramenta ${nome} ausente de ${[...ferramentas.keys()].join(', ')}`).toBeDefined();
      const args = { ...argumentos };
      if (tokenId !== undefined) {
        const nomeDoArgumento = argumentoDaUrl(ferramenta!);
        expect(nomeDoArgumento, `${nome} sem argumento de UUID da URL: ${JSON.stringify(ferramenta!.inputSchema)}`).toBeDefined();
        args[nomeDoArgumento!] = tokenId;
      }
      return cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: 60_000 });
    };
    await use({
      cliente,
      ferramentas,
      chamar,
      async chamarOk(nome, argumentos, tokenId) {
        const resultado = await chamar(nome, argumentos, tokenId);
        expect(resultado.isError ?? false, `${nome} deu erro: ${textoDo(resultado).slice(0, 500)}`).toBe(false);
        return jsonDo(resultado);
      },
    });
    await cliente.close();
  },
});
