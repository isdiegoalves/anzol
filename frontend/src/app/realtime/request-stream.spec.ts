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
    ['recusa (502 ou 503 de um proxy)', FakeEventSource.CLOSED],
    ['cai e o navegador vai reconectar', FakeEventSource.CONNECTING],
  ])('deve ficar "reconnecting" Quando o servidor %s', (_caso, readyState) => {
    subscriptions.add(stream.connect(TOKEN_ID).subscribe());

    FakeEventSource.latest().fail(readyState);

    expect(stream.status()).toBe('reconnecting');
  });

  it('deve reabrir sozinha a conexão recusada, esperando 5, 10, 20 e 30 s, e recomeçar Quando ela abre', () => {
    vi.useFakeTimers();
    try {
      subscriptions.add(stream.connect(TOKEN_ID).subscribe());
      const espera = (segundos: number) => {
        FakeEventSource.latest().fail(FakeEventSource.CLOSED);
        const antes = FakeEventSource.instances.length;
        vi.advanceTimersByTime(segundos * 1000 - 1);
        expect(FakeEventSource.instances).toHaveLength(antes);
        vi.advanceTimersByTime(1);
        expect(FakeEventSource.instances).toHaveLength(antes + 1);
        expect(stream.status()).toBe('reconnecting');
      };

      for (const segundos of [5, 10, 20, 30, 30]) {
        espera(segundos);
      }
      FakeEventSource.latest().open();
      expect(stream.status()).toBe('open');
      espera(5);
    } finally {
      vi.useRealTimers();
    }
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

  it('deve abrir de novo a conexão, para os mesmos assinantes, Quando "retry" é pedido', () => {
    const received: RequestCreated[] = [];
    subscriptions.add(stream.connect(TOKEN_ID).subscribe((event) => received.push(event)));
    const old = FakeEventSource.latest();
    old.fail(FakeEventSource.CONNECTING);

    stream.retry();

    expect(old.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(2);
    // A nova tentativa de uma conexão que caiu segue reconectando, e não "abrindo pela primeira vez".
    expect(stream.status()).toBe('reconnecting');
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('request.created', { request: webhookRequest(1), total: 1 });
    expect(stream.status()).toBe('open');
    expect(received).toHaveLength(1);
    // A conexão antiga, já trocada, não mexe mais no estado.
    old.fail(FakeEventSource.CONNECTING);
    expect(stream.status()).toBe('open');
  });

  it('deve fechar a conexão aberta e abrir outra, já em "reconnecting", retomando o que chegou, Quando a tela duvida dela', async () => {
    const resume = vi.fn().mockResolvedValue(0);
    subscriptions.add(stream.connect(TOKEN_ID, { resume }).subscribe());
    const old = FakeEventSource.latest();
    old.open();
    await vi.waitFor(() => expect(stream.status()).toBe('open'));
    resume.mockResolvedValue(2);

    stream.doubt();

    expect(old.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(stream.status()).toBe('reconnecting');
    FakeEventSource.latest().open();
    await vi.waitFor(() => expect(stream.status()).toBe('open'));
    expect(resume).toHaveBeenCalledTimes(2);
    expect(stream.recovered()).toBe(2);
  });

  it('não deve mexer na conexão que ainda abre, nem na que já reconecta, Quando a tela duvida dela', () => {
    subscriptions.add(stream.connect(TOKEN_ID).subscribe());

    stream.doubt();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream.status()).toBe('connecting');
    FakeEventSource.latest().open();
    FakeEventSource.latest().fail(FakeEventSource.CONNECTING);
    stream.doubt();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream.status()).toBe('reconnecting');
  });

  describe('Dado uma conexão aberta que para de receber sem fechar', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('deve dizer "silent" e reabrir Quando passam dois heartbeats e a folga sem sinal', () => {
      subscriptions.add(stream.connect(TOKEN_ID).subscribe());
      const old = FakeEventSource.latest();
      old.open();

      vi.advanceTimersByTime(35_000 - 1);
      expect(stream.status()).toBe('open');
      vi.advanceTimersByTime(1);

      expect(stream.status()).toBe('silent');
      expect(old.readyState).toBe(FakeEventSource.CLOSED);
      expect(FakeEventSource.instances).toHaveLength(2);
      FakeEventSource.latest().open();
      expect(stream.status()).toBe('open');
    });

    it('deve vigiar pelo intervalo que o ping diz, recomeçando a cada sinal', () => {
      subscriptions.add(stream.connect(TOKEN_ID).subscribe());
      const source = FakeEventSource.latest();
      source.open();
      source.emit('ping', 0.2);

      vi.advanceTimersByTime(5000);
      source.emit('request.created', { request: webhookRequest(1), total: 1 });
      vi.advanceTimersByTime(5000);
      source.emit('ping', 0.2);
      vi.advanceTimersByTime(5399);
      expect(stream.status()).toBe('open');
      vi.advanceTimersByTime(1);

      expect(stream.status()).toBe('silent');
    });

    it('deve reabrir de novo Quando a nova conexão também fica muda, sem abrir', () => {
      subscriptions.add(stream.connect(TOKEN_ID).subscribe());
      FakeEventSource.latest().open();

      vi.advanceTimersByTime(35_000);
      vi.advanceTimersByTime(35_000);

      expect(FakeEventSource.instances).toHaveLength(3);
      expect(stream.status()).toBe('silent');
    });
  });

  describe('Dado quem retoma o que chegou fora do tempo real (a Entrada)', () => {
    it('deve retomar a cada abertura e só ficar "open" com a retomada terminada', async () => {
      let terminar!: (count: number) => void;
      const resume = vi.fn(() => new Promise<number>((ok) => (terminar = ok)));
      subscriptions.add(stream.connect(TOKEN_ID, { resume }).subscribe());
      const source = FakeEventSource.latest();
      source.open();
      expect(resume).toHaveBeenCalledTimes(1);
      expect(stream.status()).toBe('connecting');

      terminar(0);
      await vi.waitFor(() => expect(stream.status()).toBe('open'));
      source.fail(FakeEventSource.CONNECTING);
      source.open();

      expect(resume).toHaveBeenCalledTimes(2);
      expect(stream.status()).toBe('reconnecting');
      terminar(3);
      await vi.waitFor(() => expect(stream.status()).toBe('open'));
      expect(stream.recovered()).toBe(3);
    });

    it('deve retomar na hora Quando a assinatura chega com a conexão já aberta (o stream do shell)', () => {
      subscriptions.add(stream.connect(TOKEN_ID).subscribe());
      FakeEventSource.latest().open();
      const resume = vi.fn().mockResolvedValue(0);

      subscriptions.add(stream.connect(TOKEN_ID, { resume }).subscribe());

      expect(resume).toHaveBeenCalledTimes(1);
      expect(stream.status()).toBe('open');
    });

    it('não deve retomar por quem já saiu', () => {
      const resume = vi.fn().mockResolvedValue(0);
      const keep = stream.connect(TOKEN_ID).subscribe();
      stream.connect(TOKEN_ID, { resume }).subscribe().unsubscribe();

      FakeEventSource.latest().open();

      expect(resume).not.toHaveBeenCalled();
      expect(stream.status()).toBe('open');
      keep.unsubscribe();
    });
  });

  it('deve fechar a conexão Quando a assinatura é cancelada', () => {
    const subscription = stream.connect(TOKEN_ID).subscribe();
    const source = FakeEventSource.latest();

    subscription.unsubscribe();

    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    expect(stream.status()).toBe('idle');
  });
});
