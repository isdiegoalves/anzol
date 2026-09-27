import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { UrlLock } from '../token/url-lock';
import { ChecksStore, jsonBody } from './checks-store';

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

    const saved = TestBed.inject(ChecksStore).save({ schema: { type: 'object' } });
    const put = http.expectOne(`/token/${TOKEN_ID}`);
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

    const saved = TestBed.inject(ChecksStore).save({ auto_cleanup: 1000 });
    http.expectOne(`/token/${TOKEN_ID}`).flush(token({ auto_cleanup: 1000 }));
    const reload = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests?page=1`));
    reload.flush(requestPage([R2], { total: 1 }));
    await saved;

    expect(TestBed.inject(RequestStore).requests()).toEqual([R2]);
  });

  it('não deve recarregar a lista Quando a limpeza é desligada', async () => {
    await loadList();
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: 500 }));

    const saved = TestBed.inject(ChecksStore).save({ auto_cleanup: null });
    http.expectOne(`/token/${TOKEN_ID}`).flush(token());
    await saved;

    http.expectNone(`/token/${TOKEN_ID}/requests?page=1`);
  });

  it('deve destrancar com o segredo novo Quando o segredo de leitura muda', async () => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));
    TestBed.inject(UrlLock).lock(TOKEN_ID);

    const saved = TestBed.inject(ChecksStore).save({ read_secret: 'segredo-novo' });
    http.expectOne(`/token/${TOKEN_ID}`).flush(token({ protected: true }));
    const unlock = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/unlock`));
    unlock.flush(null, { status: 204, statusText: 'No Content' });
    await saved;

    expect(unlock.request.body).toEqual({ secret: 'segredo-novo' });
    expect(TestBed.inject(UrlLock).tokenId()).toBeNull();
  });

  it('deve devolver o erro sem avisar Quando o PUT falha', async () => {
    TestBed.inject(Preferences).token.set(token());

    const saved = TestBed.inject(ChecksStore).save({ retry_after: 'x' });
    http
      .expectOne(`/token/${TOKEN_ID}`)
      .flush({ retry_after: ['bad'] }, { status: 422, statusText: 'Unprocessable Entity' });

    await expect(saved).rejects.toMatchObject({ status: 422 });
    expect(snack).not.toHaveBeenCalled();
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
