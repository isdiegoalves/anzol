import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { within } from '@testing-library/angular';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { NO_FILTER } from '../search/request-filter';
import { Preferences } from '../settings/preferences';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport, WindowClass } from '../shell/viewport';
import {
  ITEM_HEIGHT,
  ITEM_HEIGHT_COMPACT,
  RequestList,
  UNDO_MS,
  bodySummary,
} from './request-list';
import { RequestStore } from './request-store';
import { RuleStatusStore } from './rule-status-store';
import { WebhookRequest } from './webhook-request';

describe('Dado a lista lateral de mensagens', () => {
  /** Janela larga por padrão; o jsdom não tem `matchMedia`. */
  const windowClass = signal<WindowClass>('large');
  let fixture: ComponentFixture<RequestList>;
  let http: HttpTestingController;
  let store: RequestStore;

  const element = () => fixture.nativeElement as HTMLElement;
  const items = () => [...element().querySelectorAll<HTMLElement>('.item')];
  const load = async (data: WebhookRequest[], total = data.length, isLast = true) => {
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage(data, { total, is_last_page: isLast }));
    await loaded;
    await fixture.whenStable();
  };

  beforeEach(async () => {
    windowClass.set('large');
    TestBed.configureTestingModule({
      imports: [RequestList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
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
    await expectNoAxeViolations(element());
  });

  it('deve mostrar o esqueleto, e não "Waiting for first request...", Quando a lista carrega (E10)', async () => {
    const loaded = store.load(TOKEN_ID);
    await fixture.whenStable();

    expect(element().querySelectorAll('.skeleton .ghost')).toHaveLength(6);
    expect(element().textContent).not.toContain('Waiting for first request...');
    expect(items()).toHaveLength(0);

    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1)]));
    await loaded;
    await fixture.whenStable();
    expect(element().querySelector('.skeleton')).toBeNull();
    expect(items()).toHaveLength(1);
  });

  it('deve usar itens de 60 px Quando a densidade é compacta (S17)', async () => {
    TestBed.inject(ShellSettings).density.set('compact');
    await load([webhookRequest(1)]);

    expect(fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))).toBeTruthy();
    expect(
      (fixture.componentInstance as unknown as { itemHeight: () => number }).itemHeight(),
    ).toBe(ITEM_HEIGHT_COMPACT);
  });

  it('deve mostrar a mais nova no topo, com método, rota e tempo relativo, e o resumo, o IP e o #id embaixo (INBOX-01/11)', async () => {
    await load([
      webhookRequest(1, { method: 'GET', url: `http://localhost:8084/${TOKEN_ID}/a?b=1` }),
    ]);
    store.append(
      webhookRequest(2, {
        content: '{"type":"payment_intent.succeeded"}',
        user_agent: 'Stripe/1.0',
      }),
      2,
    );
    await fixture.whenStable();

    const text = (selector: string) =>
      items().map((item) => item.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim());
    expect(text('.route-line')).toEqual([
      expect.stringMatching(/^POST \/ .+ ago$/),
      expect.stringMatching(/^GET \/a\?b=1 .+ ago$/),
    ]);
    expect(text('.meta')).toEqual([
      'payment_intent.succeeded · 192.168.0.1 · #00000',
      `${webhookRequest(1).user_agent} · 192.168.0.1 · #00000`,
    ]);
    // A data absoluta fica fora da linha: no title do tempo relativo e no nome do item (trava 2).
    expect(items()[0].textContent).not.toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(items()[0].querySelector('.ago')?.getAttribute('title')).toMatch(/^[A-Z][a-z]{2} \d/);
    expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toMatch(
      /#00000.*[A-Z][a-z]{2} \d{1,2}, \d{4}.*, unread$/,
    );
    expect(items().map((item) => item.classList.contains('unread'))).toEqual([true, false]);
  });

  it.each([
    ['o type do JSON', '{"type":"charge.failed"}', 'charge.failed'],
    ['o event do JSON', '{"event":"push","type":7}', 'push'],
    ['o user-agent sem JSON', 'texto', 'curl/8'],
  ])('deve resumir o corpo pelo %s', (_caso, content, summary) => {
    expect(bodySummary(webhookRequest(1, { content, user_agent: 'curl/8' }))).toBe(summary);
  });

  it('deve inverter a ordem pelo botão do cabeçalho', async () => {
    await load([webhookRequest(2), webhookRequest(1)]);
    const order = within(element()).getByRole('button', {
      name: 'Sorted newest first. Change order',
    });

    order.click();
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=oldest`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2)]));
    await vi.waitFor(() =>
      expect(
        within(element()).getByRole('button', { name: 'Sorted oldest first. Change order' }),
      ).toBeTruthy(),
    );
  });

  it.each([
    [
      'válida',
      { provider: 'github', valid: true, reason: null },
      'ok',
      'GitHub',
      'Signature valid: GitHub',
    ],
    [
      'inválida',
      { provider: 'stripe', valid: false, reason: 'signature mismatch' },
      'bad',
      'Mismatch',
      'Signature invalid: signature mismatch',
    ],
    [
      'ausente',
      { provider: 'github', valid: false, reason: 'header X-Hub-Signature-256 absent' },
      'bad',
      'No signature',
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
    ).toEqual(['GitHub', '1 schema error', 'Near miss']);
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

  // INBOX-16: os dois botões sempre no mesmo lugar; sem página, aria-disabled e focáveis.
  it('deve manter "Previous page" e "Next page" no rodapé, o sem página desabilitado e focável', async () => {
    await load([webhookRequest(1)], 60, false);

    const footer = within(element().querySelector('footer') as HTMLElement);
    const previous = footer.getByRole('button', { name: 'Previous page' });
    const next = footer.getByRole('button', { name: 'Next page' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    expect(previous.hasAttribute('disabled')).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBeNull();
    expect(element().querySelector('.range')?.textContent).toBe('1–1 of 60');

    previous.click();
    http.expectNone(`/token/${TOKEN_ID}/requests?page=0&sorting=newest`);
    next.click();
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=2&sorting=newest`)
      .flush(requestPage([webhookRequest(2)], { current_page: 2, total: 60 }));
    await expectNoAxeViolations(element());
  });

  it('deve dizer "N unread" ao lado do heading, fora dele (INBOX-07)', async () => {
    const [um, dois, tres] = [1, 2, 3].map((n) => webhookRequest(n));
    TestBed.inject(Preferences).unread.set([um.uuid, dois.uuid]);
    await load([um, dois, tres]);

    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (3)');
    expect(within(element()).getByText('2 unread')).toBeTruthy();
  });

  it('deve contar na pílula a nova que a tela não abriu e dizer se ela ficou à vista', async () => {
    const vinte = Array.from({ length: 20 }, (_, n) => webhookRequest(n + 1));
    await load(vinte);
    const list = fixture.componentInstance;
    const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))
      .componentInstance as CdkVirtualScrollViewport;
    vi.spyOn(viewport, 'getViewportSize').mockReturnValue(3 * ITEM_HEIGHT);
    // A mais nova no topo (INBOX-01): as novas entram em cima; rolado para baixo, ficam fora da vista.
    const top = vi.spyOn(viewport, 'measureScrollOffset').mockReturnValue(10 * ITEM_HEIGHT);

    const nova = webhookRequest(21);
    store.append(nova, 21);
    expect(list.receive(nova)).toBe(false);
    await fixture.whenStable();
    expect(element().querySelector('.new-pill')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '↑1 new request',
    );

    top.mockReturnValue(0);
    const outra = webhookRequest(22);
    store.append(outra, 22);
    expect(list.receive(outra)).toBe(true);
    await fixture.whenStable();
    expect(element().querySelector('.new-pill')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '↑2 new requests',
    );

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
    expect(items()[0].classList.contains('fresh')).toBe(true);
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

    expect(element().textContent).toContain('No requests match these filters');
    expect(element().textContent).not.toContain('Waiting for first request...');

    // INBOX-25: o "Clear filters" do estado vazio volta à lista completa.
    within(element().querySelector('app-empty-state') as HTMLElement)
      .getByRole('button', { name: 'Clear filters' })
      .click();
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1)]));
    await vi.waitFor(() => expect(store.filtering()).toBe(false));
  });

  it('deve escolher a B em vez de abrir a mensagem Quando a lista está no "Compare with…"', async () => {
    await load([webhookRequest(1), webhookRequest(2)]);
    const compare = TestBed.inject(CompareStore);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const opened: WebhookRequest[] = [];
    fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));

    compare.start(webhookRequest(1));
    await fixture.whenStable();
    expect(element().querySelector('app-compare-band .band')?.textContent).toContain(
      'Choose a request to compare with #00000',
    );
    expect(items()[0].classList.contains('base')).toBe(true);
    items()[1].querySelector<HTMLButtonElement>('.select')?.click();

    expect(opened).toEqual([]);
    expect(navigate).toHaveBeenCalledWith([
      '/',
      TOKEN_ID,
      'compare',
      webhookRequest(1).uuid,
      webhookRequest(2).uuid,
    ]);
  });

  it('deve marcar A e B, com a etiqueta e o papel no nome, Quando a página do Compare mostra o par', async () => {
    await load([webhookRequest(1), webhookRequest(2), webhookRequest(3)]);

    TestBed.inject(CompareStore).show(webhookRequest(3), webhookRequest(1));
    await fixture.whenStable();

    expect(items().map((item) => item.querySelector('.tag')?.textContent ?? '')).toEqual([
      'B',
      '',
      'A',
    ]);
    expect(items()[2].querySelector('.select')?.getAttribute('aria-label')).toMatch(
      /compared as A$/,
    );
  });

  it('deve sair do modo de escolha Quando "Cancel" é clicado', async () => {
    await load([webhookRequest(1)]);
    const compare = TestBed.inject(CompareStore);
    compare.start(webhookRequest(1));
    await fixture.whenStable();

    element().querySelector<HTMLButtonElement>('app-compare-band .band button')?.click();
    await fixture.whenStable();

    expect(compare.picking()).toBeNull();
    expect(element().querySelector('app-compare-band .band')).toBeNull();
  });

  // INBOX-13: o selo da regra que respondeu diz o status dela ("201 · Pix").
  it('deve dizer o status e o nome da regra que respondeu no selo', async () => {
    const statuses = TestBed.inject(RuleStatusStore);
    const ensured = statuses.ensure(TOKEN_ID, ['r1']);
    http
      .expectOne(`/token/${TOKEN_ID}/rules`)
      .flush([{ id: 'r1', name: 'Pix', response: { status: 201 } }]);
    await ensured;

    await load([webhookRequest(1, { rule: { id: 'r1', name: 'Pix' } })]);

    const seal = items()[0].querySelector('.seals app-check-chip[data-kind="rule"]');
    expect(seal?.textContent?.trim()).toBe('201 · Pix');
  });

  // INBOX-32/34: no celular, itens de duas linhas (os selos sobem, como na densidade compacta), sem
  // o IP, e a linha "N requests · newest first" no lugar visível do heading, que fica no documento.
  it('deve usar o item de duas linhas, sem o IP, e dizer a contagem e a ordem Quando a janela é compacta', async () => {
    windowClass.set('compact');
    await load([webhookRequest(1), webhookRequest(2)]);

    expect(element().classList).toContain('compact');
    expect(items()[0].querySelector('.meta .ip')?.textContent).toContain(webhookRequest(1).ip);
    const line = element().querySelector('.order-line');
    expect(line?.textContent?.trim()).toBe('2 requests · newest first');
    expect(line?.getAttribute('aria-hidden')).toBe('true');
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (2)');
  });
});
