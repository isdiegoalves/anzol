import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { BASE_URL, expect } from './contrato.js';

// O documento OpenAPI 3.1 do Anzol (`GET /openapi.json`) usado como juiz das respostas: cada resposta real é validada
// contra o schema que o documento declara para o método, o caminho e o status. O dialeto do OAS 3.1 é o JSON Schema
// 2020-12, então o próprio documento entra no Ajv e os `$ref` a `#/components/...` resolvem nele.

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

type Documento = { paths: Record<string, Record<string, any>>; components: Record<string, any> };

let carregado: Promise<{ doc: Documento; ajv: Ajv2020 }> | undefined;

function carregar(): Promise<{ doc: Documento; ajv: Ajv2020 }> {
  carregado ??= (async () => {
    const res = await fetch(new URL('/openapi.json', BASE_URL));
    expect(res.status, 'GET /openapi.json').toBe(200);
    const doc = (await res.json()) as Documento;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(doc as object, 'oas');
    return { doc, ajv };
  })();
  return carregado;
}

/** `~` e `/` escapados como num JSON Pointer. */
function ponteiro(parte: string): string {
  return parte.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Valida [corpo] contra o schema JSON que o documento declara para `método caminho → status` ([caminho] é o template,
 * ex. `/token/{tokenId}`). Falha o teste se o documento não declara a resposta ou se o corpo não segue o schema.
 */
export async function expectConformeAoDocumento(metodo: string, caminho: string, status: number, corpo: unknown): Promise<void> {
  const { doc, ajv } = await carregar();
  const operacao = doc.paths[caminho]?.[metodo.toLowerCase()];
  expect(operacao, `${metodo} ${caminho} no documento`).toBeDefined();
  let base = `/paths/${ponteiro(caminho)}/${metodo.toLowerCase()}/responses/${status}`;
  let resposta = operacao.responses?.[String(status)];
  expect(resposta, `${metodo} ${caminho} → ${status} no documento`).toBeDefined();
  if (resposta.$ref) {
    base = (resposta.$ref as string).slice(1);
    resposta = base.split('/').slice(1).reduce((no: any, p: string) => no[p.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
  }
  const tipo = Object.keys(resposta.content ?? {}).find((t) => t.includes('json'));
  expect(tipo, `${metodo} ${caminho} → ${status} sem conteúdo JSON no documento`).toBeDefined();
  const validar = ajv.compile({ $ref: `oas#${base}/content/${ponteiro(tipo!)}/schema` });
  const ok = validar(corpo);
  expect(ok, `${metodo} ${caminho} → ${status}: ${JSON.stringify(validar.errors, null, 1)?.slice(0, 1500)}`).toBe(true);
}
