import { HttpErrorResponse } from '@angular/common/http';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { FormControl, Validators } from '@angular/forms';
import { token } from '../../testing/fixtures';
import { E2eePolicy } from '../token/token';
import {
  changedElsewhere,
  cutsRequests,
  errorKeys,
  fieldErrors,
  pendingSummary,
  savedSettings,
  schemaOf,
  schemaText,
  schemaValidator,
  updateError,
  withChanges,
} from './url-settings';

const POLITICA: E2eePolicy = {
  path: '$.payload',
  required: true,
  audience: 'anzol-lab',
  bindings: {
    jti: '$.eventId',
    evt: '$.tipoEvento.nome',
    app: { path: '$.servico.nome', ignore_case: true },
  },
  max_age_seconds: 43200,
  trusted_signers: [{ kty: 'EC', crv: 'P-256', kid: 'sig-1', x: 'x', y: 'y' }],
};

const CONFIGURADA = token({
  default_status: 202,
  default_content_type: 'application/json',
  timeout: 3,
  default_content: '{"ok":true}',
  retry_after: 120,
  auto_cleanup: 1000,
  signature: { provider: 'github', secret: '••••-e2e' },
  schema: { type: 'object' },
  protected: true,
  e2ee: POLITICA,
  e2ee_keys: [{ kid: 'enc-1', created_at: '2026-10-07 10:00:00', jwk: { kty: 'EC' } }],
});

describe('Dado a configuração salva da URL como corpo do PUT (CA-11)', () => {
  it('deve levar todos os campos, com o segredo mascarado e sem read_secret, Quando a URL está configurada', () => {
    expect(savedSettings(CONFIGURADA)).toEqual({
      default_status: '202',
      default_content_type: 'application/json',
      timeout: '3',
      default_content: '{"ok":true}',
      retry_after: '120',
      auto_cleanup: 1000,
      signature: { provider: 'github', secret: '••••-e2e' },
      schema: { type: 'object' },
      e2ee: POLITICA,
    });
  });

  it('deve mandar nulos, e não omitir, Quando o token veio de uma versão sem os campos novos', () => {
    const antigo = token();
    delete antigo.retry_after;
    delete antigo.auto_cleanup;
    delete antigo.signature;

    expect(savedSettings(antigo)).toMatchObject({
      retry_after: null,
      auto_cleanup: null,
      signature: null,
      schema: null,
      e2ee: null,
    });
  });

  it('deve trocar só a parte do cartão e manter assinatura e resposta Quando o Schema é salvo', () => {
    const corpo = withChanges(CONFIGURADA, { schema: null });

    expect(corpo).toEqual({ ...savedSettings(CONFIGURADA), schema: null });
    expect(corpo.signature).toEqual({ provider: 'github', secret: '••••-e2e' });
    expect(corpo.default_content).toBe('{"ok":true}');
  });

  it.each([
    ['Schema', { schema: null }],
    ['Signature', { signature: null }],
    ['Response', { default_status: '201' }],
    ['Privacy', { read_secret: 'outro-segredo' }],
  ])('deve manter a política de decifra no PUT Quando o cartão %s é salvo', (_cartao, mudancas) => {
    expect(withChanges(CONFIGURADA, mudancas).e2ee).toEqual(POLITICA);
  });

  it('deve deixar as chaves de cifra fora do PUT, que não as grava', () => {
    expect(savedSettings(CONFIGURADA)).not.toHaveProperty('e2ee_keys');
  });

  it('deve acusar a política mudada em outro lugar, e não as chaves', () => {
    expect(changedElsewhere(CONFIGURADA, { ...CONFIGURADA, e2ee: null })).toEqual(['e2ee']);
    expect(changedElsewhere(CONFIGURADA, { ...CONFIGURADA, e2ee_keys: [] })).toEqual([]);
  });
});

describe('Dado a limpeza automática antes e depois do PUT', () => {
  it.each([
    ['ligada', null, 1000, true],
    ['reduzida', 5000, 1000, true],
    ['desligada', 500, null, false],
    ['aumentada', 500, 1000, false],
    ['mantida', 1000, 1000, false],
  ] as const)(
    'deve dizer se o servidor cortou mensagens Quando é %s',
    (_c, antes, depois, corta) => {
      expect(cutsRequests(token({ auto_cleanup: antes }), token({ auto_cleanup: depois }))).toBe(
        corta,
      );
    },
  );
});

