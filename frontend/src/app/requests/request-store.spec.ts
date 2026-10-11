import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { NO_FILTER, RequestFilter } from '../search/request-filter';
import { RECOUNT_EVERY_MS, RequestStore, requestGoneInterceptor } from './request-store';
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
    expect(store.unreadOf(TOKEN_ID)).toEqual([nova.uuid]);
    expect(store.unreadOf('outra')).toEqual([]);
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

  it('deve pedir as que chegaram depois da mais nova da URL, seguindo pelo maior seq até a última página', async () => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1, { seq: 12 }), webhookRequest(0, { seq: 11 })]));
    await loaded;
    const [A, B, C] = [13, 14, 15].map((seq) => webhookRequest(seq, { seq }));

    const arrived = store.arrivedSinceNewest();
    http
      .expectOne(`${listUrl}?after=12`)
      .flush(requestPage([A, B], { total: 5, is_last_page: false, current_page: 1 }));
    await vi.waitFor(() =>
      http.expectOne(`${listUrl}?after=14`).flush(requestPage([C], { total: 5 })),
    );

    expect(await arrived).toEqual({ data: [A, B, C], total: 5 });
  });

  it('deve partir da mais nova da URL, e não da maior carregada, Quando a URL abre na página 3', async () => {
    const loaded = store.load(TOKEN_ID, 3);
    http
      .expectOne(`${listUrl}?per_page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(120, { seq: 120 })], { total: 120 }));
    await vi.waitFor(() =>
      http
        .expectOne(`${listUrl}?page=3&sorting=newest`)
        .flush(requestPage([webhookRequest(20, { seq: 20 })], { total: 120, current_page: 3 })),
    );
    await loaded;

    const arrived = store.arrivedSinceNewest();
    http.expectOne(`${listUrl}?after=120`).flush(requestPage([], { total: 120 }));

    expect(await arrived).toEqual({ data: [], total: 120 });
  });

  it('deve trazer de volta à lista a chegada contada com filtro Quando a releitura sem filtro falhou', async () => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1, { seq: 10 })], { total: 1 }));
    await loaded;
    const filtered = store.applyFilter({ ...NO_FILTER, text: 'x' });
    http.expectOne(searchUrl).flush(requestPage([], { total: 0 }));
    await filtered;
    const chegou = webhookRequest(2, { seq: 20 });
    store.countArrival(chegou, 2);
    const cleared = store.applyFilter(NO_FILTER);
    http.expectOne(`${listUrl}?page=1&sorting=newest`).error(new ProgressEvent('error'));
    await cleared;
    expect(store.failure()).toMatchObject({ kind: 'search', status: 0 });

    const arrived = store.arrivedSinceNewest();
    http.expectOne(`${listUrl}?after=10`).flush(requestPage([chegou], { total: 2 }));

    expect(await arrived).toEqual({ data: [chegou], total: 2 });
  });

  it('não deve ter de onde retomar Quando nenhuma mensagem da URL tem seq', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`${listUrl}?page=1&sorting=newest`).flush(requestPage([webhookRequest(1)]));
    await loaded;

    expect(await store.arrivedSinceNewest()).toBeNull();
  });

  it('deve pôr na lista pela ordem do seq, uma vez só, a que chega depois de outra mais nova', async () => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1, { seq: 10 })], { total: 1 }));
    await loaded;
    const [nova, retomada] = [webhookRequest(3, { seq: 30 }), webhookRequest(2, { seq: 20 })];

    store.append(nova, 2);
    store.append(retomada, 3);
    store.append(nova, 3);

    expect(store.requests().map((request) => request.seq)).toEqual([30, 20, 10]);
    expect(store.unread()).toEqual([nova.uuid, retomada.uuid]);
  });
});

describe('Dado um GET da requisição aberta que responde 404', () => {
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

  /** Na ordem inversa, a carga lê antes a mais nova da URL (a fronteira da volta da conexão). */
  const respond = async (action: Promise<void>, page: number, body: RequestPage) => {
    for (const newest of http.match(`${listUrl}?per_page=1&sorting=newest`)) {
      newest.flush(requestPage([]));
    }
    await vi.waitFor(() => http.expectOne(`${listUrl}?page=${page}&sorting=oldest`).flush(body));
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

      expect(await deleted).toBe('restored');
      http.expectNone(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`);
      expect(store.requests()).toEqual(antes);
      expect(store.total()).toBe(3);
    });

    it('deve devolver a mensagem ao mesmo lugar e repassar o erro Quando o DELETE falha', async () => {
      const antes = store.requests();
      store.select(webhookRequest(1).uuid);

      const deleted = store.deleteRequest(webhookRequest(1));
      http
        .expectOne({
          method: 'DELETE',
          url: `/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`,
        })
        .flush({}, { status: 503, statusText: 'Unavailable' });

      await expect(deleted).rejects.toMatchObject({ status: 503 });
      expect(store.requests()).toEqual(antes);
      expect(store.total()).toBe(3);
      expect(store.gone()).toBeNull();
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

      expect(await deleted).toBe('deleted');
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
      expect(store.selected()).toEqual(webhookRequest(2));
      expect(store.gone()).toMatchObject({ id: webhookRequest(2).uuid, cause: 'deleted' });
    });

    it('deve devolver lista, total, não lidas e a aberta Quando apagar todas falha', async () => {
      store.append(webhookRequest(9), 4);
      store.select(webhookRequest(2).uuid);
      const antes = store.requests();

      const deleted = store.deleteAll();
      http
        .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request` })
        .flush({}, { status: 503, statusText: 'Unavailable' });

      await expect(deleted).rejects.toMatchObject({ status: 503 });
      expect(store.requests()).toEqual(antes);
      expect(store.total()).toBe(4);
      expect(store.hasNextPage()).toBe(true);
      expect(store.unread()).toEqual([webhookRequest(9).uuid]);
      expect(store.gone()).toBeNull();
    });

    it('deve manter a que chegou durante o pedido Quando apagar todas falha', async () => {
      const deleted = store.deleteAll();
      const call = http.expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request` });
      store.append(webhookRequest(9), 4);

      call.flush({}, { status: 503, statusText: 'Unavailable' });

      await expect(deleted).rejects.toMatchObject({ status: 503 });
      expect(store.requests().map((request) => request.uuid)).toEqual([
        webhookRequest(1).uuid,
        webhookRequest(2).uuid,
        webhookRequest(9).uuid,
      ]);
      expect(store.total()).toBe(4);
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
      expect(JSON.parse(localStorage.getItem('unread') ?? '{}')).toEqual({
        [TOKEN_ID]: [webhookRequest(5).uuid],
      });
    });

    it('não deve avisar nada Quando a aberta continua na lista', () => {
      store.select(R3.uuid);

      store.append(R4, 3, [R1.uuid]);

      expect(store.selected()?.uuid).toBe(R3.uuid);
      expect(store.gone()).toBeNull();
    });

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

  describe('Dado a requisição aberta apagada por esta aba', () => {
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

      expect(await deleted).toBe('restored');

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

  describe('Dado o link para uma requisição que não abre', () => {
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
        http
          .expectOne(`${listUrl}?per_page=1&sorting=newest`)
          .flush(requestPage([R3], { total: 7, per_page: 1, is_last_page: false })),
      );
      await reloaded;

      expect(store.requests()).toEqual([R3]);
      expect(store.matched()).toBe(1);
      expect(store.total()).toBe(7);
    });

    it('deve ler o total da URL numa listagem de um item Quando a ordem muda com filtro', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
      search().flush(requestPage([R2, R3], { total: 2 }));
      await applied;

      const toggled = store.toggleSorting();
      const call = search();
      expect(call.request.body).toMatchObject({ sorting: 'newest', page: 1 });
      call.flush(requestPage([R3, R2], { total: 2 }));
      await vi.waitFor(() =>
        http
          .expectOne(`${listUrl}?per_page=1&sorting=newest`)
          .flush(requestPage([R3], { total: 812, per_page: 1, is_last_page: false })),
      );
      await toggled;

      expect(store.requests()).toEqual([R3, R2]);
      expect(store.total()).toBe(812);
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

describe('Dado o filtro pelo status respondido', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const answered = (n: number, status: number) =>
    webhookRequest(n, { seq: n, response: { status } });
  const search = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));

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

  it('deve mandar o status na busca do servidor, num pedido só, e contar a URL inteira', async () => {
    const [limite, fora] = [answered(9, 429), answered(4, 503)];

    const applied = store.applyFilter({ ...NO_FILTER, answered: ['4xx', '503'] });
    const call = await search();
    expect(call.request.body).toEqual({
      match: {},
      answered: ['4xx', '503'],
      sorting: 'newest',
      page: 1,
      per_page: 50,
    });
    call.flush(requestPage([limite, fora], { total: 812, is_last_page: false }));
    await applied;

    expect(store.requests()).toEqual([limite, fora]);
    expect(store.matched()).toBe(812);
    expect(store.hasNextPage()).toBe(true);
    expect(store.newestWindow()).toBeNull();
  });

  it('deve pedir a página seguinte à busca, com o mesmo status', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'], answered: ['5xx'] });
    (await search()).flush(requestPage([answered(9, 500)], { total: 51, is_last_page: false }));
    await applied;

    const next = store.loadNextPage();
    const call = await search();
    expect(call.request.body).toMatchObject({
      match: { method: ['POST'] },
      answered: ['5xx'],
      page: 2,
    });
    call.flush(requestPage([answered(2, 503)], { total: 51, current_page: 2 }));
    await next;

    expect(store.requests()).toEqual([answered(9, 500), answered(2, 503)]);
    expect(store.hasNextPage()).toBe(false);
  });
});

