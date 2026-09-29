import { InteractivityChecker } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { ActionPanel } from './action-panel';
import { ACTION_PANEL_KEY, ActionPanelStore, ActionTab, PANEL_MIN_PX } from './action-panel-store';

describe('Dado o painel de ação acoplado ao detalhe', () => {
  const request = webhookRequest(2);
  const show = async (tab: ActionTab = 'replay', sheet = false, providers: Provider[] = []) => {
    localStorage.setItem(ACTION_PANEL_KEY, JSON.stringify({ open: true, tab, height: null }));
    const view = await render(ActionPanel, {
      inputs: { request, sheet },
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), ...providers],
    });
    return { ...view, store: TestBed.inject(ActionPanelStore) };
  };
  const tabs = () => within(screen.getByRole('tablist', { name: 'Actions on this request' }));
  const selected = () => tabs().getByRole('tab', { selected: true }).textContent?.trim();

  afterEach(() => localStorage.clear());

  it('deve ser a região "Action panel" com as quatro abas, e passar no axe', async () => {
    const { container } = await show();

    const panel = screen.getByRole('region', { name: 'Action panel' });
    expect(
      tabs()
        .getAllByRole('tab')
        .map((tab) => tab.textContent?.trim()),
    ).toEqual(['Replay', 'Compare', 'Create rule', 'Explain']);
    expect(selected()).toBe('Replay');
    expect(within(panel).getByRole('tabpanel', { name: 'Replay' })).toBeTruthy();
    expect(within(panel).getByRole('group', { name: 'Action result' }).textContent).toBe('');
    await expectNoAxeViolations(container);
  });

  it('deve andar pelas abas com as setas, Home e End, com ativação automática', async () => {
    const { store } = await show();
    tabs().getByRole('tab', { name: 'Replay' }).focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect([selected(), store.tab()]).toEqual(['Explain', 'explain']);
    await userEvent.keyboard('{Home}');
    expect(selected()).toBe('Replay');
    await userEvent.keyboard('{ArrowRight}');
    expect(selected()).toBe('Compare');
    await userEvent.keyboard('{End}');
    expect(selected()).toBe('Explain');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(tabs().getByRole('tab', { name: 'Explain' })),
    );
  });

  it('deve mudar a altura pelo divisor, sem passar do mínimo, e expandir e restaurar', async () => {
    const { store, fixture } = await show();
    const separator = screen.getByRole('separator', { name: 'Resize action panel' });
    expect(separator.getAttribute('aria-valuemin')).toBe(String(PANEL_MIN_PX));
    expect(fixture.nativeElement.style.height).toBe('40%');

    separator.focus();
    await userEvent.keyboard('{ArrowUp}');
    await fixture.whenStable();
    // O jsdom não mede: 0 + 40 px fica no mínimo.
    expect(store.height()).toBe(PANEL_MIN_PX);
    expect(fixture.nativeElement.style.height).toBe(`${PANEL_MIN_PX}px`);

    await userEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
    expect(fixture.nativeElement.style.height).toBe('100%');
    await userEvent.click(screen.getByRole('button', { name: 'Restore panel' }));
    expect(fixture.nativeElement.style.height).toBe(`${PANEL_MIN_PX}px`);
  });

  it.each([
    [
      'o "Close panel"',
      async () => userEvent.click(screen.getByRole('button', { name: 'Close panel' })),
    ],
    [
      'o Esc dentro do painel',
      async () => {
        tabs().getByRole('tab', { name: 'Replay' }).focus();
        await userEvent.keyboard('{Escape}');
      },
    ],
  ])('deve fechar pelo %s', async (_caso, close) => {
    const { store } = await show();

    await close();

    expect(store.open()).toBe(false);
  });

  it('deve ser uma folha de tela cheia, modal, com "Close", abaixo de 840 px', async () => {
    // O jsdom não tem layout: o CDK acharia todo elemento invisível e nada focável.
    const checker: Partial<InteractivityChecker> = {
      isVisible: () => true,
      isDisabled: (element) => element.hasAttribute('disabled'),
      isFocusable: (element) => element.tabIndex >= -1,
      isTabbable: (element) => element.tabIndex >= 0,
    };
    const { container, store } = await show('replay', true, [
      { provide: InteractivityChecker, useValue: checker },
    ]);

    const sheet = screen.getByRole('dialog', { name: 'Actions on this request' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(sheet).getByRole('tab', { name: 'Replay' })),
    );
    expect(screen.queryByRole('separator')).toBeNull();
    await expectNoAxeViolations(container);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(store.open()).toBe(false);
  });

  it('deve pedir a outra da lista na aba Compare e mostrar o par, com o link da comparação inteira', async () => {
    const { store, fixture } = await show('compare');
    const compare = TestBed.inject(CompareStore);

    expect(compare.picking()).toEqual(request);
    expect(screen.getByText('Pick a request in the list to compare with #00000.')).toBeTruthy();

    const other = webhookRequest(1, { content: '{"n":1,"ok":false}' });
    compare.showInPanel(other, request);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('app-request-compare')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open full comparison' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/compare/${other.uuid}/${request.uuid}`,
    );
    await vi.waitFor(() =>
      expect(store.result()).toMatch(
        /^Compared #00000 with #00000\. \d+ changes? explains? the outcome\.$/,
      ),
    );
  });

  it('deve mostrar a folha de criar regra na aba Create rule e fechar pelo "Cancel" dela', async () => {
    const { store } = await show('rule');

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(screen.getByRole('checkbox', { name: 'Method POST' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(cancel);

    expect(store.open()).toBe(false);
  });

  it('deve pedir ao modelo só pela requisição pedida, e não ao trocar de requisição', async () => {
    const explainUrl = (uuid: string) => `/token/${TOKEN_ID}/request/${uuid}/explain`;
    const { store, fixture } = await show('explain');
    const http = TestBed.inject(HttpTestingController);
    await screen.findByRole('button', { name: 'Ask the local model' });
    http.expectNone(explainUrl(request.uuid));

    store.explainFor.set(request.uuid);
    await vi.waitFor(() => http.expectOne(explainUrl(request.uuid)));

    const other = webhookRequest(5);
    fixture.componentRef.setInput('request', other);
    await screen.findByRole('button', { name: 'Ask the local model' });
    http.expectNone(explainUrl(other.uuid));
  });

  it('deve andar para um par do mesmo evento sem a aberta, e trocar o par ao abrir outra requisição', async () => {
    const { fixture } = await show('compare');
    const compare = TestBed.inject(CompareStore);
    const [first, second] = [webhookRequest(7), webhookRequest(8)];

    compare.showInPanel(first, second);
    await fixture.whenStable();
    expect(compare.inPanel()).toEqual({ a: first, b: second });
    expect(fixture.nativeElement.querySelector('app-request-compare')).not.toBeNull();

    fixture.componentRef.setInput('request', webhookRequest(9));
    await fixture.whenStable();
    expect(compare.picking()).toEqual(webhookRequest(9));
    expect(fixture.nativeElement.querySelector('app-request-compare')).toBeNull();
  });

  it('deve fechar Quando a escolha na lista é cancelada sem par', async () => {
    const { store, fixture } = await show('compare');

    TestBed.inject(CompareStore).close();
    await fixture.whenStable();

    expect(store.open()).toBe(false);
  });

  it('deve dizer o resultado da ação pela região "Action result"', async () => {
    const { store, fixture } = await show();

    store.result.set('Replay result: 201 Created in 12 ms');
    await fixture.whenStable();

    expect(screen.getByRole('group', { name: 'Action result' }).textContent).toBe(
      'Replay result: 201 Created in 12 ms',
    );
  });
});
