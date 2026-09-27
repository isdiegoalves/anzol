import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { ScenarioPanel } from './scenario-panel';
import { Scenario } from './scenario-store';

const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;

describe('Dado os cenários da URL na aba Scenario do editor (RULES-12/24)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ScenarioPanel>;
  let loader: HarnessLoader;

  const retry = (state = 'Started'): Scenario => ({
    name: 'Retry',
    state,
    states: ['Started', 'falhou-1', 'falhou-2', 'ok'],
  });
  const login: Scenario = { name: 'Login', state: 'logado', states: ['logado'] };

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () =>
    [...element().querySelectorAll('tbody tr[data-scenario]')].map((row) =>
      [...row.querySelectorAll('td.data')].map((cell) => cell.textContent?.trim()),
    );
  const button = (text: string, ancestor?: string) =>
    loader.getHarness(MatButtonHarness.with({ text, ancestor }));
  const flushGet = (scenarios: Scenario[]) =>
    vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_CENARIOS }).flush(scenarios));
  const open = async (scenarios: Scenario[], rules: Rule[] = []) => {
    fixture = TestBed.createComponent(ScenarioPanel);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('rules', rules);
    loader = TestbedHarnessEnvironment.loader(fixture);
    fixture.detectChanges();
    await flushGet(scenarios);
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ScenarioPanel],
      // As setas do diagrama são links para as regras (E-09).
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('deve apontar o estado exigido que nenhuma regra produz (provável erro de digitação, E-09)', async () => {
    await open(
      [{ name: 'entrega', state: 'Started', states: ['Started'] }],
      [
        rule(1, { scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' } }),
        rule(2, { scenario: { name: 'entrega', requiredState: 'entregue' } }),
        rule(3, { scenario: { name: 'entrega', requiredState: 'falhou-1' } }),
      ],
    );

    expect(screen.getAllByRole('note').map((note) => note.textContent?.trim())).toEqual([
      'No rule leads to state "entregue" — probably a typo.',
    ]);
  });

  it('deve listar cada cenário com o estado atual Quando carrega', async () => {
    await open([retry('falhou-1'), login]);

    expect(screen.getByRole('heading', { name: 'Scenarios on this URL' })).toBeTruthy();
    expect(rows()).toEqual([
      ['Retry', 'falhou-1'],
      ['Login', 'logado'],
    ]);
  });

  it('deve incluir o cenário que só o rascunho cita, em Started, com o diagrama das regras com o rascunho, e passar no axe', async () => {
    const rascunho = [
      rule(1, { scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' } }),
      rule(2, { scenario: { name: 'Novo', newState: 'x' } }),
    ];
    await open([retry('falhou-1')], rascunho);

    expect(rows()).toEqual([
      ['Retry', 'falhou-1'],
      ['Novo', 'Started'],
    ]);
    expect(
      screen.getByRole('img', { name: /^Retry: Started, then falhou-1 \(current\)/ }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Novo: Started (current), then x' })).toBeTruthy();
    await expectNoAxeViolations(element());
  });

  it('deve oferecer Started e os estados citados, e enviar o escolhido Quando "Set state" é clicado', async () => {
    await open([retry()]);
    const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: '[aria-label="New state of Retry"]' }),
    );
    const setState = await button('Set state', '[data-scenario="Retry"]');
    expect(await setState.isDisabled()).toBe(true);

    await select.open();
    const options = await Promise.all((await select.getOptions()).map((o) => o.getText()));
    expect(options).toEqual(['Started', 'falhou-1', 'falhou-2', 'ok']);
    await select.clickOptions({ text: 'falhou-2' });
    await setState.click();

    const call = http.expectOne({ method: 'PUT', url: `${URL_CENARIOS}/Retry` });
    expect(call.request.body).toEqual({ state: 'falhou-2' });
    call.flush(null);
    await flushGet([retry('falhou-2')]);
    await vi.waitFor(() => expect(rows()).toEqual([['Retry', 'falhou-2']]));
    expect(snack).toHaveBeenCalledWith('Scenario Retry set to falhou-2', undefined, {
      duration: 4000,
    });
  });

  /** O diálogo "Reset all scenarios?" (WM-37), e o botão escolhido nele. */
  const confirmReset = async (choice: 'Reset' | 'Cancel') => {
    const dialog = await vi.waitFor(() =>
      TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness),
    );
    const texto = [await dialog.getTitleText(), await dialog.getContentText()];
    await (await dialog.getHarness(MatButtonHarness.with({ text: choice }))).click();
    return texto;
  };

  it('deve confirmar nomeando os cenários, apagar todos os estados e reler Quando "Reset all" é clicado', async () => {
    await open([retry('ok'), login]);

    await (await button('Reset all to Started')).click();

    expect(await confirmReset('Reset')).toEqual([
      'Reset all scenarios?',
      'Resets 2 scenarios to Started: Retry, Login.',
    ]);
    (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: URL_CENARIOS }))).flush(null);
    await flushGet([retry(), { ...login, state: 'Started' }]);
  });

  it('não deve zerar nada Quando o reset é cancelado', async () => {
    await open([retry('ok')]);

    await (await button('Reset all to Started')).click();
    await confirmReset('Cancel');

    http.expectNone({ method: 'DELETE', url: URL_CENARIOS });
    expect(rows()).toEqual([['Retry', 'ok']]);
  });

  it('deve reler os estados depois do reset', async () => {
    await open([retry('ok'), login]);

    await (await button('Reset all to Started')).click();
    await confirmReset('Reset');

    (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: URL_CENARIOS }))).flush(null);
    await flushGet([retry(), { ...login, state: 'Started' }]);
    await vi.waitFor(() =>
      expect(rows()).toEqual([
        ['Retry', 'Started'],
        ['Login', 'Started'],
      ]),
    );
  });

  it('deve reler os estados Quando "Refresh" é clicado (webhooks mudam o estado)', async () => {
    await open([retry()]);

    await (await button('Refresh')).click();
    await flushGet([retry('falhou-1')]);

    await vi.waitFor(() => expect(rows()).toEqual([['Retry', 'falhou-1']]));
  });

  it('deve explicar o erro e manter a lista Quando o reset falha', async () => {
    await open([retry('ok')]);

    await (await button('Reset all to Started')).click();
    await confirmReset('Reset');
    (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: URL_CENARIOS }))).flush(
      { success: false },
      { status: 410, statusText: 'Gone' },
    );

    await vi.waitFor(() =>
      expect(element().querySelector('[role=alert]')?.textContent).toContain(
        'This URL no longer exists (410).',
      ),
    );
    expect(rows()).toEqual([['Retry', 'ok']]);
  });

  it('deve dizer que não há estado guardado Quando a lista vem vazia', async () => {
    await open([]);

    expect(element().textContent).toContain('No scenario state yet');
  });
});