describe('Dado uma URL no teto da limpeza automática com filtro ligado', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const post = (n: number) => webhookRequest(n, { seq: n });
  const get = (n: number) => webhookRequest(n, { seq: n, method: 'GET' });
  const searches = () => http.match({ method: 'POST', url: searchUrl });
  /** A busca de um item que confere a contagem, respondida com `total`. */
  const recounted = (total: number) => {
    const [call, ...others] = searches();
    expect(others).toEqual([]);
    expect(call.request.body).toEqual({
      match: { method: ['POST'] },
      sorting: 'newest',
      page: 1,
      per_page: 1,
    });
    call.flush(requestPage([post(999)], { total, per_page: 1, is_last_page: false }));
    return vi.advanceTimersByTimeAsync(0);
  };
  /** Lista de 500 no teto, filtro por POST com 300 casando e só a primeira página carregada. */
  const filtered = async (matched = 300, isLast = false) => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([post(50), get(49)], { total: 500, is_last_page: false }));
    await loaded;
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    (await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }))).flush(
      requestPage([post(50), post(48)], { total: matched, is_last_page: isLast }),
    );
    await applied;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
    localStorage.clear();
  });

  it('deve conferir no servidor, por uma busca de um item, a contagem que o corte pode ter mudado', async () => {
    await filtered();

    store.arriveFiltered(get(51), 500, ['cortada-que-casava']);
    expect(store.matched()).toBe(300);
    await vi.advanceTimersByTimeAsync(0);
    await recounted(299);

    expect(store.matched()).toBe(299);
    expect(store.requests()).toEqual([post(50), post(48)]);
  });

  it('deve conferir no máximo uma vez a cada 10 s enquanto chegam, e mais uma no fim da rajada', async () => {
    await filtered();

    store.arriveFiltered(get(51), 500, ['cortada-1']);
    await vi.advanceTimersByTimeAsync(0);
    await recounted(299);
    for (const n of [52, 53, 54]) {
      await vi.advanceTimersByTimeAsync(1_000);
      store.arriveFiltered(get(n), 500, [`cortada-${n}`]);
    }
    await vi.advanceTimersByTimeAsync(RECOUNT_EVERY_MS - 3_001);
    expect(searches()).toEqual([]);
    expect(store.matched()).toBe(299);

    await vi.advanceTimersByTimeAsync(1);
    await recounted(296);
    expect(store.matched()).toBe(296);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(searches()).toEqual([]);
  });

  it('nunca deve dizer que casam mais do que a URL guarda', async () => {
    await filtered(500);

    store.arriveFiltered(post(51), 500, ['cortada-1']);
    store.arriveFiltered(post(52), 500, ['cortada-2']);

    expect(store.matched()).toBe(500);
    await vi.advanceTimersByTimeAsync(0);
    await recounted(500);
  });

  it('não deve pedir nada Quando a cortada estava na lista: a conta já é exata', async () => {
    await filtered(2, true);

    store.arriveFiltered(get(51), 500, [post(48).uuid, 'cortada-que-nao-casava']);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.matched()).toBe(1);
    expect(searches()).toEqual([]);
  });

  it('não deve pedir nada fora do teto, sem corte', async () => {
    await filtered();

    store.arriveFiltered(post(51), 501);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.matched()).toBe(301);
    expect(searches()).toEqual([]);
  });

  it('deve desistir da conferência marcada Quando o filtro muda', async () => {
    await filtered();
    store.arriveFiltered(get(51), 500, ['cortada-1']);
    await vi.advanceTimersByTimeAsync(0);
    await recounted(299);
    store.arriveFiltered(get(52), 500, ['cortada-2']);

    const applied = store.applyFilter({ ...NO_FILTER, methods: ['GET'] });
    const [call] = searches();
    call.flush(requestPage([get(52)], { total: 200, is_last_page: false }));
    await vi.advanceTimersByTimeAsync(0);
    await applied;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.matched()).toBe(200);
    expect(searches()).toEqual([]);
  });
});