describe('Dado o erro do PUT', () => {
  const recusa = new HttpErrorResponse({
    status: 422,
    error: {
      schema: ['The schema is invalid: $ref is not internal.'],
      'signature.secret': ['The signature.secret field is required.'],
    },
  });

  it('deve separar as mensagens de um campo Quando o servidor responde 422', () => {
    expect(fieldErrors(recusa, 'schema')).toEqual(['The schema is invalid: $ref is not internal.']);
    expect(fieldErrors(recusa, 'timeout')).toEqual([]);
    expect(fieldErrors(new HttpErrorResponse({ status: 500 }), 'schema')).toEqual([]);
  });

  it.each([
    [
      'e2ee',
      'The e2ee requires a read secret on this URL (read_secret).',
      'A decifra exige segredo de leitura: ligue Privacidade nesta URL.',
    ],
    [
      'e2ee.trusted_signers.0',
      'The e2ee.trusted_signers.0 must have a kid.',
      'Um signatário confiável (e2ee.trusted_signers.0) precisa de kid.',
    ],
    [
      'kid',
      'The kid is already in use on this URL.',
      'Já existe uma chave de cifra com esse kid nesta URL.',
    ],
  ])(
    'deve dizer em pt-BR a recusa em %s Quando a tela está em pt-BR',
    (campo, original, traduzida) => {
      const erro = new HttpErrorResponse({ status: 422, error: { [campo]: [original] } });
      expect(fieldErrors(erro, campo)).toEqual([original]);

      loadTranslations(translations);
      try {
        expect(fieldErrors(erro, campo)).toEqual([traduzida]);
      } finally {
        clearTranslations();
      }
    },
  );

  it('deve listar as chaves do 422 Quando o servidor recusa a política', () => {
    const politica = new HttpErrorResponse({
      status: 422,
      error: { 'e2ee.audience': ['x'], 'e2ee.trusted_signers.0': ['y'] },
    });

    expect(errorKeys(politica)).toEqual(['e2ee.audience', 'e2ee.trusted_signers.0']);
    expect(errorKeys(new HttpErrorResponse({ status: 500, error: { e2ee: ['z'] } }))).toEqual([]);
  });

  it.each([
    [
      '422',
      recusa,
      'Error updating token: The schema is invalid: $ref is not internal., The signature.secret field is required.',
    ],
    ['500', new HttpErrorResponse({ status: 500 }), 'Error updating token (500)'],
    ['desconhecido', new Error('x'), 'Error updating token (unknown)'],
  ])('deve dizer o erro como o app atual Quando a API responde %s', (_c, erro, esperado) => {
    expect(updateError(erro)).toBe(esperado);
  });
});

describe('Dado o campo do schema', () => {
  it.each([
    ['vazio (desliga)', '  ', null],
    ['objeto', '{"type": "object"}', null],
    ['lista', '[1]', { json: 'The schema must be a JSON object.' }],
  ])('deve validar Quando o texto é %s', (_c, texto, esperado) => {
    expect(schemaValidator(new FormControl(texto, { nonNullable: true }))).toEqual(esperado);
  });

  it('deve dizer "Invalid JSON" Quando o texto não é JSON', () => {
    expect(schemaValidator(new FormControl('{"type": ', { nonNullable: true }))).toEqual({
      json: expect.stringMatching(/^Invalid JSON: /),
    });
  });

  it('deve ir e voltar entre texto indentado e objeto, com vazio como nulo', () => {
    expect(schemaText({ type: 'object' })).toBe('{\n  "type": "object"\n}');
    expect(schemaText(null)).toBe('');
    expect(schemaOf('{"type": "object"}')).toEqual({ type: 'object' });
    expect(schemaOf(' ')).toBeNull();
  });
});

describe('Dado os campos pendentes de um cartão', () => {
  it('deve juntar os vazios em "fill in" e os errados em "fix", na ordem da tela', () => {
    const header = new FormControl('', Validators.required);
    const secret = new FormControl('', Validators.required);
    const tolerance = new FormControl('abc', Validators.pattern(/^\d+$/));
    const ok = new FormControl('x', Validators.required);

    expect(
      pendingSummary([
        [header, 'header', 'Signature header'],
        [ok, 'prefix', 'Prefix'],
        [secret, 'secret', 'Secret'],
        [tolerance, 'toleranceSeconds', 'Timestamp tolerance (seconds)'],
      ]),
    ).toBe('To save, fill in: Signature header, Secret; fix: Timestamp tolerance (seconds)');
    expect(pendingSummary([[ok, 'prefix', 'Prefix']])).toBe('');
  });
});
