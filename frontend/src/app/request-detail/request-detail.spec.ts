import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Provider, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { RuleTrace } from '../rules/rule';
import { ShareDialog } from '../share/share-dialog';
import { Viewport, WindowClass } from '../shell/viewport';
import { AiClient } from '../ai/ai-client';
import { ActionPanelStore } from './action-panel-store';
import { Explanations } from './explanations';
import { RequestDetail } from './request-detail';

describe('Dado a requisição aberta que sumiu do servidor', () => {
  const windowClass = signal<WindowClass>('large');
  const REASON = 'The server no longer has this request.';
  const [older, open, newer] = [webhookRequest(1), webhookRequest(2), webhookRequest(3)];

  const showGone = async (list = [newer, open, older]) => {
    const view = await render(RequestDetail, {
      inputs: { request: open, token: token(), page: 1 },
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`).flush(requestPage(list));
    await loaded;
    store.select(open.uuid);
    const deleted = store.deleteRequest(open);
    http
      .expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${open.uuid}` })
      .flush(null);
    await deleted;
    await view.fixture.whenStable();
    return { ...view, store };
  };
  const toolbar = () => screen.getByRole('toolbar', { name: 'Request actions' });
  const described = (element: HTMLElement) =>
    document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent?.trim();

  beforeEach(() => windowClass.set('large'));
  afterEach(() => localStorage.clear());

  it('deve desligar na barra o que precisa do servidor, focável e com a razão, e manter o resto', async () => {
    const { container } = await showGone();

    for (const name of ['Replay…', 'Compare with…', 'Share read-only link…']) {
      const button = within(toolbar()).getByRole('button', { name });
      expect([name, button.getAttribute('aria-disabled')]).toEqual([name, 'true']);
      expect(button).toHaveProperty('disabled', false);
      expect(described(button)).toBe(REASON);
    }
    expect(
      within(toolbar()).getByRole('button', { name: 'Explain' }).getAttribute('aria-disabled'),
    ).toBe('true');
    for (const name of ['Copy payload', 'Create rule from this request']) {
      const button = within(toolbar()).getByRole('button', { name });
      expect([name, button.getAttribute('aria-disabled')]).toEqual([name, null]);
    }
    expect(screen.getByText(REASON)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve desligar no "More" o link permanente, o conteúdo cru e o apagar', async () => {
    await showGone();

    await userEvent.click(screen.getByRole('button', { name: 'More' }));

    for (const name of [
      'Send as new…',
      'Test a variation',
      'Permalink',
      'Raw content',
      'Delete request',
    ]) {
      const item = await screen.findByRole('menuitem', { name });
      expect([name, item.getAttribute('aria-disabled')]).toEqual([name, 'true']);
      expect(described(item)).toBe(REASON);
      expect(item.hasAttribute('href')).toBe(false);
    }
  });

  it('não deve navegar nem abrir nada Quando uma ação desligada é clicada', async () => {
    await showGone();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    const start = vi.spyOn(TestBed.inject(CompareStore), 'start');

    within(toolbar()).getByRole('button', { name: 'Replay…' }).click();
    within(toolbar()).getByRole('button', { name: 'Compare with…' }).click();

    expect(navigate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(TestBed.inject(ActionPanelStore).open()).toBe(false);
  });

  it('deve sair da cópia para a vizinha que existe, de um lado e do outro', async () => {
    const view = await showGone();
    const opened: WebhookRequest[] = [];
    view.fixture.componentInstance.openRequest.subscribe((request) => opened.push(request));

    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await userEvent.click(screen.getByRole('button', { name: 'Newer' }));

    expect(opened).toEqual([older, newer]);
  });

  it('não deve oferecer a vizinha que não existe', async () => {
    await showGone([open, older]);

    expect(screen.getByRole('button', { name: 'Newer' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Older' })).toHaveProperty('disabled', false);
  });

  it('deve tirar a ação desligada da barra do celular e deixá-la no "More"', async () => {
    windowClass.set('compact');
    await showGone();

    expect(within(toolbar()).queryByRole('button', { name: 'Replay…' })).toBeNull();
    expect(
      within(toolbar()).getByRole('button', { name: 'Create rule from this request' }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const replay = await screen.findByRole('menuitem', { name: 'Replay…' });
    expect(replay.getAttribute('aria-disabled')).toBe('true');
    expect(described(replay)).toBe(REASON);
  });

  it('deve religar as ações e anunciar "Request restored." Quando o apagar é desfeito', async () => {
    const view = await render(RequestDetail, {
      inputs: { request: open, token: token(), page: 1 },
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([open, older]));
    await loaded;
    store.select(open.uuid);
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete request' }));
    await view.fixture.whenStable();
    expect(
      within(toolbar()).getByRole('button', { name: 'Replay…' }).getAttribute('aria-disabled'),
    ).toBe('true');

    snack.mock.results[0].value.dismissWithAction();

    await vi.waitFor(() => expect(announce.mock.calls).toEqual([['Request restored.']]));
    await view.fixture.whenStable();
    expect(store.gone()).toBeNull();
    expect(
      within(toolbar()).getByRole('button', { name: 'Replay…' }).getAttribute('aria-disabled'),
    ).toBeNull();
    http.expectNone({ method: 'DELETE', url: `/token/${TOKEN_ID}/request/${open.uuid}` });
  });
});

describe('Dado o detalhe de uma mensagem com as ações', () => {
  /** Janela larga por padrão; o jsdom não tem `matchMedia`. */
  const windowClass = signal<WindowClass>('large');
  const show = async (request: WebhookRequest, providers: Provider[] = []) => {
    const view = await render(RequestDetail, {
      inputs: { request, token: token(), page: 2 },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
        ...providers,
      ],
    });
    return {
      ...view,
      loader: TestbedHarnessEnvironment.loader(view.fixture),
      http: view.fixture.debugElement.injector.get(HttpTestingController),
    };
  };
  const toolbar = () => screen.getByRole('toolbar', { name: 'Request actions' });
  const action = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    windowClass.set('large');
  });

  it('deve agrupar as ações na barra "Request actions" e passar no axe', async () => {
    const { container } = await show(webhookRequest(1, { content: '{"a":1}' }));

    expect(
      within(toolbar())
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Replay…', 'Compare', 'Create rule', 'Copy payload', 'Share', 'Explain']);
    // INBOX-19: o rótulo curto é o começo do nome acessível de hoje (WCAG 2.5.3).
    for (const name of [
      'Compare with…',
      'Create rule from this request',
      'Share read-only link…',
    ]) {
      expect(action(name)).toBeTruthy();
    }
    await expectNoAxeViolations(container);
  });

  // INBOX-20: apagar a aberta sem voltar à lista, com o Undo de hoje.
  it('deve apagar a mensagem aberta pelo "Delete request" do menu "More", com o Undo', async () => {
    const request = webhookRequest(1);
    const { loader, fixture } = await show(request);
    const remove = vi
      .spyOn(fixture.debugElement.injector.get(RequestStore), 'deleteRequest')
      .mockResolvedValue(true);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.clickItem({ text: 'Delete request' });

    expect(open).toHaveBeenCalledWith('Request deleted', 'Undo', { duration: 4000 });
    expect(remove).toHaveBeenCalledWith(request, expect.any(Promise));
  });

  it('deve levar ao menu "More" o que sai da barra de seis, com Permalink (com a página) e Raw content', async () => {
    const request = webhookRequest(1);
    const { loader } = await show(request);

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.open();
    const items = await more.getItems();

    expect(await Promise.all(items.map((item) => item.getText()))).toEqual([
      'Send as new…',
      'Create schema from this request',
      'Copy As',
      'Test a variation',
      'Permalink',
      'Raw content',
      'Delete request',
    ]);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[mat-menu-item]')];
    expect(links.map((link) => link.href)).toEqual([
      `${location.origin}/#/${TOKEN_ID}/${request.uuid}/2?at=2026-09-26%2000%3A43%3A49`,
      `${location.origin}/token/${TOKEN_ID}/request/${request.uuid}/raw`,
    ]);
  });

  // INBOX-33 (trava 5): no celular, as ações principais numa linha e as demais no ⋮ "More".
  it('deve deixar Replay, Create rule e Copy na barra e levar o resto ao menu "More" Quando a janela é compacta', async () => {
    windowClass.set('compact');
    const request = webhookRequest(1, { content: '{"a":1}' });
    const { container, loader, fixture } = await show(request);

    expect(
      within(toolbar())
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Replay…', 'Create rule', 'Copy payload']);
    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.open();
    expect(await Promise.all((await more.getItems()).map((item) => item.getText()))).toEqual([
      'Compare with…',
      'Share read-only link…',
      'Explain',
      'Send as new…',
      'Create schema from this request',
      'Copy As',
      'Test a variation',
      'Permalink',
      'Raw content',
      'Delete request',
    ]);
    await expectNoAxeViolations(container);

    await more.clickItem({ text: 'Compare with…' });
    const panel = fixture.debugElement.injector.get(ActionPanelStore);
    expect([panel.open(), panel.tab()]).toEqual([true, 'compare']);
  });

  it('deve copiar o curl e avisar Quando "Copy As > curl" é escolhido', async () => {
    const request = webhookRequest(1, { headers: {}, content: null });
    const { loader, fixture } = await show(request);
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.clickItem({ text: 'Copy As' }, { text: 'curl' });

    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(`curl -X 'POST' '${request.url}'`));
    expect(open).toHaveBeenCalledWith('Copied request as curl', undefined, { duration: 1000 });
  });

  it('deve copiar o corpo cru e avisar Quando "Copy payload" é clicado', async () => {
    const { fixture } = await show(webhookRequest(1, { content: '{"a":1}' }));
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');

    await userEvent.click(action('Copy payload'));

    expect(copy).toHaveBeenCalledWith('{"a":1}');
    expect(open).toHaveBeenCalledWith('Copied payload', undefined, { duration: 1000 });
  });

  it('não deve oferecer "Copy payload" Quando o corpo é vazio', async () => {
    await show(webhookRequest(1, { content: '' }));

    expect(within(toolbar()).queryByRole('button', { name: 'Copy payload' })).toBeNull();
  });

  // C1: o "Why not rule…?" fica no grupo dos cartões, junto do cartão da regra.
  it('deve oferecer "Why not rule…?" junto dos cartões de verificação', async () => {
    await show(webhookRequest(3));

    const cartoes = screen.getByRole('group', { name: 'Checks on this request' });
    expect(within(cartoes).getByRole('button', { name: 'Why not rule…?' })).toBeTruthy();
  });

  it.each([
    ['Replay…', 'replay'],
    ['Compare with…', 'compare'],
    ['Create rule from this request', 'rule'],
    ['Explain', 'explain'],
  ] as const)(
    'deve abrir o painel de ação na aba certa Quando "%s" é clicado',
    async (name, tab) => {
      const { fixture } = await show(webhookRequest(3));
      const navigate = vi.spyOn(fixture.debugElement.injector.get(Router), 'navigate');
      const dialog = vi.spyOn(fixture.debugElement.injector.get(MatDialog), 'open');

      await userEvent.click(action(name));

      const panel = fixture.debugElement.injector.get(ActionPanelStore);
      expect([panel.open(), panel.tab()]).toEqual([true, tab]);
      expect(navigate).not.toHaveBeenCalled();
      expect(dialog).not.toHaveBeenCalled();
    },
  );

  it('deve devolver o foco ao botão que abriu Quando o painel fecha', async () => {
    const { fixture } = await show(webhookRequest(3));
    const replay = action('Replay…');

    await userEvent.click(replay);
    (document.activeElement as HTMLElement | null)?.blur();
    fixture.debugElement.injector.get(ActionPanelStore).close();

    expect(document.activeElement).toBe(replay);
  });

  it('deve abrir o Send da mensagem apontado para a própria URL Quando "Test a variation" (WM-28)', async () => {
    const request = webhookRequest(3);
    // O Router de verdade: o cartão da regra tem link (WM-10), e o RouterLink precisa dele.
    const { fixture, loader } = await show(request);
    const navigate = vi
      .spyOn(fixture.debugElement.injector.get(Router), 'navigate')
      .mockResolvedValue(true);

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.clickItem({ text: 'Test a variation' });

    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'outbound'], {
      queryParams: { 'send-from': request.uuid, to: 'self' },
    });
  });

  it('deve abrir Checks › Schema com a mensagem Quando "Create schema from this request" é clicado', async () => {
    const request = webhookRequest(3, { content: '{"id": 7}' });
    const { fixture, loader } = await show(request);
    const navigate = vi
      .spyOn(fixture.debugElement.injector.get(Router), 'navigate')
      .mockResolvedValue(true);

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.clickItem({ text: 'Create schema from this request' });

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'checks'], {
        queryParams: { 'schema-from': request.uuid },
      }),
    );
  });

  it.each([
    ['vazio', ''],
    ['nulo', null],
    ['um formulário', 'nome=Ana'],
    ['JSON malformado', '{"id": '],
  ])(
    'não deve oferecer "Create schema from this request" Quando o corpo é %s',
    async (_caso, content) => {
      const { loader } = await show(webhookRequest(1, { content }));

      const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
      await more.open();
      const items = await Promise.all((await more.getItems()).map((item) => item.getText()));
      expect(items).not.toContain('Create schema from this request');
    },
  );

  it('deve abrir Outbound com a mensagem Quando "Send as new…" é escolhido no "More"', async () => {
    const request = webhookRequest(5);
    const { fixture, loader } = await show(request);
    const navigate = vi
      .spyOn(fixture.debugElement.injector.get(Router), 'navigate')
      .mockResolvedValue(true);

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.clickItem({ text: 'Send as new…' });

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'outbound'], {
        queryParams: { 'send-from': request.uuid },
      }),
    );
  });

  it('deve abrir o diálogo do link só-leitura Quando "Share read-only link…" é clicado', async () => {
    const request = webhookRequest(6);
    const { fixture } = await show(request);
    const open = vi
      .spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
      .mockReturnValue({} as never);

    await userEvent.click(action('Share read-only link…'));

    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        ShareDialog,
        expect.objectContaining({ data: { request } }),
      ),
    );
  });

  describe('Dado o cartão da resposta com a regra que chegou mais perto', () => {
    const traceUrl = (request: WebhookRequest) =>
      `/token/${TOKEN_ID}/request/${request.uuid}/rules/trace`;
    const checks = () => screen.getByRole('group', { name: 'Checks on this request' });
    const trace = (answeredBy: string, conditions: string[]): RuleTrace => ({
      request: 'x',
      responded_by: { id: answeredBy, name: 'Tudo o resto' },
      rules: [
        {
          id: 'r1',
          name: 'Pedido pago',
          enabled: true,
          position: 1,
          matches: answeredBy === 'r1',
          failed: answeredBy === 'r1' ? [] : ['method: expected POST, got GET'],
          conditions: ['match.method'],
        },
        {
          id: 'r9',
          name: 'Tudo o resto',
          enabled: true,
          position: 2,
          matches: true,
          failed: [],
          conditions,
        },
      ],
    });

    it('deve dizer a regra mais perto, com a ressalva do trace, Quando uma pega-tudo respondeu', async () => {
      const request = webhookRequest(1, {
        rule: { id: 'r9', name: 'Tudo o resto' },
        response: { status: 404 },
      });
      const { http, fixture, container } = await show(request);

      http.expectOne(traceUrl(request)).flush(trace('r9', []));
      await fixture.whenStable();

      expect(checks().textContent).toContain('Answered 404 · by rule');
      expect(checks().textContent).toContain(
        'Closest rule: Pedido pago — method: expected POST, got GET',
      );
      expect(checks().textContent).toContain('Checked against the rules as they are now.');
      await expectNoAxeViolations(container);
    });

    it('não deve dizer regra mais perto Quando respondeu uma regra com condições', async () => {
      const request = webhookRequest(1, {
        rule: { id: 'r9', name: 'Tudo o resto' },
        response: { status: 404 },
      });
      const { http, fixture } = await show(request);

      http.expectOne(traceUrl(request)).flush(trace('r9', ['match.path']));
      await fixture.whenStable();

      expect(checks().textContent).toContain('Answered 404 · by rule');
      expect(checks().textContent).not.toContain('Closest rule');
      expect(checks().textContent).not.toContain('Checked against the rules as they are now.');
    });

    it('não deve pedir o trace sem regra, nem ficar com a frase de outra requisição', async () => {
      const first = webhookRequest(1, {
        rule: { id: 'r9', name: 'Tudo o resto' },
        response: { status: 404 },
      });
      const { http, fixture } = await show(first);
      const pending = http.expectOne(traceUrl(first));

      fixture.componentRef.setInput('request', webhookRequest(2, { response: { status: 429 } }));
      await fixture.whenStable();
      pending.flush(trace('r9', []));
      await fixture.whenStable();

      http.expectNone((call) => call.url.endsWith('/rules/trace'));
      expect(checks().textContent).toContain('Answered 429 · default response');
      expect(checks().textContent).not.toContain('Closest rule');
    });
  });

  describe('Dado Newer e Older (a lista vai da mais nova, no topo, para a mais antiga; INBOX-01)', () => {
    it('deve abrir a vizinha e desabilitar na ponta', async () => {
      // c é a mais nova (no topo da lista), a a mais antiga.
      const [c, b, a] = [3, 2, 1].map((n) => webhookRequest(n));
      const opened: WebhookRequest[] = [];
      const view = await render(RequestDetail, {
        inputs: { request: b, token: token(), page: 1 },
        on: { openRequest: (request: WebhookRequest) => opened.push(request) },
        providers: [provideHttpClient(), provideHttpClientTesting()],
        configureTestBed: (testBed) => {
          const store = testBed.inject(RequestStore);
          const loaded = store.load(TOKEN_ID);
          testBed
            .inject(HttpTestingController)
            .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
            .flush(requestPage([c, b, a]));
          return loaded;
        },
      });
      await view.fixture.whenStable();

      await userEvent.click(screen.getByRole('button', { name: 'Newer' }));
      await userEvent.click(screen.getByRole('button', { name: 'Older' }));
      expect(opened).toEqual([c, a]);

      view.fixture.componentRef.setInput('request', c);
      await view.fixture.whenStable();
      expect(screen.getByRole('button', { name: 'Newer' })).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: 'Older' })).toHaveProperty('disabled', false);
    });
  });

  describe('Dado o "Explain"', () => {
    const explainUrl = (request: WebhookRequest) =>
      `/token/${TOKEN_ID}/request/${request.uuid}/explain`;

    it('deve continuar "Explain" com o painel aberto, e abrir outra vez sem fechar', async () => {
      const { fixture } = await show(webhookRequest(6));
      const panel = fixture.debugElement.injector.get(ActionPanelStore);

      await userEvent.click(action('Explain'));
      await userEvent.click(action('Explain'));

      expect([panel.open(), panel.tab(), panel.explainFor()]).toEqual([
        true,
        'explain',
        webhookRequest(6).uuid,
      ]);
      expect(action('Explain').textContent?.trim()).toBe('Explain');
    });

    it('deve desabilitar o "Explain" com a dica de configuração Quando a IA está desligada (503)', async () => {
      const request = webhookRequest(6);
      const { container, http, fixture } = await show(request);
      const asked = TestBed.inject(AiClient).explain(TOKEN_ID, request.uuid);
      http
        .expectOne(explainUrl(request))
        .flush(
          { error: 'AI is not configured' },
          { status: 503, statusText: 'Service Unavailable' },
        );
      await expect(asked).rejects.toBeTruthy();
      await fixture.whenStable();

      expect(container.querySelector('.ai-off')?.textContent?.trim()).toBe(
        'This server has no local AI.',
      );
      const explain = action('Explain');
      expect(explain).toHaveProperty('disabled', false);
      expect(explain.getAttribute('aria-disabled')).toBe('true');
      expect(
        document.getElementById(explain.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe('This server has no local AI.');
      await userEvent.click(explain);
      expect(fixture.debugElement.injector.get(ActionPanelStore).open()).toBe(false);
    });

    it('deve abrir a aba Explain Quando o "Open" do aviso pede a explicação desta requisição', async () => {
      const request = webhookRequest(6);
      const { fixture } = await show(request);
      const panel = fixture.debugElement.injector.get(ActionPanelStore);

      TestBed.inject(Explanations).wanted.set(webhookRequest(7).uuid);
      await fixture.whenStable();
      expect(panel.open()).toBe(false);

      TestBed.inject(Explanations).wanted.set(request.uuid);
      await fixture.whenStable();
      expect([panel.open(), panel.tab(), panel.explainFor()]).toEqual([
        true,
        'explain',
        request.uuid,
      ]);
    });
  });
});