describe('Dado uma página da lista que não vem', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const unavailable = { status: 503, statusText: 'Unavailable' };
  const row = (n: number) => webhookRequest(n, { seq: n, response: { status: 429 } });
  const page = (number: number) => `${listUrl}?page=${number}&sorting=newest`;
  const search = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID, 2);
    http.expectOne(`${listUrl}?per_page=1&sorting=newest`).flush(requestPage([row(9)]));
    await vi.waitFor(() =>
      http
        .expectOne(page(2))
        .flush(requestPage([row(6), row(5)], { total: 9, current_page: 2, is_last_page: false })),
    );
    await loaded;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve dizer que a página seguinte não veio, manter a lista e tentar a mesma de novo', async () => {
    const next = store.loadNextPage();
    http.expectOne(page(3)).flush({}, unavailable);
    await next;

    expect(store.pageFailure()).toEqual({ kind: 'list', status: 503, attempt: 0, read: 'next' });
    expect(store.requests()).toEqual([row(6), row(5)]);
    expect(store.paging()).toBeNull();
    expect(store.failure()).toBeNull();

    const again = store.retryPage();
    http.expectOne(page(3)).flush({}, unavailable);
    await again;
    expect(store.pageFailure()).toMatchObject({ attempt: 1, read: 'next' });

    const third = store.retryPage();
    http.expectOne(page(3)).flush(requestPage([row(4)], { total: 9, current_page: 3 }));
    await third;
    expect(store.pageFailure()).toBeNull();
    expect(store.requests()).toEqual([row(6), row(5), row(4)]);
  });

  it('deve dizer que a página anterior não veio e tentar a mesma de novo', async () => {
    const previous = store.loadPreviousPage();
    http.expectOne(page(1)).error(new ProgressEvent('error'));
    await previous;

    expect(store.pageFailure()).toEqual({ kind: 'list', status: 0, attempt: 0, read: 'previous' });

    const again = store.retryPage();
    http.expectOne(page(1)).flush(requestPage([row(9), row(8)], { total: 9, is_last_page: false }));
    await again;
    expect(store.pageFailure()).toBeNull();
    expect(store.requests()).toEqual([row(9), row(8), row(6), row(5)]);
  });

  it('não deve dizer nada da página Quando a URL foi trancada ou não existe mais: quem mostra é o shell', async () => {
    const next = store.loadNextPage();
    http.expectOne(page(3)).flush({}, { status: 401, statusText: 'Unauthorized' });
    await next;

    expect(store.pageFailure()).toBeNull();
    expect(store.paging()).toBeNull();
  });

  it('deve esquecer a página que não veio Quando o filtro muda', async () => {
    const next = store.loadNextPage();
    http.expectOne(page(3)).flush({}, unavailable);
    await next;

    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    expect(store.pageFailure()).toBeNull();
    (await search()).flush(requestPage([row(6)]));
    await applied;
  });

  it('deve dizer que as anteriores à janela não vieram, manter o que ela mostra e tentar de novo', async () => {
    const edgeUrl = (position: number) => `${listUrl}?page=${position}&per_page=1&sorting=newest`;
    const edge = (position: number, oldest: number) =>
      vi.waitFor(() =>
        http.expectOne(edgeUrl(position)).flush(
          requestPage([row(oldest)], {
            total: 9,
            per_page: 1,
            current_page: position,
            is_last_page: false,
          }),
        ),
      );
    const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 2 });
    await edge(2, 8);
    (await search()).flush(requestPage([row(9), row(8), row(6)], { total: 4 }));
    await applied;

    const older = store.lookBefore();
    await edge(4, 6);
    (await search()).flush({}, unavailable);
    await older;

    expect(store.pageFailure()).toEqual({ kind: 'list', status: 503, attempt: 0, read: 'before' });
    expect(store.requests()).toEqual([row(9), row(8)]);
    expect(store.windowReading()).toBeNull();
    expect(store.newestWindow()).toMatchObject({ size: 2, more: true });

    const again = store.retryPage();
    await edge(4, 6);
    (await search()).flush(requestPage([row(9), row(8), row(6), row(5)], { total: 4 }));
    await again;

    expect(store.pageFailure()).toBeNull();
    expect(store.requests()).toEqual([row(9), row(8), row(6)]);
    expect(store.newestWindow()).toMatchObject({ size: 4, more: true });
  });
});

