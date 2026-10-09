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
import { FilterChips } from '../search/filter-chips';
import { NO_FILTER } from '../search/request-filter';
import { Preferences } from '../settings/preferences';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport, WindowClass } from '../shell/viewport';
import {
  ITEM_HEIGHT,
  ITEM_HEIGHT_COMPACT,
  ITEM_HEIGHT_TOUCH,
  RequestList,
  UNDO_MS,
  bodySummary,
} from './request-list';
import { RequestStore } from './request-store';
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

  it('deve usar itens de duas linhas: 40 px, 36 px na densidade compacta e 64 px no celular (B1, S17)', async () => {
    const height = () =>
      (fixture.componentInstance as unknown as { itemHeight: () => number }).itemHeight();
    await load([webhookRequest(1)]);

    expect(fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))).toBeTruthy();
    expect([ITEM_HEIGHT, height()]).toEqual([40, 40]);
    expect(element().classList).not.toContain('dense');

    TestBed.inject(ShellSettings).density.set('compact');
    await fixture.whenStable();
    expect([ITEM_HEIGHT_COMPACT, height()]).toEqual([36, 36]);
    expect(element().classList).toContain('dense');
    // As mesmas duas linhas, com o mesmo conteúdo.
    expect(items()[0].querySelectorAll('.select > .line')).toHaveLength(2);

    // No celular o alvo de toque manda: 64 px em qualquer densidade.
    windowClass.set('compact');
    await fixture.whenStable();
    expect([ITEM_HEIGHT_TOUCH, height()]).toEqual([64, 64]);
    expect(element().classList).toContain('touch');
    expect(element().classList).not.toContain('dense');
  });

  it('deve cortar o caminho no meio, com ele inteiro no title e no nome do item (B1)', async () => {
    const path = '/pedidos/2026/09/loja-centro/confirmacoes/pagamento-aprovado';
    await load([webhookRequest(1, { url: `http://localhost:8084/${TOKEN_ID}${path}` })]);

    const route = items()[0].querySelector('.route') as HTMLElement;
    expect(route.getAttribute('title')).toBe(path);
    expect(route.textContent?.trim()).toBe(path);
    expect(route.querySelector('.start')?.textContent).toBe(
      ' /pedidos/2026/09/loja-centro/confirmacoes',
    );
    expect(route.querySelector('.end')?.textContent).toBe('/pagamento-aprovado');
    expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toMatch(
      new RegExp(`^POST ${path}, #`),
    );
  });

  it('deve mostrar a mais nova no topo, com método, rota e tempo relativo, e os selos, o tipo e o #id embaixo, sem IP nem agente (INBOX-01/11, B1)', async () => {
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
      '— · not recorded payment_intent.succeeded #00000',
      '— · not recorded #00000',
    ]);
    expect(element().textContent).not.toContain('192.168.0.1');
    expect(element().textContent).not.toContain('Stripe/1.0');
    // O IP fica no nome acessível.
    expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toContain(
      'from 192.168.0.1',
    );
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

  describe('Dado o teclado na lista (B1): uma parada só do Tab', () => {
    const [A, B, C] = [webhookRequest(1), webhookRequest(2), webhookRequest(3)];
    const selects = () => items().map((item) => item.querySelector('.select') as HTMLElement);
    const stops = (selector: string) =>
      items().map((item) => (item.querySelector(selector) as HTMLElement).tabIndex);
    const press = async (key: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
    };

    it('deve ter o Tab só no primeiro item, e na requisição aberta Quando há uma', async () => {
      await load([A, B, C]);
      expect(stops('.select')).toEqual([0, -1, -1]);
      expect(stops('.delete')).toEqual([0, -1, -1]);

      store.select(B.uuid);
      await fixture.whenStable();
      expect(stops('.select')).toEqual([-1, 0, -1]);
    });

    it('deve andar com ↑, ↓, Home e End sem abrir, parando nas pontas', async () => {
      const opened = vi.fn();
      fixture.componentInstance.openRequest.subscribe(opened);
      await load([A, B, C]);
      selects()[0].focus();

      await press('ArrowDown');
      expect(document.activeElement).toBe(selects()[1]);
      expect(stops('.select')).toEqual([-1, 0, -1]);
      await press('End');
      expect(document.activeElement).toBe(selects()[2]);
      await press('ArrowDown');
      expect(document.activeElement).toBe(selects()[2]);
      await press('Home');
      await press('ArrowUp');
      expect(document.activeElement).toBe(selects()[0]);
      expect(opened).not.toHaveBeenCalled();
    });

    it('deve abrir com Enter e avisar que foi pelo teclado; pelo ponteiro, só abrir', async () => {
      const [opened, byKey] = [vi.fn(), vi.fn()];
      fixture.componentInstance.openRequest.subscribe(opened);
      fixture.componentInstance.openedByKey.subscribe(byKey);
      await load([A, B]);

      // Enter num botão chega como clique sem ponteiro (`detail` 0).
      selects()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      expect(opened).toHaveBeenCalledWith(B);
      expect(byKey).toHaveBeenCalledWith(B);

      selects()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(opened).toHaveBeenLastCalledWith(A);
      expect(byKey).toHaveBeenCalledTimes(1);
    });

    it('deve levar a parada do Tab ao item aberto por J ou K, e o foco só se ele estava na lista', async () => {
      await load([A, B, C]);

      fixture.componentInstance.follow(C.uuid);
      await fixture.whenStable();
      expect(stops('.select')).toEqual([-1, -1, 0]);
      expect(document.activeElement).not.toBe(selects()[2]);

      selects()[2].focus();
      fixture.componentInstance.follow(A.uuid);
      await fixture.whenStable();
      expect(document.activeElement).toBe(selects()[0]);
    });
  });

  it('deve filtrar pelo selo do status, sem abrir a requisição, e não ter o selo clicável no toque', async () => {
    const opened = vi.fn();
    fixture.componentInstance.openRequest.subscribe(opened);
    const filter = vi.spyOn(TestBed.inject(FilterChips), 'filterByValue').mockReturnValue();
    await load([webhookRequest(1, { response: { status: 429 } }), webhookRequest(2)]);
    const seals = () =>
      [...element().querySelectorAll<HTMLElement>('app-seal-filter button')].map((button) =>
        button.getAttribute('aria-label'),
      );

    expect(seals()).toEqual(['Filter by answered 429']);
    element().querySelector<HTMLElement>('app-seal-filter button')?.click();
    expect(filter).toHaveBeenCalledWith({ kind: 'status', name: '', value: '429' });
    expect(opened).not.toHaveBeenCalled();
    await expectNoAxeViolations(element());

    windowClass.set('compact');
    await fixture.whenStable();
    expect(seals()).toEqual([]);
  });

  describe('Dado a lista agrupada pela chave do evento', () => {
    const KEY = 'x-loja-event-id';
    const attempt = (n: number, event: string | null, seconds: number, status = 429) =>
      webhookRequest(n, {
        headers: event === null ? {} : { [KEY]: [event] },
        created_at: `2026-09-26 00:00:${String(seconds).padStart(2, '0')}`,
        response: { status },
      });
    // Da mais nova para a mais antiga: A1 (0 s), B1, A2 (1 s depois), solta, A3 (5 s depois).
    const [a1, b1, a2, solta, a3, b2] = [
      attempt(1, 'evt_a', 0),
      attempt(2, 'evt_b', 2),
      attempt(3, 'evt_a', 1),
      attempt(4, null, 3),
      attempt(5, 'evt_a', 6, 200),
      attempt(6, 'evt_b', 9),
    ];
    const events = () => [...element().querySelectorAll<HTMLElement>('app-event-line .select')];
    const chevron = (value: string) =>
      element().querySelector<HTMLElement>(`app-event-line [aria-label="Attempts of ${value}"]`);
    const grouped = async () => {
      TestBed.inject(Preferences).token.set(token({ retry_after: '3' }));
      localStorage.setItem(`anzol.eventKey.${TOKEN_ID}`, KEY);
      await load([b2, a3, solta, a2, b1, a1]);
      http.expectOne(`/token/${TOKEN_ID}/rules`).flush([]);
      await fixture.whenStable();
    };
    const press = async (key: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
    };

    it('deve mostrar o evento no lugar das tentativas, com a trilha e sem selo de julgamento', async () => {
      await grouped();

      expect(events().map((event) => event.getAttribute('aria-label'))).toEqual([
        expect.stringMatching(
          /^Event evt_b, POST \/, 2 attempts in 7 s, answers 429 429, newest at .+\. Open the newest attempt$/,
        ),
        expect.stringMatching(
          /^Event evt_a, POST \/, 3 attempts in 6 s, answers 429 429 200, 1 attempt came before the asked wait, newest at .+\. Open the newest attempt$/,
        ),
      ]);
      expect([...events()[1].querySelectorAll('.seal')].map((seal) => seal.textContent)).toEqual([
        '429',
        '429',
        '200',
      ]);
      expect(events()[1].querySelector('.seal.last')?.textContent).toBe('200');
      expect(element().textContent).toContain(
        'Grouped by x-loja-event-id · 2 events in the 6 loaded',
      );
      // A solta continua um item comum, com o #id.
      expect(items().map((item) => item.querySelector('.id')?.textContent?.trim())).toEqual([
        `#${solta.uuid.substring(0, 5)}`,
      ]);
      await expectNoAxeViolations(element());
    });

    it('deve marcar a linha do evento que teve tentativa antes da espera pedida, recolhido ou aberto', async () => {
      await grouped();
      const early = () =>
        [...element().querySelectorAll('app-event-line')].map((line) =>
          line.classList.contains('early'),
        );

      expect(early()).toEqual([false, true]);

      chevron('evt_a')?.click();
      await fixture.whenStable();
      expect(early()).toEqual([false, true]);
    });

    it('deve mostrar as tentativas pelo chevron, da mais nova para a mais antiga, com o veredito', async () => {
      await grouped();

      chevron('evt_a')?.click();
      await fixture.whenStable();

      expect(chevron('evt_a')?.getAttribute('aria-expanded')).toBe('true');
      expect(
        items()
          .map((item) => item.querySelector('.select')?.getAttribute('aria-label') ?? '')
          .map((label) => /^Attempt \d of 3, (\d+ s after the previous, )?/.exec(label)?.[0]),
      ).toEqual([
        'Attempt 3 of 3, 5 s after the previous, ',
        'Attempt 2 of 3, 1 s after the previous, ',
        'Attempt 1 of 3, ',
        // A solta, no lugar dela (depois do evento que chegou antes dela).
        undefined,
      ]);
      const notes = [...element().querySelectorAll('app-event-note')].map((note) =>
        note.textContent?.trim(),
      );
      expect(notes).toEqual([
        'Waited 5 s. It asked to wait 3 s.',
        'Came 1 s after the previous answer. It asked to wait 3 s.',
        'Wait asked: Retry-After: 3, as configured now. Times are kept to the second.',
      ]);
      expect(element().querySelector('app-event-note .before')?.textContent).toContain('Came 1 s');
      await expectNoAxeViolations(element());
    });

    it('deve expandir e recolher pelas setas, sem abrir, com o chevron fora do Tab', async () => {
      const opened = vi.fn();
      fixture.componentInstance.openRequest.subscribe(opened);
      await grouped();
      expect(chevron('evt_a')?.tabIndex).toBe(-1);
      events()[1].focus();

      await press('ArrowRight');
      expect(chevron('evt_a')?.getAttribute('aria-expanded')).toBe('true');
      await press('ArrowRight');
      expect(document.activeElement?.getAttribute('data-uuid')).toBe(a3.uuid);
      await press('ArrowLeft');
      expect(document.activeElement).toBe(events()[1]);
      await press('ArrowLeft');
      expect(chevron('evt_a')?.getAttribute('aria-expanded')).toBe('false');
      expect(opened).not.toHaveBeenCalled();

      events()[1].click();
      expect(opened).toHaveBeenCalledWith(a3);
    });

    it('deve oferecer agrupar uma vez, e não oferecer de novo depois de "Not now"', async () => {
      const values = ['a', 'b', 'a', 'c', 'b', 'c'];
      await load(values.map((value, i) => attempt(i + 1, value, i)));
      const offer = () => element().querySelector('[aria-label="Group by event"]');

      expect(offer()?.textContent).toContain(
        'Some requests repeat the same x-loja-event-id. Group them by event?',
      );
      await expectNoAxeViolations(element());
      within(offer() as HTMLElement)
        .getByRole('button', { name: 'Not now' })
        .click();
      await fixture.whenStable();

      expect(offer()).toBeNull();
      expect(localStorage.getItem(`anzol.eventKey.${TOKEN_ID}`)).toBe('off');
      expect(events()).toEqual([]);
    });
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
      '',
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
    'deve mostrar o selo (só o ícone, quando passou) e o veredito completo no title e no nome do item, Quando a assinatura é %s',
    async (_caso, signature, tone, texto, rotulo) => {
      await load([webhookRequest(1, { signature })]);

      const seal = items()[0].querySelector('.seals app-check-chip[data-kind="signature"]');

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

    expect(items()[0].querySelector('.seals app-check-chip[data-kind="signature"]')).toBeNull();
  });

  it('deve mostrar os selos de schema e de regra ao lado do de assinatura', async () => {
    await load([
      webhookRequest(1, {
        signature: { provider: 'github', valid: true, reason: null },
        schema: { valid: false, errors: [{ path: '/id', message: 'must be integer' }] },
        near_miss: { id: 'r', name: 'Só GET', failed: ['method: expected GET, got POST'] },
        response: { status: 429 },
      }),
    ]);

    expect(
      [...items()[0].querySelectorAll('.seals app-check-chip')].map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(['429 · Default response', '', '1 schema error']);
  });

  // O selo e o trecho do nome acessível dizem a mesma coisa.
  it.each([
    [
      'a resposta padrão',
      { rule: null, response: { status: 429 } },
      '429 · Default response',
      'Default response · 429',
      'none',
    ],
    [
      'uma regra',
      { rule: { id: 'r1', name: 'Pedido pago' }, response: { status: 201 } },
      '201 · Pedido pago',
      'Answered by rule · 201: Pedido pago',
      'ok',
    ],
    [
      'uma falha de rede de regra',
      { rule: { id: 'r2', name: 'Derruba' }, response: { fault: 'connection_reset' } },
      '— · Connection reset',
      'Network fault by rule: Connection reset: Derruba',
      'bad',
    ],
    ['nada gravado', { rule: null }, '— · not recorded', 'Answer not recorded', 'none'],
  ])(
    'deve dizer o status e a origem no primeiro selo e no nome do item Quando respondeu %s',
    async (_caso, campos, selo, nome, tom) => {
      await load([webhookRequest(1, campos)]);

      const seal = items()[0].querySelector('.seals app-check-chip');
      expect(seal?.getAttribute('data-kind')).toBe('rule');
      expect(seal?.querySelector('.title')?.textContent).toBe(selo);
      expect(seal?.getAttribute('title')).toBe(nome);
      expect(seal?.classList).toContain(tom);
      expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toContain(nome);
    },
  );

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
    TestBed.inject(Preferences).unread.set({ [TOKEN_ID]: [um.uuid, dois.uuid] });
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
    // UX-10: a pílula fica numa faixa própria, antes da lista: não cobre item nenhum.
    const pill = element().querySelector('app-new-pill') as HTMLElement;
    expect(pill.closest('.list')).toBeNull();
    expect(pill.nextElementSibling?.classList).toContain('list');
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

  it('deve mostrar a busca acima da lista, também na URL vazia (UX-11)', async () => {
    await load([]);
    expect(element().querySelector('app-request-search [role="search"]')).not.toBeNull();

    await load([webhookRequest(1)]);
    expect(element().querySelector('app-request-search [role="search"]')).not.toBeNull();
  });

  // L9 da auditoria: com filtro (inclusive o desfecho do C2), o título diz quantas sobraram.
  it('deve dizer "N of M" no título Quando há filtro, e voltar a "M" sem ele', async () => {
    await load([webhookRequest(1), webhookRequest(2), webhookRequest(3)], 9);
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (9)');

    const applied = store.applyFilter({ ...NO_FILTER, outcome: { type: 'default' } });
    http
      .expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/requests/search` })
      .flush(requestPage([webhookRequest(1)], { total: 3 }));
    await applied;
    await fixture.whenStable();

    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (3 of 9)');
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

  it.each([
    [{ status: 201 }, '201 · Pix'],
    [{ fault: 'connection_reset' }, '— · Connection reset'],
    [null, '— · not recorded'],
  ])('deve dizer %j no selo da regra que respondeu como "%s"', async (response, esperado) => {
    await load([webhookRequest(1, { rule: { id: 'r1', name: 'Pix' }, response })]);

    const seal = items()[0].querySelector('.seals app-check-chip[data-kind="rule"]');
    expect(seal?.textContent?.trim()).toBe(esperado);
  });

  // INBOX-34: no celular, a linha "N requests · newest first" no lugar visível do heading, que fica
  // no documento.
  it('deve dizer a contagem e a ordem Quando a janela é compacta', async () => {
    windowClass.set('compact');
    await load([webhookRequest(1), webhookRequest(2)]);

    const line = element().querySelector('.order-line');
    expect(line?.textContent?.trim()).toBe('2 requests · newest first');
    expect(line?.getAttribute('aria-hidden')).toBe('true');
    expect(element().querySelector('h2')?.textContent?.trim()).toBe('Requests (2)');
  });

  // Celular a 390 e 320 px (trava 5): os selos dividem a linha do resumo, dentro do item, e encolhem
  // com o resumo; o veredito inteiro fica no title do selo e no nome do item.
  it('deve pôr os selos na linha do resumo, dentro do botão do item', async () => {
    await load([
      webhookRequest(1, {
        signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
      }),
    ]);

    const seal = items()[0].querySelector(
      '.select .meta .seals app-check-chip[data-kind="signature"]',
    );
    expect(seal?.getAttribute('title')).toBe('Signature invalid: signature mismatch');
    expect(items()[0].querySelector('.select')?.getAttribute('aria-label')).toContain(
      'Signature invalid: signature mismatch',
    );
  });
});
