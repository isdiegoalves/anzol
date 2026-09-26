import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { routes } from '../app.routes';
import { Preferences } from '../settings/preferences';
import { RequestStore } from '../requests/request-store';
import { NO_FILTER } from '../search/request-filter';
import { Redirector } from '../settings/redirect';

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
    await flush(`/token/${TOKEN_ID}/requests?page=1`, requestPage([R1, R2]));
  };
  const text = () => (harness.routeNativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
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

  it('deve criar uma URL nova e ir para ela Quando a raiz é aberta sem token salvo', async () => {
    await harness.navigateByUrl('/');

    const call = await flush('/token', token({ uuid: NOVO_TOKEN }));

    expect(call.request.method).toBe('POST');
    await vi.waitFor(() => expect(router.url).toBe(`/${NOVO_TOKEN}`));
    await flush(`/token/${NOVO_TOKEN}`, token({ uuid: NOVO_TOKEN }));
    await flush(`/token/${NOVO_TOKEN}/requests?page=1`, requestPage([]));
    await vi.waitFor(() => expect(text()).toContain('Waiting for first request...'));
  });

  it('deve abrir a mensagem do link Quando o link traz token, mensagem e página', async () => {
    await openToken(`/${TOKEN_ID}/${R2.uuid}/1`);

    await vi.waitFor(() => expect(text()).toContain(R2.uuid));
    expect(router.url).toBe(`/${TOKEN_ID}/${R2.uuid}/1`);
    expect(text()).not.toContain(R1.uuid);
  });

  it('deve criar outra URL e avisar Quando o token do link não existe mais (410)', async () => {
    await harness.navigateByUrl(`/${TOKEN_ID}`);

    await flush(`/token/${TOKEN_ID}`, { success: false }, { status: 410, statusText: 'Gone' });
    await flush('/token', token({ uuid: NOVO_TOKEN }));

    await vi.waitFor(() =>
      expect(snack).toHaveBeenCalledWith('URL not found. Invalid ID, created new URL', undefined, {
        duration: 10000,
      }),
    );
    await flush(`/token/${NOVO_TOKEN}`, token({ uuid: NOVO_TOKEN }));
    await flush(`/token/${NOVO_TOKEN}/requests?page=1`, requestPage([]));
    expect(router.url).toBe(`/${NOVO_TOKEN}`);
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
    http.expectNone(`/token/${TOKEN_ID}/requests?page=1`);
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
    expect(primeiro.readyState).toBe(FakeEventSource.CLOSED);

    await openToken(`/${TOKEN_ID}`);

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.latest().readyState).not.toBe(FakeEventSource.CLOSED);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
  });

  describe('Dado o stream SSE aberto', () => {
    beforeEach(async () => {
      await openToken(`/${TOKEN_ID}`);
      await vi.waitFor(() =>
        expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`),
      );
    });

    it('deve listar, contar como não lida no título e avisar Quando chega request.created', async () => {
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 3,
        truncated: false,
      });

      await vi.waitFor(() => expect(snack).toHaveBeenCalledWith('Request received'));
      await vi.waitFor(() => expect(TestBed.inject(Title).getTitle()).toBe('(1) Webhook.site'));
      expect(text()).toContain('Requests (3)');
      expect(text()).toContain(`#${nova.uuid.substring(0, 5)}`);
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
      expect(store.requests().map((request) => request.uuid)).toEqual([R2.uuid, nova.uuid]);
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
      await vi.waitFor(() => expect(snack).toHaveBeenCalledWith('Request received'));
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

      await vi.waitFor(() => expect(snack).toHaveBeenCalledTimes(2));
      expect(store.requests()).toEqual([R2]);
      expect(store.total()).toBe(4);
      const call = await flush(searchUrl, requestPage([R2, R4], { total: 2 }));
      expect(call.request.body).toMatchObject({ text: 'pedido', page: 1 });
      await vi.waitFor(() => expect(store.requests()).toEqual([R2, R4]));
      expect(store.matched()).toBe(2);
      expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`);
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

  it('deve comparar a aberta com a escolhida na lista e voltar ao detalhe Quando "Compare with…" é usado', async () => {
    await openToken(`/${TOKEN_ID}/${R1.uuid}/1`);
    await vi.waitFor(() => expect(text()).toContain('Compare with'));
    const root = harness.routeNativeElement as HTMLElement;
    const button = (label: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
      );

    button('Compare with…')?.click();
    await harness.fixture.whenStable();
    expect(text()).toContain(`Choose a request to compare with #${R1.uuid.substring(0, 5)}`);
    root.querySelectorAll<HTMLButtonElement>('.item .select')[1].click();

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(root.querySelector('app-request-compare .id-b')?.textContent).toBe(
        `#${R2.uuid.substring(0, 5)}`,
      );
    });
    expect(root.querySelector('app-request-detail')).toBeNull();

    button('Close')?.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('app-request-compare')).toBeNull();
    expect(root.querySelector('app-request-detail')).not.toBeNull();
  });
});
