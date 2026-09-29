import { LiveAnnouncer } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { routes } from '../app.routes';
import { ANNOUNCE_EVERY_MS } from './inbox';
import { Preferences } from '../settings/preferences';
import { Connection } from '../realtime/connection-store';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { NO_FILTER } from '../search/request-filter';
import { Redirector } from '../settings/redirect';
import { RequestList } from '../requests/request-list';
import { ScreenState } from '../shell/screen-state';
import { Viewport, WindowClass } from '../shell/viewport';

const NOVO_TOKEN = '11111111-1111-4111-8111-111111111111';
const [R1, R2] = [webhookRequest(1), webhookRequest(2)];

describe('Dado a tela principal', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let router: Router;
  let snack: MockInstance<MatSnackBar['open']>;

  const flush = async (
    url: string,
    body: object,
    init?: { status: number; statusText: string },
  ) => {
    const call = await vi.waitFor(() => http.expectOne(url));
    call.flush(body, init);
    return call;
  };
  const openToken = async (url: string) => {
    await harness.navigateByUrl(url);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2]));
  };
  const text = () => (harness.routeNativeElement as HTMLElement).textContent ?? '';

  /** Janela larga (lista e detalhe lado a lado); o jsdom não tem `matchMedia`. */
  const windowClass = signal<WindowClass>('large');

  beforeEach(async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    // O jsdom não rola: a lista virtual pede `scrollTo` ao ir para o fim.
    Element.prototype.scrollTo ??= () => undefined;
    windowClass.set('large');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('deve abrir a última URL do localStorage e a primeira mensagem Quando a raiz é aberta', async () => {
    TestBed.inject(Preferences).token.set(token());

    await openToken('/');

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    expect(text()).toContain(R1.uuid);
  });

  it('deve abrir o roteiro do endereço no lugar do detalhe e fechá-lo tirando o ?guide= (R1)', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}/${R1.uuid}/1?guide=retry`);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2]));
    await flush(`/token/${TOKEN_ID}/rules`, []);
    const root = harness.routeNativeElement as HTMLElement;

    const guide = await vi.waitFor(() => {
      const region = root.querySelector('section[aria-label="Guide: Test a retry"]');
      expect(region).not.toBeNull();
      return region as HTMLElement;
    });
    expect(root.querySelector('app-request-detail')).toBeNull();
    guide.querySelector<HTMLButtonElement>('button[aria-label="Close guide"]')?.click();

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    await vi.waitFor(() => expect(root.querySelector('app-request-detail')).not.toBeNull());
    expect(root.querySelector('section[aria-label^="Guide"]')).toBeNull();
  });

  it('deve deixar como não lida a mensagem que a tela abriu sozinha e marcá-la Quando ela é clicada (INBOX-02)', async () => {
    const preferences = TestBed.inject(Preferences);
    preferences.unread.set([R1.uuid, R2.uuid]);

    await openToken(`/${TOKEN_ID}`);

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    await harness.fixture.whenStable();
    expect(preferences.unread()).toEqual([R1.uuid, R2.uuid]);

    const root = harness.routeNativeElement as HTMLElement;
    root.querySelectorAll<HTMLButtonElement>('.item .select')[0].click();
    await vi.waitFor(() => expect(preferences.unread()).toEqual([R2.uuid]));
    root.querySelectorAll<HTMLButtonElement>('.item .select')[1].click();
    await vi.waitFor(() => expect(preferences.unread()).toEqual([]));
  });

  it('deve mostrar o status gravado na mensagem, sem ler as regras da URL (INBOX-13, C3)', async () => {
    const answered = webhookRequest(7, {
      rule: { id: 'r1', name: 'Pix' },
      response: { status: 201 },
    });
    await harness.navigateByUrl(`/${TOKEN_ID}`);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([answered, R1]));

    await vi.waitFor(() => expect(text()).toContain('201 · Pix'));
    http.expectNone(`/token/${TOKEN_ID}/rules`);
    // B2: o detalhe pede o trace da aberta, para achar a regra mais perto quando quem respondeu
    // foi uma pega-tudo. A regra com condições não ganha a frase.
    await flush(`/token/${TOKEN_ID}/request/${answered.uuid}/rules/trace`, {
      request: answered.uuid,
      responded_by: { id: 'r1', name: 'Pix' },
      rules: [
        {
          id: 'r1',
          name: 'Pix',
          enabled: true,
          position: 1,
          matches: true,
          failed: [],
          conditions: ['match.method'],
        },
      ],
    });
    await harness.fixture.whenStable();
    expect(text()).not.toContain('Closest rule');
  });

  it('deve criar uma URL nova e ir para ela Quando a raiz é aberta sem token salvo', async () => {
    await harness.navigateByUrl('/');

    const call = await flush('/token', token({ uuid: NOVO_TOKEN }));

    expect(call.request.method).toBe('POST');
    await vi.waitFor(() => expect(router.url).toBe(`/${NOVO_TOKEN}`));
    await flush(`/token/${NOVO_TOKEN}`, token({ uuid: NOVO_TOKEN }));
    await flush(`/token/${NOVO_TOKEN}/requests?page=1&sorting=newest`, requestPage([]));
    await vi.waitFor(() => expect(text()).toContain('Waiting for first request...'));
  });

  it('deve abrir filtrada pela query da rota, com o total da URL (filtros na rota)', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}?signature=invalid&methods=POST,FOO&q=abc`);
    await flush(`/token/${TOKEN_ID}`, token());

    const search = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests/search`));
    expect(search.request.body).toMatchObject({
      text: 'abc',
      match: { method: ['POST'], signature: 'invalid' },
      sorting: 'newest',
    });
    search.flush(requestPage([R1], { total: 1 }));
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2]));

    const store = TestBed.inject(RequestStore);
    await vi.waitFor(() => expect(store.total()).toBe(2));
    expect(store.filter()).toEqual({
      text: 'abc',
      methods: ['POST'],
      signature: 'invalid',
      schema: 'any',
    });
    expect(store.matched()).toBe(1);
  });

  // M1: o "Show in Inbox" do Health traz o motivo exato ou o caminho do erro de schema.
  it('deve abrir filtrada pelo motivo exato e pelo caminho do schema da rota (M1)', async () => {
    await harness.navigateByUrl(
      `/${TOKEN_ID}?signatureReason=timestamp%20outside%20tolerance&schemaPath=`,
    );
    await flush(`/token/${TOKEN_ID}`, token());

    const search = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests/search`));
    expect(search.request.body).toMatchObject({
      match: {},
      signature_reason: 'timestamp outside tolerance',
      schema_path: '',
    });
    search.flush(requestPage([R1], { total: 1 }));
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2]));

    const store = TestBed.inject(RequestStore);
    await vi.waitFor(() =>
      expect(store.filter()).toMatchObject({
        signatureReason: 'timestamp outside tolerance',
        schemaPath: '',
      }),
    );
  });

  // A rota acompanha o filtro da tela, e o eco dessa navegação chega depois: se a tela já mudou de
  // novo (a pessoa digitou na busca), o eco não pode desfazer o que ela fez.
  it('não deve desfazer o filtro da tela com o eco atrasado da própria navegação', async () => {
    await openToken(`/${TOKEN_ID}`);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    const store = TestBed.inject(RequestStore);
    const searchUrl = `/token/${TOKEN_ID}/requests/search`;
    // A primeira navegação (a rota acompanhando o filtro) fica presa, como numa máquina lenta.
    const real = router.navigate.bind(router);
    const navigate = vi
      .spyOn(router, 'navigate')
      .mockImplementationOnce(() => Promise.resolve(true))
      .mockImplementation(real);

    const first = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
    await flush(searchUrl, requestPage([R1, R2]));
    await first;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const second = store.applyFilter({ ...NO_FILTER, methods: ['POST'], text: '/a' });
    await flush(searchUrl, requestPage([R1]));
    await second;
    await vi.waitFor(() => expect(router.url).toContain('q=%2Fa'));

    // Só agora a rota da primeira mudança chega.
    await router.navigateByUrl(`/${TOKEN_ID}/${R1.uuid}/1?methods=POST`);
    await harness.fixture.whenStable();

    expect(store.filter()).toMatchObject({ methods: ['POST'], text: '/a' });
    http.expectNone(searchUrl);
    // E a rota volta a dizer o filtro que está na tela.
    await vi.waitFor(() => expect(router.url).toContain('q=%2Fa'));
  });

  describe('Dado um filtro que deixa a requisição aberta de fora (B1, UX-05)', () => {
    const root = () => harness.routeNativeElement as HTMLElement;
    const note = () => root().querySelector('.detail-pane .outside');
    const filterBy = async (found: WebhookRequest[]) => {
      const applied = TestBed.inject(RequestStore).applyFilter({ ...NO_FILTER, methods: ['POST'] });
      await flush(`/token/${TOKEN_ID}/requests/search`, requestPage(found));
      await applied;
      await harness.fixture.whenStable();
    };

    it('deve manter a aberta, dizer que ela está fora do filtro e oferecer o primeiro resultado', async () => {
      await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);
      await vi.waitFor(() => expect(text()).toContain(R2.uuid));
      expect(note()).toBeNull();

      await filterBy([R1]);

      expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1?methods=POST`);
      expect(TestBed.inject(RequestStore).selected()?.uuid).toBe(R2.uuid);
      expect(note()?.textContent).toContain('This request is not in the current filter.');

      note()?.querySelector('button')?.click();

      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1?methods=POST`));
      await vi.waitFor(() => expect(note()).toBeNull());
    });

    it('não deve oferecer o primeiro resultado Quando nada casa, nem avisar Quando a aberta casa', async () => {
      await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);
      await vi.waitFor(() => expect(text()).toContain(R2.uuid));

      await filterBy([]);
      expect(note()?.textContent).toContain('This request is not in the current filter.');
      expect(note()?.querySelector('button')).toBeNull();

      const applied = TestBed.inject(RequestStore).applyFilter({ ...NO_FILTER, methods: ['GET'] });
      await flush(`/token/${TOKEN_ID}/requests/search`, requestPage([R2]));
      await applied;
      await harness.fixture.whenStable();
      expect(note()).toBeNull();
    });
  });

  it('deve pôr o "Copy as anzol wait-for" na linha do cabeçalho da lista, e não no celular (INBOX-10)', async () => {
    await openToken(`/${TOKEN_ID}`);
    await vi.waitFor(() => expect(text()).toContain(R1.uuid));
    const tools = () => (harness.routeNativeElement as HTMLElement).querySelector('.list-tools');

    expect(tools()?.querySelector('app-wait-for-button button')?.getAttribute('aria-label')).toBe(
      'Copy as anzol wait-for',
    );

    windowClass.set('compact');
    await harness.fixture.whenStable();
    expect(tools()?.querySelector('app-wait-for-button')).toBeNull();
  });

  it('deve abrir a mensagem do link Quando o link traz token, mensagem e página', async () => {
    await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);

    await vi.waitFor(() => expect(text()).toContain(R2.uuid));
    expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`);
    expect(text()).not.toContain(R1.uuid);
  });

  // Com a mais nova no topo, as novas empurram cada mensagem para as páginas seguintes: o link
  // permanente não pode depender de ela ainda estar na página que ele traz.
  it('deve buscar a mensagem pela API e abri-la Quando o link permanente aponta uma que não está na página', async () => {
    const R9 = webhookRequest(9);
    const store = TestBed.inject(RequestStore);

    await openToken(`/${TOKEN_ID}/${R9.uuid}/1`);
    await flush(`/token/${TOKEN_ID}/request/${R9.uuid}`, R9);

    await vi.waitFor(() => expect(text()).toContain(R9.uuid));
    expect(router.url).toBe(`/${TOKEN_ID}/${R9.uuid}/1`);
    expect(store.selected()?.uuid).toBe(R9.uuid);
  });

  // B2 (CA-5): o link diz qual abrir; se ela não existe, o detalhe diz isso e nenhuma outra entra.
  it('deve mostrar o estado vazio, sem abrir outra nem mudar o endereço, Quando a requisição do link não existe (404)', async () => {
    const R9 = webhookRequest(9);

    await openToken(`/${TOKEN_ID}/${R9.uuid}/1`);
    await flush(
      `/token/${TOKEN_ID}/request/${R9.uuid}`,
      {},
      { status: 404, statusText: 'Not Found' },
    );

    await vi.waitFor(() => expect(text()).toContain('This request no longer exists.'));
    expect(text()).toContain('No other request was opened in its place.');
    expect(router.url).toBe(`/${TOKEN_ID}/${R9.uuid}/1`);
    expect(TestBed.inject(RequestStore).selected()).toBeUndefined();
  });

  it('deve dizer que não carregou, e não que não existe, Quando o servidor não responde ao link', async () => {
    const R9 = webhookRequest(9);

    await openToken(`/${TOKEN_ID}/${R9.uuid}/1`);
    await flush(`/token/${TOKEN_ID}/request/${R9.uuid}`, {}, { status: 0, statusText: '' });

    await vi.waitFor(() =>
      expect(text()).toContain('Could not load this request. The server did not answer.'),
    );
    expect(text()).not.toContain('no longer exists');
    (harness.routeNativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('app-request-unopened button')
      ?.click();
    await flush(`/token/${TOKEN_ID}/request/${R9.uuid}`, R9);
    await vi.waitFor(() => expect(TestBed.inject(RequestStore).selected()?.uuid).toBe(R9.uuid));
  });

  it('deve manter a cópia com o aviso da limpeza Quando a aberta pelo link permanente, fora da lista, é cortada ao vivo', async () => {
    const [R0, R3] = [webhookRequest(10), webhookRequest(3)];
    await harness.navigateByUrl(`/${TOKEN_ID}/${R0.uuid}/1`);
    await flush(`/token/${TOKEN_ID}`, token({ auto_cleanup: 500 }));
    await flush(
      `/token/${TOKEN_ID}/requests?page=1&sorting=newest`,
      requestPage([R2, R1], { total: 3, is_last_page: false }),
    );
    await flush(`/token/${TOKEN_ID}/request/${R0.uuid}`, R0);
    await vi.waitFor(() => expect(text()).toContain(R0.uuid));

    FakeEventSource.latest().emit('request.created', {
      request: R3,
      total: 3,
      truncated: false,
      removed: [R0.uuid],
    });

    await vi.waitFor(() =>
      expect(text()).toMatch(
        /This request was deleted from the server by auto cleanup \(keeps the newest 500\), noticed at/,
      ),
    );
    expect(router.url).toBe(`/${TOKEN_ID}/${R0.uuid}/1`);
    expect(TestBed.inject(RequestStore).selected()?.uuid).toBe(R0.uuid);
  });

  // B1 (P1 decidida): nenhuma tela cria URL sem a pessoa pedir; a página única de URL inexistente
  // (no shell) assume.
  it('não deve criar outra URL nem sair do endereço Quando o token do link sumiu (410)', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}`);

    await flush(`/token/${TOKEN_ID}`, { success: false }, { status: 410, statusText: 'Gone' });
    await new Promise((resolve) => setTimeout(resolve));

    http.expectNone('/token');
    http.expectNone(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`);
    expect(router.url).toBe(`/${TOKEN_ID}`);
    expect(snack).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('não deve criar outra URL nem avisar Quando o token do link é protegido e o acesso falta (401)', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}`);

    await flush(
      `/token/${TOKEN_ID}`,
      { error: 'This URL is protected', protected: true },
      { status: 401, statusText: 'Unauthorized' },
    );
    await new Promise((resolve) => setTimeout(resolve));

    http.expectNone('/token');
    http.expectNone(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`);
    expect(snack).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(router.url).toBe(`/${TOKEN_ID}`);
  });

  it('deve fechar o stream na aba de regras e recarregar a lista e reabri-lo Quando volta para "Requests"', async () => {
    await openToken(`/${TOKEN_ID}`);
    await vi.waitFor(() => expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`));
    const primeiro = FakeEventSource.latest();

    await harness.navigateByUrl(`/${TOKEN_ID}/rules`);
    await flush(`/token/${TOKEN_ID}/rules`, []);
    await flush(`/token/${TOKEN_ID}/stats`, {});
    expect(primeiro.readyState).toBe(FakeEventSource.CLOSED);
    // Regras abre o próprio stream (WM-38, a lista ao vivo), que fecha ao sair.
    const regras = FakeEventSource.latest();
    expect(regras).not.toBe(primeiro);

    await openToken(`/${TOKEN_ID}`);

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(3));
    expect(regras.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.latest().readyState).not.toBe(FakeEventSource.CLOSED);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
  });

  it('deve reabrir a mensagem que estava aberta Quando volta à Inbox de outro destino', async () => {
    await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);
    await vi.waitFor(() => expect(text()).toContain(R2.uuid));

    await harness.navigateByUrl(`/${TOKEN_ID}/rules`);
    await flush(`/token/${TOKEN_ID}/rules`, []);
    await flush(`/token/${TOKEN_ID}/stats`, {});
    await openToken(`/${TOKEN_ID}`);

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
  });

  // A limpeza reduzida em Checks corta sem evento: na volta, a aberta pode ter saído.
  it('deve abrir a mais antiga que ficou Quando a mensagem aberta foi cortada enquanto a Inbox estava fechada', async () => {
    const R0 = webhookRequest(10);
    await openToken(`/${TOKEN_ID}/${R0.uuid}/1`);
    await flush(`/token/${TOKEN_ID}/request/${R0.uuid}`, R0);
    await vi.waitFor(() => expect(text()).toContain(R0.uuid));

    await harness.navigateByUrl(`/${TOKEN_ID}/rules`);
    await flush(`/token/${TOKEN_ID}/rules`, []);
    await flush(`/token/${TOKEN_ID}/stats`, {});
    await openToken(`/${TOKEN_ID}`);
    await flush(
      `/token/${TOKEN_ID}/request/${R0.uuid}`,
      {},
      { status: 404, statusText: 'Not Found' },
    );

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
  });

  it('deve ter um h1 "Inbox" escondido na janela larga, e nenhum no celular (o do shell vale) (UX-21)', async () => {
    await openToken(`/${TOKEN_ID}`);
    const root = harness.routeNativeElement as HTMLElement;
    await vi.waitFor(() => expect(root.querySelectorAll('.item')).toHaveLength(2));

    expect([...root.querySelectorAll('h1')].map((h1) => h1.textContent)).toEqual(['Inbox']);
    expect(root.querySelector('main')?.getAttribute('aria-label')).toBe('Inbox');

    windowClass.set('compact');
    await harness.fixture.whenStable();
    expect(root.querySelectorAll('h1')).toHaveLength(0);
  });

  describe('Dado a volta da conexão (B1, UX-16)', () => {
    const restore = () => TestBed.inject(Connection).restored.update((count) => count + 1);

    it('deve buscar o que chegou depois da última seq e juntar na pílula, sem trocar a aberta', async () => {
      const [S1, S2] = [webhookRequest(1, { seq: 11 }), webhookRequest(2, { seq: 12 })];
      await harness.navigateByUrl(`/${TOKEN_ID}/${S2.uuid}/1`);
      await flush(`/token/${TOKEN_ID}`, token());
      await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([S2, S1]));
      await vi.waitFor(() => expect(text()).toContain(S2.uuid));
      const chegou = webhookRequest(3, { seq: 13 });

      restore();
      await flush(`/token/${TOKEN_ID}/requests?after=12`, requestPage([chegou], { total: 3 }));

      const store = TestBed.inject(RequestStore);
      await vi.waitFor(() => expect(store.requests()).toEqual([chegou, S2, S1]));
      expect(store.total()).toBe(3);
      expect(store.unread()).toContain(chegou.uuid);
      expect(router.url).toBe(`/${TOKEN_ID}/${S2.uuid}/1`);
      await vi.waitFor(() => expect(text()).toContain('1 new request'));
      expect(snack).not.toHaveBeenCalled();

      // A reconexão do tempo real repete a mesma: não entra duas vezes.
      FakeEventSource.latest().emit('request.created', { request: chegou, total: 3 });
      await harness.fixture.whenStable();
      expect(store.requests()).toEqual([chegou, S2, S1]);
    });

    it('deve refazer a busca, no lugar de pedir pela seq, Quando há filtro', async () => {
      await openToken(`/${TOKEN_ID}`);
      const store = TestBed.inject(RequestStore);
      const applied = store.applyFilter({ ...NO_FILTER, methods: ['POST'] });
      await flush(`/token/${TOKEN_ID}/requests/search`, requestPage([R1], { total: 1 }));
      await applied;

      restore();

      await flush(`/token/${TOKEN_ID}/requests/search`, requestPage([R1], { total: 1 }));
    });
  });

  describe('Dado o stream SSE aberto', () => {
    beforeEach(async () => {
      await openToken(`/${TOKEN_ID}`);
      await vi.waitFor(() =>
        expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`),
      );
    });

    it('deve listar e contar como não lida, sem aviso, Quando chega request.created com o fim da lista à vista', async () => {
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 3,
        truncated: false,
      });

      await vi.waitFor(() => expect(TestBed.inject(RequestStore).unread()).toEqual([nova.uuid]));
      await vi.waitFor(() => expect(text()).toContain('Requests (3)'));
      expect(text()).toContain(`#${nova.uuid.substring(0, 5)}`);
      expect(snack).not.toHaveBeenCalledWith(
        expect.stringMatching(/^Request received/),
        'View',
        expect.anything(),
      );
    });

    it('deve avisar "Request received" com "View" (4 s) e abrir a nova no "View" Quando ela chega fora da vista', async () => {
      vi.spyOn(RequestList.prototype, 'receive').mockReturnValue(false);
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 3,
        truncated: false,
      });

      await vi.waitFor(() =>
        // INBOX-15: o aviso diz o método e a rota da que chegou.
        expect(snack).toHaveBeenCalledWith('Request received · POST /', 'View', { duration: 4000 }),
      );
      snack.mock.results.at(-1)?.value.dismissWithAction();
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${nova.uuid}/1`));
    });

    it('deve tirar as cortadas e manter a aberta como cópia, com o aviso, Quando ela sai pela limpeza automática (B2)', async () => {
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 2,
        truncated: false,
        removed: [R1.uuid],
      });

      await vi.waitFor(() =>
        expect(text()).toContain('This request was deleted from the server by auto cleanup'),
      );
      const store = TestBed.inject(RequestStore);
      // A mais nova no topo (INBOX-01): a nova entra antes das que ficaram; nenhuma outra abre.
      expect(store.requests().map((request) => request.uuid)).toEqual([nova.uuid, R2.uuid]);
      expect(store.selected()?.uuid).toBe(R1.uuid);
      expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
      expect(text()).toContain('Requests (2)');
    });

    it('deve buscar a mensagem completa pela API Quando o evento chega truncado (> 1 MB)', async () => {
      const cortada = webhookRequest(3, { content: null });

      FakeEventSource.latest().emit('request.created', {
        request: cortada,
        total: 3,
        truncated: true,
      });

      const call = await flush(`/token/${TOKEN_ID}/request/${cortada.uuid}`, webhookRequest(3));
      expect(call.request.method).toBe('GET');
      await vi.waitFor(() =>
        expect(TestBed.inject(RequestStore).newest()).toEqual(webhookRequest(3)),
      );
    });

    it('deve refazer a busca uma vez, sem pôr a nova direto na lista nem trocar a aberta Quando chegam mensagens com filtro ativo', async () => {
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
      const store = TestBed.inject(RequestStore);
      const searchUrl = `/token/${TOKEN_ID}/requests/search`;
      const applied = store.applyFilter({ ...NO_FILTER, text: 'pedido' });
      await flush(searchUrl, requestPage([R2], { total: 1 }));
      await applied;
      const [R3, R4] = [webhookRequest(3), webhookRequest(4)];

      FakeEventSource.latest().emit('request.created', { request: R3, total: 3, truncated: false });
      FakeEventSource.latest().emit('request.created', { request: R4, total: 4, truncated: false });

      await vi.waitFor(() =>
        expect(
          snack.mock.calls.filter(([message]) => message.startsWith('Request received')),
        ).toHaveLength(2),
      );
      expect(store.requests()).toEqual([R2]);
      expect(store.total()).toBe(4);
      const call = await flush(searchUrl, requestPage([R2, R4], { total: 2 }));
      expect(call.request.body).toMatchObject({ text: 'pedido', page: 1 });
      await vi.waitFor(() => expect(store.requests()).toEqual([R2, R4]));
      expect(store.matched()).toBe(2);
      // A busca vai para a rota (link compartilhável) e a aberta continua.
      expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1?q=pedido`);
      expect(store.selected()).toEqual(R1);
    });

    it('deve ir para a mensagem nova e reenviá-la Quando auto-navegar e redirect estão ligados', async () => {
      const preferences = TestBed.inject(Preferences);
      preferences.autoNavEnable.set(true);
      preferences.redirectEnable.set(true);
      const redirect = vi.spyOn(TestBed.inject(Redirector), 'redirect').mockResolvedValue();
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 3,
        truncated: false,
      });

      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${nova.uuid}/1`));
      expect(redirect).toHaveBeenCalledWith(nova);
    });
  });

  it('deve comparar no painel de ação e levar à página do Compare pelo "Open full comparison"', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    const root = () => harness.routeNativeElement as HTMLElement;
    // INBOX-19: o rótulo visível é "Compare"; o nome acessível, "Compare with…".
    const compareWith = () =>
      root().querySelector<HTMLButtonElement>('button[aria-label="Compare with…"]');
    await vi.waitFor(() => expect(compareWith()).not.toBeNull());

    compareWith()?.click();
    await harness.fixture.whenStable();
    expect(text()).toContain(`Choose a request to compare with #${R1.uuid.substring(0, 5)}`);
    expect(text()).toContain(
      `Pick a request in the list to compare with #${R1.uuid.substring(0, 5)}.`,
    );
    root().querySelectorAll<HTMLButtonElement>('.item .select')[1].click();

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root().querySelector('app-action-panel app-request-compare .id-b')?.textContent).toBe(
        `#${R2.uuid.substring(0, 5)}`,
      );
    });
    expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
    expect(root().querySelector('app-request-detail')).not.toBeNull();
    [...root().querySelectorAll<HTMLAnchorElement>('app-action-panel a')]
      .find((link) => link.textContent?.trim() === 'Open full comparison')
      ?.click();
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/compare/${R1.uuid}/${R2.uuid}`));
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);
  });

  it('deve abrir a mais antiga com J e a mais nova com K, e não com o foco num campo', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    await vi.waitFor(() => expect(text()).toContain(R1.uuid));
    const press = (key: string, target: EventTarget = document.body) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    // A lista vem da API com a mais nova primeiro (R1 no topo): J desce para a mais antiga.
    press('j');
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
    press('k');
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));

    const input = document.body.appendChild(document.createElement('input'));
    press('k', input);
    input.remove();
    await harness.fixture.whenStable();
    expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
  });

  it('deve levar o foco ao título do detalhe Quando o item é aberto pelo teclado, e de volta ao item com Esc (B1)', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    const root = harness.routeNativeElement as HTMLElement;
    await vi.waitFor(() => expect(root.querySelectorAll('.item .select')).toHaveLength(2));
    const second = root.querySelectorAll<HTMLButtonElement>('.item .select')[1];

    // Enter num botão chega como clique sem ponteiro (`detail` 0).
    second.focus();
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(root.querySelector('.detail-pane h2.route')),
    );

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(root.querySelector('.item .select[aria-current="true"]')),
    );
    expect(document.activeElement?.getAttribute('data-uuid')).toBe(R2.uuid);
  });

  it('deve mostrar um painel por vez: a lista ao abrir a URL, o detalhe pelo link permanente ou pelo clique, e "Back to requests"', async () => {
    windowClass.set('compact');
    await openToken(`/${TOKEN_ID}`);
    const root = harness.routeNativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelectorAll('.item .select')).toHaveLength(2);
    });
    expect(root.querySelector('app-request-detail')).toBeNull();

    root.querySelectorAll<HTMLButtonElement>('.item .select')[1].click();
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelector('app-request-detail')).not.toBeNull();
    });
    expect(root.querySelector('app-request-list')).toBeNull();
    // INBOX-30/33: o detalhe em tela cheia tira o cartão da URL, e o Back abre o cabeçalho dele.
    const screen = TestBed.inject(ScreenState);
    expect(screen.detailFullscreen()).toBe(true);
    const back = root.querySelector<HTMLButtonElement>('button[aria-label="Back to requests"]');
    expect(back?.closest('header')?.querySelector('h2')).not.toBeNull();

    back?.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('app-request-list')).not.toBeNull();
    expect(screen.detailFullscreen()).toBe(false);
    // O foco volta ao item de onde se saiu (não cai no body).
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(root.querySelector('.item .select[aria-current="true"]')),
    );
    expect(document.activeElement?.getAttribute('aria-label')).toContain(
      `#${R2.uuid.substring(0, 5)}`,
    );
  });

  it('deve mostrar a lista com a primeira mensagem Quando ela chega numa URL vazia na janela estreita (E11)', async () => {
    windowClass.set('compact');
    await harness.navigateByUrl(`/${TOKEN_ID}`);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([]));
    await vi.waitFor(() => expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`));
    const root = harness.routeNativeElement as HTMLElement;

    FakeEventSource.latest().emit('request.created', { request: R1, total: 1, truncated: false });

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
    });
    await harness.fixture.whenStable();
    // Quem mandou a primeira (o "Send a test request") a vê chegar na lista, sem trocar de tela.
    expect(root.querySelector('app-request-list')).not.toBeNull();
    expect(text()).toContain('Requests (1)');
    expect(root.querySelector('app-request-detail')).toBeNull();
    // O detalhe não veio para a frente: ninguém a leu ainda.
    expect(TestBed.inject(Preferences).unread()).toEqual([R1.uuid]);
  });

  it('deve abrir a primeira no detalhe e contá-la como lida Quando ela chega numa URL vazia na janela larga', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}`);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([]));
    await vi.waitFor(() => expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`));

    FakeEventSource.latest().emit('request.created', { request: R1, total: 1, truncated: false });

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    await vi.waitFor(() => expect(text()).toContain(R1.uuid));
    // Quem espera a primeira a vê chegar no detalhe, ao lado da lista.
    expect(TestBed.inject(Preferences).unread()).toEqual([]);
  });

  describe('Dado a primeira requisição de uma URL vazia', () => {
    const arrive = async () => {
      await harness.navigateByUrl(`/${TOKEN_ID}`);
      await flush(`/token/${TOKEN_ID}`, token());
      await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([]));
      await vi.waitFor(() =>
        expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`),
      );
      await vi.waitFor(() => expect(text()).toContain('Your URL is ready'));
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = webhookRequest(1, { url: `http://localhost:8084/${TOKEN_ID}/pedidos?x=1` });
      FakeEventSource.latest().emit('request.created', {
        request: first,
        total: 1,
        truncated: false,
      });
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${first.uuid}/1`));
      await harness.fixture.whenStable();
      vi.advanceTimersByTime(ANNOUNCE_EVERY_MS);
      vi.useRealTimers();
      return { announce, root: harness.routeNativeElement as HTMLElement };
    };
    const strip = (root: HTMLElement) => root.querySelector<HTMLElement>('section.first');

    it('deve trocar o "Your URL is ready" pela faixa "First request arrived", com os passos 3 a 5, e anunciar uma vez', async () => {
      const { announce, root } = await arrive();

      await vi.waitFor(() => expect(strip(root)).not.toBeNull());
      expect(strip(root)?.getAttribute('aria-labelledby')).toBe('first-arrival-title');
      expect(strip(root)?.querySelector('h2')?.textContent?.trim()).toBe('First request arrived');
      expect(strip(root)?.textContent).toContain('POST /pedidos, at');
      expect(
        [...(strip(root)?.querySelectorAll('a') ?? [])].map((link) => [
          link.textContent?.trim(),
          link.getAttribute('href'),
        ]),
      ).toEqual([
        ["Check the provider's signature", `/${TOKEN_ID}/checks?section=signature`],
        ['Choose the answer', `/${TOKEN_ID}/rules/new`],
        ['Test a retry', `/${TOKEN_ID}?guide=retry`],
      ]);
      expect(text()).not.toContain('Your URL is ready');
      const said = announce.mock.calls.map(([message]) => String(message));
      expect(said.filter((message) => message.startsWith('First request arrived'))).toHaveLength(1);
      expect(said).not.toContain('1 new request arrived');
    });

    it('deve sumir com "Dismiss" e não voltar nesta URL', async () => {
      const { root } = await arrive();
      await vi.waitFor(() => expect(strip(root)).not.toBeNull());

      [...(strip(root)?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === 'Dismiss')
        ?.click();
      await harness.fixture.whenStable();

      expect(strip(root)).toBeNull();
      expect(JSON.parse(localStorage.getItem(`anzol.guides.${TOKEN_ID}`) ?? '[]')).toEqual([
        'first',
      ]);
    });
  });

  it('deve abrir os roteiros pelo "Guides" do cabeçalho da lista', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    const root = harness.routeNativeElement as HTMLElement;
    const guides = await vi.waitFor(() => {
      const found = root.querySelector<HTMLButtonElement>('button.guides');
      expect(found?.textContent?.trim()).toBe('Guides');
      return found as HTMLButtonElement;
    });

    guides.click();
    await harness.fixture.whenStable();
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'First webhook',
      'Test a retry',
    ]);
    items[0].click();

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1?guide=first`));
    await flush(`/token/${TOKEN_ID}/rules`, []);
  });

  it('deve fechar o painel de ação com Esc, sem voltar à lista', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    const root = harness.routeNativeElement as HTMLElement;
    await vi.waitFor(() => expect(root.querySelector('app-request-detail')).not.toBeNull());
    const press = (key: string) =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    press('p');
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelector('app-action-panel')).not.toBeNull();
    });
    press('Escape');
    await harness.fixture.whenStable();

    expect(root.querySelector('app-action-panel')).toBeNull();
    expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
    expect(root.querySelector('app-request-detail')).not.toBeNull();
  });

  it('deve abrir o detalhe em tela cheia pelo link permanente Quando a janela é estreita (CA-8/CA-9)', async () => {
    windowClass.set('compact');
    await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);
    const root = harness.routeNativeElement as HTMLElement;

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelector('app-request-detail')).not.toBeNull();
    });
    expect(text()).toContain(R2.uuid);
    expect(root.querySelector('button[aria-label="Back to requests"]')).not.toBeNull();
  });

  it('deve guardar o "Follow new" na chave de hoje (autoNavEnable)', async () => {
    await openToken(`/${TOKEN_ID}`);
    const root = harness.routeNativeElement as HTMLElement;
    const follow = await vi.waitFor(() => {
      const found = root.querySelector<HTMLButtonElement>('button[role="switch"]');
      expect(found?.closest('mat-slide-toggle')?.textContent).toContain('Follow new');
      return found as HTMLButtonElement;
    });

    follow.click();

    expect(localStorage.getItem('autoNavEnable')).toBe('true');
  });
});
