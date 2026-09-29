import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { NO_FILTER } from '../search/request-filter';
import { RequestStore, requestGoneInterceptor } from './request-store';
import { RequestPage } from './webhook-request';

const listUrl = `/token/${TOKEN_ID}/requests`;
const searchUrl = `/token/${TOKEN_ID}/requests/search`;

describe('Dado o total da URL fora da Entrada (B1, UX-12)', () => {
  let http: HttpTestingController;
  let store: RequestStore;

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

  it('deve ler só o total, com uma requisição por página, sem mexer na lista', async () => {
    expect(store.totalOf(TOKEN_ID)).toBeNull();

    const peeked = store.peek(TOKEN_ID);
    http.expectOne(`${listUrl}?per_page=1`).flush(requestPage([webhookRequest(1)], { total: 34 }));
    await peeked;

    expect(store.totalOf(TOKEN_ID)).toBe(34);
    expect(store.totalOf('outra')).toBeNull();
    expect(store.tokenId()).toBeNull();
    expect(store.requests()).toEqual([]);
  });

  it('deve contar a que chega no total e nas não lidas, uma vez só', () => {
    const nova = webhookRequest(7);

    store.arrivedOutside(TOKEN_ID, nova, 35);
    store.arrivedOutside(TOKEN_ID, nova, 35);

    expect(store.totalOf(TOKEN_ID)).toBe(35);
    expect(store.unread()).toEqual([nova.uuid]);
  });

  it('deve preferir o total da lista carregada, e mantê-lo em dia', async () => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1)], { total: 5 }));
    await loaded;
    expect(store.totalOf(TOKEN_ID)).toBe(5);

    store.arrivedOutside(TOKEN_ID, webhookRequest(2), 6);

    expect(store.totalOf(TOKEN_ID)).toBe(6);
    expect(store.total()).toBe(6);
  });

  it('deve pedir as que chegaram depois da seq dada, na ordem em que chegaram', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`${listUrl}?page=1&sorting=newest`).flush(requestPage([webhookRequest(1)]));
    await loaded;

    const arrived = store.arrivedAfter(12);
    http
      .expectOne(`${listUrl}?after=12`)
      .flush(requestPage([webhookRequest(2), webhookRequest(3)], { total: 3 }));

    expect(await arrived).toEqual({ data: [webhookRequest(2), webhookRequest(3)], total: 3 });
  });
});

