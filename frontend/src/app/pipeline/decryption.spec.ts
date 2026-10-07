import { webhookRequest } from '../../testing/fixtures';
import { DecryptionResult } from '../requests/webhook-request';
import { decryptionReasonText, decryptionResult } from './decryption';
import { pipelineOf } from './pipeline';

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
      { state: 'invalid', tone: 'bad', title: 'Decryption invalid', short: 'signer_unknown' },
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
  });
});
