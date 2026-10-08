import { CHAVES_TOKEN, DATA_HORA, type Token } from '../../support/contrato.js';
import { parEc } from '../../support/e2ee.js';
import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// URL de laboratório E2EE (`POST /e2ee-lab`): nasce pronta, com segredo de leitura e de HMAC (mostrados só na criação),
// as chaves de cifra enc-v1 e enc-v2, o remetente de teste lab-sig-1 (a privada fica no servidor), a política com o
// envelope neutro, HMAC genérico (cabeçalho escolhido na criação, padrão X-Signature) e as regras do laboratório
// (HMAC 401, kid desconhecido 500, outra falha 400, padrão 202). Vive 24 h sem renovar; a marca `lab` não muda pelo
// PUT. O teto de 20 URLs de laboratório ativas fica com os testes do backend (o contrato roda em paralelo).

interface Laboratorio {
  token: Token;
  read_secret: string;
  hmac_secret: string;
  hmac_header: string;
  jwks: { keys: Record<string, unknown>[] };
}

test('POST /e2ee-lab sem campos: URL pronta, segredos uma vez, nenhuma privada na resposta', async ({ urls }) => {
  const res = await http('POST', '/e2ee-lab', { corpo: {} });
  expect(res.status, res.texto).toBe(201);
  const lab = res.json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);

  expect(Object.keys(lab.token).sort()).toEqual(CHAVES_TOKEN);
  expect(lab.token).toMatchObject({ protected: true, default_status: 202 });
  expect(lab.token.lab).toMatchObject({ signer_kid: 'lab-sig-1' });
  expect(lab.token.lab!.expires_at).toMatch(DATA_HORA);
  expect(lab.token.e2ee_keys.map((k) => k.kid)).toEqual(['enc-v1', 'enc-v2']);
  expect((lab.token.e2ee as any).trusted_signers.map((k: any) => k.kid)).toEqual(['lab-sig-1']);
  expect(lab.token.signature).toMatchObject({ provider: 'generic', header: 'X-Signature', algorithm: 'sha256', encoding: 'hex' });
  expect(lab.hmac_header).toBe('X-Signature');
  expect(lab.jwks.keys.map((k) => k.kid)).toEqual(['enc-v1', 'enc-v2']);
  expect(res.texto).not.toContain('"d":');

  const regras = (await http('GET', `/token/${lab.token.uuid}/rules`, { headers: comSegredo(lab.read_secret) })).json<any[]>();
  expect(regras.map((r) => [r.match.signature ?? r.match.decryption, r.response.status])).toEqual([
    ['invalid', 401], ['absent', 401], ['unknown_kid', 500], ['invalid', 400],
  ]);
});

test('cabeçalho do HMAC e signatário externo escolhidos na criação; o externo vem antes do de teste', async ({ urls }) => {
  const externo = await parEc('cliente-sig-1');
  const res = await http('POST', '/e2ee-lab', { corpo: { hmac_header: 'X-Canal-Assinatura', trusted_signers: [externo.publica] } });
  expect(res.status, res.texto).toBe(201);
  const lab = res.json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);
  expect(lab.hmac_header).toBe('X-Canal-Assinatura');
  expect((lab.token.e2ee as any).trusted_signers.map((k: any) => k.kid)).toEqual(['cliente-sig-1', 'lab-sig-1']);
});

test('campos inválidos → 422 com a chave de cada um', async () => {
  const comD = await parEc('com-d');
  const res = await http('POST', '/e2ee-lab', {
    corpo: { path: "$['payload']", hmac_header: 'X Ruim', trusted_signers: [comD.privada] },
  });
  expect(res.status, res.texto).toBe(422);
  expect(Object.keys(res.json<object>())).toEqual(expect.arrayContaining(['path', 'hmac_header', 'trusted_signers.0']));
});

test('a marca lab não muda pelo PUT; URL comum tem lab null', async ({ urls }) => {
  const lab = (await http('POST', '/e2ee-lab', { corpo: {} })).json<Laboratorio>();
  urls.lembrar(lab.token.uuid, lab.read_secret);
  const res = await http('PUT', `/token/${lab.token.uuid}`, {
    headers: comSegredo(lab.read_secret), corpo: { lab: null, e2ee: lab.token.e2ee },
  });
  expect(res.json<Token>().lab).toMatchObject({ signer_kid: 'lab-sig-1' });
  expect((await urls.abrir()).lab).toBeNull();
});
