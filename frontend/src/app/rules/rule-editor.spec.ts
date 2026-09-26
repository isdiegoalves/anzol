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
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
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
        scenario: null,
        response: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: '{"ok":true}',
          template: false,
          delay: null,
          dribble: null,
          fault: null,
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

  describe('Dado template, atraso, dribble e falha na resposta', () => {
    const toggle = (label: string) => loader.getHarness(MatSlideToggleHarness.with({ label }));
    const choose = async (label: string, option: string) => {
      const harness = await select(label);
      await harness.open();
      await harness.clickOptions({ text: option });
    };
    const savedResponse = async () => {
      await save();
      const call = await put();
      call.flush(call.request.body);
      return (call.request.body as Rule[])[0].response;
    };

    it('deve gravar template: true e mostrar a cola dos helpers Quando o toggle "Template" é ligado', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await toggle('Template')).check();
      const helpers = fixture.nativeElement.querySelector('details.helpers') as HTMLDetailsElement;
      helpers.querySelector('summary')?.click();

      expect(helpers.open).toBe(true);
      expect(helpers.textContent).toContain("{{jsonPath request.body '$.id'}}");
      expect(helpers.textContent).toContain("{{randomValue type='UUID'}}");
      expect(await savedResponse()).toMatchObject({ template: true });
    });

    it('deve gravar o atraso uniforme com mínimo e máximo Quando o tipo "Uniform" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await choose('Delay', 'Uniform (random)');
      await (await input('Delay min (ms)')).setValue('100');
      await (await input('Delay max (ms)')).setValue('900');

      expect(await savedResponse()).toMatchObject({ delay: { uniform: { min: 100, max: 900 } } });
    });

    it.each([
      ['Fixed', 'Delay (ms)', '60001', 'An integer between 0 and 60000 (ms).'],
      ['Log-normal', 'Delay median (ms)', '-1', 'An integer between 0 and 60000 (ms).'],
    ])(
      'não deve permitir salvar e deve explicar Quando o atraso %s passa do teto de 60 s ou é negativo',
      async (tipo, campo, valor, erro) => {
        await open({ index: 0 }, [rule(1)]);

        await choose('Delay', tipo);
        await (await input(campo)).setValue(valor);
        await (await input(campo)).blur();

        expect(await (await button('Save')).isDisabled()).toBe(true);
        expect(await (await field(campo)).getTextErrors()).toEqual([erro]);
      },
    );

    it('não deve permitir salvar Quando o mínimo do atraso uniforme passa do máximo', async () => {
      await open({ index: 0 }, [rule(1)]);

      await choose('Delay', 'Uniform (random)');
      await (await input('Delay min (ms)')).setValue('900');
      await (await input('Delay max (ms)')).setValue('100');
      await (await input('Delay max (ms)')).blur();

      expect(await (await button('Save')).isDisabled()).toBe(true);
      expect(await (await field('Delay max (ms)')).getTextErrors()).toEqual([
        'At least the min, up to 60000 (ms).',
      ]);
    });

    it('deve gravar o dribble e recusar mais de 100 pedaços Quando o toggle "Dribble" é ligado', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await toggle('Dribble')).check();
      await (await input('Chunks')).setValue('101');
      expect(await (await button('Save')).isDisabled()).toBe(true);
      await (await input('Chunks')).setValue('10');
      await (await input('Dribble duration (ms)')).setValue('3000');

      expect(await savedResponse()).toMatchObject({ dribble: { chunks: 10, durationMs: 3000 } });
    });

    it('deve desabilitar status, corpo, template, atraso e dribble e explicar Quando uma falha é escolhida', async () => {
      await open({ index: 0 }, [rule(1, { response: { status: 201, delay: { fixed: 5 } } })]);

      await choose('Fault', 'Connection reset (TCP RST)');

      for (const label of ['Status', 'Response body']) {
        expect(await (await input(label)).isDisabled()).toBe(true);
      }
      expect(await (await select('Delay')).isDisabled()).toBe(true);
      expect(await (await toggle('Template')).isDisabled()).toBe(true);
      expect(await (await toggle('Dribble')).isDisabled()).toBe(true);
      expect(fixture.nativeElement.querySelector('.fault-note')?.textContent).toContain(
        'the status, headers, body, delay and dribble are ignored',
      );
      expect(await savedResponse()).toMatchObject({
        status: 201,
        fault: 'connection_reset',
        delay: null,
      });
    });

    it('deve reabilitar a resposta Quando a falha volta para "None"', async () => {
      await open({ index: 0 }, [rule(1, { response: { fault: 'empty_response' } })]);
      expect(await (await input('Status')).isDisabled()).toBe(true);

      await choose('Fault', 'None');

      expect(await (await input('Status')).isDisabled()).toBe(false);
      expect(fixture.nativeElement.querySelector('.fault-note')).toBeNull();
    });
  });

  describe('Dado a seção "Scenario"', () => {
    const outras = [
      rule(1, { scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' } }),
      rule(2, { scenario: { name: 'Retry', requiredState: 'falhou-1', newState: 'ok' } }),
      rule(3, { scenario: { name: 'Login' } }),
    ];
    /** Sugestões do `<datalist>` ligado ao campo (o navegador as filtra pelo texto digitado). */
    const suggestions = (label: string) => {
      const root = fixture.nativeElement as HTMLElement;
      const list = root.querySelector(`input[aria-label="${label}"]`)?.getAttribute('list');
      const options = root.querySelectorAll<HTMLOptionElement>(`datalist#${list} option`);
      return [...options].map((option) => option.value);
    };

    it('deve sugerir os cenários e os estados que as regras já citam', async () => {
      await open({ index: null }, outras);

      expect(suggestions('Scenario name')).toEqual(['Retry', 'Login']);
      expect(suggestions('Required state')).toEqual(['Started']);
      await (await input('Scenario name')).setValue('Retry');

      expect(suggestions('Required state')).toEqual(['Started', 'falhou-1', 'ok']);
      expect(suggestions('New state')).toEqual(['Started', 'falhou-1', 'ok']);
    });

    it('deve gravar o cenário com os estados Quando salva', async () => {
      await open({ index: null }, outras);

      await (await input('Name')).setValue('Terceira falha');
      await (await input('Scenario name')).setValue('Retry');
      await (await input('Required state')).setValue('falhou-2');
      await (await input('New state')).setValue('ok');
      await save();

      const call = await put();
      expect((call.request.body as Rule[])[3].scenario).toEqual({
        name: 'Retry',
        requiredState: 'falhou-2',
        newState: 'ok',
      });
      call.flush(call.request.body);
    });

    it('deve desabilitar os estados Quando o cenário não tem nome', async () => {
      await open({ index: null }, outras);

      expect(await (await input('Required state')).isDisabled()).toBe(true);
      await (await input('Scenario name')).setValue('Retry');
      expect(await (await input('Required state')).isDisabled()).toBe(false);
    });

    it('deve mostrar no campo o erro do servidor para o nome do cenário', async () => {
      await open({ index: 0 }, outras);

      await save();
      (await put()).flush(
        { '0.scenario.name': ['The scenario name may not be greater than 100 characters.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(async () =>
        expect(await (await field('Scenario name')).getTextErrors()).toEqual([
          'The scenario name may not be greater than 100 characters.',
        ]),
      );
    });
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
