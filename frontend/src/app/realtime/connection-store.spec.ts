import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID } from '../../testing/fixtures';
import {
  Connection,
  QUIET_DROP_MS,
  RESTORED_NOTE_MS,
  connectionInterceptor,
} from './connection-store';
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

  it('deve reabrir o tempo real e dizer "Connected again." por 5 s só Quando ele abre, depois de "Try again now" dar certo', async () => {
    const opened = TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe();
    FakeEventSource.latest().open();
    TestBed.tick();
    failCall();
    const notice = connection.notice();

    const retry = connection.retry();
    http.expectOne(`/token/${TOKEN_ID}`).flush('{}');
    await retry;

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].readyState).toBe(FakeEventSource.CLOSED);
    TestBed.tick();
    expect(connection.notice()).toBe(notice);
    expect(connection.downSince()).not.toBeNull();

    FakeEventSource.latest().open();
    TestBed.tick();
    expect(connection.downSince()).toBeNull();
    expect(connection.notice()).toBe('Connected again.');

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

  describe('Dado o tempo real fora de "Live" (regra dos 5 s)', () => {
    let opened: Subscription;
    const source = () => FakeEventSource.latest();
    const settle = async (ms = 0) => {
      await vi.advanceTimersByTimeAsync(ms);
      TestBed.tick();
    };

    beforeEach(async () => {
      opened = TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe();
      source().open();
      await settle();
    });

    afterEach(() => opened.unsubscribe());

    it('não deve mostrar a faixa nem falar Quando ele volta antes de 5 s', async () => {
      source().fail(FakeEventSource.CONNECTING);
      await settle(QUIET_DROP_MS - 1);
      source().open();
      await settle(10_000);

      expect(connection.downSince()).toBeNull();
      expect(connection.notice()).toBe('');
    });

    it('deve mostrar a faixa e dizer uma vez que a atualização ao vivo caiu Quando passa de 5 s', async () => {
      source().fail(FakeEventSource.CONNECTING);
      await settle(QUIET_DROP_MS - 1);
      expect(connection.downSince()).toBeNull();
      await settle(1);

      expect(connection.downSince()).not.toBeNull();
      expect(connection.notice()).toBe('Live updates dropped; reconnecting.');
      expect(connection.countdown()).toBe(5);
    });

    it('deve dizer desde quando não há sinal Quando o stream emudece sem fechar', async () => {
      await settle(35_000);
      await settle(QUIET_DROP_MS);

      expect(connection.notice()).toMatch(
        /^No signal from the server since \d{1,2}:\d{2}.*\. The list may be incomplete\.$/,
      );
    });

    it('deve reabrir o stream em "Try again now", sem provar a volta pela API, e falar só quando ele abre', async () => {
      source().fail(FakeEventSource.CONNECTING);
      await settle(QUIET_DROP_MS);
      const notice = connection.notice();
      const antes = FakeEventSource.instances.length;

      await connection.retry();
      await settle();

      http.expectNone(`/token/${TOKEN_ID}`);
      expect(FakeEventSource.instances).toHaveLength(antes + 1);
      expect(connection.notice()).toBe(notice);
      expect(connection.countdown()).toBe(10);
      source().open();
      await settle();
      expect(connection.downSince()).toBeNull();
      expect(connection.notice()).toBe('Connected again.');
    });
  });

  describe('Dado a Entrada, que retoma o que chegou a cada vez que o tempo real abre', () => {
    const reopen = async (recovered: number) => {
      const resume = vi.fn().mockResolvedValue(recovered);
      const opened = TestBed.inject(RequestStream).connect(TOKEN_ID, { resume }).subscribe();
      FakeEventSource.latest().open();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();
      return { resume, opened };
    };

    it('deve dizer numa fala quantas chegaram Quando a queda foi curta, sem faixa', async () => {
      const { resume, opened } = await reopen(0);

      resume.mockResolvedValue(3);
      FakeEventSource.latest().fail(FakeEventSource.CONNECTING);
      TestBed.tick();
      FakeEventSource.latest().open();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      expect(connection.downSince()).toBeNull();
      expect(connection.notice()).toBe('3 requests arrived during a brief connection drop.');
      opened.unsubscribe();
    });

    it('não deve dizer nada Quando a queda curta não perdeu nada', async () => {
      const { opened } = await reopen(0);

      FakeEventSource.latest().fail(FakeEventSource.CONNECTING);
      TestBed.tick();
      FakeEventSource.latest().open();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      expect(connection.notice()).toBe('');
      opened.unsubscribe();
    });

    it('deve dizer "Connected again." com quantas chegaram Quando a queda teve faixa', async () => {
      const { resume, opened } = await reopen(0);
      resume.mockResolvedValue(1);
      FakeEventSource.latest().fail(FakeEventSource.CONNECTING);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(QUIET_DROP_MS);
      expect(connection.downSince()).not.toBeNull();

      FakeEventSource.latest().open();
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      expect(connection.downSince()).toBeNull();
      expect(connection.notice()).toBe('Connected again. 1 request arrived meanwhile.');
      opened.unsubscribe();
    });
  });
});
