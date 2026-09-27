import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { NO_FILTER } from '../search/request-filter';
import { Preferences } from '../settings/preferences';
import { ITEM_HEIGHT, RequestList, UNDO_MS } from './request-list';
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
    // O jsdom não rola: a lista virtual pede `scrollTo` ao ir para o fim.
    Element.prototype.scrollTo ??= () => undefined;
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

  it('deve mostrar método, início do UUID, rota, IP e data e destacar a não lida Quando há mensagens', async () => {
    await load([
      webhookRequest(1, { method: 'GET', url: `http://localhost:8084/${TOKEN_ID}/a?b=1` }),
    ]);
    store.append(webhookRequest(2), 2);
    await fixture.whenStable();

    expect(
      items().map((item) =>
        item.querySelector('.select')?.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual([
      expect.stringMatching(/^GET #00000 \/a\?b=1 192\.168\.0\.1 · [A-Z][a-z]{2} \d/),
      expect.stringMatching(/^POST #00000 \/ 192\.168\.0\.1 · [A-Z][a-z]{2} \d/),
    ]);
    expect(items().map((item) => item.classList.contains('unread'))).toEqual([false, true]);
    expect(items()[1].querySelector('.select')?.getAttribute('aria-label')).toMatch(/, unread$/);
  });

  it.each([
    [
      'válida',
      { provider: 'github', valid: true, reason: null },
      'ok',
      'Sig OK',
      'Signature valid: GitHub',
    ],
    [
      'inválida',
      { provider: 'stripe', valid: false, reason: 'signature mismatch' },
      'bad',
      'Bad sig',
      'Signature invalid: signature mismatch',
    ],
    [
      'ausente',
      { provider: 'github', valid: false, reason: 'header X-Hub-Signature-256 absent' },
      'bad',
      'No sig',
      'Signature absent: header X-Hub-Signature-256 absent',
    ],
  ] as const)(
    'deve mostrar o selo com ícone e texto, e o veredito completo no nome do item, Quando a assinatura é %s',
    async (_caso, signature, tone, texto, rotulo) => {
      await load([webhookRequest(1, { signature })]);

      const seal = items()[0].querySelector('.seals app-check-chip');

      expect(seal?.textContent?.trim()).toBe(texto);
      expect(seal?.getAttribute('title')).toBe(rotulo);
      expect(seal?.classList).toContain(tone);
      expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toContain(rotulo);
    },
  );

  it.each([
    ['nula (URL sem verificação)', { signature: null }],
    ['ausente (mensagem gravada antes da verificação)', {}],
  ])('não deve mostrar selo de assinatura Quando ela é %s', async (_caso, campos) => {
    await load([webhookRequest(1, campos)]);

    expect(items()[0].querySelector('.seals app-check-chip')).toBeNull();
  });

  it('deve mostrar os selos de schema e de regra ao lado do de assinatura', async () => {
    await load([
      webhookRequest(1, {
        signature: { provider: 'github', valid: true, reason: null },
        schema: { valid: false, errors: [{ path: '/id', message: 'must be integer' }] },
        near_miss: { id: 'r', name: 'Só GET', failed: ['method: expected GET, got POST'] },
      }),
    ]);

    expect(
      [...items()[0].querySelectorAll('.seals app-check-chip')].map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(['Sig OK', 'Bad schema', 'Near miss']);
  });

  it('deve emitir a mensagem clicada Quando o usuário clica nela', async () => {
    await load([webhookRequest(1)]);
    const opened: WebhookRequest[] = [];
    fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));

    items()[0].querySelector<HTMLButtonElement>('.select')?.click();

    expect(opened).toEqual([webhookRequest(1)]);
  });

  it('deve tirar da lista na hora e apagar pela API Quando a lixeira é clicada e o aviso some sem Undo', async () => {
    await load([webhookRequest(1), webhookRequest(2)]);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    items()[0].querySelector<HTMLButtonElement>('.delete')?.click();
    await fixture.whenStable();
    expect(items()).toHaveLength(1);
    expect(element().textContent).toContain('Requests (1)');
    expect(open).toHaveBeenCalledWith('Request deleted', 'Undo', { duration: UNDO_MS });
    http.expectNone(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`);

    open.mock.results[0].value.dismiss();
    await vi.waitFor(() =>
      http
        .expectOne({
          method: 'DELETE',
          url: `/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`,
        })
        .flush({}),
    );
  });

  it('deve devolver a mensagem sem apagar Quando o Undo é clicado', async () => {
    await load([webhookRequest(1), webhookRequest(2)]);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    items()[0].querySelector<HTMLButtonElement>('.delete')?.click();
    open.mock.results[0].value.dismissWithAction();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(items()).toHaveLength(2);
    });

    http.expectNone(`/token/${TOKEN_ID}/request/${webhookRequest(1).uuid}`);
    expect(element().textContent).toContain('Requests (2)');
  });

  it('deve ter a lixeira com o nome "Delete request {uuid}" e passar no axe', async () => {
    await load([webhookRequest(1)]);

    expect(items()[0].querySelector('.delete')?.getAttribute('aria-label')).toBe(
      `Delete request ${webhookRequest(1).uuid}`,
    );
    await expectNoAxeViolations(element());
  });

  it('deve mostrar total e limite no cabeçalho Quando a URL tem limpeza automática', async () => {
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: 500 }));
    await load([webhookRequest(1)], 500, false);

    const header = element().querySelector('h2');
    expect(header?.textContent?.trim()).toBe('Requests (500 / 500)');
    expect(header?.getAttribute('title')).toBe('Auto cleanup keeps the 500 most recent requests');
  });

  it('deve mostrar só o total Quando a limpeza automática está desligada', async () => {
    TestBed.inject(Preferences).token.set(token({ auto_cleanup: null }));
    await load([webhookRequest(1)], 12);

    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (12)');
    expect(element().querySelector('h2')?.hasAttribute('title')).toBe(false);
  });

  it('deve desenhar só as linhas visíveis Quando a lista tem 10.000 mensagens', async () => {
    const dezMil = Array.from({ length: 10_000 }, (_, n) => webhookRequest(n + 1));
    await load(dezMil);

    expect(element().textContent).toContain('Requests (10000)');
    expect(items().length).toBeGreaterThan(0);
    expect(items().length).toBeLessThan(40);
  });

  it('deve oferecer "Next page" e dizer a faixa no rodapé Quando a API diz que não é a última página', async () => {
    await load([webhookRequest(1)], 60, false);

    expect(element().textContent).toContain('Next page');
    expect(element().textContent).not.toContain('Previous page');
    expect(element().querySelector('.range')?.textContent).toBe('1–1 of 60');
  });

  it('deve contar na pílula a nova que a tela não abriu e dizer se ela ficou à vista', async () => {
    const vinte = Array.from({ length: 20 }, (_, n) => webhookRequest(n + 1));
    await load(vinte);
    const list = fixture.componentInstance;
    const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))
      .componentInstance as CdkVirtualScrollViewport;
    vi.spyOn(viewport, 'getViewportSize').mockReturnValue(3 * ITEM_HEIGHT);
    const top = vi.spyOn(viewport, 'measureScrollOffset').mockReturnValue(0);

    const nova = webhookRequest(21);
    store.append(nova, 21);
    expect(list.receive(nova)).toBe(false);
    await fixture.whenStable();
    expect(element().querySelector('.new-pill')?.textContent?.trim()).toBe('1 new request');
    expect(items().some((item) => item.classList.contains('fresh'))).toBe(false);

    top.mockReturnValue(18 * ITEM_HEIGHT);
    const outra = webhookRequest(22);
    store.append(outra, 22);
    expect(list.receive(outra)).toBe(true);
    await fixture.whenStable();
    expect(element().querySelector('.new-pill')?.textContent?.trim()).toBe('2 new requests');

    list.showNew();
    await fixture.whenStable();
    expect(element().querySelector('.new-pill')).toBeNull();
  });

  it('não deve contar na pílula a nova que a tela abriu', async () => {
    await load([webhookRequest(1)]);
    const nova = webhookRequest(2);
    store.append(nova, 2);

    expect(fixture.componentInstance.receive(nova, true)).toBe(true);
    await fixture.whenStable();

    expect(element().querySelector('.new-pill')).toBeNull();
    expect(items()[1].classList.contains('fresh')).toBe(true);
  });

  it('deve mostrar a busca acima da lista Quando a URL tem mensagens', async () => {
    await load([]);
    expect(element().querySelector('app-request-search')).toBeNull();

    await load([webhookRequest(1)]);
    expect(element().querySelector('app-request-search [role="search"]')).not.toBeNull();
  });

  it('deve manter a busca à vista para limpar o filtro Quando a URL fica vazia com filtro ativo', async () => {
    await load([webhookRequest(1)]);
    const applied = store.applyFilter({ ...NO_FILTER, text: 'x' });
    http
      .expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/requests/search` })
      .flush(requestPage([webhookRequest(1)], { total: 1 }));
    await applied;

    const deleted = store.deleteAll();
    http.expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request` }).flush({});
    await deleted;
    await fixture.whenStable();

    expect(element().querySelector('app-request-search [role="search"]')).not.toBeNull();
  });

  it('deve avisar que nada casa, sem "Waiting for first request..." Quando o filtro não acha nada', async () => {
    await load([webhookRequest(1)]);

    const applied = store.applyFilter({ ...NO_FILTER, text: 'nada' });
    http
      .expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/requests/search` })
      .flush(requestPage([], { total: 0 }));
    await applied;
    await fixture.whenStable();

    expect(element().textContent).toContain('No requests match the filters.');
    expect(element().textContent).not.toContain('Waiting for first request...');
  });

  it('deve escolher a B em vez de abrir a mensagem Quando a lista está no "Compare with…"', async () => {
    await load([webhookRequest(1), webhookRequest(2)]);
    const compare = TestBed.inject(CompareStore);
    const opened: WebhookRequest[] = [];
    fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));

    compare.start(webhookRequest(1));
    await fixture.whenStable();
    expect(element().querySelector('.picking')?.textContent).toContain(
      'Choose a request to compare with #00000',
    );
    expect(items()[0].classList.contains('base')).toBe(true);
    items()[1].querySelector<HTMLButtonElement>('.select')?.click();

    expect(opened).toEqual([]);
    expect(compare.pair()).toEqual({ a: webhookRequest(1), b: webhookRequest(2) });
  });

  it('deve sair do modo de escolha Quando "Cancel" é clicado', async () => {
    await load([webhookRequest(1)]);
    const compare = TestBed.inject(CompareStore);
    compare.start(webhookRequest(1));
    await fixture.whenStable();

    element().querySelector<HTMLButtonElement>('.picking button')?.click();
    await fixture.whenStable();

    expect(compare.picking()).toBeNull();
    expect(element().querySelector('.picking')).toBeNull();
  });
});
