import { LiveAnnouncer } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { PendingDelete, UNDO_MS } from './pending-delete';
import { RequestStore } from './request-store';

describe('Dado o apagar de uma requisição, com o Undo', () => {
  let deleting: PendingDelete;
  let store: RequestStore;
  let http: HttpTestingController;
  const [first, second] = [webhookRequest(1), webhookRequest(2)];
  const deleteOf = (uuid: string) => ({
    method: 'DELETE',
    url: `/token/${TOKEN_ID}/request/${uuid}`,
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    deleting = TestBed.inject(PendingDelete);
    store = TestBed.inject(RequestStore);
    http = TestBed.inject(HttpTestingController);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([first, second]));
    await loaded;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('deve guardar o apagar pelo tempo do Undo e só então mandar ao servidor', async () => {
    deleting.delete(first);

    expect(store.requests()).toEqual([second]);
    expect(deleting.pending()).toEqual({ request: first, route: '/' });
    vi.advanceTimersByTime(UNDO_MS - 1);
    http.expectNone(deleteOf(first.uuid));

    vi.advanceTimersByTime(1);

    expect(deleting.pending()).toBeNull();
    await vi.waitFor(() => http.expectOne(deleteOf(first.uuid)).flush({}));
  });

  it('deve devolver a requisição e anunciar "Request restored." Quando o Undo é usado', async () => {
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    deleting.delete(first);

    deleting.undo();

    await vi.waitFor(() =>
      expect(announce.mock.calls).toEqual([['Request restored.', ANNOUNCEMENT_MS]]),
    );
    expect(store.requests()).toEqual([first, second]);
    expect(deleting.pending()).toBeNull();
    vi.advanceTimersByTime(UNDO_MS);
    http.expectNone(deleteOf(first.uuid));
  });

  it('deve mandar a primeira ao servidor e esvaziar o aviso por um quadro Quando outra é apagada', async () => {
    deleting.delete(first);

    deleting.delete(second);

    expect(deleting.pending()).toBeNull();
    TestBed.tick();
    expect(deleting.pending()?.request).toEqual(second);
    await vi.waitFor(() => http.expectOne(deleteOf(first.uuid)).flush({}));
    http.expectNone(deleteOf(second.uuid));
    deleting.undo();
  });

  it('deve calar o snackbar Quando o aviso da requisição está na tela, e falar por ele sem o aviso', () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    deleting.delete(first);
    deleting.undo();
    deleting.noticeShown.set(true);
    deleting.delete(second);
    deleting.undo();

    expect(open.mock.calls.map(([, , config]) => config?.politeness)).toEqual(['polite', 'off']);
  });

  it('deve tirar o snackbar da tela Quando o Undo vem pelo aviso da requisição', () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    deleting.delete(first);
    const dismiss = vi.spyOn(open.mock.results[0].value, 'dismiss');

    deleting.undo();

    expect(dismiss).toHaveBeenCalled();
  });
});
