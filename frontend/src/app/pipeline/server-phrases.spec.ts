import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import {
  conditionPhrase,
  originalTitle,
  schemaErrorText,
  schemaPhrase,
  validationPhrase,
} from './server-phrases';

// As frases exatas do servidor (RuleMatching.kt, BodyMatching.kt, RuleFailures.kt, RuleReader.kt).
const conditions: [string, string][] = [
  ['method: expected POST, got GET', 'método: esperava POST, veio GET'],
  ['method: expected one of POST, PUT, got GET', 'método: esperava um de POST, PUT, veio GET'],
  ['path: expected "/pagamentos", got "/outra"', 'caminho: esperava "/pagamentos", veio "/outra"'],
  ['path: expected prefix "/api", got "/web"', 'caminho: esperava começar com "/api", veio "/web"'],
  [
    'path: expected to match "^/v\\d+$", got "/x"',
    'caminho: esperava casar a regex "^/v\\d+$", veio "/x"',
  ],
  [
    'header x-tenant: expected "acme", got "outra"',
    'cabeçalho x-tenant: esperava "acme", veio "outra"',
  ],
  ['header x-tenant: absent', 'cabeçalho x-tenant: ausente'],
  ['query env: present', 'query env: presente'],
  [
    'query env: expected to contain "pro", got "dev"',
    'query env: esperava conter "pro", veio "dev"',
  ],
  [
    'header x-id: expected to match "^a", got "b"',
    'cabeçalho x-id: esperava casar a regex "^a", veio "b"',
  ],
  [
    'body $.status: expected "pago", got "pendente"',
    'corpo $.status: esperava "pago", veio "pendente"',
  ],
  ['body $.status: absent', 'corpo $.status: ausente'],
  ['body $.status: body is not JSON', 'corpo $.status: o corpo não é JSON'],
  ['body: body is not JSON', 'corpo: o corpo não é JSON'],
  ['body: not equal to the expected JSON', 'corpo: diferente do JSON esperado'],
  ['body: expected to contain "pix"', 'corpo: esperava conter "pix"'],
  ['body: expected to match "^\\{"', 'corpo: esperava casar a regex "^\\{"'],
  ['body: expected "a", got "b"', 'corpo: esperava "a", veio "b"'],
  [
    'schema: expected valid, got not configured',
    'schema: não configurado nesta URL (a regra pede schema válido)',
  ],
  [
    'schema: expected invalid, got not configured',
    'schema: não configurado nesta URL (a regra pede schema inválido)',
  ],
  [
    'schema: expected valid, got invalid (3 errors)',
    'schema: esperava válido, veio inválido (3 erros de schema)',
  ],
  [
    'schema: expected valid, got invalid (1 errors)',
    'schema: esperava válido, veio inválido (1 erro de schema)',
  ],
  ['schema: expected invalid, got valid', 'schema: esperava inválido, veio válido'],
  [
    'scenario entrega: expected state "falhou 1", got "Started"',
    'cenário entrega: esperava o estado "falhou 1", estava em "Started"',
  ],
  ['chance 30%: rolled 57, not applied', 'chance de 30%: sorteou 57, não aplicou'],
  [
    'window: opens at 2026-09-29T12:00:00Z, received at 2026-09-29T11:59:30Z',
    'janela: abre em 2026-09-29T12:00:00Z, chegou em 2026-09-29T11:59:30Z',
  ],
  [
    'window: closed at 2026-09-29T13:00:00Z, received at 2026-09-29T13:00:05Z',
    'janela: fechou em 2026-09-29T13:00:00Z, chegou em 2026-09-29T13:00:05Z',
  ],
];

