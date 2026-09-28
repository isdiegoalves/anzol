import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { UrlMissing, urlMissingInterceptor } from './url-missing';

describe('Dado uma chamada à API de uma URL que não existe (B1)', () => {
  let http: HttpClient;
  let server: HttpTestingController;
  let missing: UrlMissing;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([urlMissingInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    server = TestBed.inject(HttpTestingController);
    missing = TestBed.inject(UrlMissing);
  });

  afterEach(() => server.verify());

  const call = (method: string, url: string, status: number) => {
    http.request(method, url).subscribe({ error: () => undefined });
    server.expectOne(url).flush({}, { status, statusText: 'x' });
  };

  it.each([
    ['GET', `/token/${TOKEN_ID}`, 410],
    ['GET', `/token/${TOKEN_ID}`, 404],
    ['GET', `/token/${TOKEN_ID}/rules`, 410],
    ['GET', `/token/${TOKEN_ID}/requests?page=1`, 410],
    ['PUT', `/token/${TOKEN_ID}`, 410],
  ])('deve marcar a URL como inexistente Quando %s %s responde %i', (method, url, status) => {
    call(method, url, status);

    expect(missing.missing()).toEqual({ id: TOKEN_ID, reason: 'gone' });
  });

  it.each([
    ['GET', `/token/${TOKEN_ID}/request/abc`, 404, 'a requisição que sumiu não é a URL'],
    ['GET', `/token/${TOKEN_ID}`, 500, 'erro do servidor não é "não existe"'],
    ['GET', `/token/${TOKEN_ID}`, 401, 'URL trancada não é "não existe"'],
    ['DELETE', `/token/${TOKEN_ID}`, 410, 'quem apaga já sabe'],
    ['GET', `/share/${TOKEN_ID}`, 410, 'não é rota de URL'],
  ])('não deve marcar Quando %s %s responde %i (%s)', (method, url, status) => {
    call(method, url, status);

    expect(missing.missing()).toBeNull();
  });

  it('deve limpar só a URL pedida, ou qualquer uma', () => {
    missing.mark(TOKEN_ID);

    missing.clear('outra');
    expect(missing.missing()?.id).toBe(TOKEN_ID);
    missing.clear(TOKEN_ID);
    expect(missing.missing()).toBeNull();

    missing.mark('xyz', 'malformed');
    missing.clear();
    expect(missing.missing()).toBeNull();
  });
});
