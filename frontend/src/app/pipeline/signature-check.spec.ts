import { clearTranslations, loadTranslations } from '@angular/localize';
import { token, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { SignatureResult } from '../requests/webhook-request';
import { SignatureConfig } from '../token/token';
import { signatureAdvice, signatureCheck } from './signature-check';

const github = (reason: string | null): SignatureResult => ({
  provider: 'github',
  valid: reason === null,
  reason,
});
const generica = (reason: string): SignatureResult => ({
  provider: 'generic',
  valid: false,
  reason,
});
const urlCom = (signature: SignatureConfig) => token({ signature });
const urlGenerica = urlCom({ provider: 'generic', header: 'X-Sig', algorithm: 'sha256' });

describe('Dado o motivo da assinatura que falhou, com a tela em pt-BR', () => {
  beforeEach(() => loadTranslations(translations));
  afterEach(() => clearTranslations());

  it.each([
    [
      'o HMAC que não bateu',
      github('signature mismatch'),
      'x-hub-signature-256',
      '✕ Assinatura inválida — o HMAC-SHA256 do corpo bruto não bateu (signature mismatch): segredo diferente nos dois lados, ou corpo alterado no caminho.',
    ],
    [
      'o cabeçalho fora do formato',
      generica('malformed header'),
      'x-sig',
      '✕ Assinatura inválida — o cabeçalho não está no formato esperado (malformed header)',
    ],
    [
      'o timestamp fora da tolerância',
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' } as const,
      'stripe-signature',
      '✕ Assinatura inválida — o HMAC-SHA256 de "{t}.{corpo bruto}" bateu, mas o timestamp está a 412 s de agora, fora da tolerância (timestamp outside tolerance)',
    ],
  ])(
    'deve escrever na linha do cabeçalho %s em português, com o motivo original',
    (_caso, signature, header, nota) => {
      const request = webhookRequest(1, { headers: { [header]: ['v'] }, signature });

      expect(signatureCheck(request, urlGenerica)?.rows.get(header)).toBe(nota);
    },
  );

  it('deve dizer em português qual cabeçalho faltou', () => {
    const request = webhookRequest(1, {
      signature: github('header X-Hub-Signature-256 absent'),
    });

    expect(signatureCheck(request, null)?.missing?.note).toBe(
      '⊘ Sem assinatura — a verificação do GitHub espera o cabeçalho X-Hub-Signature-256',
    );
  });

  it.each([
    [
      'signature mismatch',
      github('signature mismatch'),
      null,
      'Confira se o segredo do HMAC daqui é o mesmo do GitHub; se for, algo no caminho alterou o corpo.',
    ],
    [
      'signature mismatch no genérico',
      generica('signature mismatch'),
      urlGenerica,
      'Confira se o segredo do HMAC daqui é o mesmo do remetente; se for, algo no caminho alterou o corpo.',
    ],
    [
      'header absent',
      github('header X-Hub-Signature-256 absent'),
      null,
      'O GitHub não assinou (sem segredo cadastrado lá).',
    ],
    [
      'header absent no genérico',
      generica('header X-Sig absent'),
      urlGenerica,
      'O remetente não assinou, ou o cabeçalho configurado aqui é outro.',
    ],
    [
      'malformed header no genérico',
      generica('malformed header'),
      urlGenerica,
      'Compare o Prefixo e a Codificação (hex/base64) de Verificações › Assinatura com o cabeçalho que chegou, na aba Cabeçalhos. Se o remetente mandou fora do combinado (sem o prefixo, por exemplo), quem corrige é ele; se o formato dele é o combinado, ajuste o Prefixo e a Codificação aqui.',
    ],
    [
      'malformed header no GitHub',
      github('malformed header'),
      null,
      'O cabeçalho não segue o formato do GitHub: confirme que o remetente é o GitHub, ou use Generic.',
    ],
    [
      'timestamp com a tolerância da URL',
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' } as const,
      urlCom({ provider: 'stripe', toleranceSeconds: 300 }),
      'O timestamp passa da tolerância de 300 s: reentrega atrasada ou relógio errado; ou aumente a tolerância.',
    ],
    [
      'timestamp sem a URL (link só-leitura)',
      { provider: 'stripe', valid: false, reason: 'timestamp outside tolerance (412 s)' } as const,
      null,
      'O timestamp passa da tolerância configurada: reentrega atrasada ou relógio errado; ou aumente a tolerância.',
    ],
  ])('deve dizer quem corrige o motivo %s', (_caso, signature, url, conselho) => {
    expect(signatureAdvice(webhookRequest(1, { signature }), url)).toEqual([conselho]);
  });
});

describe('Dado a assinatura em inglês', () => {
  it('deve manter a linha do cabeçalho como era, com o motivo do servidor', () => {
    const request = webhookRequest(1, {
      headers: { 'x-hub-signature-256': ['v'] },
      signature: github('signature mismatch'),
    });

    expect(signatureCheck(request, null)?.rows.get('x-hub-signature-256')).toBe(
      '✕ Signature invalid — HMAC-SHA256 of the raw body did not match (signature mismatch)',
    );
  });

  it.each([
    ['válida', github(null)],
    ['não verificada', null],
  ])('deve ficar sem o que fazer Quando a assinatura é %s', (_caso, signature) => {
    expect(signatureAdvice(webhookRequest(1, { signature }), null)).toEqual([]);
  });

  it('deve dizer quem corrige Quando o HMAC não bateu', () => {
    expect(
      signatureAdvice(webhookRequest(1, { signature: github('signature mismatch') }), null),
    ).toEqual([
      "Check that the HMAC secret here is the same as GitHub's; if it is, something on the way altered the body.",
    ]);
  });

  it('deve dizer como achar o lado do erro Quando o cabeçalho do genérico está fora do formato', () => {
    expect(
      signatureAdvice(webhookRequest(1, { signature: generica('malformed header') }), urlGenerica),
    ).toEqual([
      "Compare the Prefix and the Encoding (hex/base64) in Checks › Signature with the header that arrived, in the Headers tab. If the sender is off the agreed format (no prefix, for example), the sender fixes it; if the sender's format is the agreed one, adjust the Prefix and the Encoding here.",
    ]);
  });
});
