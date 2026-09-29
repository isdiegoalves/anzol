import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelectHarness } from '@angular/material/select/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { RuleIntents } from './rule-intents';
import { RuleStore } from './rule-store';
import { ScenarioSequence } from './scenario-sequence';
import { insertSequence, sequenceRules, suggestScenarioName } from './sequence';

const spec = {
  methods: ['POST'],
  path: { equals: '/entrega' },
  times: 2,
  first: { status: 503, body: 'tente de novo' },
  final: { status: 200, body: '{"ok":true}' },
  scenario: 'entrega',
};

describe('Dado o assistente de sequência (sequenceRules, WM-32)', () => {
  it('deve gerar N+1 regras encadeadas, a última sem estado novo (fica)', () => {
    const rules = sequenceRules(spec, 9);

    expect(
      rules.map((r) => [
        r.name,
        r.priority,
        r.scenario?.requiredState,
        r.scenario?.newState ?? null,
        r.response?.status,
      ]),
    ).toEqual([
      ['entrega 1/3', 9, 'Started', 'entrega 2', 503],
      ['entrega 2/3', 9, 'entrega 2', 'entrega 3', 503],
      ['entrega 3/3', 9, 'entrega 3', null, 200],
    ]);
    expect(rules.every((r) => r.scenario?.name === 'entrega' && r.enabled)).toBe(true);
    expect(rules[0].match).toEqual({
      method: ['POST'],
      path: { equals: '/entrega' },
      query: {},
      headers: {},
      body: [],
    });
    expect(rules[0].response?.body).toBe('tente de novo');
    expect(rules[2].response?.body).toBe('{"ok":true}');
    expect(rules[2].scenario).not.toHaveProperty('newState');
  });

  it('deve pôr o Retry-After só nas respostas que recusam', () => {
    const rules = sequenceRules({ ...spec, first: { ...spec.first, retryAfter: 5 } }, 5);

    expect(rules.map((r) => r.response?.headers)).toEqual([
      { 'Retry-After': '5' },
      { 'Retry-After': '5' },
      {},
    ]);
  });

  it('deve gerar 2 regras Quando N é 1', () => {
    expect(sequenceRules({ ...spec, times: 1 }, 5).map((r) => r.name)).toEqual([
      'entrega 1/2',
      'entrega 2/2',
    ]);
  });

  it.each([
    ['/entrega', 'entrega'],
    ['/api/v1/pagamentos/', 'pagamentos'],
    ['', 'sequence'],
    ['/', 'sequence'],
  ])('deve sugerir o nome do cenário pelo caminho %s → %s', (path, name) => {
    expect(suggestScenarioName(path)).toBe(name);
  });

  it('deve inserir as regras contíguas antes da pega-tudo ligada, com a prioridade dela', () => {
    const tudo = rule(9, {
      name: 'Tudo',
      priority: 7,
      match: { method: [], path: null, query: {}, headers: {}, body: [] },
    });
    const { rules, priority } = insertSequence([rule(1, { priority: 1 }), tudo], spec);

    expect(priority).toBe(7);
    expect(rules.map((r) => r.name)).toEqual([
      'Rule 1',
      'entrega 1/3',
      'entrega 2/3',
      'entrega 3/3',
      'Tudo',
    ]);
  });

  it('deve pôr no fim com P5 Quando não há pega-tudo', () => {
    const { rules, priority } = insertSequence([rule(1)], spec);

    expect(priority).toBe(5);
    expect(rules.map((r) => r.name)).toEqual([
      'Rule 1',
      'entrega 1/3',
      'entrega 2/3',
      'entrega 3/3',
    ]);
  });
});

