import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { webhookRequest } from '../../testing/fixtures';
import { DecryptionResult } from '../requests/webhook-request';
import { spokenOf } from '../ui/check-chip';
import { decryptionReasonText, decryptionResult } from './decryption';
import { CheckResult, pipelineOf } from './pipeline';

const resultado = (overrides: Partial<DecryptionResult>): DecryptionResult => ({
  state: 'valid',
  kid: 'enc-1',
  signature_kid: 'sig-1',
  reason: null,
  jti: 'n-1',
  duplicate_of: null,
  ...overrides,
});

describe('Dado a decifra gravada na mensagem', () => {
  it.each([
    ['ausente (mensagem antiga)', undefined],
    ['nula (a URL não decifra)', null],
  ])('deve ficar sem resultado Quando ela é %s', (_caso, decryption) => {
    const request = webhookRequest(1, { decryption });

    expect(decryptionResult(request)).toBeNull();
    expect(pipelineOf(request).decryption).toBeNull();
  });

  it.each([
    [
      'válida',
      resultado({}),
      { state: 'valid', tone: 'ok', title: 'Decrypted', short: 'Decrypted' },
      'key enc-1 · signed by sig-1',
    ],
    [
      'válida e repetida',
      resultado({ duplicate_of: webhookRequest(2).uuid }),
      { state: 'valid', tone: 'ok', title: 'Decrypted · repeated jti', short: 'Repeated jti' },
      'key enc-1 · signed by sig-1',
    ],
    [
      'inválida',
      resultado({ state: 'invalid', reason: 'signer_unknown' }),
      { state: 'invalid', tone: 'bad', title: 'Decryption invalid', short: 'Unknown signer' },
      'the JWS kid is not a trusted signer (signer_unknown)',
    ],
    [
      'de chave desconhecida',
      resultado({ state: 'unknown_kid', kid: 'enc-9', signature_kid: null }),
      { state: 'unknown-kid', tone: 'bad', title: 'Unknown encryption key', short: 'Unknown kid' },
      "The JWE kid enc-9 is not one of this URL's keys",
    ],
    [
      'em claro aceito',
      resultado({ state: 'absent', kid: null, signature_kid: null }),
      { state: 'absent', tone: 'none', title: 'Not encrypted', short: 'Plaintext' },
      'The attribute arrived in plaintext, which this URL accepts',
    ],
  ])('deve montar o selo Quando a decifra é %s', (_caso, decryption, selo, detalhe) => {
    expect(decryptionResult(webhookRequest(1, { decryption }))).toEqual({
      kind: 'decryption',
      ...selo,
      detail: detalhe,
    });
  });

  it('deve mostrar o código como veio Quando o servidor manda um motivo que a tela não conhece', () => {
    expect(decryptionReasonText('novo_motivo')).toBe('novo_motivo');
    expect(
      decryptionResult(
        webhookRequest(1, { decryption: resultado({ state: 'invalid', reason: 'novo_motivo' }) }),
      )?.short,
    ).toBe('novo_motivo');
  });
});

/** Os 26 motivos da decifra inválida, com o selo curto em inglês e em pt-BR. */
const MOTIVOS: readonly [string, string, string][] = [
  ['hmac_failed', 'HMAC blocked', 'HMAC barrou'],
  ['body_not_json', 'Not JSON', 'Corpo não é JSON'],
  ['attribute_missing', 'Attribute missing', 'Atributo ausente'],
  ['downgrade', 'Plaintext · refused', 'Em claro · recusado'],
  ['too_large', 'JWE too large', 'JWE grande demais'],
  ['malformed_jwe', 'Malformed JWE', 'JWE malformado'],
  ['alg_not_allowed', 'alg not allowed', 'alg não aceito'],
  ['enc_not_allowed', 'enc not allowed', 'enc não aceito'],
  ['zip_present', 'Compressed JWE', 'JWE comprimido'],
  ['kid_missing', 'No kid', 'JWE sem kid'],
  ['cty_not_jwt', 'cty not JWT', 'cty não é JWT'],
  ['epk_invalid', 'Invalid epk', 'epk inválida'],
  ['epk_off_curve', 'epk off curve', 'epk fora da curva'],
  ['decrypt_failed', 'Decrypt failed', 'Não decifrou'],
  ['jws_missing', 'No JWS inside', 'Sem JWS dentro'],
  ['jws_alg_not_allowed', 'JWS alg not allowed', 'JWS alg não aceito'],
  ['signer_unknown', 'Unknown signer', 'Signatário desconhecido'],
  ['signature_invalid', 'JWS signature invalid', 'Assinatura JWS inválida'],
  ['claims_malformed', 'Malformed claims', 'Claims malformados'],
  ['aud_mismatch', 'aud mismatch', 'aud divergente'],
  ['jti_mismatch', 'jti mismatch', 'jti divergente'],
  ['evt_mismatch', 'evt mismatch', 'evt divergente'],
  ['app_mismatch', 'app mismatch', 'app divergente'],
  ['iat_missing', 'No iat', 'Sem iat'],
  ['iat_outside_window', 'iat outside window', 'iat fora da janela'],
  ['data_missing', 'No data claim', 'Sem data'],
];

const invalida = (reason: string) =>
  decryptionResult(webhookRequest(1, { decryption: resultado({ state: 'invalid', reason }) }));

describe.each([
  ['inglês', (): void => undefined, 1],
  ['pt-BR', () => loadTranslations(translations), 2],
] as const)('Dado a decifra inválida com a tela em %s', (_idioma, carregar, coluna) => {
  beforeEach(carregar);
  afterEach(() => clearTranslations());

  it.each(MOTIVOS)(
    'deve dar ao motivo %s um selo curto em palavras e manter o código no nome acessível',
    (...linha) => {
      const selo = invalida(linha[0]) as CheckResult;

      expect(selo.short).toBe(linha[coluna]);
      expect(selo.short).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(spokenOf(selo)).toContain(`(${linha[0]})`);
    },
  );

  it('deve dizer no selo que a chave de cifra é desconhecida, sem o kid cru', () => {
    const selo = decryptionResult(
      webhookRequest(1, { decryption: resultado({ state: 'unknown_kid', kid: 'enc-9' }) }),
    );

    expect(selo?.short).toBe(['Unknown kid', 'Chave desconhecida'][coluna - 1]);
  });
});
