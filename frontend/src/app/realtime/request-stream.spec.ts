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

  it('não deve mexer no estado do cabeçalho ("Live") Quando quem assina é a tela de Regras (quiet)', () => {
    const received: RequestCreated[] = [];
    const subscription = stream
      .connect(TOKEN_ID, { quiet: true })
      .subscribe((event) => received.push(event));
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('request.created', { request: webhookRequest(1), total: 1 });

    expect(stream.status()).toBe('idle');
    expect(received).toHaveLength(1);
    subscription.unsubscribe();
    expect(FakeEventSource.latest().readyState).toBe(FakeEventSource.CLOSED);
    expect(stream.status()).toBe('idle');
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

  describe('Dado mais de um assinante da mesma URL (o shell, a Entrada, Regras)', () => {
    it('deve abrir uma conexão só, entregar a todos e fechá-la com o último', () => {
      const received: string[] = [];
      const shell = stream.connect(TOKEN_ID).subscribe(() => received.push('shell'));
      const inbox = stream.connect(TOKEN_ID).subscribe(() => received.push('inbox'));
      const rules = stream
        .connect(TOKEN_ID, { quiet: true })
        .subscribe(() => received.push('rules'));
      expect(FakeEventSource.instances).toHaveLength(1);
      const source = FakeEventSource.latest();
      source.open();

      source.emit('request.created', { request: webhookRequest(1), total: 1 });
      expect(received).toEqual(['shell', 'inbox', 'rules']);

      inbox.unsubscribe();
      expect(source.readyState).toBe(FakeEventSource.OPEN);
      expect(stream.status()).toBe('open');
      shell.unsubscribe();
      // Só o assinante calado ficou: a conexão segue, e o "Live" do cabeçalho apaga.
      expect(source.readyState).toBe(FakeEventSource.OPEN);
      expect(stream.status()).toBe('idle');
      rules.unsubscribe();
      expect(source.readyState).toBe(FakeEventSource.CLOSED);
    });

    it('deve mostrar o estado de agora a quem assina uma conexão já aberta', () => {
      subscriptions.add(stream.connect(TOKEN_ID, { quiet: true }).subscribe());
      FakeEventSource.latest().open();
      expect(stream.status()).toBe('idle');

      subscriptions.add(stream.connect(TOKEN_ID).subscribe());

      expect(stream.status()).toBe('open');
    });
  });

  it('deve contar as quedas seguidas e zerar Quando a conexão abre', () => {
    subscriptions.add(stream.connect(TOKEN_ID).subscribe());
    const source = FakeEventSource.latest();

    source.fail(FakeEventSource.CONNECTING);
    source.fail(FakeEventSource.CONNECTING);
    expect(stream.drops()).toBe(2);
    source.open();
    expect(stream.drops()).toBe(0);
    // O servidor recusar não é queda de rede.
    source.fail(FakeEventSource.CLOSED);
    expect(stream.drops()).toBe(0);
  });

  it('deve abrir de novo a conexão, para os mesmos assinantes, Quando "retry" é pedido', () => {
    const received: RequestCreated[] = [];
    subscriptions.add(stream.connect(TOKEN_ID).subscribe((event) => received.push(event)));
    const old = FakeEventSource.latest();
    old.fail(FakeEventSource.CONNECTING);

    stream.retry();

    expect(old.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(stream.status()).toBe('connecting');
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('request.created', { request: webhookRequest(1), total: 1 });
    expect(stream.status()).toBe('open');
    expect(received).toHaveLength(1);
    // A conexão antiga, já trocada, não mexe mais no estado.
    old.fail(FakeEventSource.CONNECTING);
    expect(stream.status()).toBe('open');
  });

  it('deve fechar a conexão Quando a assinatura é cancelada', () => {
    const subscription = stream.connect(TOKEN_ID).subscribe();
    const source = FakeEventSource.latest();

    subscription.unsubscribe();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    expect(stream.status()).toBe('idle');
  });
});
