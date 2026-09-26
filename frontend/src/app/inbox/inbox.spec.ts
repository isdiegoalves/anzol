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

    it('deve ir para a mensagem nova Quando auto-navegar está ligado', async () => {
      const preferences = TestBed.inject(Preferences);
      preferences.autoNavEnable.set(true);
      const nova = webhookRequest(3);

      FakeEventSource.latest().emit('request.created', {
        request: nova,
        total: 3,
        truncated: false,
      });

      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${nova.uuid}/1`));
    });
  });
});
