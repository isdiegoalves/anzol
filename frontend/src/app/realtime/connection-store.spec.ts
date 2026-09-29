import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID } from '../../testing/fixtures';
import { Connection, RESTORED_NOTE_MS, connectionInterceptor } from './connection-store';
import { RequestStream } from './request-stream';

describe('Dado a conexão com o servidor', () => {
  let http: HttpTestingController;
  let connection: Connection;

  const networkError = () => new ProgressEvent('error');
  const failCall = (url = '/token/abc/requests') => {
    TestBed.inject(HttpClient)
      .get(url)
      .subscribe({ error: () => undefined });
    http.expectOne(url).error(networkError());
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([connectionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    connection = TestBed.inject(Connection);
    connection.probe.set(`/token/${TOKEN_ID}`);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('deve começar com conexão e a região vazia', () => {
    expect(connection.downSince()).toBeNull();
    expect(connection.notice()).toBe('');
  });

  it('deve dizer uma vez desde quando, sem instrução de operador, Quando uma chamada falha por rede', () => {
    failCall();

    expect(connection.downSince()).not.toBeNull();
    const notice = connection.notice();
    expect(notice).toMatch(
      /^No connection to the server since \d{1,2}:\d{2}.*\. What you typed is kept\.$/,
    );
    expect(notice).not.toMatch(/docker|ANZOL_|compose/i);
    expect(connection.countdown()).toBe(5);

    const since = connection.downSince();
    failCall('/token/abc');
    expect(connection.downSince()).toBe(since);
    expect(connection.notice()).toBe(notice);
  });

  it('não deve contar como queda a resposta com status (404, 500)', () => {
    TestBed.inject(HttpClient)
      .get('/token/abc')
      .subscribe({ error: () => undefined });
    http.expectOne('/token/abc').flush(null, { status: 500, statusText: 'Server Error' });

    expect(connection.downSince()).toBeNull();
  });

  it('deve contar os segundos e tentar de novo sozinha, esperando mais a cada falha', async () => {
    failCall();

    await vi.advanceTimersByTimeAsync(4000);
    expect(connection.countdown()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    http.expectOne(`/token/${TOKEN_ID}`).error(networkError());
    await vi.advanceTimersByTimeAsync(0);

    expect(connection.downSince()).not.toBeNull();
    expect(connection.countdown()).toBe(10);
  });

  it('deve dizer "Connected again." por 5 s, reabrir o tempo real e avisar quem relê Quando "Try again now" dá certo', async () => {
    const opened = TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe();
    failCall();
    const notice = connection.notice();

    const retry = connection.retry();
    http.expectOne(`/token/${TOKEN_ID}`).flush('{}');
    await retry;

    expect(connection.downSince()).toBeNull();
    expect(connection.notice()).toBe('Connected again.');
    expect(connection.notice()).not.toBe(notice);
    expect(connection.restored()).toBe(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED);

    await vi.advanceTimersByTimeAsync(RESTORED_NOTE_MS);
    expect(connection.notice()).toBe('');
    // Sem conexão caída, a contagem não volta.
    await vi.advanceTimersByTimeAsync(30_000);
    http.expectNone(`/token/${TOKEN_ID}`);
    opened.unsubscribe();
  });

  it('deve contar como volta a resposta com status (a URL trancada responde 401)', async () => {
    failCall();

    const retry = connection.retry();
    http
      .expectOne(`/token/${TOKEN_ID}`)
      .flush({ protected: true }, { status: 401, statusText: 'Unauthorized' });
    await retry;

    expect(connection.downSince()).toBeNull();
    expect(connection.notice()).toBe('Connected again.');
  });

  it('deve contar como queda o tempo real que cai e não volta na primeira reconexão', () => {
    const opened = TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe();
    const source = FakeEventSource.latest();
    source.open();

    source.fail(FakeEventSource.CONNECTING);
    TestBed.tick();
    expect(connection.downSince()).toBeNull();

    source.fail(FakeEventSource.CONNECTING);
    TestBed.tick();
    expect(connection.downSince()).not.toBeNull();
    opened.unsubscribe();
  });

  it('não deve contar como queda o tempo real que cai e volta', () => {
    const opened = TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe();
    const source = FakeEventSource.latest();

    source.fail(FakeEventSource.CONNECTING);
    source.open();
    source.fail(FakeEventSource.CONNECTING);
    TestBed.tick();

    expect(connection.downSince()).toBeNull();
    opened.unsubscribe();
  });
});
