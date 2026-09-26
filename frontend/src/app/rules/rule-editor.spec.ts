import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatButtonToggleHarness } from '@angular/material/button-toggle/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { ruleFromRequest } from './rule-from-request';
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
    dialogData.draft = data.draft;
    dialogData.example = data.example;
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
      expect(helpers.textContent).toContain("even inside a quoted key ($['a(b)'], $['x?'])");
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

  describe('Dado a condição "Signature" no match', () => {
    const savedMatch = async () => {
      await save();
      const call = await put();
      call.flush(call.request.body);
      return (call.request.body as Rule[])[0].match;
    };

    it('deve oferecer Any, Valid, Invalid e Absent, começando em Any, e explicar de onde vem', async () => {
      await open({ index: 0 }, [rule(1)]);
      const signature = await select('Signature');

      expect(await signature.getValueText()).toBe('Any');
      await signature.open();
      const options = await signature.getOptions();
      expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
        'Any',
        'Valid',
        'Invalid',
        'Absent (no signature header)',
      ]);
      expect(await (await field('Signature')).getTextHints()).toEqual([
        'Set up signature verification in Edit URL',
      ]);
    });

    it('deve gravar match.signature Quando "Invalid" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      const signature = await select('Signature');
      await signature.open();
      await signature.clickOptions({ text: 'Invalid' });

      expect(await savedMatch()).toEqual({ ...rule(1).match, signature: 'invalid' });
    });

    it('deve vir com a condição salva e retirá-la do match Quando volta para "Any"', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, signature: 'valid' } })]);
      const signature = await select('Signature');

      expect(await signature.getValueText()).toBe('Valid');
      await signature.open();
      await signature.clickOptions({ text: 'Any' });

      expect(await savedMatch()).toEqual(rule(1).match);
    });

    it('deve mostrar no campo o erro do servidor para a condição de assinatura', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, signature: 'absent' } })]);

      await save();
      (await put()).flush(
        { '0.match.signature': ['The selected signature is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(async () =>
        expect(await (await field('Signature')).getTextErrors()).toEqual([
          'The selected signature is invalid.',
        ]),
      );
    });
  });

  describe('Dado a condição "Schema" no match', () => {
    const savedMatch = async () => {
      await save();
      const call = await put();
      call.flush(call.request.body);
      return (call.request.body as Rule[])[0].match;
    };
    const view = (text: 'Form' | 'JSON') =>
      loader.getHarness(MatButtonToggleHarness.with({ text }));

    it('deve oferecer Any, Valid e Invalid, começando em Any, e explicar de onde vem', async () => {
      await open({ index: 0 }, [rule(1)]);
      const schema = await select('Schema');

      expect(await schema.getValueText()).toBe('Any');
      await schema.open();
      const options = await schema.getOptions();
      expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
        'Any',
        'Valid',
        'Invalid',
      ]);
      expect(await (await field('Schema')).getTextHints()).toEqual([
        'Set up schema validation in Edit URL',
      ]);
    });

    it('deve gravar match.schema Quando "Invalid" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      const schema = await select('Schema');
      await schema.open();
      await schema.clickOptions({ text: 'Invalid' });

      expect(await savedMatch()).toEqual({ ...rule(1).match, schema: 'invalid' });
    });

    it('deve vir com a condição salva e retirá-la do match Quando volta para "Any"', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, schema: 'valid' } })]);
      const schema = await select('Schema');

      expect(await schema.getValueText()).toBe('Valid');
      await schema.open();
      await schema.clickOptions({ text: 'Any' });

      expect(await savedMatch()).toEqual(rule(1).match);
    });

    it('deve levar a condição do formulário ao JSON e de volta Quando alterna as abas', async () => {
      await open({ index: 0 }, [rule(1)]);
      const schema = await select('Schema');
      await schema.open();
      await schema.clickOptions({ text: 'Invalid' });

      await (await view('JSON')).check();
      const json = await loader.getHarness(
        MatInputHarness.with({ selector: '[aria-label="Rule JSON"]' }),
      );
      const regra = JSON.parse(await json.getValue()) as Rule;
      expect(regra.match?.schema).toBe('invalid');
      await json.setValue(JSON.stringify({ ...regra, match: { ...regra.match, schema: 'valid' } }));
      await (await view('Form')).check();

      expect(await (await select('Schema')).getValueText()).toBe('Valid');
    });

    it('deve mostrar no campo o erro do servidor para a condição de schema', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, schema: 'valid' } })]);

      await save();
      (await put()).flush(
        { '0.match.schema': ['The selected schema is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(async () =>
        expect(await (await field('Schema')).getTextErrors()).toEqual([
          'The selected schema is invalid.',
        ]),
      );
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

  describe('Dado o "Describe the rule"', () => {
    const URL_SUGGEST = `/token/${TOKEN_ID}/rules/suggest`;
    const sugerida: Rule = {
      ...rule(9),
      id: undefined,
      name: 'Pagamentos 429',
      match: { ...rule(9).match, path: { equals: '/pagamentos' } },
      response: { ...rule(9).response, status: 429, headers: { 'Retry-After': '5' } },
    };
    const suggest = async (texto = 'Responda 429 com Retry-After 5 para POST em /pagamentos') => {
      await (await input('Describe the rule')).setValue(texto);
      await (await button('Suggest')).click();
      const call = await vi.waitFor(() => http.expectOne({ method: 'POST', url: URL_SUGGEST }));
      call.flush({ rule: sugerida, explanation: 'Responde **429**.', attempts: 1 });
      await vi.waitFor(async () =>
        expect(await (await input('Name')).getValue()).toBe(sugerida.name),
      );
      return call;
    };

    it('deve preencher o editor com a regra sugerida sem salvar Quando "Suggest" responde', async () => {
      await open({ index: null }, [rule(1)]);

      await suggest();

      expect(await (await input('Path')).getValue()).toBe('/pagamentos');
      expect(await (await input('Status')).getValue()).toBe('429');
      expect(await (await input('Response header 1 name')).getValue()).toBe('Retry-After');
      expect(await (await input('Response header 1 value')).getValue()).toBe('5');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Suggested in 1 attempt.',
      );
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(TestBed.inject(RuleStore).rules()).toEqual([rule(1)]);
    });

    it('deve gravar a sugestão no fim da lista só Quando o dono clica "Save"', async () => {
      await open({ index: null }, [rule(1)]);
      await suggest();

      await save();

      const call = await put();
      expect(call.request.body).toEqual([rule(1), sugerida]);
      call.flush([rule(1), { ...sugerida, id: 'r9' }]);
      await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    });

    it('deve manter o id da regra editada Quando a sugestão substitui uma regra salva', async () => {
      await open({ index: 0 }, [rule(1), rule(2)]);
      await suggest();

      await save();

      const call = await put();
      expect(call.request.body).toEqual([{ ...sugerida, id: 'r1' }, rule(2)]);
      call.flush([{ ...sugerida, id: 'r1' }, rule(2)]);
    });

    it('deve preencher o JSON Quando a visão aberta é a "JSON"', async () => {
      await open({ index: null }, []);
      await (await loader.getHarness(MatButtonToggleHarness.with({ text: 'JSON' }))).check();

      await (await input('Describe the rule')).setValue('regra de 429');
      await (await button('Suggest')).click();
      (await vi.waitFor(() => http.expectOne(URL_SUGGEST))).flush({
        rule: sugerida,
        explanation: '',
        attempts: 3,
      });

      await vi.waitFor(async () =>
        expect(JSON.parse(await (await input('Rule JSON')).getValue())).toEqual(
          JSON.parse(JSON.stringify(sugerida)),
        ),
      );
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
    });

    it('deve oferecer a mensagem aberta como exemplo Quando o editor recebe uma', async () => {
      const example = webhookRequest(5);
      await open({ index: null, example }, []);

      await (await loader.getHarness(MatCheckboxHarness)).check();
      await (await input('Describe the rule')).setValue('igual a esta');
      await (await button('Suggest')).click();

      const call = await vi.waitFor(() => http.expectOne(URL_SUGGEST));
      expect(call.request.body).toEqual(expect.objectContaining({ request_id: example.uuid }));
      call.flush({ rule: sugerida, explanation: '', attempts: 1 });
      await vi.waitFor(async () =>
        expect(await (await input('Name')).getValue()).toBe(sugerida.name),
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

  describe('Dado uma regra criada a partir de uma mensagem', () => {
    const draft = () =>
      ruleFromRequest(
        webhookRequest(7, {
          method: 'POST',
          url: `http://localhost:8084/${TOKEN_ID}/pedidos?tipo=pix`,
          query: { tipo: 'pix' },
          content: '{"id":42}',
        }),
      );

    it('deve abrir preenchido com método, caminho, query e corpo da mensagem', async () => {
      await open({ index: null, draft: draft() });

      expect(await (await input('Name')).getValue()).toBe('POST /pedidos');
      expect(await (await select('Methods')).getValueText()).toBe('POST');
      expect(await (await select('Path match')).getValueText()).toBe('Equals');
      expect(await (await input('Path')).getValue()).toBe('/pedidos');
      expect(await (await input('Query 1 name')).getValue()).toBe('tipo');
      expect(await (await select('Query 1 operator')).getValueText()).toBe('equals');
      expect(await (await input('Query 1 value')).getValue()).toBe('pix');
      expect(await (await select('Body 1 type')).getValueText()).toBe('Equal to JSON');
      expect(await (await input('Body 1 value')).getValue()).toBe('{"id":42}');
      expect(await (await input('Status')).getValue()).toBe('200');
      expect(await (await input('Response body')).getValue()).toBe('');
    });

    it('deve acrescentar a regra no fim da lista com prioridade 5 Quando salva', async () => {
      await open({ index: null, draft: draft() }, [rule(1), rule(2)]);

      await save();

      const call = await put();
      expect(call.request.body).toEqual([
        rule(1),
        rule(2),
        {
          name: 'POST /pedidos',
          enabled: true,
          priority: 5,
          match: {
            method: ['POST'],
            path: { equals: '/pedidos' },
            query: { tipo: { equals: 'pix' } },
            headers: {},
            body: [{ equalToJson: { id: 42 } }],
          },
          scenario: null,
          response: {
            status: 200,
            headers: {},
            body: '',
            template: false,
            delay: null,
            dribble: null,
            fault: null,
          },
        },
      ]);
      call.flush([rule(1), rule(2), rule(3)]);
      await vi.waitFor(() => expect(dialogRef.close).toHaveBeenCalledWith(true));
    });
  });

  describe('Dado o botão "Test against history"', () => {
    const MISS = '00000000-0000-4000-8000-000000000009';
    const testCall = () =>
      vi.waitFor(() => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }));
    const countCall = () =>
      vi.waitFor(() => http.expectOne((req) => req.url === `/token/${TOKEN_ID}/requests`));
    const panel = (): HTMLElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector('[aria-label="History test"]');

    it('deve testar a regra em edição e mostrar quantas casariam e por que as outras não', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await input('Name')).setValue('Em edição');

      await (await button('Test against history')).click();
      const call = await testCall();
      call.flush({
        matches: [{ uuid: 'a', seq: 3 }],
        misses: [{ uuid: MISS, seq: 2, failed: ['method: expected POST, got GET', 'x: y'] }],
      });
      (await countCall()).flush({ data: [], total: 2 });
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      expect(call.request.body).toEqual({ ...rule(1), name: 'Em edição' });
      expect(panel()?.querySelector('.summary')?.textContent?.trim()).toBe(
        '1 of 2 recorded requests would match.',
      );
      const link = panel()?.querySelector('a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`#/${TOKEN_ID}/${MISS}/1`);
      expect(link.target).toBe('_blank');
      expect(link.textContent?.trim()).toBe('#00000');
      expect(
        [...(panel()?.querySelectorAll('.failed li') ?? [])].map((li) => li.textContent),
      ).toEqual(['method: expected POST, got GET', 'x: y']);
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('deve mostrar o erro no editor e não fechar Quando o servidor recusa a regra (422)', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await button('Test against history')).click();
      (await testCall()).flush(
        { 'match.path.regex': ['The regex is invalid.'] },
        { status: 422, statusText: 'Unprocessable' },
      );
      (await countCall()).flush({ data: [], total: 0 });
      await vi.waitFor(() =>
        expect(fixture.nativeElement.querySelector('.history-errors')).not.toBeNull(),
      );

      const alert = (fixture.nativeElement as HTMLElement).querySelector('.history-errors');
      expect(alert?.textContent?.trim()).toBe('match.path.regex: The regex is invalid.');
      expect(panel()).toBeNull();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('não deve permitir testar Quando a regra em edição é inválida', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await input('Name')).setValue('');

      expect(await (await button('Test against history')).isDisabled()).toBe(true);
    });

    it('deve apagar o resultado Quando a regra muda depois do teste', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await button('Test against history')).click();
      (await testCall()).flush({ matches: [], misses: [] });
      (await countCall()).flush({ data: [], total: 0 });
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      await (await input('Name')).setValue('Outra');

      expect(panel()).toBeNull();
    });
  });
});
