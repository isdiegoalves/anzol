import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { UrlAccess } from './url-access';
import { UrlLock } from './url-lock';

describe('Dado o acesso a uma URL protegida', () => {
  let http: HttpTestingController;
  let access: UrlAccess;
  let lock: UrlLock;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    access = TestBed.inject(UrlAccess);
    lock = TestBed.inject(UrlLock);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve mandar o segredo e destrancar a tela Quando o unlock responde 204', async () => {
    lock.lock(TOKEN_ID);

    const done = access.unlock(TOKEN_ID, 'segredo-certo');
    const call = http.expectOne(`/token/${TOKEN_ID}/unlock`);
    call.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual({ secret: 'segredo-certo' });
    expect(lock.tokenId()).toBeNull();
  });

  it('deve repassar o erro e continuar trancada Quando o segredo está errado (401)', async () => {
    lock.lock(TOKEN_ID);

    const done = access.unlock(TOKEN_ID, 'errado');
    http
      .expectOne(`/token/${TOKEN_ID}/unlock`)
      .flush({ error: 'Wrong secret' }, { status: 401, statusText: 'Unauthorized' });

    await expect(done).rejects.toMatchObject({ status: 401 });
    expect(lock.tokenId()).toBe(TOKEN_ID);
  });

  it('deve apagar o cookie, esquecer a URL e trancar a tela Quando o lock é pedido', async () => {
    const preferences = TestBed.inject(Preferences);
    preferences.token.set(token({ protected: true }));

    const done = access.lock(TOKEN_ID);
    const call = http.expectOne(`/token/${TOKEN_ID}/lock`);
    call.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(call.request.method).toBe('POST');
    expect(preferences.token()).toBeNull();
    expect(lock.tokenId()).toBe(TOKEN_ID);
  });
});
