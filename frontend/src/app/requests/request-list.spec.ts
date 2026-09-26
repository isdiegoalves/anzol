import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { RequestList } from './request-list';
import { RequestStore } from './request-store';
import { WebhookRequest } from './webhook-request';

describe('Dado a lista lateral de mensagens', () => {
  let fixture: ComponentFixture<RequestList>;
  let http: HttpTestingController;
  let store: RequestStore;

  const element = () => fixture.nativeElement as HTMLElement;
  const items = () => [...element().querySelectorAll<HTMLElement>('.item')];
  const load = async (data: WebhookRequest[], total = data.length, isLast = true) => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1`)
      .flush(requestPage(data, { total, is_last_page: isLast }));
    await loaded;
    await fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [RequestList],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    fixture = TestBed.createComponent(RequestList);
    // A lista virtual só desenha o que cabe na altura do viewport.
    element().style.height = '600px';
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve mostrar "Waiting for first request..." Quando a URL não tem mensagens', async () => {
    await load([]);

    expect(element().textContent).toContain('Requests (0)');
    expect(element().textContent).toContain('Waiting for first request...');
  });

  it('deve mostrar método, início do UUID e IP e destacar a não lida Quando há mensagens', async () => {
    await load([webhookRequest(1, { method: 'GET' })]);
    store.append(webhookRequest(2), 2);
    await fixture.whenStable();

    expect(
      items().map((item) =>
        item.querySelector('.select')?.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual([
      expect.stringMatching(/^GET #00000 192\.168\.0\.1[A-Z][a-z]{2} \d/),
      expect.stringMatching(/^POST #00000 192\.168\.0\.1[A-Z][a-z]{2} \d/),
    ]);
    expect(items().map((item) => item.classList.contains('unread'))).toEqual([false, true]);
  });

  it('deve emitir a mensagem clicada Quando o usuário clica nela', async () => {
    await load([webhookRequest(1)]);
    const opened: WebhookRequest[] = [];
    fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));

    items()[0].querySelector<HTMLButtonElement>('.select')?.click();

    expect(opened).toEqual([webhookRequest(1)]);
  });

  it('deve apagar pela API e tirar da lista Quando o X é clicado', async () => {
    await load([webhookRequest(1), webhookRequest(2)]);

    items()[0].querySelector<HTMLButtonElement>('.delete')?.click();
    http
      .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}` })
      .flush({});
    await fixture.whenStable();

    expect(items()).toHaveLength(1);
    expect(element().textContent).toContain('Requests (1)');
  });

  it('deve oferecer "Next page" Quando a API diz que não é a última página', async () => {
    await load([webhookRequest(1)], 60, false);

    expect(element().textContent).toContain('Next page');
    expect(element().textContent).not.toContain('Previous Page');
  });
});
