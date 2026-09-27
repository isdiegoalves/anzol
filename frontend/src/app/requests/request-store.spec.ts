import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { NO_FILTER } from '../search/request-filter';
import { RequestStore } from './request-store';
import { RequestPage } from './webhook-request';

const listUrl = `/token/${TOKEN_ID}/requests`;
const searchUrl = `/token/${TOKEN_ID}/requests/search`;

describe('Dado o RequestStore da URL aberta', () => {
  let http: HttpTestingController;
  let store: RequestStore;

  const respond = async (action: Promise<void>, page: number, body: RequestPage) => {
    http.expectOne(`${listUrl}?page=${page}&sorting=oldest`).flush(body);
    await action;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    // Os casos abaixo são da ordem da API (a mais antiga primeiro); a ordem padrão da tela, a mais
    // nova primeiro (INBOX-01), tem os seus no fim.
    store.sorting.set('oldest');
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

    it('deve devolver a mensagem ao mesmo lugar, sem apagar no servidor, Quando o Undo vem', async () => {
      const antes = store.requests();

      const deleted = store.deleteRequest(webhookRequest(1), Promise.resolve(true));
      expect(store.requests()).toHaveLength(1);
      expect(store.total()).toBe(2);

      expect(await deleted).toBe(false);
      http.expectNone(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`);
      expect(store.requests()).toEqual(antes);
      expect(store.total()).toBe(3);
    });

    it('deve apagar no servidor Quando o aviso some sem Undo', async () => {
      let semUndo!: (undo: boolean) => void;
      const deleted = store.deleteRequest(
        webhookRequest(2),
        new Promise((resolve) => (semUndo = resolve)),
      );
      http.expectNone(`/token/${TOKEN_ID}/request/${webhookRequest(2).uuid}`);

      semUndo(false);
      await vi.waitFor(() =>
        http
          .expectOne({
            method: 'DELETE',
            url: `/token/${TOKEN_ID}/request/${webhookRequest(2).uuid}`,
          })
          .flush({}),
      );

      expect(await deleted).toBe(true);
      expect(store.requests().map((request) => request.uuid)).toEqual([webhookRequest(1).uuid]);
    });

    it('deve dizer a faixa carregada no rodapé ("1–2 of 3")', () => {
      expect(store.range()).toEqual({ from: 1, to: 2, of: 3 });
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

  describe('Dado a limpeza automática cortando as mais antigas', () => {
    const [R1, R2, R3, R4] = [1, 2, 3, 4].map((n) => webhookRequest(n));

    beforeEach(async () => {
      await respond(store.load(TOKEN_ID, 1), 1, requestPage([R1, R2, R3], { total: 3 }));
    });

    it('deve tirar da lista e das não lidas o que o servidor cortou Quando chega mensagem com removed', () => {
      store.append(R4, 9);
      store.append(webhookRequest(5), 3, [R1.uuid, R4.uuid, webhookRequest(99).uuid]);

      expect(store.requests().map((r) => r.uuid)).toEqual([
        R2.uuid,
        R3.uuid,
        webhookRequest(5).uuid,
      ]);
      expect(store.total()).toBe(3);
      expect(store.unread()).toEqual([webhookRequest(5).uuid]);
      expect(JSON.parse(localStorage.getItem('unread') ?? '[]')).toEqual([webhookRequest(5).uuid]);
    });

    it('não deve indicar outra mensagem Quando a aberta continua na lista', () => {
      store.select(R3.uuid);

      expect(store.append(R4, 3, [R1.uuid])).toBeUndefined();
      expect(store.selected()?.uuid).toBe(R3.uuid);
    });

    it.each([
      ['a seguinte que ficou', [R1.uuid], R2],
      ['a mais próxima depois de um bloco cortado', [R1.uuid, R2.uuid], R3],
      ['a nova, se todas as carregadas saíram', [R1.uuid, R2.uuid, R3.uuid], R4],
    ])('deve indicar %s Quando a mensagem aberta é cortada', (_caso, removed, esperada) => {
      store.select(R1.uuid);

      expect(store.append(R4, 3, removed)).toEqual(esperada);
    });

    it('deve buscar de novo a primeira página e manter a aberta Quando a lista é recarregada', async () => {
      store.select(R3.uuid);

      const reloaded = store.reload();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([R3, R4], { total: 2 }));

      expect(await reloaded).toBeUndefined();
      expect(store.requests()).toEqual([R3, R4]);
      expect(store.total()).toBe(2);
      expect(store.selected()?.uuid).toBe(R3.uuid);
    });

    it('deve indicar a mais próxima que ficou Quando a aberta foi cortada no recarregamento', async () => {
      store.select(R1.uuid);

      const reloaded = store.reload();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([R3, R4], { total: 2 }));

      expect(await reloaded).toEqual(R3);
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

  describe('Dado um filtro na lista', () => {
    const [R1, R2, R3] = [webhookRequest(1), webhookRequest(2), webhookRequest(3)];
    const search = () => http.expectOne({ method: 'POST', url: searchUrl });

    beforeEach(async () => {
      await respond(store.load(TOKEN_ID, 1), 1, requestPage([R1, R2, R3]));
      store.select(R1.uuid);
    });

    it('deve buscar pelo search, contar "N of M" e manter a aberta fora do resultado Quando o filtro é aplicado', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, text: 'pedido', methods: ['PUT'] });
      const call = search();
      expect(call.request.body).toEqual({
        text: 'pedido',
        match: { method: ['PUT'] },
        sorting: 'oldest',
        page: 1,
        per_page: 50,
      });
      call.flush(requestPage([R2], { total: 1 }));
      await applied;

      expect(store.filtering()).toBe(true);
      expect(store.requests()).toEqual([R2]);
      expect(store.matched()).toBe(1);
      expect(store.total()).toBe(3);
      expect(store.selected()).toEqual(R1);
    });

    it('deve dizer que a URL tem mensagens Quando nenhuma casa com o filtro', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, text: 'nada' });
      search().flush(requestPage([], { total: 0 }));
      await applied;

      expect(store.requests()).toEqual([]);
      expect(store.hasRequests()).toBe(true);
      expect(store.hasNextPage()).toBe(false);
    });

    it('deve voltar à lista completa pelo GET Quando o filtro é limpo', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, methods: ['GET'] });
      search().flush(requestPage([], { total: 0 }));
      await applied;

      await respond(store.applyFilter(NO_FILTER), 1, requestPage([R1, R2, R3]));

      expect(store.filtering()).toBe(false);
      expect(store.requests()).toHaveLength(3);
    });

    it('deve ignorar a resposta atrasada Quando o filtro muda com uma busca a caminho', async () => {
      const first = store.applyFilter({ ...NO_FILTER, text: 'a' });
      const second = store.applyFilter({ ...NO_FILTER, text: 'ab' });
      const [atrasada, atual] = http.match({ method: 'POST', url: searchUrl });
      atual.flush(requestPage([R3], { total: 1 }));
      await second;
      atrasada.flush(requestPage([R1, R2], { total: 2 }));
      await first;

      expect(store.requests()).toEqual([R3]);
      expect(store.matched()).toBe(1);
    });

    it('deve contar a nova sem pôr na lista e refazer a busca das páginas carregadas Quando chega mensagem com filtro', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
      search().flush(requestPage([R1], { total: 1 }));
      await applied;
      const R4 = webhookRequest(4);

      store.countArrival(R4, 4);
      expect(store.requests()).toEqual([R1]);
      expect(store.total()).toBe(4);
      expect(store.unread()).toContain(R4.uuid);

      const refreshed = store.refreshSearch();
      const call = search();
      expect(call.request.body).toMatchObject({ page: 1, match: { method: ['POST'] } });
      call.flush(requestPage([R1, R4], { total: 2 }));

      expect(await refreshed).toBeUndefined();
      expect(store.requests()).toEqual([R1, R4]);
      expect(store.matched()).toBe(2);
      expect(store.selected()).toEqual(R1);
    });

    it('deve limpar o filtro Quando outra URL é carregada', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, text: 'x' });
      search().flush(requestPage([], { total: 0 }));
      await applied;

      await respond(store.load(TOKEN_ID, 1), 1, requestPage([R1]));

      expect(store.filter()).toEqual(NO_FILTER);
      expect(store.matched()).toBe(0);
    });

    it('deve descontar do total e do resultado Quando uma mensagem do resultado é apagada', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, text: 'x' });
      search().flush(requestPage([R2], { total: 1 }));
      await applied;

      const deleted = store.deleteRequest(R2);
      http.expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${R2.uuid}` }).flush({});
      await deleted;

      expect(store.total()).toBe(2);
      expect(store.matched()).toBe(0);
    });

    it('deve recarregar o resultado e o total da URL Quando reload é chamado com filtro', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, text: 'x' });
      search().flush(requestPage([R2, R3], { total: 2 }));
      await applied;

      const reloaded = store.reload();
      search().flush(requestPage([R3], { total: 1 }));
      await vi.waitFor(() =>
        http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([R3])),
      );
      await reloaded;

      expect(store.requests()).toEqual([R3]);
      expect(store.matched()).toBe(1);
      expect(store.total()).toBe(1);
    });
  });

  describe('Dado a ordem padrão, a mais nova no topo (INBOX-01)', () => {
    beforeEach(() => store.sorting.set('newest'));

    it('deve pedir sorting=newest e pôr a nova no topo Quando chega em tempo real', async () => {
      const loaded = store.load(TOKEN_ID, 1);
      http
        .expectOne(`${listUrl}?page=1&sorting=newest`)
        .flush(requestPage([webhookRequest(2), webhookRequest(1)], { total: 2 }));
      await loaded;

      store.append(webhookRequest(3), 3);

      expect(store.requests().map((r) => r.uuid)).toEqual(
        [3, 2, 1].map((n) => webhookRequest(n).uuid),
      );
      expect(store.newest()?.uuid).toBe(webhookRequest(3).uuid);
    });

    it('deve inverter e reler a primeira página Quando a ordem é trocada', async () => {
      const loaded = store.load(TOKEN_ID, 1);
      http.expectOne(`${listUrl}?page=1&sorting=newest`).flush(requestPage([webhookRequest(2)]));
      await loaded;

      const toggled = store.toggleSorting();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([webhookRequest(1)]));
      await toggled;

      expect(store.newestFirst()).toBe(false);
      expect(store.requests().map((r) => r.uuid)).toEqual([webhookRequest(1).uuid]);
    });

    // A limpeza automática corta as mais antigas: a vizinha da cortada é a mais antiga que ficou.
    it('deve achar a mais antiga que ficou pela API Quando ela está além das páginas carregadas', async () => {
      const loaded = store.load(TOKEN_ID, 1);
      http
        .expectOne(`${listUrl}?page=1&sorting=newest`)
        .flush(requestPage([webhookRequest(9), webhookRequest(8)], { is_last_page: false }));
      await loaded;

      const oldest = store.oldestKept();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([webhookRequest(2)]));

      expect((await oldest)?.uuid).toBe(webhookRequest(2).uuid);
    });

    it('deve achar a mais antiga que ficou no fim da lista Quando todas as páginas estão carregadas', async () => {
      const loaded = store.load(TOKEN_ID, 1);
      http
        .expectOne(`${listUrl}?page=1&sorting=newest`)
        .flush(requestPage([webhookRequest(9), webhookRequest(8)]));
      await loaded;

      expect((await store.oldestKept())?.uuid).toBe(webhookRequest(8).uuid);
    });
  });
});
