import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { TokenStore } from './token-store';

describe('Dado o TokenStore falando com /token', () => {
  let http: HttpTestingController;
  let store: TokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TokenStore);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve guardar o token e montar a URL do webhook Quando GET /token/{id} responde', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}`).flush(token());
    await loaded;

    expect(store.token()).toEqual(token());
    expect(store.webhookUrl()).toBe(`${location.protocol}//${location.host}/${TOKEN_ID}`);
    expect(JSON.parse(localStorage.getItem('token') ?? 'null')).toEqual(token());
  });

  it('deve rejeitar com o 410 e esquecer o token Quando a URL não existe mais', async () => {
    TestBed.inject(Preferences).token.set(token());
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}`)
      .flush({ success: false }, { status: 410, statusText: 'Gone' });

    await expect(loaded).rejects.toThrow(HttpErrorResponse);
    expect(store.token()).toBeNull();
  });

  it('deve enviar só os campos preenchidos Quando cria uma URL personalizada', async () => {
    const created = store.create({ default_status: '404', timeout: '0' });
    const call = http.expectOne('/token');
    call.flush(token({ default_status: 404 }));

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual({ default_status: '404', timeout: '0' });
    expect((await created).default_status).toBe(404);
  });

  it('deve guardar o token devolvido pelo servidor, e não o enviado, Quando a URL é editada', async () => {
    TestBed.inject(Preferences).token.set(token({ retry_after: '120' }));
    const updated = store.update(TOKEN_ID, { retry_after: '007' });
    const call = http.expectOne(`/token/${TOKEN_ID}`);
    call.flush(token({ retry_after: 7 }));
    await updated;

    expect(call.request.body).toEqual({ retry_after: '007' });
    expect(store.token()?.retry_after).toBe(7);
  });

  it('deve refletir o valor devolvido pelo servidor Quando o CORS é alternado (regressão do C2)', async () => {
    TestBed.inject(Preferences).token.set(token({ cors: false }));
    const toggled = store.toggleCors(TOKEN_ID);
    const call = http.expectOne(`/token/${TOKEN_ID}/cors/toggle`);
    call.flush({ enabled: true });

    expect(call.request.method).toBe('PUT');
    expect(await toggled).toBe(true);
    expect(store.token()?.cors).toBe(true);
    expect(store.token()).not.toHaveProperty('actions');
  });
});
