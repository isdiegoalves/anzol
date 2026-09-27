import { signal } from '@angular/core';
import { Viewport, WindowClass } from '../shell/viewport';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleGroupHarness } from '@angular/material/button-toggle/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { Rule } from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const isLatestRequest = (req: HttpRequest<unknown>) =>
  req.url.endsWith('/requests') &&
  req.params.get('sorting') === 'newest' &&
  req.params.get('per_page') === '1';

/** A mensagem de exemplo: POST /pagamentos com X-Tenant e corpo JSON. */
const PEDIDO = webhookRequest(1, {
  url: `http://localhost/${TOKEN_ID}/pagamentos`,
  headers: { 'x-tenant': ['acme'], 'x-status': ['pix pago'] },
  query: { env: 'prod' },
  content: '{"id":"p2","status":"pago","valor":10}',
});

/**
 * Editor de condições e resposta (F3): caminho em um passo e chips (WM-14), regex de valor
 * inteiro com o testador (WM-43, E-12), "From this request" e helpers clicáveis (WM-16), corpo da
 * resposta (WM-42, WM-46, E-10), "Form" sempre clicável (WM-04) e a IA como proposta (E-13).
 */
describe('Dado o editor de condições e resposta', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleEditor>;
  let loader: HarnessLoader;
  let onServer: Rule[] = [];

  const open = async (
    data: RuleEditorData = { index: null },
    rules: Rule[] = [],
    latest: WebhookRequest[] = [PEDIDO],
    tokenOverrides: Partial<Token> = {},
  ) => {
    TestBed.inject(Preferences).token.set(token(tokenOverrides));
    onServer = rules;
    const store = TestBed.inject(RuleStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(URL_REGRAS).flush(rules);
    await loaded;
    fixture = TestBed.createComponent(RuleEditor);
    fixture.componentRef.setInput('data', data);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    for (const call of http.match(isLatestRequest)) {
      call.flush(requestPage(latest));
    }
    // A mensagem chega por promessa: um ciclo de tarefas antes do render.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const root = () => fixture.nativeElement as HTMLElement;
  const input = (label: string) =>
    loader.getHarness(MatInputHarness.with({ selector: `[aria-label="${label}"]` }));
  const select = (label: string) =>
    loader.getHarness(MatSelectHarness.with({ selector: `[aria-label="${label}"]` }));
  const button = (text: string) => loader.getHarness(MatButtonHarness.with({ text }));
  const click = async (selector: string) => {
    (root().querySelector(selector) as HTMLElement).click();
    await fixture.whenStable();
  };
  const tab = (name: 'match' | 'response') => click(`#rule-tab-${name}`);
  const panel = (name: 'match' | 'response') =>
    root().querySelector(`#rule-panel-${name} app-rule-from-request-panel`) as HTMLElement;
  const use = async (name: 'match' | 'response', label: string) => {
    [...panel(name).querySelectorAll('button')]
      .find((botao) => botao.getAttribute('aria-label') === label)
      ?.click();
    await fixture.whenStable();
  };
  const texts = (selector: string) =>
    [...root().querySelectorAll(selector)].map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
  const saved = async (): Promise<Rule> => {
    await (await button('Save')).click();
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush(onServer);
    const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    call.flush(call.request.body);
    const list = call.request.body as Rule[];
    return list[list.length - 1];
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RuleEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Largura grande: o cabeçalho com todos os botões (abaixo de 1200 px é a folha, F8).
        { provide: Viewport, useValue: { windowClass: signal<WindowClass>('large') } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('Dado o caminho (WM-14)', () => {
    it('deve ter o Path habilitado, "Equals" escolhido e vazio valendo qualquer caminho', async () => {
      await open();
      await (await input('Name')).setValue('Tudo');

      expect(await (await input('Path')).isDisabled()).toBe(false);
      expect(await (await select('Path match')).getValueText()).toBe('Equals');
      expect(texts('#rule-panel-match mat-hint')).toContain(
        "Empty: any path. After the URL's token.",
      );
      expect((await saved()).match?.path).toBeNull();
    });

    it('deve gravar o caminho digitado como "Equals", e oferecer só os três modos', async () => {
      await open();
      await (await input('Name')).setValue('Pix');
      await (await input('Path')).setValue('/pagamentos');
      const modo = await select('Path match');
      await modo.open();

      expect(await Promise.all((await modo.getOptions()).map((o) => o.getText()))).toEqual([
        'Equals',
        'Starts with',
        'Matches regex (whole value)',
      ]);
      await modo.close();
      expect((await saved()).match?.path).toEqual({ equals: '/pagamentos' });
    });

    it('deve abrir a raiz gravada como equals "" como "/"', async () => {
      await open({ index: 0 }, [rule(1, { match: { path: { equals: '' } } })]);

      expect(await (await input('Path')).getValue()).toBe('/');
    });
  });

  describe('Dado os chips de adicionar e a regex de valor inteiro (WM-14, WM-43, E-12)', () => {
    it('deve abrir o campo do corpo em JSONPath e exigir a assinatura inválida', async () => {
      await open();

      await (await button('Add body field (JSONPath)')).click();
      await (await button('Require invalid signature')).click();

      expect(await (await select('Body 1 type')).getValueText()).toBe('JSONPath');
      const assinatura = await loader.getHarness(
        MatButtonToggleGroupHarness.with({ selector: '[aria-label="Signature"]' }),
      );
      const [invalida] = await assinatura.getToggles({ text: 'Invalid' });
      expect(await invalida.isChecked()).toBe(true);
      expect(root().querySelector('.unsaved')).not.toBeNull();
    });

    it('deve dizer se a regex cobre o valor da mensagem e trocar por "contém"', async () => {
      await open();
      await (await button('Add header condition')).click();
      await (await input('Header 1 name')).setValue('X-Status');
      const operador = await select('Header 1 operator');
      await operador.open();
      await operador.clickOptions({ text: 'matches regex (whole value)' });

      await (await input('Header 1 value')).setValue('pago');
      expect(texts('app-rule-condition-hint .hint')).toEqual([
        'Doesn\'t match "pix pago" — a regex must cover the whole value.',
      ]);
      await expectNoAxeViolations(root());
      await (await button('Use contains')).click();
      expect(await operador.getValueText()).toBe('contains');

      await operador.open();
      await operador.clickOptions({ text: 'matches regex (whole value)' });
      await (await input('Header 1 value')).setValue('.*pago');
      expect(texts('app-rule-condition-hint .hint')).toEqual(['Matches "pix pago" · approx.']);
      await (await input('Header 1 value')).setValue('(?=pix).*');
      expect(texts('app-rule-condition-hint .hint')).toEqual([
        "Can't check here — test against history.",
      ]);
    });

    it('deve dizer como o "Equals (JSON)" leu o valor e o que a mensagem tem no caminho', async () => {
      await open();
      await (await button('Add body field (JSONPath)')).click();
      await (await input('Body 1 path')).setValue('$.valor');
      await (await input('Body 1 equals')).setValue('10');

      expect(texts('#rule-panel-match mat-hint')).toContain('Read as number 10');
      expect(texts('#rule-panel-match .tester')).toContain('In this request: 10 · approx.');
      await (await input('Body 1 equals')).setValue('"pago"');
      expect(texts('#rule-panel-match mat-hint')).toContain('Read as text "pago"');
    });
  });

  describe('Dado o painel "From this request" (WM-16)', () => {
    it('deve mostrar a mensagem mais nova e virar condição com um clique, sem duplicar', async () => {
      await open();
      await (await input('Name')).setValue('Pix pago');

      expect(panel('match').textContent).toContain('POST /pagamentos');
      await use('match', 'Use x-tenant: acme');
      await use('match', 'Use x-tenant: acme');
      await use('match', 'Use $.status: "pago"');
      await use('match', 'Use env: prod');

      expect(await (await input('Header 1 name')).getValue()).toBe('x-tenant');
      expect(await (await input('Header 1 value')).getValue()).toBe('acme');
      expect(root().querySelector('[aria-label="Header 2 name"]')).toBeNull();
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(root().querySelector('[aria-label="Query 1 value"]')),
      );
      await expectNoAxeViolations(root());
      expect((await saved()).match).toMatchObject({
        headers: { 'x-tenant': { equals: 'acme' } },
        query: { env: { equals: 'prod' } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      });
    });

    it('deve filtrar os campos pelo caminho ou pelo valor', async () => {
      await open();
      const filtro = panel('match').querySelector('input.filter') as HTMLInputElement;

      filtro.value = 'valor';
      filtro.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(
        [...panel('match').querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
      ).toEqual(['Use $.valor: 10']);
    });

    it('deve usar a mensagem recebida pelo editor (?from=) sem ler a mais nova', async () => {
      await open(
        { index: null, example: webhookRequest(9, { headers: { 'x-a': ['b'] } }) },
        [],
        [],
      );

      expect(panel('match').querySelector('button[aria-label="Use x-a: b"]')).not.toBeNull();
    });

    it('deve pedir uma requisição de teste Quando a URL não recebeu nada', async () => {
      await open({ index: null }, [], []);

      expect(panel('match').textContent).toContain(
        'Send a test request to this URL to pick fields from it.',
      );
    });

    it('deve inserir o helper do campo no cursor do corpo, na aba Response', async () => {
      await open();
      await tab('response');
      const corpo = root().querySelector(
        'textarea[aria-label="Response body"]',
      ) as HTMLTextAreaElement;
      await (await input('Response body')).setValue('status=');
      corpo.setSelectionRange(7, 7);

      await use('response', 'Use $.status: "pago"');

      expect(await (await input('Response body')).getValue()).toBe(
        "status={{jsonPath request.body '$.status'}}",
      );
    });
  });

  describe('Dado o corpo da resposta (WM-42, WM-46, E-10)', () => {
    it('deve formatar o JSON e sugerir o Content-Type, com o padrão da URL como alternativa', async () => {
      await open({ index: null }, [], [], { default_content_type: 'text/plain' });
      await tab('response');
      await (await input('Response body')).setValue('{"a":1,"b":[1,2]}');

      await (await button('Format JSON')).click();
      expect(await (await input('Response body')).getValue()).toBe(
        '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
      );
      expect(
        await (await button("Use the URL's default content type (text/plain)")).isDisabled(),
      ).toBe(false);
      await expectNoAxeViolations(root());
      await (await button('Add Content-Type: application/json')).click();

      expect(await (await input('Response header 1 name')).getValue()).toBe('Content-Type');
      expect(await (await input('Response header 1 value')).getValue()).toBe('application/json');
      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ text: 'Add Content-Type: application/json' }),
        ),
      ).toHaveLength(0);
      await (await loader.getHarness(MatSlideToggleHarness.with({ label: 'Template' }))).check();
      expect(
        await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Format JSON' })),
      ).toHaveLength(0);
    });

    it('deve avisar do JSON inválido com a linha, sem impedir de salvar', async () => {
      await open();
      await (await input('Name')).setValue('Quebrado');
      await tab('response');
      await (await input('Response body')).setValue('{"a":\n');

      expect(texts('[role="note"]')).toContain('Not valid JSON: line 2');
      expect((await saved()).response?.body).toBe('{"a":\n');
    });

    it('deve inserir o helper da cola no cursor, com o hmac e a descrição nova do jsonPath', async () => {
      await open();
      await tab('response');
      await (await loader.getHarness(MatSlideToggleHarness.with({ label: 'Template' }))).check();

      expect(root().textContent).toContain(
        'Value from the JSON body. Simple paths only ($.a.b[0]).',
      );
      await click('button[aria-label="Insert hmac"]');
      expect(await (await input('Response body')).getValue()).toBe('{{hmac request.body}}');
    });
  });

  describe('Dado a sugestão da IA como proposta (E-13)', () => {
    it('deve aplicar só as condições e desfazer pelo snackbar', async () => {
      await open({ index: 0 }, [rule(1)]);
      const onAction = new Subject<void>();
      const snack = vi
        .spyOn(TestBed.inject(MatSnackBar), 'open')
        .mockReturnValue({ onAction: () => onAction } as never);
      const proposta = rule(1, {
        match: { ...rule(1).match, headers: { 'x-tenant': { equals: 'acme' } } },
        response: { ...rule(1).response, status: 429 },
      });

      await (await input('Describe the rule')).setValue('429 para acme');
      await (await button('Suggest')).click();
      (
        await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/suggest` }))
      ).flush({ rule: proposta, explanation: '', attempts: 1 });
      await (await vi.waitFor(() => button('Apply conditions only'))).click();

      expect(await (await input('Header 1 value')).getValue()).toBe('acme');
      expect(await (await input('Status')).getValue()).toBe('201');
      expect(snack).toHaveBeenCalledWith('Suggestion applied', 'Undo', { duration: 5000 });
      onAction.next();
      await fixture.whenStable();
      expect(root().querySelector('[aria-label="Header 1 value"]')).toBeNull();
    });
  });
});
