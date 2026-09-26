import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleHarness } from '@angular/material/button-toggle/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;

describe('Dado o editor de regra', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleEditor>;
  let loader: HarnessLoader;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let dialogData: RuleEditorData;

  const open = async (data: RuleEditorData, rules: Rule[] = [rule(1)]) => {
    const store = TestBed.inject(RuleStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(URL_REGRAS).flush(rules);
    await loaded;
    dialogData.index = data.index;
    fixture = TestBed.createComponent(RuleEditor);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  };
  const input = (label: string) =>
    loader.getHarness(MatInputHarness.with({ selector: `[aria-label="${label}"]` }));
  const select = (label: string) =>
    loader.getHarness(MatSelectHarness.with({ selector: `[aria-label="${label}"]` }));
  const field = (label: string) =>
    loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
  const button = (text: string) => loader.getHarness(MatButtonHarness.with({ text }));
  const save = async () => (await button('Save')).click();
  const put = () => vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));

  beforeEach(() => {
    dialogRef = { close: vi.fn() };
    dialogData = { index: null };
    TestBed.configureTestingModule({
      imports: [RuleEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve acrescentar a regra montada no formulário e salvar a lista inteira Quando "Save" é clicado', async () => {
    await open({ index: null });

    await (await input('Name')).setValue('Pix pago');
    const methods = await select('Methods');
    await methods.open();
    await methods.clickOptions({ text: 'POST' });
    await methods.close();
    const pathMode = await select('Path match');
    await pathMode.open();
    await pathMode.clickOptions({ text: 'Equals' });
    await (await input('Path')).setValue('/pagamentos');
    await (await button('Add header condition')).click();
    await (await input('Header 1 name')).setValue('X-Signature');
    const operator = await select('Header 1 operator');
    await operator.open();
    await operator.clickOptions({ text: 'is present' });
    await (await button('Add body condition')).click();
    await (await input('Body 1 value')).setValue('pedido');
    await (await input('Status')).setValue('201');
    await (await button('Add response header')).click();
    await (await input('Response header 1 name')).setValue('Content-Type');
    await (await input('Response header 1 value')).setValue('application/json');
    await (await input('Response body')).setValue('{"ok":true}');
    await save();

    const call = await put();
    expect(call.request.body).toEqual([
      rule(1),
      {
        name: 'Pix pago',
        enabled: true,
        priority: 5,
        match: {
          method: ['POST'],
          path: { equals: '/pagamentos' },
          query: {},
          headers: { 'X-Signature': { present: true } },
          body: [{ contains: 'pedido' }],
        },
        response: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
        },
      },
    ]);
    call.flush([rule(1), rule(2)]);
    await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
  });

  it('deve vir preenchido e trocar só a regra editada na lista Quando edita a segunda regra', async () => {
    await open({ index: 1 }, [rule(1), rule(2)]);

    expect(await (await input('Name')).getValue()).toBe('Rule 2');
    expect(await (await input('Path')).getValue()).toBe('/r2');
    expect(await (await select('Methods')).getValueText()).toBe('POST');
    await (await input('Name')).setValue('Renomeada');
    await save();

    const call = await put();
    expect(call.request.body).toEqual([rule(1), { ...rule(2), name: 'Renomeada' }]);
    call.flush(call.request.body);
  });

  it('deve mostrar o erro do servidor no campo e não fechar Quando o PUT responde 422', async () => {
    await open({ index: 1 }, [rule(1), rule(2)]);

    await save();
    (await put()).flush(
      {
        '1.match.path.equals': ['The path must start with a slash.'],
        '0.name': ['The name has already been taken.'],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(async () =>
      expect(await (await field('Path')).getTextErrors()).toEqual([
        'The path must start with a slash.',
      ]),
    );
    expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain(
      'Rule 1 › name: The name has already been taken.',
    );
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('deve mostrar o erro no campo da condição Quando o 422 aponta um header pelo nome', async () => {
    await open({ index: 0 }, [rule(1, { match: { headers: { 'X-Signature': { regex: '(' } } } })]);

    await save();
    (await put()).flush(
      { '0.match.headers.X-Signature.regex': ['The regex is invalid.'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(async () =>
      expect(await (await field('Value')).getTextErrors()).toEqual(['The regex is invalid.']),
    );
  });

  it('não deve permitir salvar Quando o nome está vazio ou o status está fora de 100–599', async () => {
    await open({ index: null });

    expect(await (await button('Save')).isDisabled()).toBe(true);
    await (await input('Name')).setValue('ok');
    expect(await (await button('Save')).isDisabled()).toBe(false);
    await (await input('Status')).setValue('600');
    expect(await (await button('Save')).isDisabled()).toBe(true);
  });

  describe('Dado a visão "JSON"', () => {
    const json = () => input('Rule JSON');
    const view = (text: 'Form' | 'JSON') =>
      loader.getHarness(MatButtonToggleHarness.with({ text }));

    it('deve mostrar a regra do formulário como JSON Quando a aba é aberta', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await input('Name')).setValue('Do formulário');

      await (await view('JSON')).check();

      expect(JSON.parse(await (await json()).getValue())).toEqual({
        ...rule(1),
        name: 'Do formulário',
      });
    });

    it('deve salvar a regra crua como foi escrita Quando "Save" é clicado na aba JSON', async () => {
      await open({ index: 0 }, [rule(1)]);
      const crua = { ...rule(1), name: 'Crua', response: { ...rule(1).response, status: 418 } };

      await (await view('JSON')).check();
      await (await json()).setValue(JSON.stringify(crua));
      await save();

      const call = await put();
      expect(call.request.body).toEqual([crua]);
      call.flush([crua]);
    });

    it('deve explicar o erro, bloquear o Save e a volta ao formulário Quando o JSON é inválido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await view('JSON')).check();
      await (await json()).setValue('{"name": ""}');

      expect(await (await field('Rule JSON')).getTextErrors()).toEqual([
        'name: The name field is required.',
      ]);
      expect(await (await button('Save')).isDisabled()).toBe(true);
      expect(await (await view('Form')).isDisabled()).toBe(true);
    });

    it('deve levar o JSON editado ao formulário Quando volta para a aba "Form"', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await view('JSON')).check();
      await (await json()).setValue(JSON.stringify({ ...rule(1), name: 'Pelo JSON' }));
      await (await view('Form')).check();

      expect(await (await input('Name')).getValue()).toBe('Pelo JSON');
    });
  });
});