describe('Dado uma requisição que chega com filtro ligado', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const post = (n: number, status = 200) => webhookRequest(n, { seq: n, response: { status } });
  const get = (n: number) => webhookRequest(n, { seq: n, method: 'GET' });
  const search = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));
  const filterBy = async (filter: RequestFilter, found: RequestPage) => {
    const applied = store.applyFilter(filter);
    (await search()).flush(found);
    await applied;
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush(requestPage([post(5), get(4), post(3)], { total: 40 }));
    await loaded;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve pôr na lista a que casa e só contar a que não casa, sem pedido nenhum, Quando o filtro se decide por ela', async () => {
    await filterBy(
      { ...NO_FILTER, methods: ['POST'], answered: ['2xx'] },
      requestPage([post(5), post(3)], { total: 30, is_last_page: false }),
    );

    expect(store.arriveFiltered(post(6), 41)).toBe(true);
    expect(store.arriveFiltered(get(7), 42)).toBe(true);
    expect(store.arriveFiltered(post(8, 503), 43)).toBe(true);

    expect(store.requests()).toEqual([post(6), post(5), post(3)]);
    expect(store.matched()).toBe(31);
    expect(store.total()).toBe(43);
    expect(store.unread()).toEqual([post(6).uuid, get(7).uuid, post(8, 503).uuid]);
    expect(store.hasNextPage()).toBe(true);
  });

  it('deve pôr a que casa no fim Quando a lista está da mais antiga para a mais nova', async () => {
    const sorted = store.toggleSorting();
    http
      .expectOne(`${listUrl}?page=1&sorting=oldest`)
      .flush(requestPage([post(3), get(4), post(5)], { total: 40 }));
    await sorted;
    await filterBy({ ...NO_FILTER, methods: ['POST'] }, requestPage([post(3), post(5)]));

    store.arriveFiltered(post(6), 41);

    expect(store.requests()).toEqual([post(3), post(5), post(6)]);
    expect(store.matched()).toBe(3);
  });

  it('deve tirar da lista, e do que casa, a que a limpeza cortou', async () => {
    await filterBy({ ...NO_FILTER, methods: ['POST'] }, requestPage([post(5), post(3)]));

    store.arriveFiltered(get(6), 40, [post(3).uuid, get(4).uuid]);

    expect(store.requests()).toEqual([post(5)]);
    expect(store.matched()).toBe(1);
  });

  it('não deve repetir a que já está na lista (o evento e a volta da conexão trazem a mesma)', async () => {
    await filterBy({ ...NO_FILTER, methods: ['POST'] }, requestPage([post(5), post(3)]));

    store.arriveFiltered(post(6), 41);
    store.arriveFiltered(post(6), 41);

    expect(store.requests()).toEqual([post(6), post(5), post(3)]);
    expect(store.matched()).toBe(3);
  });

  it('deve só contar, e dizer que o servidor é quem sabe, Quando o filtro tem texto ou desfecho', async () => {
    await filterBy({ ...NO_FILTER, text: 'pix', methods: ['POST'] }, requestPage([post(5)]));

    expect(store.arriveFiltered(post(6), 41)).toBe(false);

    expect(store.requests()).toEqual([post(5)]);
    expect(store.matched()).toBe(1);
    expect(store.total()).toBe(41);
    expect(store.unread()).toContain(post(6).uuid);
  });

  it('deve reler só a primeira página da busca, da mais nova para a mais antiga, e pôr na lista as novas que casam', async () => {
    await filterBy(
      { ...NO_FILTER, text: 'pix' },
      requestPage([post(5), post(3)], { total: 120, is_last_page: false }),
    );
    const next = store.loadNextPage();
    (await search()).flush(requestPage([post(2), post(1)], { total: 120, current_page: 2 }));
    await next;
    store.arriveFiltered(post(6), 41);
    store.arriveFiltered(get(7), 42);
    store.arriveFiltered(post(8), 43);

    const refreshed = store.refreshSearch();
    const call = await search();
    expect(call.request.body).toEqual({
      text: 'pix',
      match: {},
      sorting: 'newest',
      page: 1,
      per_page: 50,
    });
    call.flush(
      requestPage([post(8), post(6), post(5), post(3)], { total: 122, is_last_page: false }),
    );
    await refreshed;

    expect(store.requests()).toEqual([post(8), post(6), post(5), post(3), post(2), post(1)]);
    expect(store.matched()).toBe(122);
  });

  it('deve seguir para a página seguinte da busca só enquanto todas as lidas são novas', async () => {
    await filterBy({ ...NO_FILTER, text: 'pix' }, requestPage([post(5)], { total: 1 }));
    const burst = Array.from({ length: 60 }, (_, i) => post(100 - i));
    burst.forEach((request, i) => store.arriveFiltered(request, 41 + i));

    const refreshed = store.refreshSearch();
    (await search()).flush(requestPage(burst.slice(0, 50), { total: 61, is_last_page: false }));
    const second = await search();
    expect(second.request.body).toMatchObject({ page: 2, sorting: 'newest' });
    second.flush(requestPage([...burst.slice(50), post(5)], { total: 61, current_page: 2 }));
    await refreshed;

    expect(store.requests()).toEqual([...burst, post(5)]);
    expect(store.matched()).toBe(61);
  });

  it('deve valer só a releitura mais recente Quando duas correm juntas', async () => {
    await filterBy({ ...NO_FILTER, text: 'pix' }, requestPage([post(5)], { total: 1 }));
    store.arriveFiltered(post(6), 41);
    const older = store.refreshSearch();
    const first = await search();
    store.arriveFiltered(post(7), 42);
    const newer = store.refreshSearch();
    const second = await search();

    second.flush(requestPage([post(7), post(6), post(5)], { total: 3 }));
    await newer;
    first.flush(requestPage([post(6), post(5)], { total: 2 }));
    await older;

    expect(store.requests()).toEqual([post(7), post(6), post(5)]);
    expect(store.matched()).toBe(3);
  });

  it('deve deixar para a busca a que chega com a busca do filtro novo a caminho, e relê-la no fim', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    const first = await search();

    expect(store.arriveFiltered(post(6), 41)).toBe(false);
    first.flush(requestPage([post(5), post(3)], { total: 2 }));
    await applied;
    const again = await search();
    expect(again.request.body).toMatchObject({ match: { method: ['POST'] }, sorting: 'newest' });
    again.flush(requestPage([post(6), post(5), post(3)], { total: 3 }));

    await vi.waitFor(() => expect(store.requests()).toEqual([post(6), post(5), post(3)]));
    expect(store.matched()).toBe(3);
  });

  it('deve acertar o que casa com o total de cada página da busca que chega', async () => {
    await filterBy(
      { ...NO_FILTER, methods: ['POST'] },
      requestPage([post(5), post(3)], { total: 120, is_last_page: false }),
    );

    const next = store.loadNextPage();
    (await search()).flush(requestPage([post(2)], { total: 118, current_page: 2 }));
    await next;

    expect(store.matched()).toBe(118);
  });
});

describe('Dado a URL aberta já com o filtro do endereço', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const newestUrl = `${listUrl}?per_page=1&sorting=newest`;
  const newest = requestPage([webhookRequest(9, { seq: 9 })], {
    total: 812,
    per_page: 1,
    is_last_page: false,
  });
  const search = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));

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

  it('deve ler o total e a mais nova da URL numa listagem de um item, sem a página inteira', async () => {
    const loaded = store.load(TOKEN_ID, 1, { ...NO_FILTER, methods: ['POST'] });
    http.expectOne(newestUrl).flush(newest);
    (await search()).flush(requestPage([webhookRequest(4, { seq: 4 })], { total: 3 }));
    await loaded;

    expect(store.total()).toBe(812);
    expect(store.matched()).toBe(3);
    expect(store.requests()).toEqual([webhookRequest(4, { seq: 4 })]);

    const arrived = store.arrivedSinceNewest();
    http.expectOne(`${listUrl}?after=9`).flush(requestPage([], { total: 812 }));
    await arrived;
  });

  it('deve fazer a mesma leitura de um item na ordem da mais antiga primeiro', async () => {
    store.sorting.set('oldest');

    const loaded = store.load(TOKEN_ID, 1, { ...NO_FILTER, text: 'pix' });
    http.expectOne(newestUrl).flush(newest);
    const call = await search();
    expect(call.request.body).toMatchObject({ text: 'pix', sorting: 'oldest', page: 1 });
    call.flush(requestPage([webhookRequest(2, { seq: 2 })], { total: 40 }));
    await loaded;

    expect(store.total()).toBe(812);
    expect(store.matched()).toBe(40);
  });
});