// Assinatura e decifra: a frase da tela, com a do servidor entre parênteses, nos dois idiomas.
const withOriginal: [string, string, string][] = [
  [
    'signature: expected valid, got not configured',
    'this URL does not verify signatures; the rule expects the signature to be valid',
    'esta URL não verifica assinatura; a regra pede assinatura válida',
  ],
  [
    'signature: expected valid, got invalid (signature mismatch)',
    'expects the signature to be valid; this one is invalid',
    'pede assinatura válida; esta veio inválida',
  ],
  [
    'signature: expected invalid, got valid',
    'expects the signature to be invalid; this one is valid',
    'pede assinatura inválida; esta veio válida',
  ],
  [
    'signature: expected valid, got absent (header X-Sig absent)',
    'expects the signature to be valid; this one is absent',
    'pede assinatura válida; esta veio ausente',
  ],
  [
    'decryption: expected valid, got not configured',
    'this URL does not decrypt; the rule expects the decryption to come out valid',
    'esta URL não decifra; a regra pede decifra válida',
  ],
  [
    'decryption: expected valid, got invalid (aud_mismatch)',
    'expects the decryption to come out valid; this one came out invalid',
    'pede decifra válida; esta veio inválida',
  ],
  [
    'decryption: expected absent, got invalid (downgrade)',
    'expects the decryption to come out in plaintext; this one came out invalid',
    'pede decifra em claro; esta veio inválida',
  ],
  [
    'decryption: expected valid, got unknown_kid',
    'expects the decryption to come out valid; this one came out with an unknown key',
    'pede decifra válida; esta veio com chave desconhecida',
  ],
];

const validations: [string, string][] = [
  ['The regex is invalid.', 'A regex é inválida.'],
  ['The status must be between 100 and 599.', 'O status deve estar entre 100 e 599.'],
  ['The priority must be at least 1.', 'A prioridade deve ser 1 ou mais.'],
  ['The name field is required.', 'O nome é obrigatório.'],
  ['The name may not be greater than 255 characters.', 'O nome pode ter no máximo 255 caracteres.'],
  ['The rules may not have more than 50 items.', 'A URL aceita no máximo 50 regras.'],
  ['The template is invalid: unclosed tag.', 'Erro no template: unclosed tag.'],
  ['The selected signature.provider is invalid.', 'O signature.provider escolhido é inválido.'],
  ['The signature.header is invalid.', 'O campo signature.header é inválido.'],
  ['The signature.secret field is required.', 'O campo signature.secret é obrigatório.'],
  [
    'The signature.secret may not be greater than 256 characters.',
    'O campo signature.secret pode ter no máximo 256 caracteres.',
  ],
  [
    'The condition must have exactly one of: equals, contains.',
    'O campo condition deve ter exatamente um de: equals, contains.',
  ],
  ['The schema is invalid: bad type.', 'Schema inválido: bad type.'],
  [
    'The body field is required when fault is truncated_body.',
    'O campo body é obrigatório com a falha truncated_body.',
  ],
  [
    'The active from must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.',
    'O campo active from deve ser uma data-hora ISO-8601 com fuso, como 2026-09-29T12:00:00Z.',
  ],
  [
    'The active until must be a date after active from.',
    'O campo active until deve ser uma data depois de active from.',
  ],
];

// As mensagens do validador de schema (a biblioteca do servidor): [original, en, pt-BR].
const schemaMessages: [string, string, string][] = [
  [
    'string found, number expected',
    'got a string, expected a number',
    'veio texto, esperava número',
  ],
  [
    'integer found, boolean expected',
    'got an integer, expected a boolean',
    'veio inteiro, esperava booleano',
  ],
  [
    'object found, array expected',
    'got an object, expected an array',
    'veio objeto, esperava lista',
  ],
  ['null found, string expected', 'got null, expected a string', 'veio nulo, esperava texto'],
  ["required property 'id' not found", 'missing id', 'faltou id'],
  [
    'does not have a value in the enumeration ["pago", "pendente"]',
    'not one of ["pago", "pendente"]',
    'não é um de ["pago", "pendente"]',
  ],
  ['must have a minimum value of 1', 'below the minimum of 1', 'abaixo do mínimo de 1'],
  ['must have a maximum value of 10', 'above the maximum of 10', 'acima do máximo de 10'],
  ['must be at least 3 characters long', 'shorter than 3 characters', 'menos de 3 caracteres'],
  ['must be at most 5 characters long', 'longer than 5 characters', 'mais de 5 caracteres'],
  [
    'does not match the regex pattern ^PED-\\d+$',
    'does not match the pattern ^PED-\\d+$',
    'não casa com o padrão ^PED-\\d+$',
  ],
];
const unknownSchemaMessages = ['must be multiple of 2', 'string found, [integer, null] expected'];

