import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TOKEN_ID } from '../../testing/fixtures';
import { UrlLock, urlDraftKey, urlLockInterceptor } from './url-lock';

const PROTEGIDA = { error: 'This URL is protected', protected: true };
const NAO_AUTORIZADO = { status: 401, statusText: 'Unauthorized' };

describe('Dado o interceptador das chamadas da URL', () => {
  let http: HttpTestingController;
  let lock: UrlLock;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([urlLockInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    lock = TestBed.inject(UrlLock);
  });

  afterEach(() => http.verify());

  /** Faz a chamada, responde com `body`/`init` e devolve se ela falhou. */
  const call = async (method: 'GET' | 'POST', url: string, body: object, init?: object) => {
    const client = TestBed.inject(HttpClient);
    const pending = firstValueFrom(
      method === 'GET' ? client.get(url) : client.post(url, { secret: 'x' }),
    ).catch(() => 'falhou');
    http.expectOne(url).flush(body, init);
    return pending;
  };

  it.each([
    ['o token', `/token/${TOKEN_ID}`],
    ['as mensagens', `/token/${TOKEN_ID}/requests?page=1&sorting=newest`],
    ['as regras', `/token/${TOKEN_ID}/rules`],
    ['os links compartilhados', `/token/${TOKEN_ID}/shares`],
  ])('deve trancar a tela na URL Quando %s volta 401 protegida', async (_caso, url) => {
    expect(await call('GET', url, PROTEGIDA, NAO_AUTORIZADO)).toBe('falhou');

    expect(lock.tokenId()).toBe(TOKEN_ID);
  });

  it.each([
    ['o 401 não diz que a URL é protegida', `/token/${TOKEN_ID}`, { error: 'x' }, NAO_AUTORIZADO],
    ['é 404', `/token/${TOKEN_ID}`, PROTEGIDA, { status: 404, statusText: 'Not Found' }],
    ['é o próprio unlock (segredo errado)', `/token/${TOKEN_ID}/unlock`, PROTEGIDA, NAO_AUTORIZADO],
    ['é o lock', `/token/${TOKEN_ID}/lock`, PROTEGIDA, NAO_AUTORIZADO],
    ['é o link público', '/share/abc', PROTEGIDA, NAO_AUTORIZADO],
  ])('não deve trancar Quando %s', async (_caso, url, body, init) => {
    const method = url.endsWith('lock') ? 'POST' : 'GET';

    await call(method, url, body, init);

    expect(lock.tokenId()).toBeNull();
  });

  it('não deve trancar Quando a chamada dá certo', async () => {
    await call('GET', `/token/${TOKEN_ID}`, {});

    expect(lock.tokenId()).toBeNull();
  });

  it('deve apagar os rascunhos da URL (e só os dela) Quando a URL tranca (E-04)', () => {
    sessionStorage.setItem(urlDraftKey(TOKEN_ID, 'rule:r1'), '{}');
    sessionStorage.setItem(urlDraftKey(TOKEN_ID, 'rule:new'), '{}');
    sessionStorage.setItem(urlDraftKey('outra', 'rule:r1'), '{}');

    lock.lock(TOKEN_ID);

    expect(sessionStorage.getItem(urlDraftKey(TOKEN_ID, 'rule:r1'))).toBeNull();
    expect(sessionStorage.getItem(urlDraftKey(TOKEN_ID, 'rule:new'))).toBeNull();
    expect(sessionStorage.getItem(urlDraftKey('outra', 'rule:r1'))).toBe('{}');
    sessionStorage.clear();
  });
});
