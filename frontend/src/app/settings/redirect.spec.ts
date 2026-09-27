import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { Preferences } from './preferences';
import { Redirector, buildRedirect } from './redirect';

const settings = { url: 'http://destino', method: null, contentType: null, headers: null };

describe('Dado o reenvio de uma mensagem pelo navegador', () => {
  it('deve levar o caminho depois do UUID e a query Quando a mensagem veio em /{uuid}/a/b?x=1', () => {
    const request = webhookRequest(1, { url: `http://localhost:8084/${TOKEN_ID}/a/b?x=1` });

    expect(buildRedirect(request, settings).url).toBe('http://destino/a/b?x=1');
  });

  it('deve usar o método da mensagem e text/plain Quando método e content-type estão vazios', () => {
    const call = buildRedirect(webhookRequest(1, { method: 'PATCH' }), { ...settings, method: '' });

    expect(call.method).toBe('PATCH');
    expect(call.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(call.body).toBe('{"n":1}');
  });

  it('deve repassar só os headers listados que a mensagem tem Quando a lista tem vírgulas sobrando', () => {
    const request = webhookRequest(1, { headers: { 'x-token': ['a', 'b'], referer: ['r'] } });

    const call = buildRedirect(request, {
      ...settings,
      headers: 'x-token,,ausente,',
      contentType: 'app/x',
    });

    expect(call.headers).toEqual({ 'Content-Type': 'app/x', 'x-token': 'a,b' });
  });
});

describe('Dado o Redirector com a URL de destino configurada', () => {
  let http: HttpTestingController;
  let snackBar: MatSnackBar;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snackBar = TestBed.inject(MatSnackBar);
    TestBed.inject(Preferences).redirectUrl.set('http://destino');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve enviar a mensagem e avisar o status Quando o destino responde 200', async () => {
    const open = vi.spyOn(snackBar, 'open');
    const done = TestBed.inject(Redirector).redirect(webhookRequest(1, { method: 'PUT' }));

    const call = http.expectOne('http://destino');
    call.flush('ok', { status: 200, statusText: 'OK' });
    await done;

    expect(call.request.method).toBe('PUT');
    expect(call.request.body).toBe('{"n":1}');
    expect(open).toHaveBeenCalledWith(
      'Redirected request to http://destino. Status: OK',
      undefined,
      { duration: 4000 },
    );
  });

  it('deve avisar o erro por 5 s Quando o destino falha', async () => {
    const open = vi.spyOn(snackBar, 'open');
    const done = TestBed.inject(Redirector).redirect(webhookRequest(1));

    http.expectOne('http://destino').flush('x', { status: 502, statusText: 'Bad Gateway' });
    await done;

    expect(open).toHaveBeenCalledWith(
      'Error redirecting request to http://destino. Status: Bad Gateway',
      undefined,
      { duration: 5000 },
    );
  });
});