describe('server-phrases', () => {
  describe('Dado a tela em inglês', () => {
    it.each([...conditions.map(([en]) => en)])(
      'deve deixar "%s" como o servidor mandou, sem marcar como traduzida',
      (en) => {
        expect(conditionPhrase(en)).toEqual({ text: en, original: en, translated: false });
      },
    );

    it.each(withOriginal)(
      'deve dizer "%s" numa frase da tela, com o original entre parênteses',
      (original, en) => {
        expect(conditionPhrase(original)).toEqual({
          text: `${en} (${original})`,
          original,
          translated: false,
        });
      },
    );

    it.each([...validations.map(([en]) => en)])('deve deixar a mensagem "%s" como veio', (en) => {
      expect(validationPhrase(en)).toEqual({ text: en, original: en, translated: false });
    });

    it('não deve pôr title na frase que não mudou', () => {
      expect(originalTitle(conditionPhrase('method: expected POST, got GET'))).toBeNull();
    });

    it.each(schemaMessages)(
      'deve dizer o erro de schema "%s" numa frase da tela, com o original entre parênteses',
      (original, en) => {
        expect(schemaPhrase(original)).toBe(`${en} (${original})`);
      },
    );

    it.each(unknownSchemaMessages)('deve deixar o erro de schema "%s" como veio', (original) => {
      expect(schemaPhrase(original)).toBe(original);
    });

    it('deve dizer o corpo que não é JSON sem repetir a frase entre parênteses', () => {
      expect(schemaErrorText({ path: '', message: 'body is not JSON' })).toBe(
        '(root): the body is not JSON',
      );
    });

    it('deve pôr o caminho antes do erro de schema', () => {
      expect(schemaErrorText({ path: '/valor', message: 'string found, number expected' })).toBe(
        '/valor: got a string, expected a number (string found, number expected)',
      );
    });
  });

  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it.each(conditions)('deve traduzir "%s"', (en, pt) => {
      expect(conditionPhrase(en)).toEqual({ text: pt, original: en, translated: true });
    });

    it.each(withOriginal)(
      'deve traduzir "%s" com o original entre parênteses, sem o "Show original"',
      (original, _en, pt) => {
        expect(conditionPhrase(original)).toEqual({
          text: `${pt} (${original})`,
          original,
          translated: false,
        });
      },
    );

    it.each(validations)('deve traduzir a mensagem "%s"', (en, pt) => {
      expect(validationPhrase(en)).toEqual({ text: pt, original: en, translated: true });
    });

    it.each(schemaMessages)('deve traduzir o erro de schema "%s"', (original, _en, pt) => {
      expect(schemaPhrase(original)).toBe(`${pt} (${original})`);
    });

    it('deve traduzir o corpo que não é JSON, com o original entre parênteses', () => {
      expect(schemaErrorText({ path: '', message: 'body is not JSON' })).toBe(
        '(raiz): o corpo não é JSON (body is not JSON)',
      );
    });

    it('deve guardar o original no title', () => {
      expect(originalTitle(conditionPhrase('body $.status: absent'))).toBe(
        'Original: body $.status: absent',
      );
    });

    it('deve deixar em inglês a frase que a tabela não conhece', () => {
      const unknown = 'frobnicate: a phrase no table knows';
      expect(conditionPhrase(unknown)).toEqual({
        text: unknown,
        original: unknown,
        translated: false,
      });
      expect(validationPhrase('The moon is made of cheese')).toMatchObject({ translated: false });
    });
  });
});
