import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { RuleStore, validationMessages } from './rule-store';

describe('Dado as regras da URL aberta', () => {
  let http: HttpTestingController;
  let store: RuleStore;
  const url = `/token/${TOKEN_ID}/rules`;

  const loaded = async () => {
    const done = store.load(TOKEN_ID);
    http.expectOne(url).flush([rule(1), rule(2)]);
    await done;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RuleStore);
  });

  afterEach(() => http.verify());

  it('deve guardar a lista do GET Quando a URL é carregada', async () => {
    await loaded();

    expect(store.tokenId()).toBe(TOKEN_ID);
    expect(store.rules()).toEqual([rule(1), rule(2)]);
  });

  it('deve enviar a lista inteira no PUT e ficar com a lista que o servidor devolve Quando salva', async () => {
    await loaded();
    const nova = { ...rule(3), id: undefined };

    const done = store.save([rule(1), rule(2), nova]);
    const call = http.expectOne(url);
    call.flush([rule(1), rule(2), rule(3)]);
    await done;

    expect(call.request.method).toBe('PUT');
    expect(call.request.body).toEqual([rule(1), rule(2), nova]);
    expect(store.rules()).toEqual([rule(1), rule(2), rule(3)]);
  });

  it('deve mostrar a mudança na hora e voltar à lista anterior Quando o PUT falha', async () => {
    await loaded();
    const desligada = { ...rule(1), enabled: false };

    const done = store.save([desligada, rule(2)]);
    expect(store.rules()).toEqual([desligada, rule(2)]);
    http.expectOne(url).flush({}, { status: 500, statusText: 'Server Error' });

    await expect(done).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.rules()).toEqual([rule(1), rule(2)]);
  });

  it('deve buscar a lista atual no servidor Quando exporta', async () => {
    await loaded();

    const done = store.fetchAll();
    http.expectOne({ method: 'GET', url }).flush([rule(9)]);

    expect(await done).toEqual([rule(9)]);
  });
});

describe('Dado a resposta de erro ao salvar regras', () => {
  it('deve listar chave e mensagem com a regra numerada a partir de 1 Quando é 422', () => {
    const erro = new HttpErrorResponse({
      status: 422,
      error: {
        '0.match.path.regex': ['The regex is invalid.'],
        rules: ['The rules may not have more than 100 items.'],
      },
    });

    expect(validationMessages(erro)).toEqual([
      'Rule 1 › match.path.regex: The regex is invalid.',
      'The rules may not have more than 100 items.',
    ]);
  });

  it.each([
    ['500', new HttpErrorResponse({ status: 500 }), ['Could not save the rules (500).']],
    ['410', new HttpErrorResponse({ status: 410 }), ['This URL no longer exists (410).']],
    ['desconhecido', new Error('x'), ['Could not save the rules (unknown).']],
  ])('deve dar uma frase só Quando o erro é %s', (_caso, erro, esperado) => {
    expect(validationMessages(erro)).toEqual(esperado);
  });
});
