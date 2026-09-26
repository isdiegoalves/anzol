import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from './request-store';
import { RequestPage } from './webhook-request';

const listUrl = `/token/${TOKEN_ID}/requests`;

describe('Dado o RequestStore da URL aberta', () => {
  let http: HttpTestingController;
  let store: RequestStore;

  const respond = async (action: Promise<void>, page: number, body: RequestPage) => {
    http.expectOne(`${listUrl}?page=${page}`).flush(body);
    await action;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  describe('Dado a primeira página carregada', () => {
    beforeEach(async () => {
      await respond(
        store.load(TOKEN_ID, 1),
        1,
        requestPage([webhookRequest(1), webhookRequest(2)], { total: 3, is_last_page: false }),
      );
    });

    it('deve expor lista, total e próxima página Quando a API diz que há mais', () => {
      expect(store.requests().map((r) => r.uuid)).toEqual([
        webhookRequest(1).uuid,
        webhookRequest(2).uuid,
      ]);
      expect(store.total()).toBe(3);
      expect(store.hasNextPage()).toBe(true);
      expect(store.hasPreviousPage()).toBe(false);
    });

    it('deve anexar a página 2 no fim Quando a próxima página é pedida', async () => {
      await respond(
        store.loadNextPage(),
        2,
        requestPage([webhookRequest(3)], { current_page: 2, total: 3 }),
      );

      expect(store.requests()).toHaveLength(3);
      expect(store.pageOf(webhookRequest(3).uuid)).toBe(2);
      expect(store.hasNextPage()).toBe(false);
    });

    it('deve marcar como lida Quando a mensagem é aberta', () => {
      store.append(webhookRequest(9), 4);
      expect(store.unread()).toEqual([webhookRequest(9).uuid]);

      store.select(webhookRequest(9).uuid);

      expect(store.unread()).toEqual([]);
      expect(store.selected()?.uuid).toBe(webhookRequest(9).uuid);
    });

    it('deve continuar mostrando a mensagem aberta Quando ela é apagada', async () => {
      store.select(webhookRequest(1).uuid);

      const deleted = store.deleteRequest(webhookRequest(1));
      const call = http.expectOne(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`);
      call.flush({ status: true });
      await deleted;

      expect(call.request.method).toBe('DELETE');
      expect(store.requests()).toHaveLength(1);
      expect(store.total()).toBe(2);
      expect(store.selected()?.uuid).toBe(webhookRequest(1).uuid);
    });

    it('deve zerar lista, seleção e não lidas Quando todas são apagadas', async () => {
      store.append(webhookRequest(9), 4);
      store.select(webhookRequest(2).uuid);

      const deleted = store.deleteAll();
      http
        .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request` })
        .flush({ status: true });
      await deleted;

      expect(store.hasRequests()).toBe(false);
      expect(store.total()).toBe(0);
      expect(store.selected()).toBeUndefined();
      expect(store.unread()).toEqual([]);
    });
  });

  it('deve carregar a página anterior no começo Quando o deep link abriu a página 2', async () => {
    await respond(
      store.load(TOKEN_ID, 2),
      2,
      requestPage([webhookRequest(51)], { current_page: 2, total: 51 }),
    );
    expect(store.hasPreviousPage()).toBe(true);

    await respond(
      store.loadPreviousPage(),
      1,
      requestPage([webhookRequest(1)], { total: 51, is_last_page: false }),
    );

    expect(store.requests().map((r) => r.uuid)).toEqual([
      webhookRequest(1).uuid,
      webhookRequest(51).uuid,
    ]);
    expect(store.hasPreviousPage()).toBe(false);
    expect(store.hasNextPage()).toBe(false);
  });

  it('deve criar a primeira página Quando chega mensagem numa URL vazia', async () => {
    await respond(store.load(TOKEN_ID, 1), 1, requestPage([]));

    store.append(webhookRequest(1), 1);

    expect(store.requests()).toEqual([webhookRequest(1)]);
    expect(store.total()).toBe(1);
  });

  it('deve buscar a mensagem completa Quando fetchOne é chamado', async () => {
    const fetched = store.fetchOne(TOKEN_ID, webhookRequest(1).uuid);
    http.expectOne(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`).flush(webhookRequest(1));

    expect(await fetched).toEqual(webhookRequest(1));
  });
});
