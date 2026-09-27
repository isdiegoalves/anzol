import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { conditionPhrase, originalTitle, validationPhrase } from './server-phrases';

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
  ['body: not equal to the expected JSON', 'corpo: diferente do JSON dado'],
  ['body: expected to contain "pix"', 'corpo: esperava conter "pix"'],
  ['body: expected to match "^\\{"', 'corpo: esperava casar a regex "^\\{"'],
  ['body: expected "a", got "b"', 'corpo: esperava "a", veio "b"'],
  [
    'signature: expected valid, got not configured',
    'assinatura: não configurada nesta URL (a regra pede valid)',
  ],
  [
    'signature: expected valid, got invalid (signature mismatch)',
    'assinatura: esperava valid, veio invalid (signature mismatch)',
  ],
  [
    'schema: expected valid, got not configured',
    'schema: não configurado nesta URL (a regra pede valid)',
  ],
  [
    'schema: expected valid, got invalid (3 errors)',
    'schema: esperava valid, veio invalid (3 errors)',
  ],
  [
    'scenario entrega: expected state "falhou 1", got "Started"',
    'cenário entrega: esperava o estado "falhou 1", estava em "Started"',
  ],
];

const validations: [string, string][] = [
  ['The regex is invalid.', 'A regex é inválida.'],
  ['The status must be between 100 and 599.', 'O status deve estar entre 100 e 599.'],
  ['The priority must be at least 1.', 'A prioridade deve ser 1 ou mais.'],
  ['The name field is required.', 'O nome é obrigatório.'],
  ['The name may not be greater than 255 characters.', 'O nome pode ter no máximo 255 caracteres.'],
  ['The rules may not have more than 50 items.', 'Mais de 50 regras.'],
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
];

describe('server-phrases', () => {
  describe('Dado a tela em inglês', () => {
    it.each([...conditions.map(([en]) => en)])(
      'deve deixar "%s" como o servidor mandou, sem marcar como traduzida',
      (en) => {
        expect(conditionPhrase(en)).toEqual({ text: en, original: en, translated: false });
      },
    );

    it.each([...validations.map(([en]) => en)])('deve deixar a mensagem "%s" como veio', (en) => {
      expect(validationPhrase(en)).toEqual({ text: en, original: en, translated: false });
    });

    it('não deve pôr title na frase que não mudou', () => {
      expect(originalTitle(conditionPhrase('method: expected POST, got GET'))).toBeNull();
    });
  });

  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it.each(conditions)('deve traduzir "%s"', (en, pt) => {
      expect(conditionPhrase(en)).toEqual({ text: pt, original: en, translated: true });
    });

    it.each(validations)('deve traduzir a mensagem "%s"', (en, pt) => {
      expect(validationPhrase(en)).toEqual({ text: pt, original: en, translated: true });
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
