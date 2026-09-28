import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { SuggestionCheck } from '../ai/ai-client';
import { SuggestionApply } from './rule-suggest';
import { RuleSuggestForm } from './rule-suggest-form';

const URL_SUGGEST = `/token/${TOKEN_ID}/rules/suggest`;

describe('Dado o "Describe the rule"', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleSuggestForm>;
  let loader: HarnessLoader;
  let suggested: SuggestionApply[];

  const render = async (example?: WebhookRequest) => {
    fixture = TestBed.createComponent(RuleSuggestForm);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('example', example);
    suggested = [];
    fixture.componentInstance.applied.subscribe((value) => suggested.push(value));
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const describeRule = async (text: string) =>
    (
      await loader.getHarness(
        MatInputHarness.with({ selector: '[aria-label="Describe the rule"]' }),
      )
    ).setValue(text);
  const suggestButton = () => loader.getHarness(MatButtonHarness.with({ text: 'Suggest' }));
  /** O "Suggest" desligado fica no Tab e diz por quê: `aria-disabled`, e não `disabled`. */
  const suggestOff = async () =>
    (await (await (await suggestButton()).host()).getAttribute('aria-disabled')) === 'true';
  const post = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: URL_SUGGEST }));
  const text = (element: HTMLElement) => element.textContent?.replace(/\s+/g, ' ').trim();
  /** A região viva da espera, dentro do `group "AI progress"`. */
  const progress = (element: HTMLElement) =>
    element.querySelector('[role=group][aria-label="AI progress"] [role=status]') as HTMLElement;
  /** As linhas de `list "Checks on this suggestion"`: veredito e frase. */
  const checks = (element: HTMLElement) =>
    [...element.querySelectorAll('.checks li')].map((li) => [
      text(li.querySelector('.verdict') as HTMLElement),
      text(li.querySelector('.said') as HTMLElement),
    ]);
  const actions = (element: HTMLElement) =>
    [...element.querySelectorAll('.apply button')].map((button) => [
      text(button as HTMLElement),
      button.hasAttribute('mat-flat-button'),
    ]);
  const CHECK: SuggestionCheck = {
    example: null,
    recent: { evaluated: 34, matched: 7 },
    warnings: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('deve ficar desabilitado Quando a descrição está vazia', async () => {
    await render();

    expect(await suggestOff()).toBe(true);
    await describeRule('   ');
    expect(await suggestOff()).toBe(true);
  });

  it('deve mostrar a espera, emitir a regra e mostrar explicação e tentativas Quando o servidor sugere', async () => {
    const element = await render();
    await describeRule('Responda 429 para POST em /pagamentos');
    await (await suggestButton()).click();

    const call = await post();
    expect(call.request.body).toEqual({
      prompt: 'Responda 429 para POST em /pagamentos',
      lang: 'en',
    });
    await fixture.whenStable();
    // B4 (UX-42): a espera honesta, com o que o pedido costuma levar, o contador e o "Cancel".
    expect(text(progress(element))).toBe('Asking the local model. It usually takes about 5 s.');
    expect(element.querySelector('app-ai-wait .seconds')?.getAttribute('aria-hidden')).toBe('true');
    expect(await loader.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).toBeTruthy();
    expect(await suggestOff()).toBe(true);

    call.flush({ rule: rule(7), explanation: 'Responde **429**.', attempts: 2 });
    await vi.waitFor(() =>
      expect(element.querySelector('[role="region"][aria-label="Suggestion"]')).not.toBeNull(),
    );
    // A região da espera esvazia sem falar; quem fala é o foco no resumo.
    expect(text(progress(element))).toBe('');
    expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Cancel' }))).toEqual([]);
    const result = element.querySelector('[aria-label="Suggestion"]') as HTMLElement;
    expect(text(result)).toContain('Suggested in 2 attempts.');
    expect(result.querySelector('strong')?.textContent).toBe('429');
    // E-13: a proposta só entra quando o dono aplica.
    expect(suggested).toEqual([]);
    await expectNoAxeViolations(element);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Apply all' }))).click();
    expect(suggested).toEqual([{ rule: rule(7), conditionsOnly: false }]);
    expect(result.querySelector('.changes')).toBeNull();
    expect(text(result)).toContain('Suggested in 2 attempts.');
  });

  it('deve listar o que muda na regra do editor, aplicar só as condições ou descartar (E-13)', async () => {
    const element = await render();
    fixture.componentRef.setInput('current', rule(1));
    const proposta = rule(1, {
      match: { ...rule(1).match, headers: { 'x-tenant': { equals: 'acme' } } },
      response: { ...rule(1).response, status: 429, body: '{}' },
    });
    await describeRule('429 para acme');
    await (await suggestButton()).click();
    (await post()).flush({ rule: proposta, explanation: '', attempts: 1 });

    await vi.waitFor(() => expect(element.querySelector('.changes')).not.toBeNull());
    expect(
      [...element.querySelectorAll('.changes li')].map((li) => text(li as HTMLElement)),
    ).toEqual(['+ header x-tenant = acme', 'status 201 → 429', 'body changed']);
    await (
      await loader.getHarness(MatButtonHarness.with({ text: 'Apply conditions only' }))
    ).click();
    expect(suggested).toEqual([{ rule: proposta, conditionsOnly: true }]);

    // O mesmo pedido de novo: a sugestão guardada volta, sem outra chamada.
    await (await suggestButton()).click();
    await vi.waitFor(() => expect(element.querySelector('.changes')).not.toBeNull());
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Dismiss' }))).click();
    expect(element.querySelector('[aria-label="Suggestion"]')).toBeNull();
    expect(suggested).toHaveLength(1);
  });

  it('deve mandar o id da mensagem aberta Quando "use the open request as example" está marcado', async () => {
    const example = webhookRequest(3);
    await render(example);
    await describeRule('igual a esta');
    await (await loader.getHarness(MatCheckboxHarness)).check();
    await (await suggestButton()).click();

    const call = await post();
    expect(call.request.body).toEqual(
      expect.objectContaining({ prompt: 'igual a esta', request_id: example.uuid }),
    );
    call.flush({ rule: rule(1), explanation: '', attempts: 1 });
    await (
      await vi.waitFor(() => loader.getHarness(MatButtonHarness.with({ text: 'Apply all' })))
    ).click();
    expect(suggested).toHaveLength(1);
  });

  it('deve ter a caixa do exemplo desligada, dizendo o que falta, Quando não há mensagem aberta', async () => {
    const element = await render();

    const box = await loader.getHarness(MatCheckboxHarness);
    expect(await box.isDisabled()).toBe(true);
    const input = element.querySelector('mat-checkbox input') as HTMLInputElement;
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(text(element.querySelector('#suggest-no-example') as HTMLElement)).toBe(
      'Open a request in the Inbox to use it as example.',
    );
    await expectNoAxeViolations(element);
  });

  describe('Dado a conferência da sugestão (B4, UX-41)', () => {
    it('deve conferir a regra, dizer o que ela faz e o que uma regra não faz, e deixar "Apply all" como primário', async () => {
      const example = webhookRequest(3, { content: '{"status":"pago"}' });
      const element = await render(example);
      await describeRule('igual a esta');
      await (await loader.getHarness(MatCheckboxHarness)).check();
      await (await suggestButton()).click();
      (await post()).flush({
        rule: rule(7),
        explanation: 'Texto do **modelo**.',
        attempts: 1,
        check: { ...CHECK, example: { matches: true, failed: [], conditions: [] } },
      });
      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());

      const summary = element.querySelector('.summary') as HTMLElement;
      expect(text(summary)).toBe('Checked: matches the example and 7 of the last 34.');
      // Na chegada da sugestão, o foco vai para o resumo.
      await vi.waitFor(() => expect(document.activeElement).toBe(summary));
      expect(element.querySelector('.checks')?.getAttribute('aria-labelledby')).toBe(
        'suggestion-checks',
      );
      expect(text(element.querySelector('#suggestion-checks') as HTMLElement)).toBe(
        'Checks on this suggestion',
      );
      expect(checks(element).slice(0, 2)).toEqual([
        ['OK', 'Matches the example request.'],
        ['OK', 'Would match 7 of the last 34 requests.'],
      ]);
      const words = element.querySelector('[role=group][aria-label="Rule in words"]');
      expect(text(words as HTMLElement)).toMatch(/^When a POST to \/r7\b.*answer 207\.$/);
      expect(text(element.querySelector('.limits') as HTMLElement)).toBe(
        'A rule only chooses the answer to a request: status, headers, body, delay or a network fault. It does not send e-mail, write to a database or call another service.',
      );
      // O texto do modelo por último, recolhido e marcado como não conferido.
      const model = element.querySelector('details.model') as HTMLDetailsElement;
      expect(model.open).toBe(false);
      expect(text(model.querySelector('summary') as HTMLElement)).toBe('What the model wrote');
      expect(text(model.querySelector('.hint') as HTMLElement)).toBe(
        'Not checked. The rule above is what counts.',
      );
      expect(model.querySelector('strong')?.textContent).toBe('modelo');
      expect(actions(element)).toEqual([
        ['Dismiss', false],
        ['Apply conditions only', false],
        ['Apply all', true],
      ]);
      await expectNoAxeViolations(element);
    });

    it('deve contar os problemas, pôr "Dismiss" como primário e deixar aplicar mesmo assim', async () => {
      const example = webhookRequest(3, { content: '{"status":"pago"}' });
      const element = await render(example);
      await describeRule('Responder 202 para mensagens como esta');
      await (await loader.getHarness(MatCheckboxHarness)).check();
      await (await suggestButton()).click();
      (await post()).flush({
        rule: rule(7),
        explanation: '',
        attempts: 1,
        check: {
          example: {
            matches: false,
            failed: ['body $.status: expected "sucedido", got "pago"'],
            conditions: ['match.body.0'],
          },
          recent: { evaluated: 34, matched: 0 },
          warnings: [{ code: 'example_not_matched', message: 'x' }],
        },
      });
      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());

      expect(text(element.querySelector('.summary') as HTMLElement)).toBe(
        '2 problems found. Review before applying.',
      );
      expect(checks(element).slice(0, 2)).toEqual([
        [
          'Problem',
          'Does not match the example request: body $.status: expected "sucedido", got "pago"',
        ],
        ['Problem', 'Would match none of the last 34 requests.'],
      ]);
      expect(actions(element)).toEqual([
        ['Apply conditions only', false],
        ['Apply all', false],
        ['Dismiss', true],
      ]);
      const apply = await loader.getHarness(MatButtonHarness.with({ text: 'Apply all' }));
      expect(await apply.isDisabled()).toBe(false);
      await apply.click();
      expect(suggested).toEqual([{ rule: rule(7), conditionsOnly: false }]);
      await expectNoAxeViolations(element);
    });

    it('deve oferecer "Open the sequence assistant" Quando o pedido pede passos em sequência', async () => {
      const element = await render();
      await describeRule('falhe 3 vezes com 503 e depois responda 200');
      await (await suggestButton()).click();
      (await post()).flush({
        rule: rule(7),
        explanation: '',
        attempts: 1,
        check: { ...CHECK, warnings: [{ code: 'sequence_as_single_rule', message: 'x' }] },
      });
      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());

      expect(checks(element).at(-1)?.[1]).toContain(
        'You asked for steps in sequence. One rule cannot do that.',
      );
      expect(
        await loader.getHarness(MatButtonHarness.with({ text: 'Open the sequence assistant' })),
      ).toBeTruthy();
    });

    it('deve conferir o que consegue e pedir atenção Quando o servidor não manda a conferência', async () => {
      const element = await render();
      await describeRule('x');
      await (await suggestButton()).click();
      (await post()).flush({ rule: rule(7), explanation: '', attempts: 1 });
      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());

      expect(checks(element)[0]).toEqual(['Attention', 'Could not check against the history.']);
      expect(actions(element).at(-1)).toEqual(['Apply all', true]);
    });
  });

  describe('Dado a espera da IA (B4, UX-42)', () => {
    it('deve abortar o pedido e deixar a tela como antes Quando "Cancel"', async () => {
      const element = await render();
      await describeRule('x');
      await (await suggestButton()).click();
      const call = await post();

      await (await loader.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).click();

      expect(call.cancelled).toBe(true);
      await vi.waitFor(() =>
        expect(text(progress(element))).toBe('Cancelled. Nothing was changed.'),
      );
      expect(element.querySelector('[role=alert]')).toBeNull();
      expect(element.querySelector('[aria-label="Suggestion"]')).toBeNull();
      expect(await suggestOff()).toBe(false);
    });

    it('deve cancelar pelo Esc durante a espera', async () => {
      await render();
      await describeRule('x');
      await (await suggestButton()).click();
      const call = await post();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

      await vi.waitFor(() => expect(call.cancelled).toBe(true));
    });

    it('deve dizer uma vez que ainda espera Quando passa do dobro do costume', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const element = await render();
      await describeRule('x');
      await (await suggestButton()).click();
      const call = await post();

      await vi.advanceTimersByTimeAsync(9000);
      expect(text(progress(element))).toBe('Asking the local model. It usually takes about 5 s.');
      expect(text(element.querySelector('app-ai-wait .seconds') as HTMLElement)).toBe('9 s');
      await vi.advanceTimersByTimeAsync(1000);

      expect(text(progress(element))).toBe('Still waiting. It can take up to 90 s.');
      call.flush({ rule: rule(7), explanation: '', attempts: 1, check: CHECK });
    });

    it('deve pedir pelo Enter no campo, e quebrar a linha com Shift+Enter', async () => {
      const element = await render();
      await describeRule('Responda 429');
      const field = element.querySelector('textarea') as HTMLTextAreaElement;

      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }),
      );
      http.expectNone(URL_SUGGEST);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));

      (await post()).flush({ rule: rule(7), explanation: '', attempts: 1, check: CHECK });
    });

    it('deve mostrar a sugestão guardada, sem outro pedido, Quando o mesmo texto é pedido de novo', async () => {
      const element = await render();
      await describeRule('Responda 429');
      await (await suggestButton()).click();
      (await post()).flush({ rule: rule(7), explanation: '', attempts: 1, check: CHECK });
      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Dismiss' }))).click();

      await (await suggestButton()).click();

      await vi.waitFor(() => expect(element.querySelector('.checks')).not.toBeNull());
      http.expectNone(URL_SUGGEST);
      // Outro texto é outro pedido.
      await describeRule('Responda 503');
      await (await suggestButton()).click();
      (await post()).flush({ rule: rule(8), explanation: '', attempts: 1, check: CHECK });
    });

    it('deve segurar o "Suggest" com a contagem à vista Quando a IA responde 429 (UX-52)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const element = await render();
      await describeRule('x');
      await (await suggestButton()).click();
      (await post()).flush(
        { error: 'Too many' },
        { status: 429, statusText: 'Too Many', headers: { 'Retry-After': '3' } },
      );
      await vi.waitFor(() => expect(element.querySelector('[role=alert]')).not.toBeNull());

      expect(text(element.querySelector('[role=alert]') as HTMLElement)).toContain(
        'Try again in 3 s.',
      );
      const countdown = element.querySelector('.countdown') as HTMLElement;
      expect(text(countdown)).toBe('3 s');
      expect(countdown.getAttribute('aria-hidden')).toBe('true');
      expect(await suggestOff()).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);

      expect(element.querySelector('.countdown')).toBeNull();
      expect(await suggestOff()).toBe(false);
    });
  });

  it('deve mostrar os últimos erros e não emitir regra Quando o servidor responde 422', async () => {
    const element = await render();
    await describeRule('algo impossível');
    await (await suggestButton()).click();

    (await post()).flush(
      { error: 'No valid rule after 3 attempts', errors: { 'response.status': ['too big'] } },
      { status: 422, statusText: 'Unprocessable' },
    );
    await vi.waitFor(() => expect(element.querySelector('[role=alert]')).not.toBeNull());
    expect(
      [...element.querySelectorAll('[role=alert] li')].map((li) => li.textContent?.trim()),
    ).toEqual(['No valid rule after 3 attempts', 'response.status: too big']);
    // A lista continua lista para o leitor de tela: o alerta fica no contêiner em volta (E11).
    expect(element.querySelector('ul[role]')).toBeNull();
    await expectNoAxeViolations(element);
    expect(suggested).toEqual([]);
    expect(await suggestOff()).toBe(false);
  });

  it('deve desabilitar os controles com a dica de configuração Quando o servidor responde 503', async () => {
    const element = await render(webhookRequest(1));
    await describeRule('x');
    await (await suggestButton()).click();

    (await post()).flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Off' });
    await vi.waitFor(async () => expect(await suggestOff()).toBe(true));
    const textarea = await loader.getHarness(
      MatInputHarness.with({ selector: '[aria-label="Describe the rule"]' }),
    );
    expect(await textarea.isDisabled()).toBe(true);
    expect(await (await loader.getHarness(MatCheckboxHarness)).isDisabled()).toBe(true);
    // A razão à vista, sem o nome das variáveis, e o caminho para quem opera o servidor.
    const off = element.querySelector('#suggest-off') as HTMLElement;
    expect(text(off)).toBe('This server has no local AI. How to turn it on');
    expect(off.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/isdiegoalves/anzol#ia-local',
    );
    expect(element.textContent).not.toContain('WEBHOOK_AI');
    const button = element.querySelector('.actions button') as HTMLElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('suggest-off');
    await expectNoAxeViolations(element);
  });

  it('deve vir desligado desde o começo Quando a IA já respondeu 503 nesta sessão', async () => {
    sessionStorage.setItem('anzol.ai.off', '1');
    const element = await render();

    expect(await suggestOff()).toBe(true);
    expect(text(element.querySelector('#suggest-off') as HTMLElement)).toContain(
      'This server has no local AI.',
    );
  });

  it('deve lembrar que o caminho é relativo à URL e avisar Quando a descrição cita a URL inteira', async () => {
    const element = await render();

    expect(text(element.querySelector('mat-hint') as HTMLElement)).toBe(
      'Paths are relative to this URL (say /payments). Nothing is saved until you click Save.',
    );
    expect(element.querySelector('.note')).toBeNull();
    await describeRule(`POST em http://localhost:8084/${TOKEN_ID}/pagamentos responde 201`);
    fixture.detectChanges();

    expect(text(element.querySelector('.note') as HTMLElement)).toBe(
      `Your description mentions this URL. The rule's path is only what comes after /${TOKEN_ID}: describe it as /payments, not as the full URL.`,
    );
  });
});
