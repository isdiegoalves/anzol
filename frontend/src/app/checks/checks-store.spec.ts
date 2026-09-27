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
import { ChangedElsewhere, ChecksStore, jsonBody } from './checks-store';

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
    http.expectOne(`/token/${TOKEN_ID}/requests?page=1`).flush(requestPage([R1, R2]));
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
    expect(snack).toHaveBeenCalledWith('URL updated!', undefined, { duration: 4000 });
  });

  it('deve recarregar a lista da URL Quando a limpeza reduzida corta mensagens (o corte não gera evento)', async () => {
    await loadList();
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: 5000 }));

    const saved = TestBed.inject(ChecksStore).save(
      { auto_cleanup: 1000 },
      TestBed.inject(Preferences).token()!,
    );
    (await expectPutAfterRead(http)).flush(token({ auto_cleanup: 1000 }));
    const reload = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests?page=1`));
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

    http.expectNone(`/token/${TOKEN_ID}/requests?page=1`);
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

  it('deve reler a URL antes do PUT e manter o schema gravado lá fora Quando salva a resposta (CA-11)', async () => {
    const lida = token({ schema: null, default_status: 200 });
    TestBed.inject(Preferences).token.set(lida);

    const saved = TestBed.inject(ChecksStore).save({ default_status: '201' }, lida);
    const reler = await vi.waitFor(() =>
      http.expectOne((r) => r.method === 'GET' && r.url === URL),
    );
    reler.flush(token({ schema: { type: 'object' }, default_status: 200 }));
    const put = await vi.waitFor(() => http.expectOne((r) => r.method === 'PUT' && r.url === URL));
    put.flush(token({ schema: { type: 'object' }, default_status: 201 }));
    await saved;

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