// O link de Métricas e de Saúde traz `?window=n`: a contagem deles é sobre as n mais novas da URL.
describe('Dado a janela das mais novas na rota', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  const answered = (n: number, status: number) =>
    webhookRequest(n, { seq: n, response: { status } });
  const edgeUrl = (size: number) => `${listUrl}?page=${size}&per_page=1&sorting=newest`;
  const listPage = (page: number) => `${listUrl}?page=${page}&per_page=100&sorting=newest`;
  const edge = (size: number, oldest: number, total: number) =>
    vi.waitFor(() =>
      http.expectOne(edgeUrl(size)).flush(
        requestPage([answered(oldest, 200)], {
          total,
          per_page: 1,
          current_page: size,
          is_last_page: false,
        }),
      ),
    );
  const search = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));

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

  it('deve achar a fronteira pelo seq da n-ésima mais nova e ficar com o que a busca acha até ela', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 2 });
    await edge(2, 8, 3);
    const call = await search();
    expect(call.request.body).toEqual({
      match: {},
      answered: ['429'],
      sorting: 'newest',
      page: 1,
      per_page: 100,
    });
    call.flush(
      requestPage([answered(9, 429), answered(7, 429)], { total: 40, is_last_page: false }),
    );
    await applied;

    expect(store.requests()).toEqual([answered(9, 429)]);
    expect(store.matched()).toBe(1);
    expect(store.newestWindow()).toMatchObject({ size: 2, more: true });
    expect(store.hasNextPage()).toBe(false);
  });

  it('deve seguir pelas páginas da busca enquanto não cruza a fronteira', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => answered(from - i, 200));

    const applied = store.applyFilter({ ...NO_FILTER, signature: 'invalid', window: 500 });
    await edge(500, 391, 10_000);
    const first = await search();
    expect(first.request.body).toMatchObject({ match: { signature: 'invalid' }, page: 1 });
    first.flush(requestPage(page(600), { total: 4000, is_last_page: false }));
    const second = await search();
    expect(second.request.body).toMatchObject({ page: 2, per_page: 100 });
    second.flush(requestPage(page(480), { total: 4000, current_page: 2, is_last_page: false }));
    await applied;

    expect(store.requests()).toHaveLength(190);
    expect(store.requests().at(-1)).toEqual(answered(391, 200));
    expect(store.matched()).toBe(190);
    expect(store.newestWindow()).toMatchObject({ size: 500, more: true });
  });

  it('não deve repetir a que a página seguinte traz de novo Quando chega outra entre as duas', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => answered(from - i, 200));

    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'], window: 500 });
    await edge(500, 491, 10_000);
    (await search()).flush(requestPage(page(600), { total: 4000, is_last_page: false }));
    (await search()).flush(
      requestPage(page(501), { total: 4001, current_page: 2, is_last_page: false }),
    );
    await applied;

    expect(store.requests().map((request) => request.seq)).toEqual(
      Array.from({ length: 110 }, (_, i) => 600 - i),
    );
    expect(store.matched()).toBe(110);
  });

  it('deve parar na última página da busca Quando ela acaba dentro da janela', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['GET'], window: 2 });
    await edge(2, 8, 3);
    (await search()).flush(requestPage([answered(9, 200)], { total: 1 }));
    await applied;

    expect(store.requests()).toEqual([answered(9, 200)]);
    expect(store.newestWindow()).toMatchObject({ size: 2, more: true });
  });

  it('deve ler a janela pela listagem Quando não há outro filtro', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, window: 2 });
    await edge(2, 8, 3);
    await vi.waitFor(() =>
      http.expectOne(listPage(1)).flush(
        requestPage(
          [9, 8, 7].map((n) => answered(n, 200)),
          { per_page: 100 },
        ),
      ),
    );
    await applied;

    expect(store.requests()).toEqual([answered(9, 200), answered(8, 200)]);
    expect(store.matched()).toBe(2);
    expect(store.newestWindow()).toMatchObject({ size: 2, more: true });
  });

  it('deve parar na página que termina na fronteira, sem pedir a seguinte', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => answered(from - i, 200));

    const applied = store.applyFilter({ ...NO_FILTER, window: 200 });
    await edge(200, 401, 10_000);
    await vi.waitFor(() =>
      http
        .expectOne(listPage(1))
        .flush(requestPage(page(600), { total: 10_000, per_page: 100, is_last_page: false })),
    );
    await vi.waitFor(() =>
      http.expectOne(listPage(2)).flush(
        requestPage(page(500), {
          total: 10_000,
          per_page: 100,
          current_page: 2,
          is_last_page: false,
        }),
      ),
    );
    await applied;

    expect(store.requests()).toHaveLength(200);
    expect(store.requests().at(-1)).toEqual(answered(401, 200));
  });

  it('deve mostrar a janela da mais antiga para a mais nova Quando a ordem da lista é essa', async () => {
    const sorted = store.toggleSorting();
    http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([answered(1, 200)]));
    await sorted;

    const applied = store.applyFilter({ ...NO_FILTER, answered: ['2xx'], window: 2 });
    await edge(2, 8, 3);
    const call = await search();
    expect(call.request.body).toMatchObject({ sorting: 'newest' });
    call.flush(requestPage([answered(9, 200), answered(8, 201)], { total: 2 }));
    await applied;

    expect(store.requests()).toEqual([answered(8, 201), answered(9, 200)]);
  });

  it('deve ser a busca de sempre, sem janela, Quando a URL não guarda mais que ela', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, answered: ['2xx'], window: 500 });
    await vi.waitFor(() =>
      http
        .expectOne(edgeUrl(500))
        .flush(requestPage([], { total: 51, per_page: 1, current_page: 500 })),
    );
    const call = await search();
    expect(call.request.body).toMatchObject({ answered: ['2xx'], page: 1, per_page: 50 });
    call.flush(requestPage([answered(2, 200)], { total: 51, is_last_page: false }));
    await applied;

    expect(store.matched()).toBe(51);
    expect(store.hasNextPage()).toBe(true);
    expect(store.newestWindow()).toBeNull();
  });

  it('deve ancorar a janela na hora em que foi lida', async () => {
    const before = Date.now();

    const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 2 });
    await edge(2, 8, 3);
    (await search()).flush(requestPage([answered(9, 429)], { total: 1 }));
    await applied;

    const at = store.newestWindow()?.at.getTime() ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('não deve reler nem mover a janela Quando chega requisição: a nova conta na URL e fica fora dela', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 2 });
    await edge(2, 8, 3);
    (await search()).flush(requestPage([answered(9, 429)], { total: 1 }));
    await applied;
    const anchored = store.newestWindow();

    expect(store.arriveFiltered(answered(10, 429), 4)).toBe(true);
    await store.refreshSearch();

    expect(store.requests()).toEqual([answered(9, 429)]);
    expect(store.matched()).toBe(1);
    expect(store.total()).toBe(4);
    expect(store.newestWindow()).toBe(anchored);
  });

  it('deve dizer, durante a leitura, quantas da janela já foram cobertas', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => answered(from - i, 200));

    const applied = store.applyFilter({ ...NO_FILTER, window: 200 });
    expect(store.windowReading()).toBeNull();
    await edge(200, 401, 10_000);
    await vi.waitFor(() => expect(store.windowReading()).toEqual({ size: 200, looked: 0 }));
    await vi.waitFor(() =>
      http
        .expectOne(listPage(1))
        .flush(requestPage(page(600), { total: 10_000, per_page: 100, is_last_page: false })),
    );
    await vi.waitFor(() => expect(store.windowReading()).toEqual({ size: 200, looked: 100 }));
    await vi.waitFor(() =>
      http.expectOne(listPage(2)).flush(
        requestPage(page(500), {
          total: 10_000,
          per_page: 100,
          current_page: 2,
          is_last_page: false,
        }),
      ),
    );
    await applied;

    expect(store.windowReading()).toBeNull();
  });

  it('deve tirar o progresso Quando a leitura da janela falha', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 2 });
    await edge(2, 8, 3);
    (await search()).flush({}, { status: 503, statusText: 'Unavailable' });
    await applied;

    expect(store.windowReading()).toBeNull();
    expect(store.failure()).toMatchObject({ kind: 'search', status: 503 });
  });

  describe('Dado o "Look in the {window} before"', () => {
    const five = [9, 8, 7, 6, 5].map((n) => answered(n, 200));
    const window2 = async () => {
      const applied = store.applyFilter({ ...NO_FILTER, window: 2 });
      await edge(2, 8, 5);
      await vi.waitFor(() =>
        http.expectOne(listPage(1)).flush(requestPage(five, { total: 5, per_page: 100 })),
      );
      await applied;
    };

    it('deve ler só as anteriores e somá-las ao que a janela já mostra, sem mudar a hora', async () => {
      await window2();
      const first = store.newestWindow();

      const older = store.lookBefore();
      expect(store.windowReading()).toEqual({ size: 4, looked: 2 });
      await edge(4, 6, 5);
      await vi.waitFor(() =>
        http.expectOne(listPage(1)).flush(requestPage(five, { total: 5, per_page: 100 })),
      );
      await older;

      expect(store.requests()).toEqual(five.slice(0, 4));
      expect(store.matched()).toBe(4);
      expect(store.newestWindow()).toEqual({ size: 4, at: first?.at, more: true });
      expect(store.windowReading()).toBeNull();
    });

    it('deve chegar ao fim da URL e deixar de oferecer as anteriores', async () => {
      await window2();

      const older = store.lookBefore();
      await vi.waitFor(() =>
        http
          .expectOne(edgeUrl(4))
          .flush(requestPage([], { total: 3, per_page: 1, current_page: 4 })),
      );
      await vi.waitFor(() =>
        http
          .expectOne(listPage(1))
          .flush(requestPage(five.slice(0, 3), { total: 3, per_page: 100 })),
      );
      await older;

      expect(store.requests()).toEqual(five.slice(0, 3));
      expect(store.newestWindow()).toMatchObject({ size: 3, more: false });

      await store.lookBefore();
    });

    it('deve contar as que chegaram depois da leitura ao achar a fronteira seguinte', async () => {
      await window2();
      store.arriveFiltered(answered(10, 200), 6);
      store.arriveFiltered(answered(11, 200), 7);

      const older = store.lookBefore();
      await edge(6, 6, 7);
      await vi.waitFor(() =>
        http.expectOne(listPage(1)).flush(
          requestPage([answered(11, 200), answered(10, 200), ...five], {
            total: 7,
            per_page: 100,
          }),
        ),
      );
      await older;

      expect(store.requests()).toEqual(five.slice(0, 4));
      expect(store.newestWindow()).toMatchObject({ size: 4, more: true });
    });

    it('deve seguir a busca da página onde a leitura parou, na ordem da lista', async () => {
      const page = (from: number) => Array.from({ length: 100 }, (_, i) => answered(from - i, 429));
      const sorted = store.toggleSorting();
      http.expectOne(`${listUrl}?page=1&sorting=oldest`).flush(requestPage([answered(1, 200)]));
      await sorted;
      const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 150 });
      await edge(150, 851, 10_000);
      (await search()).flush(requestPage(page(1000), { total: 900, is_last_page: false }));
      (await search()).flush(
        requestPage(page(900), { total: 900, current_page: 2, is_last_page: false }),
      );
      await applied;
      expect(store.requests()).toHaveLength(150);

      const older = store.lookBefore();
      await edge(300, 701, 10_000);
      const second = await search();
      expect(second.request.body).toMatchObject({ page: 2, per_page: 100, sorting: 'newest' });
      second.flush(requestPage(page(900), { total: 900, current_page: 2, is_last_page: false }));
      const third = await search();
      expect(third.request.body).toMatchObject({ page: 3 });
      third.flush(requestPage(page(800), { total: 900, current_page: 3, is_last_page: false }));
      await older;

      expect(store.requests()).toHaveLength(300);
      expect(store.requests()[0]).toEqual(answered(701, 429));
      expect(store.requests().at(-1)).toEqual(answered(1000, 429));
      expect(store.matched()).toBe(300);
    });

    it('não deve pedir nada sem a janela em vigor', async () => {
      await store.lookBefore();

      expect(store.newestWindow()).toBeNull();
    });
  });

  it('não deve ter janela Quando o filtro não a pede', async () => {
    const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    (await search()).flush(requestPage([]));
    await applied;

    expect(store.newestWindow()).toBeNull();
  });
});

