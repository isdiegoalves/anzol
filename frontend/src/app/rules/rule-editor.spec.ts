import { signal } from '@angular/core';
import { Viewport, WindowClass } from '../shell/viewport';
import { WebhookRequest } from '../requests/webhook-request';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import type { Mock } from 'vitest';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatButtonHarness } from '@angular/material/button/testing';
import {
  MatButtonToggleGroupHarness,
  MatButtonToggleHarness,
} from '@angular/material/button-toggle/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { ruleFromRequest } from './rule-from-request';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;

/** `GET /requests` da mensagem mais nova (o exemplo do editor, WM-16). */
const isLatestRequest = (req: HttpRequest<unknown>) =>
  req.url.endsWith('/requests') &&
  req.params.get('sorting') === 'newest' &&
  req.params.get('per_page') === '1';

describe('Dado o editor de regra', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleEditor>;
  let loader: HarnessLoader;
  let closed: Mock<(saved: boolean) => void>;

  /** A lista que o servidor tem: a guarda do Save a relê antes do `PUT`. */
  let onServer: Rule[] = [];
  const open = async (
    data: RuleEditorData,
    rules: Rule[] = [rule(1)],
    latest: WebhookRequest[] = [],
  ) => {
    onServer = rules;
    const store = TestBed.inject(RuleStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(URL_REGRAS).flush(rules);
    await loaded;
    fixture = TestBed.createComponent(RuleEditor);
    fixture.componentRef.setInput('data', data);
    fixture.componentInstance.closed.subscribe(closed);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    // A mensagem de exemplo (WM-16): a mais nova da URL, quando o editor não recebeu uma.
    for (const call of http.match(isLatestRequest)) {
      call.flush(requestPage(latest));
    }
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
  const root = () => fixture.nativeElement as HTMLElement;
  /** Os chips de método (RULES-17): os ligados e o clique num deles. */
  const methodChips = () => [
    ...root().querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Methods"] button'),
  ];
  const pressedMethods = () =>
    methodChips()
      .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
      .map((chip) => chip.textContent?.trim());
  const clickMethod = async (method: string) => {
    methodChips()
      .find((chip) => chip.textContent?.trim() === method)
      ?.click();
    await fixture.whenStable();
  };
  /** Segmentado de Signature/Schema (`radiogroup`). */
  const segmented = (label: 'Signature' | 'Schema') =>
    loader.getHarness(MatButtonToggleGroupHarness.with({ selector: `[aria-label="${label}"]` }));
  const segmentedValue = async (label: 'Signature' | 'Schema') => {
    for (const toggle of await (await segmented(label)).getToggles()) {
      if (await toggle.isChecked()) {
        return toggle.getText();
      }
    }
    return null;
  };
  const choose = async (label: 'Signature' | 'Schema', text: string) => {
    const [toggle] = await (await segmented(label)).getToggles({ text });
    await toggle.check();
  };
  /** O `PUT` do Save, depois da releitura da lista (a guarda contra mudança em outro lugar). */
  const put = async () => {
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush(onServer);
    return vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
  };
  /** O resumo "To save, fix: …" abaixo do cabeçalho (WM-12); `null` sem ele. */
  const blockedText = () =>
    root().querySelector('.blocked[role="alert"]')?.textContent?.trim() ?? null;
  const text = (selector: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)].map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim(),
    );

  beforeEach(() => {
    closed = vi.fn();
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

  it('deve acrescentar a regra montada no formulário e salvar a lista inteira Quando "Save" é clicado', async () => {
    await open({ index: null });

    await (await input('Name')).setValue('Pix pago');
    await clickMethod('POST');
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
    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(true));
  });

  it('deve vir preenchido e trocar só a regra editada na lista Quando edita a segunda regra', async () => {
    await open({ index: 1 }, [rule(1), rule(2)]);

    expect(await (await input('Name')).getValue()).toBe('Rule 2');
    expect(await (await input('Path')).getValue()).toBe('/r2');
    expect(pressedMethods()).toEqual(['POST']);
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
    expect(closed).not.toHaveBeenCalled();
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

  it('não deve salvar e deve dizer o que corrigir Quando o nome está vazio ou o status está fora de 100–599 (WM-12)', async () => {
    await open({ index: null });

    expect(await (await button('Save')).isDisabled()).toBe(false);
    await save();
    expect(blockedText()).toBe('To save, fix: Name (required)');
    await (await input('Name')).setValue('ok');
    await (await input('Status')).setValue('600');
    await save();
    expect(blockedText()).toBe('To save, fix: Status (100–599)');
    expect(closed).not.toHaveBeenCalled();
  });

  describe('Dado template, atraso, dribble e falha na resposta', () => {
    const toggle = (label: string) => loader.getHarness(MatSlideToggleHarness.with({ label }));
    const choose = async (label: string, option: string) => {
      const harness = await select(label);
      await harness.open();
      await harness.clickOptions({ text: option });
    };
    /** O atraso é um segmentado (`radiogroup "Delay"`, RULES-23). */
    const delay = async (option: string) => {
      const group = await loader.getHarness(
        MatButtonToggleGroupHarness.with({ selector: '[aria-label="Delay"]' }),
      );
      const [toggle] = await group.getToggles({ text: option });
      await toggle.check();
    };
    const delayGroup = () =>
      loader.getHarness(MatButtonToggleGroupHarness.with({ selector: '[aria-label="Delay"]' }));
    const savedResponse = async () => {
      await save();
      const call = await put();
      call.flush(call.request.body);
      return (call.request.body as Rule[])[0].response;
    };

    it('deve ter o atraso em segmentado, as dicas à vista e o Template na linha do rótulo do corpo (RULES-23)', async () => {
      await open({ index: 0 }, [rule(1)]);

      const toggles = await (await delayGroup()).getToggles();
      expect(await Promise.all(toggles.map((t) => t.getText()))).toEqual([
        'None',
        'Fixed',
        'Uniform',
        'Log-normal',
      ]);
      expect(await toggles[0].isChecked()).toBe(true);
      const painel = root().querySelector('#rule-panel-response') as HTMLElement;
      expect(painel.textContent).toContain('Before answering; up to 60 s.');
      expect(painel.textContent).toContain('Send the body in chunks over time');
      expect(painel.querySelector('.fault-note')).not.toBeNull();
      // O switch Template fica no cabeçalho do corpo, antes do campo.
      const cabecalho = painel.querySelector('.body-head') as HTMLElement;
      expect(cabecalho.textContent).toContain('Template');
      expect(
        cabecalho.compareDocumentPosition(painel.querySelector('textarea') as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('deve gravar template: true e mostrar a cola dos helpers Quando o toggle "Template" é ligado', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await toggle('Template')).check();
      const helpers = fixture.nativeElement.querySelector('details.helpers') as HTMLDetailsElement;

      // Largura grande: a cola vem aberta (RULES-23).
      expect(helpers.open).toBe(true);
      expect(helpers.textContent).toContain("{{jsonPath request.body '$.id'}}");
      expect(helpers.textContent).toContain(
        'Value from the JSON body. Simple paths only ($.a.b[0]).',
      );
      expect(helpers.textContent).toContain("{{randomValue type='UUID'}}");
      expect(helpers.textContent).toContain('{{hmac request.body}}');
      expect(await savedResponse()).toMatchObject({ template: true });
    });

    it('deve gravar o atraso uniforme com mínimo e máximo Quando o tipo "Uniform" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await delay('Uniform');
      await (await input('Delay min (ms)')).setValue('100');
      await (await input('Delay max (ms)')).setValue('900');

      expect(await savedResponse()).toMatchObject({ delay: { uniform: { min: 100, max: 900 } } });
    });

    it.each([
      ['Fixed', 'Delay (ms)', '60001', 'An integer between 0 and 60000 (ms).'],
      ['Log-normal', 'Delay median (ms)', '-1', 'An integer between 0 and 60000 (ms).'],
    ])(
      'não deve salvar e deve explicar Quando o atraso %s passa do teto de 60 s ou é negativo',
      async (tipo, campo, valor, erro) => {
        await open({ index: 0 }, [rule(1)]);

        await delay(tipo);
        await (await input(campo)).setValue(valor);
        await (await input(campo)).blur();

        await save();

        expect(blockedText()).toBe(`To save, fix: ${campo} (0–60000 ms)`);
        expect(await (await field(campo)).getTextErrors()).toEqual([erro]);
      },
    );

    it('não deve salvar Quando o mínimo do atraso uniforme passa do máximo', async () => {
      await open({ index: 0 }, [rule(1)]);

      await delay('Uniform');
      await (await input('Delay min (ms)')).setValue('900');
      await (await input('Delay max (ms)')).setValue('100');
      await (await input('Delay max (ms)')).blur();

      await save();

      expect(blockedText()).toBe('To save, fix: Delay max (ms) (at least the min)');
      expect(await (await field('Delay max (ms)')).getTextErrors()).toEqual([
        'At least the min, up to 60000 (ms).',
      ]);
    });

    it('deve gravar o dribble e recusar mais de 100 pedaços Quando o toggle "Dribble" é ligado', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await toggle('Dribble')).check();
      await (await input('Chunks')).setValue('101');
      await save();
      expect(blockedText()).toBe('To save, fix: Chunks (1–100)');
      await (await input('Chunks')).setValue('10');
      // Válido de novo, o resumo sai.
      expect(blockedText()).toBeNull();
      await (await input('Dribble duration (ms)')).setValue('3000');

      expect(await savedResponse()).toMatchObject({ dribble: { chunks: 10, durationMs: 3000 } });
    });

    it('deve desabilitar status, corpo, template, atraso e dribble e explicar Quando uma falha é escolhida', async () => {
      await open({ index: 0 }, [rule(1, { response: { status: 201, delay: { fixed: 5 } } })]);

      await choose('Fault', 'Connection reset (TCP RST)');

      for (const label of ['Status', 'Response body']) {
        expect(await (await input(label)).isDisabled()).toBe(true);
      }
      expect(await (await delayGroup()).isDisabled()).toBe(true);
      expect(await (await toggle('Template')).isDisabled()).toBe(true);
      expect(await (await toggle('Dribble')).isDisabled()).toBe(true);
      // A dica fica sempre à vista (RULES-23); com a falha escolhida, vira aviso.
      const dica = fixture.nativeElement.querySelector('.fault-note') as HTMLElement;
      expect(dica.textContent).toContain(
        'the status, headers, body, delay and dribble are ignored',
      );
      expect(dica.classList).toContain('notice');
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
      expect(fixture.nativeElement.querySelector('.fault-note')?.classList).not.toContain('notice');
    });
  });

  describe('Dado a condição "Signature" no match', () => {
    const savedMatch = async () => {
      await save();
      const call = await put();
      call.flush(call.request.body);
      return (call.request.body as Rule[])[0].match;
    };

    it('deve oferecer Any, Valid, Invalid e Absent, começando em Any, e dizer de onde vem com link para Checks', async () => {
      await open({ index: 0 }, [rule(1)]);

      expect(await segmentedValue('Signature')).toBe('Any');
      const toggles = await (await segmented('Signature')).getToggles();
      expect(await Promise.all(toggles.map((toggle) => toggle.getText()))).toEqual([
        'Any',
        'Valid',
        'Invalid',
        'Absent',
      ]);
      // A URL do fixture não verifica assinatura.
      expect(text('.origin[data-for="signature"]')).toEqual([
        'Recorded on arrival · not set up · Set up in Checks',
      ]);
      const link = root().querySelector('.origin[data-for="signature"] a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/checks?section=signature`);
    });

    it('deve dizer o provedor da URL Quando ela verifica assinatura', async () => {
      TestBed.inject(Preferences).token.set(
        token({ signature: { provider: 'github' } as Token['signature'] }),
      );
      await open({ index: 0 }, [rule(1)]);

      expect(text('.origin[data-for="signature"]')).toEqual([
        'Recorded on arrival · GitHub · Set up in Checks',
      ]);
    });

    it('deve gravar match.signature Quando "Invalid" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await choose('Signature', 'Invalid');

      expect(await savedMatch()).toEqual({ ...rule(1).match, signature: 'invalid' });
    });

    it('deve vir com a condição salva e retirá-la do match Quando volta para "Any"', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, signature: 'valid' } })]);

      expect(await segmentedValue('Signature')).toBe('Valid');
      await choose('Signature', 'Any');

      expect(await savedMatch()).toEqual(rule(1).match);
    });

    it('deve mostrar no campo o erro do servidor para a condição de assinatura', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, signature: 'absent' } })]);

      await save();
      (await put()).flush(
        { '0.match.signature': ['The selected signature is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(() =>
        expect(text('.field-error[data-for="signature"]')).toEqual([
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

    it('deve oferecer Any, Valid e Invalid, começando em Any, e dizer de onde vem', async () => {
      await open({ index: 0 }, [rule(1)]);

      expect(await segmentedValue('Schema')).toBe('Any');
      const toggles = await (await segmented('Schema')).getToggles();
      expect(await Promise.all(toggles.map((toggle) => toggle.getText()))).toEqual([
        'Any',
        'Valid',
        'Invalid',
      ]);
      expect(text('.origin[data-for="schema"]')).toEqual([
        'Recorded on arrival · not validated · Set up in Checks',
      ]);
    });

    it('deve gravar match.schema Quando "Invalid" é escolhido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await choose('Schema', 'Invalid');

      expect(await savedMatch()).toEqual({ ...rule(1).match, schema: 'invalid' });
    });

    it('deve vir com a condição salva e retirá-la do match Quando volta para "Any"', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, schema: 'valid' } })]);

      expect(await segmentedValue('Schema')).toBe('Valid');
      await choose('Schema', 'Any');

      expect(await savedMatch()).toEqual(rule(1).match);
    });

    it('deve levar a condição do formulário ao JSON e de volta Quando alterna as abas', async () => {
      await open({ index: 0 }, [rule(1)]);
      await choose('Schema', 'Invalid');

      await (await view('JSON')).check();
      const json = await loader.getHarness(
        MatInputHarness.with({ selector: '[aria-label="Rule JSON"]' }),
      );
      const regra = JSON.parse(await json.getValue()) as Rule;
      expect(regra.match?.schema).toBe('invalid');
      await json.setValue(JSON.stringify({ ...regra, match: { ...regra.match, schema: 'valid' } }));
      await (await view('Form')).check();

      expect(await segmentedValue('Schema')).toBe('Valid');
    });

    it('deve mostrar no campo o erro do servidor para a condição de schema', async () => {
      await open({ index: 0 }, [rule(1, { match: { ...rule(1).match, schema: 'valid' } })]);

      await save();
      (await put()).flush(
        { '0.match.schema': ['The selected schema is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(() =>
        expect(text('.field-error[data-for="schema"]')).toEqual([
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
    /** O formulário do "Describe the rule" vem ao abrir o `<details>` (RULES-16). */
    const openSuggest = async () => {
      (root().querySelector('details.suggest summary') as HTMLElement).click();
      await vi.waitFor(() =>
        expect(root().querySelector('textarea[aria-label="Describe the rule"]')).not.toBeNull(),
      );
    };
    const applyAll = async () => (await vi.waitFor(() => button('Apply all'))).click();
    const suggest = async (texto = 'Responda 429 com Retry-After 5 para POST em /pagamentos') => {
      await openSuggest();
      await (await input('Describe the rule')).setValue(texto);
      await (await button('Suggest')).click();
      const call = await vi.waitFor(() => http.expectOne({ method: 'POST', url: URL_SUGGEST }));
      call.flush({ rule: sugerida, explanation: 'Responde **429**.', attempts: 1 });
      // E-13: a proposta só entra no editor com "Apply all".
      await applyAll();
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
      expect(closed).not.toHaveBeenCalled();
      expect(TestBed.inject(RuleStore).rules()).toEqual([rule(1)]);
    });

    it('deve gravar a sugestão no fim da lista só Quando o dono clica "Save"', async () => {
      await open({ index: null }, [rule(1)]);
      await suggest();

      await save();

      const call = await put();
      expect(call.request.body).toEqual([rule(1), sugerida]);
      call.flush([rule(1), { ...sugerida, id: 'r9' }]);
      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(true));
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
      await openSuggest();

      await (await input('Describe the rule')).setValue('regra de 429');
      await (await button('Suggest')).click();
      (await vi.waitFor(() => http.expectOne(URL_SUGGEST))).flush({
        rule: sugerida,
        explanation: '',
        attempts: 3,
      });
      await applyAll();

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
      await openSuggest();

      await (await loader.getHarness(MatCheckboxHarness)).check();
      await (await input('Describe the rule')).setValue('igual a esta');
      await (await button('Suggest')).click();

      const call = await vi.waitFor(() => http.expectOne(URL_SUGGEST));
      expect(call.request.body).toEqual(expect.objectContaining({ request_id: example.uuid }));
      call.flush({ rule: sugerida, explanation: '', attempts: 1 });
      await applyAll();
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

    it('deve explicar o erro, não salvar e bloquear a volta ao formulário Quando o JSON é inválido', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await view('JSON')).check();
      await (await json()).setValue('{"name": ""}');

      expect(await (await field('Rule JSON')).getTextErrors()).toEqual([
        'name: The name field is required.',
      ]);
      await save();
      expect(blockedText()).toBe('To save, fix: Rule JSON (name: The name field is required.)');
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(root().querySelector('.json textarea')),
      );
      // WM-04: "Form" nunca desabilitado; o clique fica no JSON e diz o que corrigir.
      const form = await view('Form');
      expect(await form.isDisabled()).toBe(false);
      await form.check();
      expect(text('[role="alert"]')).toContain(
        'To go back to the form, fix: name: The name field is required.',
      );
      expect(await (await view('JSON')).isChecked()).toBe(true);
      expect(await (await json()).getValue()).toBe('{"name": ""}');
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
          content: '{"id":42,"status":"pago"}',
        }),
      );

    it('deve abrir preenchido com método, caminho, query e corpo da mensagem', async () => {
      await open({ index: null, draft: draft() });

      expect(await (await input('Name')).getValue()).toBe('POST /pedidos');
      expect(pressedMethods()).toEqual(['POST']);
      expect(await (await select('Path match')).getValueText()).toBe('Equals');
      expect(await (await input('Path')).getValue()).toBe('/pedidos');
      expect(await (await input('Query 1 name')).getValue()).toBe('tipo');
      expect(await (await select('Query 1 operator')).getValueText()).toBe('equals');
      expect(await (await input('Query 1 value')).getValue()).toBe('pix');
      // WM-31: o id fica de fora; o campo estável vira JSONPath igual.
      expect(await (await select('Body 1 type')).getValueText()).toBe('JSONPath');
      expect(await (await input('Body 1 path')).getValue()).toBe('$.status');
      expect(await (await input('Body 1 equals')).getValue()).toBe('"pago"');
      expect(root().querySelector('[aria-label="Body 2 type"]')).toBeNull();
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
            body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
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
      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(true));
    });
  });

  describe('Dado o botão "Test against history"', () => {
    const MISS = '00000000-0000-4000-8000-000000000009';
    const testCall = () =>
      vi.waitFor(() => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }));
    const countCall = () =>
      vi.waitFor(() =>
        http.expectOne(
          (req) => req.url === `/token/${TOKEN_ID}/requests` && req.params.get('per_page') === '1',
        ),
      );
    /** As mensagens recentes (5 páginas de 100) que a prévia com prioridade lê (S8). */
    const recentCall = () =>
      vi.waitFor(() =>
        http.expectOne(
          (req) =>
            req.url === `/token/${TOKEN_ID}/requests` && req.params.get('per_page') === '100',
        ),
      );
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
      (await recentCall()).flush(requestPage([webhookRequest(1, { uuid: 'a', rule: null })]));
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      expect(call.request.body).toEqual({ ...rule(1), name: 'Em edição' });
      expect(text('[aria-label="History test"] .summary')).toEqual([
        '1 of the 2 most recent requests would match',
      ]);
      const link = root().querySelector('.misses a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`#/${TOKEN_ID}/${MISS}/1`);
      // WM-22: abre ao lado, dentro de Regras, não em outra aba.
      expect(link.target).toBe('');
      expect(link.textContent?.trim()).toBe('#00000');
      expect(text('.misses .failed li')).toEqual(['method: expected POST, got GET', 'x: y']);
      expect(closed).not.toHaveBeenCalled();
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
      expect(closed).not.toHaveBeenCalled();
    });

    it('não deve testar e deve dizer o que corrigir Quando a regra em edição é inválida (WM-12)', async () => {
      await open({ index: 0 }, [rule(1)]);

      await (await input('Name')).setValue('');
      const testar = await button('Test against history');
      expect(await testar.isDisabled()).toBe(false);
      await testar.click();

      expect(blockedText()).toBe('To test, fix: Name (required)');
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(root().querySelector('.name-input')),
      );
    });

    it('deve manter o resultado em dia Quando só muda o que não é condição (WM-22)', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await button('Test against history')).click();
      (await testCall()).flush({ matches: [], misses: [] });
      (await countCall()).flush({ data: [], total: 0 });
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      await (await input('Name')).setValue('Outra');
      await (await input('Status')).setValue('503');

      expect(panel()).not.toBeNull();
      expect(text('[aria-label="History test"] .stale')).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      http.expectNone({ method: 'POST', url: `${URL_REGRAS}/test` });
    });

    it('deve abrir a mensagem do resultado ao lado, dentro de Regras, e fechar (WM-22)', async () => {
      const pedido = webhookRequest(1, { uuid: 'a', url: `http://localhost/${TOKEN_ID}/x` });
      await open({ index: 0 }, [rule(1)]);
      await (await button('Test against history')).click();
      (await testCall()).flush({ matches: [{ uuid: 'a', seq: 3 }], misses: [] });
      (await countCall()).flush({ data: [], total: 1 });
      (await recentCall()).flush(requestPage([pedido]));
      const link = await vi.waitFor(() => {
        const found = root().querySelector<HTMLAnchorElement>('.matches a');
        expect(found?.textContent).toMatch(/^POST \/x · /);
        return found as HTMLAnchorElement;
      });

      link.click();

      const regiao = await vi.waitFor(() => {
        const found = root().querySelector('[role="region"][aria-label="Request a"]');
        expect(found).not.toBeNull();
        expect(found?.querySelector('app-request-view')).not.toBeNull();
        return found as HTMLElement;
      });
      await expectNoAxeViolations(root());
      (
        [...regiao.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close') as
          HTMLButtonElement | undefined
      )?.click();
      await fixture.whenStable();
      expect(root().querySelector('[aria-label="Request a"]')).toBeNull();
    });

    it('deve pedir a resposta renderizada só no "Preview response" e mostrá-la (C4)', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await button('Test against history')).click();
      (await testCall()).flush({ matches: [{ uuid: 'a', seq: 3 }], misses: [] });
      (await countCall()).flush({ data: [], total: 1 });
      (await recentCall()).flush(requestPage([webhookRequest(1, { uuid: 'a' })]));
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      await (await button('Preview response')).click();

      const render = await vi.waitFor(() =>
        http.expectOne(
          (req) => req.url === `${URL_REGRAS}/test` && req.params.get('render') === '3',
        ),
      );
      render.flush({
        matches: [{ uuid: 'a', seq: 3 }],
        misses: [],
        rendered: [{ uuid: 'a', status: 201, headers: {}, body: 'ok' }],
      });
      const regiao = await vi.waitFor(() => {
        const found = root().querySelector('[role="region"][aria-labelledby="rendered-title"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(regiao.textContent).toContain('Rendered responses');
      expect(regiao.querySelector('pre')?.textContent?.trim()).toBe('ok');
    });

    it('deve marcar "Out of date" e rerodar 1 s depois Quando uma condição muda (WM-22)', async () => {
      await open({ index: 0 }, [rule(1)]);
      await (await button('Test against history')).click();
      (await testCall()).flush({ matches: [], misses: [{ uuid: MISS, seq: 2, failed: ['x'] }] });
      (await countCall()).flush({ data: [], total: 1 });
      (await recentCall()).flush(requestPage([]));
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      await (await input('Path')).setValue('/outro');

      expect(text('[aria-label="History test"] .stale')).toEqual(['Out of date']);
      http.expectNone({ method: 'POST', url: `${URL_REGRAS}/test` });
      const rerun = await vi.waitFor(
        () => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }),
        { timeout: 3000 },
      );
      expect((rerun.request.body as Rule).match?.path).toEqual({ equals: '/outro' });
      rerun.flush({ matches: [], misses: [] });
      // O total de mensagens é lido uma vez por carga: o rerun não pede de novo.
      await vi.waitFor(() => expect(text('[aria-label="History test"] .stale')).toEqual([]));
    });

    it('deve dizer quantas passam a ter esta resposta e quantas seguem com a regra anterior (prévia com prioridade)', async () => {
      // A regra 1 (prioridade 1) respondeu "a"; a regra nova entra com a prioridade 5.
      const anterior = rule(1, { priority: 1 });
      await open({ index: null, draft: rule(9, { id: undefined, name: 'Nova', priority: 5 }) }, [
        anterior,
      ]);

      await (await button('Test against history')).click();
      (await testCall()).flush({
        matches: [
          { uuid: 'a', seq: 3 },
          { uuid: 'b', seq: 2 },
        ],
        misses: [],
      });
      (await countCall()).flush({ data: [], total: 2 });
      (await recentCall()).flush(
        requestPage([
          webhookRequest(1, { uuid: 'a', rule: { id: 'r1', name: anterior.name } }),
          webhookRequest(2, { uuid: 'b', rule: null }),
        ]),
      );
      await vi.waitFor(() => expect(text('.preview li')).toHaveLength(2));

      expect(text('.preview h3')).toEqual(['With the rules before it']);
      expect(text('.preview .hint')).toEqual([
        'Based on the rule that answered at the time; ignores scenario state.',
      ]);
      // RULES-21: a que vinha da resposta padrão diz qual era, e a barra mostra a proporção.
      expect(text('.preview li')).toEqual([
        '1 would now get 209 from this rule instead of the default 200',
        '1 still answered by earlier rule Rule 1',
      ]);
      expect(root().querySelector('.preview li')?.textContent).toBe(
        '1 would now get 209 from this rule instead of the default 200',
      );
      const barra = root().querySelector('.preview .proportion') as HTMLElement;
      expect(barra.getAttribute('aria-hidden')).toBe('true');
      expect([...barra.querySelectorAll('span')].map((part) => part.style.width)).toEqual([
        '50%',
        '50%',
      ]);
    });

    it('deve dizer em cada condição quantas falharam nela, pelas "conditions" do teste', async () => {
      const regra = rule(1, {
        match: {
          method: ['POST'],
          path: { equals: '/r1' },
          query: {},
          headers: { 'X-Sig': { present: true } },
          body: [{ contains: 'a' }],
        },
      });
      await open({ index: 0 }, [regra]);

      await (await button('Test against history')).click();
      (await testCall()).flush({
        matches: [],
        misses: [
          {
            uuid: 'm1',
            seq: 2,
            failed: ['method: x', 'header x-sig: absent'],
            conditions: ['match.method', 'match.headers.X-Sig'],
          },
          { uuid: 'm2', seq: 1, failed: ['header x-sig: absent'], conditions: null },
        ],
      });
      (await countCall()).flush({ data: [], total: 2 });
      (await recentCall()).flush(requestPage([]));
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      const feedback = [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll('.feedback'),
      ].map((element) => [element.getAttribute('data-condition'), element.textContent?.trim()]);
      // Um chip por condição, à direita (RULES-18); seção vazia diz "No condition".
      expect(feedback).toEqual([
        ['match.method', 'Fails on 1/2'],
        ['match.path', 'Passes 2/2'],
        ['match.query', 'No condition'],
        ['match.headers.X-Sig', 'Fails on 2/2'],
        ['match.body.0', 'Passes 2/2'],
        ['match.signature', 'No condition'],
        ['match.schema', 'No condition'],
      ]);
      // O estilo vem do resultado (a classe), não do texto, que muda com o idioma.
      expect(
        [...root().querySelectorAll('.feedback')].map((element) =>
          ['passes', 'fails', 'none'].find((kind) => element.classList.contains(kind)),
        ),
      ).toEqual(['fails', 'passes', 'none', 'fails', 'passes', 'none', 'none']);
    });
  });

  describe('Dado a regra em palavras e as abas', () => {
    it('deve descrever a regra do formulário e acompanhar a edição', async () => {
      await open({ index: 0 }, [rule(1)]);

      // RULES-15: o parágrafo "Rule in plain words", sem o rótulo, com método/status em negrito.
      const frase = root().querySelector('[aria-label="Rule in plain words"]') as HTMLElement;
      // Não é `note`: a dica da falha é o `note` da aba Response.
      expect(frase.getAttribute('role')).toBe('group');
      expect(frase.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'When a POST to /r1, answer 201.',
      );
      expect(frase.textContent).not.toContain('In plain words:');
      expect([...frase.querySelectorAll('strong')].map((b) => b.textContent)).toEqual([
        'POST',
        '201',
      ]);
      expect([...frase.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['/r1']);
      await (await input('Status')).setValue('418');
      fixture.detectChanges();

      expect(text('[aria-label="Rule in plain words"]')).toEqual([
        'When a POST to /r1, answer 418.',
      ]);
    });

    it('deve mostrar só o painel da aba escolhida, com as setas trocando de aba', async () => {
      await open({ index: 0 }, [rule(1)]);
      const root = fixture.nativeElement as HTMLElement;
      const visible = () =>
        [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
          .filter((panel) => !panel.hidden)
          .map((panel) => panel.id);

      expect(visible()).toEqual(['rule-panel-match']);
      (root.querySelector('#rule-tab-scenario') as HTMLElement).click();
      fixture.detectChanges();
      expect(visible()).toEqual(['rule-panel-scenario']);
      // A aba Scenario lê os estados dos cenários da URL (RULES-24).
      (
        await vi.waitFor(() =>
          http.expectOne({ method: 'GET', url: `/token/${TOKEN_ID}/scenarios` }),
        )
      ).flush([]);

      root
        .querySelector('#rule-tab-scenario')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      expect(visible()).toEqual(['rule-panel-test']);
      expect(root.querySelector('#rule-tab-test')?.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('Dado um caminho com o token da URL (a regra nunca casaria)', () => {
    it('deve avisar e tirar o token do caminho Quando o dono clica para corrigir', async () => {
      await open({ index: 0 }, [
        rule(1, { match: { path: { equals: `/${TOKEN_ID}/pagamentos` } } }),
      ]);
      const warning = () =>
        (fixture.nativeElement as HTMLElement).querySelector('.path-warning[role="alert"]');

      expect(warning()?.textContent).toContain("The path includes this URL's token");
      await (await button('Remove the token from the path')).click();

      expect(await (await input('Path')).getValue()).toBe('/pagamentos');
      expect(warning()).toBeNull();
    });
  });

  describe('Dado a lista mudada em outro lugar com o editor aberto (PUT troca a lista inteira)', () => {
    const changed = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('[role="alert"]')].find((alert) =>
        alert.textContent?.includes('The rules changed elsewhere'),
      );

    it('não deve gravar e deve avisar Quando outra aba acrescentou uma regra, e salvar sem perdê-la depois do Reload', async () => {
      await open({ index: null }, [rule(1)]);
      await (await input('Name')).setValue('Nova');
      await save();

      // Outra aba (ou o CLI) acrescentou a regra 2 depois da leitura.
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush([
        rule(1),
        rule(2),
      ]);
      await vi.waitFor(() => expect(changed()).toBeDefined());
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
      expect(closed).not.toHaveBeenCalled();

      await (await button('Reload')).click();
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush([
        rule(1),
        rule(2),
      ]);
      await vi.waitFor(() => expect(changed()).toBeUndefined());
      expect(await (await input('Name')).getValue()).toBe('Nova');
      onServer = [rule(1), rule(2)];
      await save();

      const call = await put();
      expect((call.request.body as Rule[]).map((r) => r.name)).toEqual([
        'Rule 1',
        'Rule 2',
        'Nova',
      ]);
    });
  });

  describe('Dado a regra em edição desligada', () => {
    it('deve avisar na prévia que a regra desligada não responde', async () => {
      await open({ index: 0 }, [rule(1, { enabled: false })]);

      await (await button('Test against history')).click();
      (await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }))).flush(
        { matches: [{ uuid: 'a', seq: 1 }], misses: [] },
      );
      (await vi.waitFor(() => http.expectOne((req) => req.params.get('per_page') === '1'))).flush({
        data: [],
        total: 1,
      });
      (await vi.waitFor(() => http.expectOne((req) => req.params.get('per_page') === '100'))).flush(
        requestPage([webhookRequest(1, { uuid: 'a', rule: null })]),
      );

      await vi.waitFor(() =>
        expect(text('.preview .off')).toEqual(['This rule is off; turn it on to answer.']),
      );
    });
  });

  describe('Dado o Reload do editor depois de "changed elsewhere"', () => {
    /** Save → a lista do servidor mudou → aviso → Reload com a lista nova. */
    const conflictThenReload = async (server: Rule[]) => {
      await save();
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush(server);
      await (await vi.waitFor(() => button('Reload'))).click();
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush(server);
      await fixture.whenStable();
      onServer = server;
    };

    it('deve avisar e salvar como regra nova, sem o id velho, Quando a regra em edição sumiu da lista (import com ids novos)', async () => {
      await open({ index: 1 }, [rule(1), rule(2)]);
      await (await input('Name')).setValue('Editada');
      const reimportada = [rule(1, { id: 'novo-1' }), rule(2, { id: 'novo-2' })];

      await conflictThenReload(reimportada);

      await vi.waitFor(() =>
        expect(text('.missing')).toEqual([
          'This rule no longer exists in the list; Save adds it as a new rule.',
        ]),
      );
      await save();
      const call = await put();
      const body = call.request.body as Rule[];
      expect(body.map((r) => [r.id, r.name])).toEqual([
        ['novo-1', 'Rule 1'],
        ['novo-2', 'Rule 2'],
        [undefined, 'Editada'],
      ]);
      expect('id' in body[2]).toBe(false);
    });

    it('deve ficar com a prioridade e o enabled da lista nova Quando o editor não os tocou', async () => {
      await open({ index: 1 }, [rule(1), rule(2)]);
      await (await input('Name')).setValue('Editada');

      await conflictThenReload([rule(2, { priority: 1, enabled: false }), rule(1)]);
      await save();

      const body = (await put()).request.body as Rule[];
      expect(body.map((r) => [r.name, r.priority, r.enabled])).toEqual([
        ['Editada', 1, false],
        ['Rule 1', 5, true],
      ]);
    });

    it('deve manter a prioridade digitada Quando o editor a mudou antes do Reload', async () => {
      await open({ index: 1 }, [rule(1), rule(2)]);
      await (await input('Priority')).setValue('7');

      await conflictThenReload([rule(2, { priority: 1 }), rule(1)]);
      await save();

      const body = (await put()).request.body as Rule[];
      expect(body.map((r) => [r.name, r.priority])).toEqual([
        ['Rule 2', 7],
        ['Rule 1', 5],
      ]);
    });
  });

  describe('Dado o cabeçalho do editor (RULES-13)', () => {
    const root = () => fixture.nativeElement as HTMLElement;
    const buttonsNamed = (name: string) =>
      [...root().querySelectorAll('button')].filter(
        (element) => element.textContent?.trim() === name,
      );

    it('deve trazer nome, prioridade, Enabled, Discard e um Save só no topo', async () => {
      await open({ index: 0 }, [rule(1)]);

      const header = root().querySelector('.editor-header') as HTMLElement;
      expect(header.querySelector('input[aria-label="Name"]')).not.toBeNull();
      expect(header.querySelector('input[aria-label="Priority"]')).not.toBeNull();
      expect(header.textContent).toContain('Enabled');
      expect(buttonsNamed('Save')).toHaveLength(1);
      expect(header.contains(buttonsNamed('Save')[0])).toBe(true);
      expect(buttonsNamed('Cancel')).toHaveLength(0);
      await (await button('Discard')).click();
      expect(closed).toHaveBeenCalledWith(false);
    });

    it('deve mostrar "Unsaved changes" só depois de uma edição', async () => {
      await open({ index: 0 }, [rule(1)]);
      expect(text('.unsaved')).toEqual([]);

      await (await input('Name')).setValue('Outro nome');
      fixture.detectChanges();

      expect(text('.unsaved')).toEqual(['Unsaved changes']);
    });

    it('deve pedir para apagar a regra salva pelo "Delete rule", e não o oferecer numa regra nova', async () => {
      const deleted = vi.fn();
      await open({ index: 0 }, [rule(1)]);
      fixture.componentInstance.deleteRequested.subscribe(deleted);

      await (
        await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Delete rule"]' }))
      ).click();

      expect(deleted).toHaveBeenCalledWith('r1');
      fixture.componentRef.setInput('data', { index: null });
      fixture.detectChanges();
      expect(root().querySelector('[aria-label="Delete rule"]')).toBeNull();
    });
  });

  describe('Dado o aside "Against history" na aba Match (RULES-19)', () => {
    const aside = () => root().querySelector('aside[aria-label="Against history"]') as HTMLElement;

    it('deve dizer que não houve teste e, depois de um, o número, as falhas mais próximas e os botões', async () => {
      await open({ index: 0 }, [rule(1)]);
      expect(aside().textContent).toContain('Not tested yet');

      await (await button('Test against history')).click();
      (await vi.waitFor(() => http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }))).flush(
        {
          matches: [{ uuid: 'a', seq: 5 }],
          misses: [
            { uuid: 'bbbbbbbb-0000', seq: 4, failed: ['method: x', 'path: y'], conditions: null },
            { uuid: 'cccccccc-0000', seq: 3, failed: ['method: x'], conditions: null },
          ],
        },
      );
      (await vi.waitFor(() => http.expectOne((req) => req.params.get('per_page') === '1'))).flush({
        data: [],
        total: 3,
      });
      (await vi.waitFor(() => http.expectOne((req) => req.params.get('per_page') === '100'))).flush(
        requestPage([webhookRequest(1, { uuid: 'a', rule: null })]),
      );
      (root().querySelector('#rule-tab-match') as HTMLElement).click();
      fixture.detectChanges();

      await vi.waitFor(() => expect(text('[aria-label="Against history"] .big')).toEqual(['1']));
      expect(text('[aria-label="Against history"] .of')).toEqual([
        'of the 3 most recent would match',
      ]);
      // As mais próximas primeiro: a de 1 condição antes da de 2.
      expect(text('[aria-label="Against history"] .closest .id')).toEqual(['#ccccc', '#bbbbb']);
      expect(text('[aria-label="Against history"] .closest > li')[0]).toBe(
        '#ccccc 1 condition method: x',
      );
      expect(text('[aria-label="Against history"] .closest .count')).toEqual([
        '1 condition',
        '2 conditions',
      ]);
      await (await button('All results')).click();
      expect(root().querySelector('#rule-tab-test')?.getAttribute('aria-selected')).toBe('true');
      expect(await (await button('Test again')).isDisabled()).toBe(false);
    });
  });
});
