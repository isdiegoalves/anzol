import { TestBed } from '@angular/core/testing';
import { Subscription } from 'rxjs';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID } from '../../testing/fixtures';
import { RESTORED_NOTE_MS } from './connection-store';
import { RequestStream } from './request-stream';
import { StorageNotice } from './storage-store';

describe('Dado o aviso do armazenamento do servidor', () => {
  let subscriptions: Subscription;
  let storage: StorageNotice;

  const said = (full: boolean, since = '2026-10-13 13:17:22') => {
    FakeEventSource.latest().emit('storage', { full, since });
    TestBed.tick();
  };
  const localTime = (since: string) =>
    new Date(`${since.replace(' ', 'T')}Z`).toLocaleTimeString('en', {
      hour: '2-digit',
      minute: '2-digit',
    });

  beforeEach(() => {
    vi.useFakeTimers();
    subscriptions = new Subscription();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    storage = TestBed.inject(StorageNotice);
    subscriptions.add(TestBed.inject(RequestStream).connect(TOKEN_ID).subscribe());
    FakeEventSource.latest().open();
    TestBed.tick();
  });

  afterEach(() => {
    subscriptions.unsubscribe();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('deve começar sem aviso', () => {
    expect(storage.full()).toBe(false);
    expect(storage.notice()).toBe('');
  });

  it('deve dizer desde que hora local o armazenamento está cheio Quando o servidor avisa', () => {
    said(true, '2026-10-13 13:17:22');

    expect(storage.full()).toBe(true);
    expect(storage.notice()).toBe(
      `Storage is full since ${localTime('2026-10-13 13:17:22')}: new requests are being refused.`,
    );
  });

  it('deve dizer "Storing again." por 5 s e depois calar Quando o servidor volta a gravar', () => {
    said(true);

    said(false);

    expect(storage.full()).toBe(false);
    expect(storage.notice()).toBe('Storing again.');
    vi.advanceTimersByTime(RESTORED_NOTE_MS);
    expect(storage.notice()).toBe('');
  });

  it('não deve dizer nada Quando o servidor diz que há espaço sem ter estado cheio', () => {
    said(false);

    expect(storage.notice()).toBe('');
  });

  it('deve manter a frase do cheio Quando ele enche de novo antes de a frase da volta sair', () => {
    said(true);
    said(false);

    said(true, '2026-10-13 14:00:00');
    vi.advanceTimersByTime(RESTORED_NOTE_MS);

    expect(storage.notice()).toBe(
      `Storage is full since ${localTime('2026-10-13 14:00:00')}: new requests are being refused.`,
    );
  });

  it('deve dizer a volta Quando a conexão reabre e o servidor manda o ping sem dizer que segue cheio', () => {
    said(true);

    TestBed.inject(RequestStream).retry();
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('ping', 15);
    TestBed.tick();

    expect(storage.notice()).toBe('Storing again.');
  });

  it('não deve repetir a frase Quando a conexão reabre e o servidor diz, antes do ping, que segue cheio', () => {
    said(true, '2026-10-13 13:17:22');
    const before = storage.notice();

    TestBed.inject(RequestStream).retry();
    FakeEventSource.latest().open();
    FakeEventSource.latest().emit('storage', { full: true, since: '2026-10-13 13:17:22' });
    FakeEventSource.latest().emit('ping', 15);
    TestBed.tick();

    expect(storage.full()).toBe(true);
    expect(storage.notice()).toBe(before);
  });
});