describe('Dado uma resposta atrasada na lista (outra URL ou outro filtro a caminho)', () => {
  const OUTRA = '0b8f2c4e-1d2a-4c3b-9e5f-6a7b8c9d0e1f';
  const TERCEIRA = '7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f';
  const daOutra = (n: number) => webhookRequest(n, { token_id: OUTRA });
  const firstPage = (tokenId: string) => `/token/${tokenId}/requests?page=1&sorting=newest`;
  let http: HttpTestingController;
  let store: RequestStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(firstPage(TOKEN_ID))
      .flush(requestPage([webhookRequest(2), webhookRequest(1)], { is_last_page: false }));
    await loaded;
    store.select(webhookRequest(1).uuid);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve tirar da vista a lista e a mensagem aberta da anterior Quando outra URL começa a abrir', () => {
    void store.load(OUTRA);

    expect(store.opening()).toBe(OUTRA);
    expect(store.requests()).toEqual([]);
    expect(store.selected()).toBeUndefined();
    expect(store.loading()).toBe(true);
    http.expectOne(firstPage(OUTRA)).flush(requestPage([daOutra(9)]));
  });

  it('deve ficar com a lista da URL pedida por último Quando a da anterior responde depois', async () => {
    const lenta = store.load(OUTRA);
    const ultima = store.load(TERCEIRA);
    const [daLenta, daUltima] = [
      http.expectOne(firstPage(OUTRA)),
      http.expectOne(firstPage(TERCEIRA)),
    ];

    daUltima.flush(requestPage([webhookRequest(7, { token_id: TERCEIRA })], { total: 1 }));
    await ultima;
    daLenta.flush(requestPage([daOutra(9), daOutra(8)], { total: 2 }));
    await lenta;

    expect(store.tokenId()).toBe(TERCEIRA);
    expect(store.opening()).toBeNull();
    expect(store.requests().map((r) => r.token_id)).toEqual([TERCEIRA]);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('deve manter o esqueleto até a carga mais recente chegar Quando a anterior termina antes', async () => {
    const lenta = store.load(OUTRA);
    const ultima = store.load(TERCEIRA);
    const [daLenta, daUltima] = [
      http.expectOne(firstPage(OUTRA)),
      http.expectOne(firstPage(TERCEIRA)),
    ];

    daLenta.flush(requestPage([daOutra(9)]));
    await lenta;
    expect(store.loading()).toBe(true);
    expect(store.requests()).toEqual([]);

    daUltima.flush(requestPage([webhookRequest(7, { token_id: TERCEIRA })]));
    await ultima;
    expect(store.loading()).toBe(false);
  });

  it('não deve pôr a lista que estava a caminho Quando outra URL começa a abrir antes dela', async () => {
    const lenta = store.load(OUTRA);
    const daLenta = http.expectOne(firstPage(OUTRA));

    store.begin(TERCEIRA);
    daLenta.flush(requestPage([daOutra(9)]));
    await lenta;

    expect(store.opening()).toBe(TERCEIRA);
    expect(store.tokenId()).toBe(TOKEN_ID);
    expect(store.requests()).toEqual([]);
  });

  it('não deve reler nem buscar a lista da anterior Quando outra URL está abrindo', async () => {
    void store.load(OUTRA);

    await store.reload();
    await store.refreshSearch();
    await store.loadNextPage();
    await store.applyFilter({ ...NO_FILTER, text: 'x' });

    http.expectOne(firstPage(OUTRA)).flush(requestPage([daOutra(9)]));
    http.expectNone(() => true);
  });

  it('não deve anexar a página seguinte do filtro anterior Quando o filtro muda com ela a caminho', async () => {
    const proxima = store.loadNextPage();
    const pagina2 = http.expectOne(`${listUrl}?page=2&sorting=newest`);
    const aplicado = store.applyFilter({ ...NO_FILTER, text: 'velho' });
    http
      .expectOne({ method: 'POST', url: searchUrl })
      .flush(requestPage([webhookRequest(1)], { total: 1 }));
    await aplicado;

    pagina2.flush(requestPage([webhookRequest(0)], { current_page: 2 }));
    await proxima;

    expect(store.requests()).toEqual([webhookRequest(1)]);
    expect(store.range()).toEqual({ from: 1, to: 1, of: 1 });
  });

  it('não deve pôr a página anterior do filtro velho Quando o filtro muda com ela a caminho', async () => {
    const naPagina3 = store.load(TOKEN_ID, 3);
    http.expectOne(`${listUrl}?per_page=1&sorting=newest`).flush(requestPage([]));
    await vi.waitFor(() =>
      http
        .expectOne(`${listUrl}?page=3&sorting=newest`)
        .flush(requestPage([webhookRequest(5)], { current_page: 3 })),
    );
    await naPagina3;

    const anterior = store.loadPreviousPage();
    const pagina2 = http.expectOne(`${listUrl}?page=2&sorting=newest`);
    const aplicado = store.applyFilter({ ...NO_FILTER, text: 'velho' });
    http
      .expectOne({ method: 'POST', url: searchUrl })
      .flush(requestPage([webhookRequest(1)], { total: 1 }));
    await aplicado;
    pagina2.flush(requestPage([webhookRequest(4)], { current_page: 2 }));
    await anterior;

    expect(store.requests()).toEqual([webhookRequest(1)]);
  });

  it('deve manter o filtro novo Quando o 422 do anterior chega depois dele', async () => {
    const recusado = store.applyFilter({
      ...NO_FILTER,
      values: [{ kind: 'header', name: 'x-a', value: '1' }],
    });
    const busca422 = http.expectOne({ method: 'POST', url: searchUrl });
    const novo = store.applyFilter({ ...NO_FILTER, text: 'novo' });
    const buscaNova = http.match({ method: 'POST', url: searchUrl });
    buscaNova.at(-1)?.flush(requestPage([webhookRequest(2)], { total: 1 }));
    await novo;

    busca422.flush({ message: 'invalid' }, { status: 422, statusText: 'Unprocessable' });
    await recusado;

    expect(store.filter().text).toBe('novo');
    expect(store.requests()).toEqual([webhookRequest(2)]);
    expect(store.rejected()).toEqual([]);
  });

  it('deve dizer a janela só do filtro mais recente Quando a leitura do anterior responde depois', async () => {
    const edgeUrl = `${listUrl}?page=2&per_page=1&sorting=newest`;
    const velho = store.applyFilter({ ...NO_FILTER, answered: ['5xx'], window: 2 });
    const daVelha = http.expectOne(edgeUrl);
    const novo = store.applyFilter({ ...NO_FILTER, answered: ['4xx'] });
    const daNova = await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));
    daNova.flush(requestPage([webhookRequest(3, { response: { status: 404 } })], { total: 1 }));
    await novo;

    daVelha.flush(
      requestPage([webhookRequest(2, { seq: 2 })], { total: 700, per_page: 1, current_page: 2 }),
    );
    (await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }))).flush(
      requestPage([], { total: 0 }),
    );
    await velho;

    expect(store.newestWindow()).toBeNull();
    expect(store.matched()).toBe(1);
  });

  describe('Dado uma mensagem apagada com o Undo a caminho', () => {
    let desfazer!: (undo: boolean) => void;
    let apagada: Promise<'deleted' | 'restored' | 'kept'>;

    beforeEach(() => {
      apagada = store.deleteRequest(
        webhookRequest(1),
        new Promise((resolve) => (desfazer = resolve)),
      );
    });

    it('deve só cancelar o apagar, sem pôr a mensagem na lista nova, Quando o Undo vem em outra URL', async () => {
      const aberta = store.load(OUTRA);
      http.expectOne(firstPage(OUTRA)).flush(requestPage([daOutra(9)], { total: 1 }));
      await aberta;

      desfazer(true);

      expect(await apagada).toBe('kept');
      expect(store.requests()).toEqual([daOutra(9)]);
      expect(store.total()).toBe(1);
      http.expectNone({ method: 'DELETE' });
    });

    it('não deve repetir a mensagem Quando a lista foi relida antes do Undo', async () => {
      const relida = store.reload();
      http
        .expectOne(firstPage(TOKEN_ID))
        .flush(requestPage([webhookRequest(2), webhookRequest(1)], { total: 2 }));
      await relida;

      desfazer(true);

      expect(await apagada).toBe('restored');
      expect(store.requests()).toEqual([webhookRequest(2), webhookRequest(1)]);
      expect(store.total()).toBe(2);
    });
  });
});

