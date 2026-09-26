import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { RequestNav } from './request-nav';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

describe('Dado a navegação primeira/anterior/próxima/última', () => {
  let loader: HarnessLoader;
  let http: HttpTestingController;
  let store: RequestStore;
  let opened: WebhookRequest[];

  const button = (text: RegExp) => loader.getHarness(MatButtonHarness.with({ text }));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [RequestNav],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/requests?page=1`).flush(
      requestPage(
        [1, 2, 3].map((n) => webhookRequest(n)),
        { total: 4, is_last_page: false },
      ),
    );
    await loaded;
    const fixture = TestBed.createComponent(RequestNav);
    opened = [];
    fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve desabilitar First e Previous Quando a primeira está aberta', async () => {
    store.select(webhookRequest(1).uuid);

    expect(await (await button(/First/)).isDisabled()).toBe(true);
    expect(await (await button(/Previous/)).isDisabled()).toBe(true);
    expect(await (await button(/Last/)).isDisabled()).toBe(false);
  });

  it('deve abrir a última Quando Last é clicado', async () => {
    store.select(webhookRequest(1).uuid);

    await (await button(/Last/)).click();

    expect(opened).toEqual([webhookRequest(3)]);
  });

  it('deve carregar a próxima página Quando Next chega na última mensagem carregada', async () => {
    store.select(webhookRequest(2).uuid);

    await (await button(/Next/)).click();

    expect(opened).toEqual([webhookRequest(3)]);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=2`)
      .flush(requestPage([webhookRequest(4)], { current_page: 2 }));
    await vi.waitFor(() => expect(store.requests()).toHaveLength(4));
  });
});
