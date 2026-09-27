import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { ScenarioStates } from './scenario-states';

const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;

const REGRAS: Rule[] = [
  rule(1, { scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou 1' } }),
  rule(2, { scenario: { name: 'entrega', requiredState: 'falhou 1' } }),
  rule(3, { scenario: { name: 'novo', newState: 'x' } }),
];

describe('Dado a seção "Scenarios on this URL" da aba Scenario (RULES-24)', () => {
  let http: HttpTestingController;

  const show = async () => {
    const view = await render(ScenarioStates, {
      inputs: { tokenId: TOKEN_ID, rules: REGRAS },
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    http
      .expectOne({ method: 'GET', url: URL_CENARIOS })
      .flush([{ name: 'entrega', state: 'falhou 1', states: ['Started', 'falhou 1'] }]);
    await view.fixture.whenStable();
    return view;
  };

  afterEach(() => http.verify());

  it('deve mostrar cada cenário com o estado atual, inclusive o que só o rascunho cita, e passar no axe', async () => {
    const { container } = await show();

    expect(screen.getByRole('heading', { name: 'Scenarios on this URL' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'entrega: Started, then falhou 1 (current)' }),
    ).toBeTruthy();
    // "novo" ainda não tem estado no servidor: começa em Started.
    expect(screen.getByRole('img', { name: 'novo: Started (current), then x' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve definir o estado escolhido com "Set" e reler', async () => {
    const { fixture } = await show();
    const loader = TestbedHarnessEnvironment.loader(fixture);

    const estado = await loader.getHarness(
      MatSelectHarness.with({ selector: '[aria-label="Set state of entrega"]' }),
    );
    await estado.open();
    await estado.clickOptions({ text: 'Started' });
    const linha = screen
      .getByRole('img', { name: /^entrega:/ })
      .closest('.scenario') as HTMLElement;
    await userEvent.click(within(linha).getByRole('button', { name: 'Set' }));

    const put = await vi.waitFor(() =>
      http.expectOne({ method: 'PUT', url: `${URL_CENARIOS}/entrega` }),
    );
    expect(put.request.body).toEqual({ state: 'Started' });
    put.flush({ name: 'entrega', state: 'Started', states: [] });
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_CENARIOS }))).flush([
      { name: 'entrega', state: 'Started', states: ['Started', 'falhou 1'] },
    ]);
    await vi.waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'entrega: Started (current), then falhou 1' }),
      ).toBeTruthy(),
    );
  });

  it('deve voltar tudo a Started com "Reset all to Started" e reler com "Refresh"', async () => {
    await show();

    await userEvent.click(screen.getByRole('button', { name: 'Reset all to Started' }));
    (await vi.waitFor(() => http.expectOne({ method: 'DELETE', url: URL_CENARIOS }))).flush([]);
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_CENARIOS }))).flush([]);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_CENARIOS }))).flush([]);
  });
});