describe('Dado o servidor sem responder à lista ou à busca', () => {
  const firstPage = `${listUrl}?page=1&sorting=newest`;
  const unavailable = { status: 503, statusText: 'Unavailable' };
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
    vi.useRealTimers();
    http.verify();
    localStorage.clear();
  });

  const failFirst = async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush({}, unavailable);
    await expect(loaded).rejects.toBeDefined();
  };

  it('deve ficar com a lista da URL em erro, sem total, Quando a primeira carga responde 503', async () => {
    await failFirst();

    expect(store.failure()).toEqual({ kind: 'list', status: 503, attempt: 0 });
    expect(store.tokenId()).toBe(TOKEN_ID);
    expect(store.opening()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.requests()).toEqual([]);
    expect(store.totalOf(TOKEN_ID)).toBeNull();
  });

  it('deve listar o que chega pelo tempo real com a lista em erro, com o total do evento', async () => {
    await failFirst();

    store.append(webhookRequest(4, { seq: 4 }), 4);

    expect(store.requests()).toEqual([webhookRequest(4, { seq: 4 })]);
    expect(store.totalOf(TOKEN_ID)).toBe(4);
    expect(store.failure()?.kind).toBe('list');
  });

  it('deve contar as tentativas seguidas e sair do erro Quando a lista enfim carrega', async () => {
    await failFirst();
    await failFirst();
    expect(store.failure()?.attempt).toBe(1);

    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush(requestPage([webhookRequest(1)], { total: 1 }));
    await loaded;

    expect(store.failure()).toBeNull();
    expect(store.requests()).toEqual([webhookRequest(1)]);
  });

  it('deve manter a lista já carregada, sem estado de erro, Quando a releitura da mesma URL falha', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush(requestPage([webhookRequest(1)], { total: 1 }));
    await loaded;

    await failFirst();

    expect(store.failure()).toBeNull();
    expect(store.requests()).toEqual([webhookRequest(1)]);
  });

  it.each([401, 404, 410])(
    'não deve pôr a lista em erro Quando a URL responde %i (quem mostra é o shell)',
    async (status) => {
      const loaded = store.load(TOKEN_ID);
      http.expectOne(firstPage).flush({}, { status, statusText: 'x' });
      await expect(loaded).rejects.toBeDefined();

      expect(store.failure()).toBeNull();
    },
  );

  it('deve esvaziar a área da lista e dizer o erro da busca, e buscar de novo pelo "Try again"', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush(requestPage([webhookRequest(1)], { total: 12 }));
    await loaded;

    const applied = store.applyFilter({ ...NO_FILTER, text: 'base' });
    http.expectOne(searchUrl).flush({}, unavailable);
    await applied;

    expect(store.failure()).toEqual({ kind: 'search', status: 503, attempt: 0 });
    expect(store.requests()).toEqual([]);
    expect(store.filter().text).toBe('base');
    expect(store.searching()).toBe(false);

    const again = store.retrySearch();
    http.expectOne(searchUrl).flush(requestPage([webhookRequest(1)], { total: 1 }));
    await again;

    expect(store.failure()).toBeNull();
    expect(store.requests()).toEqual([webhookRequest(1)]);
  });

  it('deve manter a lista filtrada como estava Quando a busca refeita por uma chegada falha', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush(requestPage([webhookRequest(1, { seq: 1 })], { total: 12 }));
    await loaded;
    const applied = store.applyFilter({ ...NO_FILTER, text: 'base' });
    http.expectOne(searchUrl).flush(requestPage([webhookRequest(1, { seq: 1 })], { total: 1 }));
    await applied;
    const nova = webhookRequest(2, { seq: 2 });
    store.arriveFiltered(nova, 13);

    const refreshed = store.refreshSearch();
    http.expectOne(searchUrl).flush({}, unavailable);
    await refreshed;

    expect(store.requests()).toEqual([webhookRequest(1, { seq: 1 })]);
    expect(store.failure()).toBeNull();

    const again = store.refreshSearch();
    http
      .expectOne(searchUrl)
      .flush(requestPage([nova, webhookRequest(1, { seq: 1 })], { total: 2 }));
    await again;
    expect(store.requests()).toEqual([nova, webhookRequest(1, { seq: 1 })]);
  });

  it('deve avisar da demora aos 30 s, sem cancelar a carga, e tirar o aviso Quando ela responde', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const loaded = store.load(TOKEN_ID);
    const call = http.expectOne(firstPage);

    vi.advanceTimersByTime(29_999);
    expect(store.slow()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.slow()).toBe(true);
    expect(call.cancelled).toBe(false);

    call.flush(requestPage([webhookRequest(1)], { total: 1 }));
    await loaded;
    expect(store.slow()).toBe(false);
  });

  it('deve avisar da demora da busca aos 30 s e tirar o aviso Quando ela responde', async () => {
    const loaded = store.load(TOKEN_ID);
    http.expectOne(firstPage).flush(requestPage([webhookRequest(1)], { total: 1 }));
    await loaded;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const applied = store.applyFilter({ ...NO_FILTER, text: 'base' });
    const call = http.expectOne(searchUrl);
    vi.advanceTimersByTime(30_000);
    expect(store.searchSlow()).toBe(true);

    call.flush(requestPage([], { total: 0 }));
    await applied;
    expect(store.searchSlow()).toBe(false);
  });
});