describe('Dado um GET da requisição aberta que responde 404 (B2, caminho 3)', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const [R1, R2] = [webhookRequest(1), webhookRequest(2)];
  const get = (url: string) =>
    TestBed.inject(HttpClient)
      .get(url)
      .subscribe({ error: () => undefined });
  const notFound = { status: 404, statusText: 'Not Found' };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([requestGoneInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`${listUrl}?page=1&sorting=newest`).flush(requestPage([R1, R2]));
    await loaded;
    store.select(R1.uuid);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it.each([
    ['a própria requisição', ''],
    ['o trace das regras', '/rules/trace'],
    ['o conteúdo cru', '/raw'],
  ])('deve avisar, com a cópia na tela, Quando %s responde 404', (_caso, rest) => {
    const url = `/token/${TOKEN_ID}/request/${R1.uuid}${rest}`;

    get(url);
    http.expectOne(url).flush(null, notFound);

    expect(store.gone()).toMatchObject({ id: R1.uuid, cause: 'unknown' });
    expect(store.selected()).toEqual(R1);
  });

  it.each([
    ['é de outra requisição', 'GET', `/token/${TOKEN_ID}/request/${R2.uuid}`, notFound],
    ['não é 404', 'GET', `/token/${TOKEN_ID}/request/${R1.uuid}`, { status: 500, statusText: 'x' }],
    ['não é de um GET', 'DELETE', `/token/${TOKEN_ID}/request/${R1.uuid}`, notFound],
  ])('não deve avisar Quando a resposta %s', (_caso, method, url, answer) => {
    TestBed.inject(HttpClient)
      .request(method, url)
      .subscribe({ error: () => undefined });
    http.expectOne(url).flush(null, answer);

    expect(store.gone()).toBeNull();
  });

  it('deve manter a causa já sabida Quando o 404 chega depois do aviso', () => {
    store.append(webhookRequest(3), 2, [R1.uuid]);
    const url = `/token/${TOKEN_ID}/request/${R1.uuid}/rules/trace`;

    get(url);
    http.expectOne(url).flush(null, notFound);

    expect(store.gone()?.cause).toBe('cleanup');
  });
});

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
      expect(store.unread()).toEqual([]);
      // B2: a aberta segue na tela como cópia, com o aviso de que esta aba a apagou.
      expect(store.selected()).toEqual(webhookRequest(2));
      expect(store.gone()).toMatchObject({ id: webhookRequest(2).uuid, cause: 'deleted' });
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

    it('não deve avisar nada Quando a aberta continua na lista', () => {
      store.select(R3.uuid);

      store.append(R4, 3, [R1.uuid]);

      expect(store.selected()?.uuid).toBe(R3.uuid);
      expect(store.gone()).toBeNull();
    });

    // B2 (UX-38, CA-5): a aberta que a limpeza corta vira cópia com aviso; nenhuma outra entra.
    it.each([
      ['só ela', [R1.uuid]],
      ['um bloco', [R1.uuid, R2.uuid]],
      ['todas as carregadas', [R1.uuid, R2.uuid, R3.uuid]],
    ])(
      'deve manter a aberta como cópia, com o aviso, Quando a limpeza corta %s',
      (_caso, removed) => {
        vi.useFakeTimers({ now: new Date('2026-09-28T21:29:00'), toFake: ['Date'] });
        store.select(R1.uuid);

        store.append(R4, 3, removed);

        expect(store.selected()).toEqual(R1);
        expect(store.requests().some((request) => request.uuid === R1.uuid)).toBe(false);
        expect(store.gone()).toEqual({
          id: R1.uuid,
          cause: 'cleanup',
          at: new Date('2026-09-28T21:29:00'),
          index: 0,
        });
        vi.useRealTimers();
      },
    );

    it('deve avisar do corte também com filtro, quando a chegada só conta', () => {
      store.select(R2.uuid);

      store.countArrival(R4, 3, [R2.uuid]);

      expect(store.gone()).toMatchObject({ id: R2.uuid, cause: 'cleanup', index: 1 });
    });

    it('deve tirar o aviso Quando outra requisição é aberta', () => {
      store.select(R1.uuid);
      store.append(R4, 3, [R1.uuid]);

      store.select(R2.uuid);

      expect(store.gone()).toBeNull();
      expect(store.selected()).toEqual(R2);
    });

    it('deve buscar de novo a primeira página e manter a aberta Quando a lista é recarregada', async () => {
      store.select(R3.uuid);

      const reloaded = store.reload();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([R3, R4], { total: 2 }));

      await reloaded;
      expect(store.requests()).toEqual([R3, R4]);
      expect(store.total()).toBe(2);
      expect(store.selected()?.uuid).toBe(R3.uuid);
    });

    it('deve manter a aberta, sem trocar por outra, Quando ela sai da lista no recarregamento', async () => {
      store.select(R1.uuid);

      const reloaded = store.reload();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([R3, R4], { total: 2 }));
      await reloaded;

      expect(store.selected()).toEqual(R1);
    });
  });

  describe('Dado a requisição aberta apagada por esta aba (B2, UX-38)', () => {
    const [R1, R2] = [webhookRequest(1), webhookRequest(2)];

    beforeEach(async () => {
      await respond(store.load(TOKEN_ID, 1), 1, requestPage([R1, R2], { total: 2 }));
      store.select(R2.uuid);
    });

    it('deve manter a cópia com o aviso "deleted" e tirar o item da lista', async () => {
      const deleted = store.deleteRequest(R2);
      http
        .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${R2.uuid}` })
        .flush(null);
      await deleted;

      expect(store.requests()).toEqual([R1]);
      expect(store.selected()).toEqual(R2);
      expect(store.selectedIndex()).toBe(-1);
      expect(store.gone()).toMatchObject({ id: R2.uuid, cause: 'deleted', index: 1 });
    });

    it('deve tirar o aviso e devolver o item Quando o apagar é desfeito', async () => {
      const deleted = store.deleteRequest(R2, Promise.resolve(true));
      expect(store.gone()?.cause).toBe('deleted');

      expect(await deleted).toBe(false);

      expect(store.gone()).toBeNull();
      expect(store.requests()).toEqual([R1, R2]);
      expect(store.selectedIndex()).toBe(1);
    });

    it('não deve avisar nada Quando a apagada não é a aberta', async () => {
      const deleted = store.deleteRequest(R1);
      http
        .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${R1.uuid}` })
        .flush(null);
      await deleted;

      expect(store.gone()).toBeNull();
      expect(store.selected()).toEqual(R2);
    });
  });

  describe('Dado o link para uma requisição que não abre (B2, CA-5)', () => {
    it.each(['missing', 'failed'] as const)(
      'deve ficar sem seleção e guardar o motivo (%s), sem abrir outra',
      async (reason) => {
        await respond(store.load(TOKEN_ID, 1), 1, requestPage([webhookRequest(1)]));
        store.select(webhookRequest(1).uuid);

        store.leaveUnopened('falta', reason);

        expect(store.selected()).toBeUndefined();
        expect(store.unopened()).toEqual({ id: 'falta', reason });

        store.select(webhookRequest(1).uuid);
        expect(store.unopened()).toBeNull();
      },
    );
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

// B2 (UX-02): a busca do servidor não filtra por status; o filtro roda no navegador, sobre as
// mais novas, em páginas de 100, até 500 (e mais 500 a cada "Look in older requests").
describe('Dado o filtro pelo status respondido', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const answered = (n: number, status: number) => webhookRequest(n, { response: { status } });
  const listPage = (page: number) => `${listUrl}?page=${page}&per_page=100&sorting=newest`;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`${listUrl}?page=1&sorting=newest`).flush(requestPage([answered(1, 200)]));
    await loaded;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve varrer as mais novas pela listagem, filtrar no navegador e dizer o alcance', async () => {
    const [ok, recusa, outra] = [answered(3, 201), answered(2, 429), answered(1, 404)];

    const applied = store.applyFilter({ ...NO_FILTER, answered: ['4xx'] });
    await vi.waitFor(() => http.expectOne(listPage(1)).flush(requestPage([ok, recusa, outra])));
    await applied;

    expect(store.requests()).toEqual([recusa, outra]);
    expect(store.matched()).toBe(2);
    expect(store.scan()).toEqual({ scanned: 3, total: 3, done: true });
    expect(store.hasNextPage()).toBe(false);
  });

  it('deve parar em 500 e procurar mais 500 Quando pedem as mais antigas', async () => {
    const page = (n: number, total: number) =>
      requestPage(
        Array.from({ length: 100 }, (_, i) => answered(n * 1000 + i, 200)),
        { total, per_page: 100, current_page: n, is_last_page: false },
      );

    const applied = store.applyFilter({ ...NO_FILTER, answered: ['5xx'] });
    await vi.waitFor(() => http.expectOne(listPage(1)).flush(page(1, 505)));
    for (const n of [2, 3, 4, 5]) {
      await vi.waitFor(() => http.expectOne(listPage(n)).flush(page(n, 505)));
    }
    await applied;
    expect(store.matched()).toBe(0);
    expect(store.scan()).toEqual({ scanned: 500, total: 505, done: true });

    const older = store.lookOlder();
    for (const n of [1, 2, 3, 4, 5]) {
      await vi.waitFor(() => http.expectOne(listPage(n)).flush(page(n, 505)));
    }
    const antiga = answered(9, 503);
    await vi.waitFor(() =>
      http.expectOne(listPage(6)).flush(
        requestPage([5, 6, 7, 8].map((n) => answered(n, 200)).concat(antiga), {
          total: 505,
          current_page: 6,
        }),
      ),
    );
    await older;

    expect(store.requests()).toEqual([antiga]);
    expect(store.scan()).toEqual({ scanned: 505, total: 505, done: true });
  });

  it('deve varrer pela busca do servidor Quando há outros filtros junto', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'], answered: ['2xx'] });
    const call = await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));
    expect(call.request.body).toEqual({
      match: { method: ['POST'] },
      sorting: 'newest',
      page: 1,
      per_page: 100,
    });
    call.flush(requestPage([answered(2, 204), answered(1, 500)], { total: 2 }));
    await applied;

    expect(store.requests()).toEqual([answered(2, 204)]);
    expect(store.scan()).toEqual({ scanned: 2, total: 2, done: true });
  });

  it('não deve ter alcance Quando o filtro não tem status', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    await vi.waitFor(() =>
      http.expectOne({ method: 'POST', url: searchUrl }).flush(requestPage([])),
    );
    await applied;

    expect(store.scan()).toBeNull();
  });
});