describe('Dado o diálogo "Sequence" (WM-32)', () => {
  const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
  let http: HttpTestingController;
  const close = vi.fn();

  const show = async (saved: Rule[] = [rule(1)]) => {
    const result = await render(ScenarioSequence, {
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { path: '/entrega' } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // A lista salva, lida como a página a lê (a guarda "changed elsewhere" compara com ela).
    const load = TestBed.inject(RuleStore).load(TOKEN_ID);
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(saved);
    await load;
    result.fixture.detectChanges();
    return result;
  };

  afterEach(() => {
    http.verify();
    close.mockReset();
    vi.restoreAllMocks();
  });

  it('deve sugerir o cenário pelo caminho e mostrar a prévia das regras', async () => {
    const { container } = await show();

    expect(screen.getByRole('heading', { name: 'Sequence' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Scenario name' }) as HTMLInputElement).value).toBe(
      'entrega',
    );
    expect((screen.getByRole('spinbutton', { name: 'Times' }) as HTMLInputElement).value).toBe('2');
    const previa = screen.getByRole('region', { name: 'Preview' });
    expect(within(previa).getByText('3 rules will be created')).toBeTruthy();
    expect(
      within(previa)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual([
      'entrega 1/3 · Started → entrega 2 · 503',
      'entrega 2/3 · entrega 2 → entrega 3 · 503',
      'entrega 3/3 · entrega 3 (stays) · 200',
    ]);
    expect(screen.getByRole('button', { name: 'Create 3 rules' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve passar de "Any path" a "Equals" Quando o caminho é digitado', async () => {
    const result = await render(ScenarioSequence, {
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const modo = await TestbedHarnessEnvironment.loader(result.fixture).getHarness(
      MatSelectHarness,
    );
    expect(await modo.getValueText()).toBe('Any path');

    await userEvent.type(screen.getByRole('textbox', { name: 'Path' }), '/x');

    expect(await modo.getValueText()).toBe('Equals');
  });

  it('deve recalcular a prévia com N e avisar Quando o cenário já existe', async () => {
    await show([rule(1, { scenario: { name: 'entrega', requiredState: 'Started' } })]);

    const vezes = screen.getByRole('spinbutton', { name: 'Times' });
    await userEvent.clear(vezes);
    await userEvent.type(vezes, '4');

    expect(screen.getByRole('button', { name: 'Create 5 rules' })).toBeTruthy();
    expect(screen.getByText('Joins the existing scenario "entrega"')).toBeTruthy();
  });

  it('deve gravar as regras, destacá-las e anunciar Quando "Create" é clicado', async () => {
    await show([rule(1)]);
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    const marca = vi.spyOn(TestBed.inject(RuleIntents), 'markCreated');

    await userEvent.click(screen.getByRole('button', { name: 'Create 3 rules' }));
    await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]));
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    const body = put.request.body as Rule[];
    expect(body.map((r) => r.name)).toEqual([
      'Rule 1',
      'entrega 1/3',
      'entrega 2/3',
      'entrega 3/3',
    ]);
    put.flush(body.map((r, i) => ({ ...r, id: r.id ?? `n${i}` })));

    await vi.waitFor(() => expect(marca).toHaveBeenCalledWith(['n1', 'n2', 'n3']));
    expect(announce).toHaveBeenCalledWith('3 rules created');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('deve ter o "Retry-After (s)" vazio, sem o cabeçalho, e gravá-lo Quando preenchido', async () => {
    await show([]);
    const espera = screen.getByRole('spinbutton', { name: 'Retry-After (s)' });
    expect((espera as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Empty: no header.')).toBeTruthy();

    await userEvent.type(espera, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Create 3 rules' }));
    await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([]));
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));

    expect((put.request.body as Rule[]).map((r) => r.response?.headers)).toEqual([
      { 'Retry-After': '5' },
      { 'Retry-After': '5' },
      {},
    ]);
    put.flush([]);
  });

  it('deve recusar o "Retry-After (s)" fora de 0 a 3600', async () => {
    await show();
    const espera = screen.getByRole('spinbutton', { name: 'Retry-After (s)' });

    await userEvent.type(espera, '4000');
    await userEvent.click(screen.getByRole('button', { name: /^Create/ }));

    expect(screen.getByRole('alert').textContent).toContain('To create, fix: Retry-After (0–3600)');
    expect(document.activeElement).toBe(espera);
  });

  it('não deve gravar e deve dizer o que corrigir Quando o formulário é inválido', async () => {
    await show();

    const vezes = screen.getByRole('spinbutton', { name: 'Times' });
    await userEvent.clear(vezes);
    await userEvent.type(vezes, '30');
    const criar = screen.getByRole('button', { name: /^Create/ });
    expect((criar as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(criar);

    expect(screen.getByRole('alert').textContent).toContain('To create, fix: Times (1–20)');
    expect(document.activeElement).toBe(vezes);
    http.expectNone({ method: 'GET', url: URL_REGRAS });
  });

  it('deve avisar e desabilitar "Create" Quando passaria de 100 regras', async () => {
    await show(Array.from({ length: 98 }, (_, i) => rule(i + 1)));

    expect(screen.getByRole('note').textContent).toContain('Would exceed 100 rules.');
    const criar = screen.getByRole('button', { name: 'Create 3 rules' }) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);
    http.expectNone({ method: 'GET', url: URL_REGRAS });
  });

  it('deve sugerir o nome do cenário pelo caminho digitado, até o nome ser digitado', async () => {
    const result = await render(ScenarioSequence, {
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const nome = screen.getByRole('textbox', { name: 'Scenario name' }) as HTMLInputElement;
    expect(nome.value).toBe('sequence');

    await userEvent.type(screen.getByRole('textbox', { name: 'Path' }), '/entrega');
    result.fixture.detectChanges();
    expect(nome.value).toBe('entrega');

    await userEvent.clear(nome);
    await userEvent.type(nome, 'meu');
    await userEvent.type(screen.getByRole('textbox', { name: 'Path' }), '/x');
    expect(nome.value).toBe('meu');
  });
});