describe('Dado a página seguinte ou a anterior a caminho', () => {
  let http: HttpTestingController;
  let store: RequestStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID, 2);
    http.expectOne(`${listUrl}?per_page=1&sorting=newest`).flush(requestPage([]));
    await vi.waitFor(() =>
      http
        .expectOne(`${listUrl}?page=2&sorting=newest`)
        .flush(requestPage([webhookRequest(2)], { current_page: 2, is_last_page: false })),
    );
    await loaded;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve pedir a seguinte uma vez só e não pedir a anterior Quando os cliques se repetem', async () => {
    const primeira = store.loadNextPage();
    expect(store.paging()).toBe('next');
    await store.loadNextPage();
    await store.loadPreviousPage();
    http
      .expectOne(`${listUrl}?page=3&sorting=newest`)
      .flush(requestPage([webhookRequest(3)], { current_page: 3 }));
    await primeira;

    expect(store.paging()).toBeNull();
    expect(store.requests()).toEqual([webhookRequest(2), webhookRequest(3)]);
  });

  it('deve soltar a trava Quando a página falha', async () => {
    const anterior = store.loadPreviousPage();
    http
      .expectOne(`${listUrl}?page=1&sorting=newest`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await anterior;

    expect(store.paging()).toBeNull();
    expect(store.pageFailure()).toMatchObject({ status: 503, read: 'previous' });
  });
});
