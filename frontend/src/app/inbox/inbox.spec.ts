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
import { Preferences } from '../settings/preferences';
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

  // A limpeza automática corta as mais antigas: a vizinha da que sumiu é a mais antiga que ficou
  // (a primeira da lista quando a ordem era a da API).
  it('deve abrir a mais antiga que ficou Quando a mensagem do link permanente não existe mais (404)', async () => {
    const R9 = webhookRequest(9);

    await openToken(`/${TOKEN_ID}/${R9.uuid}/1`);
    await flush(
      `/token/${TOKEN_ID}/request/${R9.uuid}`,
      {},
      { status: 404, statusText: 'Not Found' },
    );

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
  });

  it('deve abrir a mais antiga que ficou Quando a aberta pelo link permanente, fora da lista, é cortada ao vivo', async () => {
    const [R0, R3] = [webhookRequest(10), webhookRequest(3)];
    await harness.navigateByUrl(`/${TOKEN_ID}/${R0.uuid}/1`);
    await flush(`/token/${TOKEN_ID}`, token());
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
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=oldest`, requestPage([R1]));

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
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

    it('deve tirar as cortadas e abrir a mais próxima Quando a mensagem aberta sai pela limpeza automática', async () => {
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 2,
        truncated: false,
        removed: [R1.uuid],
      });

      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`));
      const store = TestBed.inject(RequestStore);
      // A mais nova no topo (INBOX-01): a nova entra antes das que ficaram.
      expect(store.requests().map((request) => request.uuid)).toEqual([nova.uuid, R2.uuid]);
      expect(store.selected()?.uuid).toBe(R2.uuid);
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

  it('deve abrir a página do Compare pela rota, com A e B marcadas na lista, e voltar à A Quando "Compare with…" é usado', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    const root = () => harness.routeNativeElement as HTMLElement;
    const button = (label: string) =>
      [...root().querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    // INBOX-19: o rótulo visível é "Compare"; o nome acessível, "Compare with…".
    const compareWith = () =>
      root().querySelector<HTMLButtonElement>('button[aria-label="Compare with…"]');
    await vi.waitFor(() => expect(compareWith()).not.toBeNull());

    compareWith()?.click();
    await harness.fixture.whenStable();
    expect(text()).toContain(`Choose a request to compare with #${R1.uuid.substring(0, 5)}`);
    root().querySelectorAll<HTMLButtonElement>('.item .select')[1].click();

    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/compare/${R1.uuid}/${R2.uuid}`));
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root().querySelector('app-request-compare .id-b')?.textContent).toBe(
        `#${R2.uuid.substring(0, 5)}`,
      );
    });
    expect([...root().querySelectorAll('.item .tag')].map((tag) => tag.textContent)).toEqual([
      'A',
      'B',
    ]);

    button('Close')?.click();
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2]));
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root().querySelector('app-request-detail')).not.toBeNull();
    });
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
