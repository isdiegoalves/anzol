import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { UrlLock } from '../token/url-lock';
import { ChangedElsewhere, ChecksStore, UnlockFailed, jsonBody } from './checks-store';

/** Responde a releitura com a URL da tela e devolve o `PUT` que vem depois. */
async function expectPutAfterRead(http: HttpTestingController): Promise<TestRequest> {
  const url = `/token/${TOKEN_ID}`;
  const read = await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === url));
  read.flush(TestBed.inject(Preferences).token());
  return vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === url));
}

describe('Dado o salvar de um cartão de Checks', () => {
  let http: HttpTestingController;
  let snack: ReturnType<typeof vi.spyOn>;
  const [R1, R2] = [1, 2].map((n) => webhookRequest(n));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  const loadList = async () => {
    const loaded = TestBed.inject(RequestStore).load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([R1, R2]));
    await loaded;
  };

  it('deve mandar a URL salva com a mudança por cima, guardar a resposta e avisar', async () => {
    TestBed.inject(Preferences).token.set(token({ default_content: 'x', retry_after: 30 }));

    const saved = TestBed.inject(ChecksStore).save(
      { schema: { type: 'object' } },
      TestBed.inject(Preferences).token()!,
    );
    const put = await expectPutAfterRead(http);
    put.flush(token({ schema: { type: 'object' } }));
    await saved;

    expect(put.request.body).toMatchObject({
      default_content: 'x',
      retry_after: '30',
      schema: { type: 'object' },
    });
    expect(TestBed.inject(Preferences).token()?.schema).toEqual({ type: 'object' });
    expect(snack).toHaveBeenCalledWith('URL updated!', undefined, {
      duration: 4000,
      politeness: 'off',
    });
  });

  it('deve ligar o CORS depois do PUT Quando a barra o pede junto com outro campo', async () => {
    const lida = token({ cors: false });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida, {
      cors: true,
    });
    const put = await expectPutAfterRead(http);
    http.expectNone(`/token/${TOKEN_ID}/cors/toggle`);
    put.flush(token({ default_status: 201, cors: false }));
    const toggle = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`));
    expect(toggle.request.method).toBe('PUT');
    toggle.flush({ enabled: true });

    expect((await saved).cors).toBe(true);
    expect(TestBed.inject(Preferences).token()).toMatchObject({ default_status: 201, cors: true });
  });

  it('deve mandar o PUT com a URL inteira e depois trocar o CORS Quando só o CORS mudou', async () => {
    const lida = token({ cors: true, signature: { provider: 'github', secret: '••••1234' } });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({}, lida, { cors: false });
    const put = await expectPutAfterRead(http);
    expect(put.request.body).toMatchObject({
      default_status: '200',
      signature: { provider: 'github', secret: '••••1234' },
    });
    put.flush(lida);
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`))).flush({
      enabled: false,
    });

    expect((await saved).cors).toBe(false);
  });

  it('deve manter o CORS que a URL tinha Quando o PUT o devolve desligado', async () => {
    const lida = token({ cors: true });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida);
    (await expectPutAfterRead(http)).flush(token({ default_status: 201, cors: false }));
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`))).flush({
      enabled: true,
    });

    expect((await saved).cors).toBe(true);
  });

  it('deve dizer que o CORS não entrou, com o resto gravado, Quando a troca falha', async () => {
    const lida = token({ cors: false });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida, {
      cors: true,
    });
    (await expectPutAfterRead(http)).flush(token({ default_status: 201, cors: false }));
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`))).flush(null, {
      status: 500,
      statusText: 'x',
    });

    expect(await saved).toMatchObject({ default_status: 201, cors: false });
    expect(snack).toHaveBeenLastCalledWith('Could not toggle CORS.', undefined, {
      duration: 10000,
    });
  });

  it('deve recarregar a lista da URL Quando a limpeza reduzida corta mensagens (o corte não gera evento)', async () => {
    await loadList();
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: 5000 }));

    const saved = TestBed.inject(ChecksStore).save(
      { auto_cleanup: 1000 },
      TestBed.inject(Preferences).token()!,
    );
    (await expectPutAfterRead(http)).flush(token({ auto_cleanup: 1000 }));
    const reload = await vi.waitFor(() =>
      http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`),
    );
    reload.flush(requestPage([R2], { total: 1 }));
    await saved;

    expect(TestBed.inject(RequestStore).requests()).toEqual([R2]);
  });

  it('não deve recarregar a lista Quando a limpeza é desligada', async () => {
    await loadList();
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: 500 }));

    const saved = TestBed.inject(ChecksStore).save(
      { auto_cleanup: null },
      TestBed.inject(Preferences).token()!,
    );
    (await expectPutAfterRead(http)).flush(token());
    await saved;

    http.expectNone(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`);
  });

  it('deve destrancar com o segredo novo Quando o segredo de leitura muda', async () => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));
    TestBed.inject(UrlLock).lock(TOKEN_ID);

    const saved = TestBed.inject(ChecksStore).save(
      { read_secret: 'segredo-novo' },
      TestBed.inject(Preferences).token()!,
    );
    (await expectPutAfterRead(http)).flush(token({ protected: true }));
    const unlock = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/unlock`));
    unlock.flush(null, { status: 204, statusText: 'No Content' });
    await saved;

    expect(unlock.request.body).toEqual({ secret: 'segredo-novo' });
    expect(TestBed.inject(UrlLock).tokenId()).toBeNull();
  });

  it('deve devolver o erro sem avisar Quando o PUT falha', async () => {
    TestBed.inject(Preferences).token.set(token());

    const saved = TestBed.inject(ChecksStore).save(
      { retry_after: 'x' },
      TestBed.inject(Preferences).token()!,
    );
    (await expectPutAfterRead(http)).flush(
      { retry_after: ['bad'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await expect(saved).rejects.toMatchObject({ status: 422 });
    expect(snack).not.toHaveBeenCalled();
  });
});

describe('Dado a URL mudada em outro lugar (outra aba, CLI, MCP) enquanto Checks está aberto', () => {
  let http: HttpTestingController;
  const URL = `/token/${TOKEN_ID}`;
  const NO_CONTENT = { status: 204, statusText: 'No Content' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve recusar sem PUT Quando outro campo da URL mudou lá fora, e manter o que mudou no "Save anyway"', async () => {
    const lida = token({ schema: null, default_status: 200 });
    TestBed.inject(Preferences).token.set(lida);
    const fora = token({ schema: { type: 'object' }, default_status: 200 });

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida);
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      fora,
    );
    await expect(saved).rejects.toMatchObject({ fields: ['schema'] });
    http.expectNone((r) => r.method === 'PUT');

    const forced = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida, {
      force: true,
    });
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      fora,
    );
    const put = await vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === URL));
    put.flush(token({ schema: { type: 'object' }, default_status: 201 }));
    await forced;

    expect(put.request.body).toMatchObject({ default_status: '201', schema: { type: 'object' } });
  });

  it('deve recusar sem PUT, dizendo o campo, Quando o próprio campo do cartão mudou lá fora', async () => {
    const lida = token({ default_status: 200 });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida);
    const reler = await vi.waitFor(() =>
      http.expectOne((r) => r.method === 'GET' && r.url === URL),
    );
    reler.flush(token({ default_status: 404 }));

    await expect(saved).rejects.toBeInstanceOf(ChangedElsewhere);
    await expect(saved).rejects.toMatchObject({ fields: ['default_status'] });
    http.expectNone((r) => r.method === 'PUT');
  });

  it('deve recusar sem chamada Quando o CORS mudou lá fora', async () => {
    const lida = token({ cors: false });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({}, lida, { cors: true });
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      token({ cors: true }),
    );

    await expect(saved).rejects.toMatchObject({ fields: ['cors'] });
    http.expectNone(`${URL}/cors/toggle`);
  });

  it('deve gravar por cima do que mudou lá fora Quando "force"', async () => {
    const lida = token({ default_status: 200 });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida, {
      force: true,
    });
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      token({ default_status: 404, default_content: 'de fora' }),
    );
    const put = await vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === URL));
    expect(put.request.body).toMatchObject({ default_status: '201', default_content: 'de fora' });
    put.flush(token({ default_status: 201, default_content: 'de fora' }));

    await saved;
  });

  it('deve destrancar com o segredo novo antes de publicar a URL salva (o Health não pode pegar 401)', async () => {
    const lida = token({ protected: false });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ read_secret: 'segredo-novo' }, lida);
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      lida,
    );
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === URL))).flush(
      token({ protected: true }),
    );
    const unlock = await vi.waitFor(() => http.expectOne(`${URL}/unlock`));

    expect(TestBed.inject(Preferences).token()?.protected).toBe(false);
    unlock.flush(null, NO_CONTENT);
    await saved;
    expect(TestBed.inject(Preferences).token()?.protected).toBe(true);
  });
});

describe('Dado o segredo de leitura trocado e o unlock recusado depois do PUT', () => {
  let http: HttpTestingController;
  const URL = `/token/${TOKEN_ID}`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve dizer que a URL foi salva e que é preciso desbloquear com o segredo novo Quando o unlock volta 429', async () => {
    const lida = token({ protected: false });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ read_secret: 'segredo-novo' }, lida);
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'GET' && r.url === URL))).flush(
      lida,
    );
    (await vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === URL))).flush(
      token({ protected: true }),
    );
    (await vi.waitFor(() => http.expectOne(`${URL}/unlock`))).flush(
      { error: 'Too many attempts' },
      { status: 429, statusText: 'Too Many Requests' },
    );

    await expect(saved).rejects.toBeInstanceOf(UnlockFailed);
    await expect(saved).rejects.toMatchObject({ status: 429 });
  });
});

describe('Dado o id de mensagem que vem da rota (?schema-from=)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve recusar sem chamar o servidor Quando o id não é um UUID (path traversal)', async () => {
    await expect(
      TestBed.inject(ChecksStore).request(TOKEN_ID, '../../../share/abc'),
    ).rejects.toThrow();
    http.expectNone(() => true);
  });

  it('deve buscar a mensagem Quando o id é um UUID', async () => {
    const pedido = webhookRequest(1);
    const lido = TestBed.inject(ChecksStore).request(TOKEN_ID, pedido.uuid);
    http.expectOne(`/token/${TOKEN_ID}/request/${pedido.uuid}`).flush(pedido);
    expect(await lido).toEqual(pedido);
  });
});

describe('Dado o corpo de uma mensagem', () => {
  it.each([
    ['objeto', '{"a": 1}', { value: { a: 1 } }],
    ['número', '7', { value: 7 }],
    ['formulário', 'nome=Ana', null],
    ['vazio', null, null],
  ])('deve dizer se é JSON Quando o corpo é %s', (_c, content, esperado) => {
    expect(jsonBody(webhookRequest(1, { content }))).toEqual(esperado);
  });
});
