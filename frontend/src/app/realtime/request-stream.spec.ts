import { TestBed } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { RequestCreated } from '../requests/webhook-request';
import { RequestStream } from './request-stream';

describe('Dado o stream SSE de uma URL', () => {
  let subscriptions: Subscription;
  let stream: RequestStream;

  beforeEach(() => {
    subscriptions = new Subscription();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    stream = TestBed.inject(RequestStream);
  });

  afterEach(() => {
    subscriptions.unsubscribe();
    vi.unstubAllGlobals();
  });

  it('deve ficar parado (idle) Quando ninguém assina', () => {
    expect(stream.status()).toBe('idle');
  });

  it('deve abrir /token/{id}/stream e ficar conectado Quando alguém assina', () => {
    subscriptions.add(stream.connect(TOKEN_ID).subscribe());
    expect(stream.status()).toBe('connecting');

    FakeEventSource.latest().open();

    expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`);
    expect(stream.status()).toBe('open');
  });

  it('deve entregar cada request.created, sem perder o segundo, Quando dois chegam juntos', () => {
    const received: RequestCreated[] = [];
    subscriptions.add(stream.connect(TOKEN_ID).subscribe((event) => received.push(event)));
    const primeiro = { request: webhookRequest(1), total: 1, truncated: false };
    const segundo = { request: webhookRequest(2), total: 2, truncated: true };

    FakeEventSource.latest().emit('request.created', primeiro);
    FakeEventSource.latest().emit('request.created', segundo);

    expect(received).toEqual([primeiro, segundo]);
  });

  it.each([
    ['recusa (ex.: 404 no app atual)', FakeEventSource.CLOSED, 'closed'],
    ['cai e o navegador vai reconectar', FakeEventSource.CONNECTING, 'reconnecting'],
  ])('deve refletir o estado Quando o servidor %s', (_caso, readyState, esperado) => {
    subscriptions.add(stream.connect(TOKEN_ID).subscribe());

    FakeEventSource.latest().fail(readyState);

    expect(stream.status()).toBe(esperado);
  });

  it('deve fechar a conexão Quando a assinatura é cancelada', () => {
    const subscription = stream.connect(TOKEN_ID).subscribe();
    const source = FakeEventSource.latest();

    subscription.unsubscribe();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    expect(stream.status()).toBe('idle');
  });
});
