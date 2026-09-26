import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Preferences } from '../settings/preferences';
import { Rule } from './rule';
import { RuleEditor } from './rule-editor';
import { RulesPage } from './rules-page';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;

describe('Dado a aba de regras', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RulesPage>;
  let loader: HarnessLoader;

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () =>
    [...element().querySelectorAll('tbody tr[data-rule-id]')].map((row) =>
      [...row.querySelectorAll('td.data')].map((cell) => cell.textContent?.trim()),
    );
  const button = (text: string, ancestor?: string) =>
    loader.getHarness(MatButtonHarness.with({ text, ancestor }));
  const move = (label: 'Move up' | 'Move down', ancestor: string) =>
    loader.getHarness(MatButtonHarness.with({ selector: `[aria-label="${label}"]`, ancestor }));
  const open = async (rules: Rule[]) => {
    fixture = TestBed.createComponent(RulesPage);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    loader = TestbedHarnessEnvironment.loader(fixture);
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(rules);
    await vi.waitFor(() => expect(element().querySelector('table')).not.toBeNull());
  };
  const expectPut = async (lista: Rule[]) => {
    const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    expect(call.request.body).toEqual(lista);
    call.flush(lista);
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RulesPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Preferences).token.set(token());
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('deve listar nome, prioridade, match e status na ordem de avaliação Quando a URL tem regras', async () => {
    await open([
      rule(1, { priority: 5 }),
      rule(2, {
        name: 'Pix',
        priority: 1,
        match: { method: ['GET', 'HEAD'], path: { prefix: '/api' } },
      }),
    ]);

    expect(rows()).toEqual([
      ['Pix', '1', 'GET, HEAD /api*', '202'],
      ['Rule 1', '5', 'POST /r1', '201'],
    ]);
  });

  it('deve explicar que não há regras Quando a lista está vazia', async () => {
    await open([]);

    expect(element().textContent).toContain('No rules yet');
    expect(rows()).toEqual([]);
  });

  it('deve carregar a URL na barra Quando o link aponta para outra URL que a salva', async () => {
    TestBed.inject(Preferences).token.set(null);
    fixture = TestBed.createComponent(RulesPage);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.detectChanges();

    http.expectOne(URL_REGRAS).flush([]);
    http.expectOne(`/token/${TOKEN_ID}`).flush(token());
    await fixture.whenStable();

    expect(TestBed.inject(Preferences).token()?.uuid).toBe(TOKEN_ID);
  });

  it('não deve permitir criar, importar nem exportar Quando a lista ainda não carregou (o PUT apagaria as regras salvas)', async () => {
    fixture = TestBed.createComponent(RulesPage);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    loader = TestbedHarnessEnvironment.loader(fixture);
    fixture.detectChanges();

    for (const text of ['New rule', 'Import', 'Export']) {
      expect(await (await button(text)).isDisabled()).toBe(true);
    }
    http.expectOne(URL_REGRAS).flush([rule(1)]);
    await vi.waitFor(async () => expect(await (await button('New rule')).isDisabled()).toBe(false));
    expect(await (await button('Import')).isDisabled()).toBe(false);
  });

  it('deve avisar e não listar Quando a URL não existe mais (410)', async () => {
    fixture = TestBed.createComponent(RulesPage);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.detectChanges();

    http.expectOne(URL_REGRAS).flush({ success: false }, { status: 410, statusText: 'Gone' });

    await vi.waitFor(() =>
      expect(element().querySelector('[role=alert]')?.textContent).toContain(
        'This URL no longer exists (410).',
      ),
    );
    expect(element().querySelector('table')).toBeNull();
  });

  it('deve salvar a lista inteira com a regra desligada Quando o toggle é desligado', async () => {
    await open([rule(1), rule(2)]);

    const toggle = await loader.getHarness(
      MatSlideToggleHarness.with({ ancestor: '[data-rule-id="r2"]' }),
    );
    await toggle.toggle();

    await expectPut([rule(1), { ...rule(2), enabled: false }]);
    expect(await toggle.isChecked()).toBe(false);
  });

  it('deve trocar ordem e prioridades Quando "Move up" é clicado numa regra de prioridade maior', async () => {
    await open([rule(1, { priority: 1 }), rule(2, { priority: 5 })]);

    await (await move('Move up', '[data-rule-id="r2"]')).click();

    await expectPut([rule(2, { priority: 1 }), rule(1, { priority: 5 })]);
    expect(rows().map((row) => row[0])).toEqual(['Rule 2', 'Rule 1']);
  });

  it('deve só trocar a ordem Quando "Move down" é clicado entre regras de mesma prioridade', async () => {
    await open([rule(1), rule(2), rule(3)]);

    await (await move('Move down', '[data-rule-id="r1"]')).click();

    await expectPut([rule(2), rule(1), rule(3)]);
  });

  it('não deve oferecer subir a primeira nem descer a última', async () => {
    await open([rule(1), rule(2)]);

    expect(await (await move('Move up', '[data-rule-id="r1"]')).isDisabled()).toBe(true);
    expect(await (await move('Move down', '[data-rule-id="r2"]')).isDisabled()).toBe(true);
  });

  it('deve salvar sem a regra e oferecer desfazer Quando "Delete" é clicado', async () => {
    await open([rule(1), rule(2)]);
    const desfazer = new Subject<void>();
    const snack = vi
      .spyOn(TestBed.inject(MatSnackBar), 'open')
      .mockReturnValue({ onAction: () => desfazer } as unknown as ReturnType<MatSnackBar['open']>);

    await (await button('Delete', '[data-rule-id="r1"]')).click();
    await expectPut([rule(2)]);
    await vi.waitFor(() =>
      expect(snack).toHaveBeenCalledWith('Rule deleted', 'Undo', { duration: 5000 }),
    );

    desfazer.next();
    await expectPut([rule(1), rule(2)]);
  });

  it('deve abrir o editor para uma regra nova Quando "New rule" é clicado', async () => {
    await open([rule(1)]);
    const dialog = vi.spyOn(TestBed.inject(MatDialog), 'open');

    await (await button('New rule')).click();

    expect(dialog).toHaveBeenCalledWith(
      RuleEditor,
      expect.objectContaining({ data: { index: null } }),
    );
  });

  it('deve abrir o editor com a posição da regra na lista Quando "Edit" é clicado', async () => {
    await open([rule(1, { priority: 9 }), rule(2)]);
    const dialog = vi.spyOn(TestBed.inject(MatDialog), 'open');

    await (await button('Edit', '[data-rule-id="r1"]')).click();

    expect(dialog).toHaveBeenCalledWith(
      RuleEditor,
      expect.objectContaining({ data: { index: 0 } }),
    );
  });

  describe('Dado regras com template, atraso, falha ou cenário (fase B)', () => {
    const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;
    const comCenario = rule(2, { scenario: { name: 'Retry', newState: 'falhou-1' } });
    const flags = (id: string) =>
      [...element().querySelectorAll(`[data-rule-id="${id}"] .flag`)].map((flag) => [
        flag.textContent?.trim(),
        flag.getAttribute('title'),
      ]);
    const flushScenarios = () =>
      vi.waitFor(() =>
        http
          .expectOne({ method: 'GET', url: URL_CENARIOS })
          .flush([{ name: 'Retry', state: 'Started', states: ['Started', 'falhou-1'] }]),
      );

    it('deve mostrar indicadores discretos com o detalhe no título, sem mudar as colunas da lista', async () => {
      await open([
        rule(1, { response: { template: true, delay: { fixed: 250 }, fault: null } }),
        rule(3, { response: { fault: 'empty_response' } }),
      ]);

      expect(flags('r1')).toEqual([
        ['template', 'Body and header values are templates'],
        ['delay', 'Delay: 250 ms'],
      ]);
      expect(flags('r3')).toEqual([['fault', 'Fault: empty response (close without writing)']]);
      expect(rows()[0]).toEqual(['Rule 1', '5', 'POST /r1', '200']);
    });

    it('não deve pedir os cenários nem mostrar o painel Quando nenhuma regra usa cenário', async () => {
      await open([rule(1)]);

      http.expectNone({ method: 'GET', url: URL_CENARIOS });
      expect(element().querySelector('app-scenario-panel')).toBeNull();
    });

    it('deve mostrar o painel de cenários e relê-lo Quando uma regra salva usa cenário', async () => {
      await open([rule(1), comCenario]);
      await flushScenarios();
      await vi.waitFor(() =>
        expect(element().querySelector('app-scenario-panel')?.textContent).toContain('Retry'),
      );

      const toggle = await loader.getHarness(
        MatSlideToggleHarness.with({ ancestor: '[data-rule-id="r1"]' }),
      );
      await toggle.toggle();
      await expectPut([{ ...rule(1), enabled: false }, comCenario]);

      await flushScenarios();
    });
  });

  describe('Dado o export e o import', () => {
    const chooseFile = async (content: string) => {
      const input = element().querySelector<HTMLInputElement>('input[type=file]');
      if (!input) {
        throw new Error('sem input de arquivo');
      }
      const file = new File([content], 'rules.json', { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    const alertText = () => element().querySelector('[role=alert]')?.textContent ?? '';

    it('deve baixar o JSON do GET /rules com o nome da URL Quando "Export" é clicado', async () => {
      await open([rule(1)]);
      const blobs: Blob[] = [];
      vi.stubGlobal('URL', {
        createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:regras'),
        revokeObjectURL: vi.fn(),
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);

      await (await button('Export')).click();
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(2)]);

      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(`rules-${TOKEN_ID}.json`);
      expect(JSON.parse(await blobs[0].text())).toEqual([rule(1), rule(2)]);
      vi.unstubAllGlobals();
    });

    it('deve substituir a lista pelo arquivo e avisar Quando o import é aceito', async () => {
      await open([rule(1)]);
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

      await chooseFile(JSON.stringify([rule(7), rule(8)]));

      await expectPut([rule(7), rule(8)]);
      expect(rows().map((row) => row[0])).toEqual(['Rule 7', 'Rule 8']);
      await vi.waitFor(() => expect(snack).toHaveBeenCalledWith('Imported 2 rules'));
    });

    it('deve mostrar os erros do servidor e manter a lista Quando o import responde 422', async () => {
      await open([rule(1)]);

      await chooseFile(JSON.stringify([rule(7)]));
      const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      call.flush(
        { '0.match.path.regex': ['The regex is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(() =>
        expect(alertText()).toContain('Rule 1 › match.path.regex: The regex is invalid.'),
      );
      expect(rows().map((row) => row[0])).toEqual(['Rule 1']);
    });

    it.each([
      ['não é JSON', '{', 'The file is not valid JSON.'],
      ['não é uma lista', '{"name":"a"}', 'The file must contain a JSON list of rules.'],
    ])(
      'não deve chamar a API e deve explicar Quando o arquivo %s',
      async (_caso, conteudo, erro) => {
        await open([rule(1)]);

        await chooseFile(conteudo);

        await vi.waitFor(() => expect(alertText()).toContain(erro));
        http.expectNone({ method: 'PUT', url: URL_REGRAS });
      },
    );
  });
});
