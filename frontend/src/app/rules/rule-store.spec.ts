import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { DecryptionCondition, Rule } from './rule';
import { RuleStore, RulesChangedError, validationMessages } from './rule-store';

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

  it('deve pôr no começo só as regras cujo match a URL ainda não tem, sem mexer na lista da página', async () => {
    await loaded();
    const nova = (status: number, decryption: DecryptionCondition): Rule => ({
      name: `decryption: ${decryption} → ${status}`,
      match: { decryption },
      response: { status },
    });
    const existente = {
      ...rule(3),
      match: { method: [], path: null, query: {}, decryption: 'unknown_kid' },
    };

    const added = store.prependMissing(TOKEN_ID, [nova(500, 'unknown_kid'), nova(400, 'invalid')]);
    http.expectOne({ method: 'GET', url }).flush([existente]);
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url }));
    expect(put.request.body).toEqual([nova(400, 'invalid'), existente]);
    put.flush(put.request.body);

    expect(await added).toEqual([nova(400, 'invalid')]);
    expect(store.rules()).toEqual([rule(1), rule(2)]);
  });

  it('deve guardar a lista do GET Quando a URL é carregada', async () => {
    await loaded();

    expect(store.tokenId()).toBe(TOKEN_ID);
    expect(store.rules()).toEqual([rule(1), rule(2)]);
  });

  it('deve guardar o último teste da regra salva e mantê-lo ao reler a mesma URL (Likely shadowed)', async () => {
    await loaded();
    const test = store.testRule(rule(1));
    http.expectOne({ method: 'POST', url: `${url}/test` }).flush({
      matches: [{ uuid: 'm1', seq: 2 }],
      misses: [],
    });
    http.expectOne((req) => req.url === `/token/${TOKEN_ID}/requests`).flush({ total: 1 });
    await test;
    expect(store.tested().get('r1')?.matches).toEqual(['m1']);

    await loaded();
    expect(store.tested().get('r1')?.matches).toEqual(['m1']);

    const outra = store.load('outra-url');
    http.expectOne('/token/outra-url/rules').flush([]);
    await outra;
    expect(store.tested().size).toBe(0);
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

  it('deve testar a regra em edição e contar as mensagens da URL para achar a página Quando testa contra o histórico', async () => {
    await loaded();
    const emEdicao = { ...rule(3), id: undefined };

    const done = store.testRule(emEdicao);
    const test = http.expectOne({ method: 'POST', url: `${url}/test` });
    const count = http.expectOne(
      (req) => req.url === `/token/${TOKEN_ID}/requests` && req.params.get('per_page') === '1',
    );
    test.flush({
      matches: [{ uuid: 'a', seq: 2 }],
      misses: [{ uuid: 'b', seq: 1, failed: ['method: expected POST, got GET'] }],
    });
    count.flush({ data: [], total: 52 });

    expect(test.request.body).toEqual(emEdicao);
    expect(await done).toEqual({
      tested: 2,
      matched: 1,
      matches: ['a'],
      matchList: [{ uuid: 'a', seq: 2, page: 2 }],
      misses: [{ uuid: 'b', seq: 1, failed: ['method: expected POST, got GET'], page: 2 }],
      windowFull: false,
    });
  });

  describe('Dado uma mudança que parte da lista mostrada (toggle, ordem, apagar)', () => {
    it('deve gravar Quando a lista do servidor é a que a tela leu', async () => {
      await loaded();

      const done = store.saveIfUnchanged([rule(2)]);
      http.expectOne({ method: 'GET', url }).flush([rule(1), rule(2)]);
      await vi.waitFor(() => http.expectOne({ method: 'PUT', url }).flush([rule(2)]));
      await done;

      expect(store.rules()).toEqual([rule(2)]);
    });

    it('não deve gravar e deve avisar Quando a lista mudou em outro lugar desde a leitura', async () => {
      await loaded();

      const done = store.saveIfUnchanged([rule(2)]);
      http.expectOne({ method: 'GET', url }).flush([rule(1), rule(2), rule(3)]);

      await expect(done).rejects.toBeInstanceOf(RulesChangedError);
      http.expectNone({ method: 'PUT', url });
      expect(store.rules()).toEqual([rule(1), rule(2)]);
    });

    it('deve comparar com a lista que o último PUT devolveu', async () => {
      await loaded();
      const saved = store.save([rule(1)]);
      http.expectOne({ method: 'PUT', url }).flush([rule(1)]);
      await saved;

      const done = store.saveIfUnchanged([]);
      http.expectOne({ method: 'GET', url }).flush([rule(1)]);
      await vi.waitFor(() => http.expectOne({ method: 'PUT', url }).flush([]));

      await expect(done).resolves.toBeUndefined();
    });
  });

  it('deve guardar os hits por regra da janela de stats e ficar sem eles Quando stats falha', async () => {
    await loaded();

    const done = store.loadHits(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/stats`).flush({
      evaluated: 7,
      rules: { answered: [{ id: 'r1', name: 'Rule 1', count: 5 }], near_miss: [], default: 2 },
    });
    await done;
    expect(store.hits()).toEqual({
      evaluated: 7,
      answered: [{ id: 'r1', name: 'Rule 1', count: 5 }],
      near_miss: [],
      default: 2,
    });

    const again = store.loadHits(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/stats`).flush({}, { status: 404, statusText: 'x' });
    await again;
    expect(store.hits()).toBeNull();
  });

  it('deve ler as mensagens recentes em páginas de 100, da mais nova, até a última página, uma vez só', async () => {
    await loaded();
    const page = (n: number, last: boolean) =>
      requestPage([webhookRequest(n)], { is_last_page: last });

    const first = store.recentRequests();
    const second = store.recentRequests();
    const call1 = http.expectOne((req) => req.params.get('page') === '1');
    expect(call1.request.params.get('per_page')).toBe('100');
    expect(call1.request.params.get('sorting')).toBe('newest');
    call1.flush(page(1, false));
    await vi.waitFor(() =>
      http.expectOne((req) => req.params.get('page') === '2').flush(page(2, true)),
    );

    expect((await first).map((request) => request.uuid)).toEqual([
      webhookRequest(1).uuid,
      webhookRequest(2).uuid,
    ]);
    expect(await second).toBe(await first);
  });

  it('deve repassar o erro Quando o servidor recusa a regra (422)', async () => {
    await loaded();

    const done = store.testRule(rule(1));
    http
      .expectOne(`${url}/test`)
      .flush({ 'match.path.regex': ['The regex is invalid.'] }, { status: 422, statusText: 'x' });
    http.expectOne((req) => req.url === `/token/${TOKEN_ID}/requests`).flush({ total: 0 });

    await expect(done).rejects.toMatchObject({ status: 422 });
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
