import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Provider, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { ShareDialog } from '../share/share-dialog';
import { Viewport, WindowClass } from '../shell/viewport';
import { RequestDetail } from './request-detail';

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
    windowClass.set('large');
  });

  it('deve agrupar as ações na barra "Request actions" e passar no axe', async () => {
    const { container } = await show(webhookRequest(1, { content: '{"a":1}' }));

    expect(
      within(toolbar())
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'Replay…',
      'Send as new…',
      'Compare',
      'Create rule',
      'Create schema',
      'Copy payload',
      'Copy As',
      'Share',
      'Explain',
    ]);
    // INBOX-19: o rótulo curto é o começo do nome acessível de hoje (WCAG 2.5.3).
    for (const name of [
      'Compare with…',
      'Create rule from this request',
      'Create schema from this request',
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

  it('deve levar Permalink (com a página) e Raw content no menu "More"', async () => {
    const request = webhookRequest(1);
    const { loader } = await show(request);

    const more = await loader.getHarness(MatMenuHarness.with({ triggerText: '' }));
    await more.open();
    const items = await more.getItems();

    // WM-28: "Test a variation" no "More" também no desktop, para a barra caber numa linha (INBOX-19).
    expect(await Promise.all(items.map((item) => item.getText()))).toEqual([
      'Test a variation',
      'Permalink',
      'Raw content',
      'Delete request',
    ]);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[mat-menu-item]')];
    expect(links.map((link) => link.href)).toEqual([
      `${location.origin}/#/${TOKEN_ID}/${request.uuid}/2`,
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
    // A 390 px, o Copy As não cabe na linha: vai ao "More", com os formatos no submenu (trava 5).
    expect(await Promise.all((await more.getItems()).map((item) => item.getText()))).toEqual([
      'Send as new…',
      'Test a variation',
      'Compare with…',
      'Create schema from this request',
      'Copy As',
      'Share read-only link…',
      'Explain',
      'Permalink',
      'Raw content',
      'Delete request',
    ]);
    await expectNoAxeViolations(container);

    await more.clickItem({ text: 'Compare with…' });
    expect(fixture.debugElement.injector.get(CompareStore).picking()).toEqual(request);
  });

  it('deve copiar o curl e avisar Quando "Copy As > curl" é escolhido', async () => {
    const request = webhookRequest(1, { headers: {}, content: null });
    const { loader, fixture } = await show(request);
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);
    const open = vi.spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open');

    const menu = await loader.getHarness(MatMenuHarness.with({ triggerText: 'Copy As' }));
    await menu.clickItem({ text: 'curl' });

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

  it('deve abrir a folha "Create rule from this request" de Regras com a mensagem (WM-31)', async () => {
    const request = webhookRequest(3);
    const { fixture } = await show(request);
    const open = vi
      .spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
      .mockReturnValue({} as never);

    await userEvent.click(action('Create rule from this request'));

    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    const [component, config] = open.mock.calls[0];
    expect(String((component as { name?: string }).name)).toContain('RuleFromRequestDialog');
    expect(config).toMatchObject({ data: request });
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
    const { fixture } = await show(request);
    const navigate = vi
      .spyOn(fixture.debugElement.injector.get(Router), 'navigate')
      .mockResolvedValue(true);

    await userEvent.click(action('Create schema from this request'));

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
      await show(webhookRequest(1, { content }));

      expect(
        within(toolbar()).queryByRole('button', { name: 'Create schema from this request' }),
      ).toBeNull();
    },
  );

  it('deve pôr a lista em modo de escolha com a aberta como A Quando "Compare with…" é clicado', async () => {
    const request = webhookRequest(4);
    const { fixture } = await show(request);

    await userEvent.click(action('Compare with…'));

    expect(fixture.debugElement.injector.get(CompareStore).picking()).toEqual(request);
  });

  it.each([
    ['Replay…', 'replay'],
    ['Send as new…', 'send-from'],
  ] as const)('deve abrir Outbound com a mensagem Quando "%s" é clicado', async (name, param) => {
    const request = webhookRequest(5);
    const { fixture } = await show(request);
    const navigate = vi
      .spyOn(fixture.debugElement.injector.get(Router), 'navigate')
      .mockResolvedValue(true);

    await userEvent.click(action(name));

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'outbound'], {
        queryParams: { [param]: request.uuid },
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
    const explainButton = () => action(/^(Explain|Hide explanation)$/);

    it('deve abrir o painel com o diagnóstico e trocar o botão para "Hide explanation"', async () => {
      const request = webhookRequest(6);
      const { container, http } = await show(request);
      expect(container.querySelector('app-explain-panel')).toBeNull();

      await userEvent.click(explainButton());

      const call = await vi.waitFor(() =>
        http.expectOne({ method: 'POST', url: explainUrl(request) }),
      );
      expect(call.request.body).toEqual({ lang: navigator.language });
      call.flush({ explanation: 'Assinatura **válida**.', facts: {} });
      await vi.waitFor(() =>
        expect(container.querySelector('app-explain-panel strong')?.textContent).toBe('válida'),
      );
      expect(explainButton().textContent?.trim()).toBe('Hide explanation');
      http.verify();
    });

    it('deve fechar o painel Quando "Hide explanation" é clicado ou outra mensagem é aberta', async () => {
      const request = webhookRequest(6);
      const { container, http, fixture } = await show(request);
      await userEvent.click(explainButton());
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush({ explanation: 'x' });
      await vi.waitFor(() => expect(container.querySelector('app-explain-panel')).not.toBeNull());

      await userEvent.click(explainButton());
      await vi.waitFor(() => expect(container.querySelector('app-explain-panel')).toBeNull());

      await userEvent.click(explainButton());
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush({ explanation: 'x' });
      await vi.waitFor(() => expect(container.querySelector('app-explain-panel')).not.toBeNull());
      fixture.componentRef.setInput('request', webhookRequest(7));
      await fixture.whenStable();
      expect(container.querySelector('app-explain-panel')).toBeNull();
      expect(explainButton().textContent?.trim()).toBe('Explain');
    });

    it('deve desabilitar o "Explain" com a dica de configuração Quando a IA está desligada (503)', async () => {
      const request = webhookRequest(6);
      const { container, http } = await show(request);
      await userEvent.click(explainButton());
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush(
        { error: 'AI is not configured' },
        { status: 503, statusText: 'Service Unavailable' },
      );

      await vi.waitFor(() =>
        expect(container.querySelector('.ai-off')?.textContent?.trim()).toBe(
          'Set WEBHOOK_AI_* to enable',
        ),
      );
      await userEvent.click(explainButton());
      await vi.waitFor(() => expect(container.querySelector('app-explain-panel')).toBeNull());
      expect(explainButton()).toHaveProperty('disabled', true);
    });
  });
});
