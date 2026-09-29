import { TestBed } from '@angular/core/testing';
import { KNOWN_URLS_KEY, KnownUrls } from './known-urls';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

const stored = () => JSON.parse(localStorage.getItem(KNOWN_URLS_KEY) ?? 'null') as unknown;

describe('Dado as URLs que este navegador conhece (anzol.urls)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('deve migrar a URL que a tela já guardava como o primeiro item, na primeira carga', () => {
    localStorage.setItem('token', JSON.stringify({ uuid: A, default_status: 200 }));

    const known = TestBed.inject(KnownUrls);

    expect(known.urls()).toEqual([{ uuid: A, nickname: '', openedAt: '2026-09-28T12:00:00.000Z' }]);
    expect(stored()).toEqual(known.urls());
  });

  it('não deve migrar de novo Quando a lista já existe, mesmo vazia', () => {
    localStorage.setItem('token', JSON.stringify({ uuid: A }));
    localStorage.setItem(KNOWN_URLS_KEY, '[]');

    expect(TestBed.inject(KnownUrls).urls()).toEqual([]);
  });

  it('deve pôr na frente a URL aberta agora, mantendo o apelido dela', () => {
    const known = TestBed.inject(KnownUrls);
    known.opened(A);
    known.rename(A, 'Pagamentos');
    vi.setSystemTime(new Date('2026-09-28T12:05:00Z'));
    known.opened(B);
    vi.setSystemTime(new Date('2026-09-28T12:10:00Z'));

    known.opened(A);

    expect(known.urls().map((url) => [url.uuid, url.nickname])).toEqual([
      [A, 'Pagamentos'],
      [B, ''],
    ]);
    expect(stored()).toEqual(known.urls());
  });

  it('deve dizer o apelido ou, sem ele, "URL" e os 5 primeiros do UUID', () => {
    const known = TestBed.inject(KnownUrls);
    known.opened(A);

    expect(known.nameOf(A)).toBe('URL aaaaa');
    known.rename(A, '  Pagamentos  ');
    expect(known.nameOf(A)).toBe('Pagamentos');
    known.rename(A, 'x'.repeat(60));
    expect(known.nicknameOf(A)).toHaveLength(40);
    known.rename(A, ' ');
    expect(known.nameOf(A)).toBe('URL aaaaa');
  });

  it('deve guardar até 50, e a de abertura mais antiga sai', () => {
    const known = TestBed.inject(KnownUrls);
    for (let n = 0; n < 51; n++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 28, 12, 0, n)));
      known.opened(`${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`);
    }

    expect(known.urls()).toHaveLength(50);
    expect(known.urls().at(-1)?.uuid.startsWith('00000001')).toBe(true);
    expect(known.urls()[0].uuid.startsWith('00000050')).toBe(true);
  });

  it('deve esquecer as escolhidas, ou todas, sem tocar no servidor', () => {
    const known = TestBed.inject(KnownUrls);
    known.opened(A);
    known.opened(B);

    known.forget([A]);
    expect(known.urls().map((url) => url.uuid)).toEqual([B]);

    known.forgetAll();
    expect(stored()).toEqual([]);
  });

  it('deve ignorar o que não é uma lista de URLs no storage', () => {
    localStorage.setItem(KNOWN_URLS_KEY, JSON.stringify([{ uuid: A }, 'x', null]));

    expect(TestBed.inject(KnownUrls).urls()).toEqual([]);
  });

  it('deve funcionar só na memória, e dizer que não guarda, Quando o storage recusa gravar', () => {
    const known = TestBed.inject(KnownUrls);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    known.opened(A);

    expect(known.available()).toBe(false);
    expect(known.urls().map((url) => url.uuid)).toEqual([A]);
  });
});
