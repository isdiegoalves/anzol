import { enviarEGuardar, expect, test } from '../../support/contrato.js';
import { MOTIVO_DIVERGENTE, assinaturaGithub, expectInvalida, expectValida, motivoAusente } from '../../support/assinatura.js';
import { erros422, expectFalhas, lerRegras, putRegras, salvarRegras, type Regra } from '../../support/regras.js';

// Condição de regra `match.signature` (CA-6, plano "assinatura-hmac" §1): `valid`, `invalid` ou
// `absent` sobre o resultado da verificação da mensagem. Os três estados são disjuntos: `absent` é o
// header de assinatura ausente, `invalid` é header presente que não confere (malformado, divergente,
// timestamp vencido). Near miss: `signature: expected valid, got invalid (signature mismatch)`,
// casada pelo conteúdo com regex tolerante como nas outras frases de regra.

const SEGREDO = 'segredo-regras-7Q2w';
const CORPO = '{"acao":"opened"}';
const CABECALHO = 'X-Hub-Signature-256';

function envio(corpo: string, assinatura?: string) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(assinatura === undefined ? {} : { [CABECALHO]: assinatura }) },
    data: Buffer.from(corpo),
  } as const;
}

const valida = () => envio(CORPO, assinaturaGithub(SEGREDO, CORPO));
const divergente = () => envio('{"acao":"closed"}', assinaturaGithub(SEGREDO, CORPO));
const malformada = () => envio(CORPO, 'sem-prefixo');
const ausente = () => envio(CORPO);

const REGRAS: Regra[] = [
  // `invalid` com a melhor prioridade: se casasse o header ausente, o 428 nunca sairia.
  { name: 'rejeita inválida', priority: 1, match: { signature: 'invalid' }, response: { status: 401, body: 'invalid signature' } },
  { name: 'aceita válida', priority: 2, match: { signature: 'valid' }, response: { status: 202, body: 'ok' } },
  { name: 'sem assinatura', priority: 3, match: { signature: 'absent' }, response: { status: 428, body: 'assine' } },
];

test.describe('regra com match.signature (CA-6)', () => {
  test('401 para inválida (divergente e malformada), 202 para válida, 428 para ausente', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const [inv, val, aus] = await salvarRegras(request, token.uuid, REGRAS);

    for (const opcoes of [divergente(), malformada()]) {
      const { res, msg } = await enviarEGuardar(request, token.uuid, '/hook', opcoes);
      expect(res.status()).toBe(401);
      expect(await res.text()).toBe('invalid signature');
      expect(msg.rule).toEqual({ id: inv.id, name: 'rejeita inválida' });
      expect(msg.signature?.valid).toBe(false);
    }

    const ok = await enviarEGuardar(request, token.uuid, '/hook', valida());
    expect(ok.res.status()).toBe(202);
    expect(ok.msg.rule).toEqual({ id: val.id, name: 'aceita válida' });
    expectValida(ok.msg.signature, 'github');

    const sem = await enviarEGuardar(request, token.uuid, '/hook', ausente());
    expect(sem.res.status()).toBe(428);
    expect(sem.msg.rule).toEqual({ id: aus.id, name: 'sem assinatura' });
    expectInvalida(sem.msg.signature, 'github', motivoAusente(CABECALHO));
  });

  test('só "401 quando inválida": válida e ausente seguem para a resposta padrão do token', async ({ request, tokens }) => {
    const token = await tokens.criar({ default_status: 200, default_content: 'padrao', signature: { provider: 'github', secret: SEGREDO } });
    await salvarRegras(request, token.uuid, [REGRAS[0]]);
    expect((await enviarEGuardar(request, token.uuid, '', divergente())).res.status()).toBe(401);
    for (const opcoes of [valida(), ausente()]) {
      const { res, msg } = await enviarEGuardar(request, token.uuid, '', opcoes);
      expect(res.status()).toBe(200);
      expect(await res.text()).toBe('padrao');
      expect(msg).toHaveProperty('rule', null);
    }
  });

  test('signature combina em E com as outras condições', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    await salvarRegras(request, token.uuid, [
      { name: 'pedido assinado', match: { method: ['POST'], path: { equals: '/pedidos' }, signature: 'valid' }, response: { status: 201 } },
    ]);
    expect((await enviarEGuardar(request, token.uuid, '/pedidos', valida())).res.status()).toBe(201);
    expect((await enviarEGuardar(request, token.uuid, '/outro', valida())).res.status()).toBe(200);
    expect((await enviarEGuardar(request, token.uuid, '/pedidos', divergente())).res.status()).toBe(200);
  });

  test('near miss: "signature: expected valid, got invalid (signature mismatch)", sozinha quando só a assinatura falha', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const [salva] = await salvarRegras(request, token.uuid, [
      { name: 'exige válida', match: { method: ['POST'], signature: 'valid' }, response: { status: 202 } },
    ]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '', divergente());
    expect(res.status()).toBe(200);
    expect(msg).toHaveProperty('rule', null);
    expect(msg.near_miss).toMatchObject({ id: salva.id, name: 'exige válida' });
    expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss)).toHaveLength(1);
    expectFalhas(msg.near_miss!.failed, [/^signature\b.*expected\s+valid\b.*got\s+invalid\b.*signature\s+mismatch/i]);
    expectInvalida(msg.signature, 'github', MOTIVO_DIVERGENTE);
  });

  test('near miss com header ausente cita o estado recebido e o motivo', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    await salvarRegras(request, token.uuid, [{ name: 'exige válida', match: { signature: 'valid' }, response: { status: 202 } }]);
    const { msg } = await enviarEGuardar(request, token.uuid, '', ausente());
    expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss)).toHaveLength(1);
    expectFalhas(msg.near_miss!.failed, [/^signature\b.*expected\s+valid\b.*got\s+absent\b.*x-hub-signature-256/i]);
  });

  test('match.signature volta no GET das regras; valor fora de valid|invalid|absent → 422 em 0.match.signature', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    await salvarRegras(request, token.uuid, REGRAS);
    const lidas = await lerRegras(request, token.uuid);
    expect(lidas.map((r) => r.match.signature)).toEqual(['invalid', 'valid', 'absent']);

    const erros = await erros422(await putRegras(request, token.uuid, [{ name: 'x', match: { signature: 'talvez' } }]));
    expect(Object.keys(erros)).toContain('0.match.signature');
    // O 422 não mexe nas regras salvas.
    expect((await lerRegras(request, token.uuid)).map((r) => r.name)).toEqual(REGRAS.map((r) => r.name));
  });
});
