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
import { Rule } from './rule';
import { AI_WAIT_HINT } from '../ai/ai-client';
import { RuleSuggest } from './rule-suggest';

const URL_SUGGEST = `/token/${TOKEN_ID}/rules/suggest`;

describe('Dado o "Describe the rule"', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleSuggest>;
  let loader: HarnessLoader;
  let suggested: Rule[];

  const render = async (example?: WebhookRequest) => {
    fixture = TestBed.createComponent(RuleSuggest);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('example', example);
    suggested = [];
    fixture.componentInstance.suggested.subscribe((value) => suggested.push(value));
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
  const post = () => vi.waitFor(() => http.expectOne({ method: 'POST', url: URL_SUGGEST }));
  const text = (element: HTMLElement) => element.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve vir recolhido e abrir pelo título (RULES-16)', async () => {
    const element = await render();

    const details = element.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    (element.querySelector('summary') as HTMLElement).click();
    expect(details.open).toBe(true);
  });

  it('deve ficar desabilitado Quando a descrição está vazia', async () => {
    await render();

    expect(await (await suggestButton()).isDisabled()).toBe(true);
    await describeRule('   ');
    expect(await (await suggestButton()).isDisabled()).toBe(true);
  });

  it('deve mostrar a espera, emitir a regra e mostrar explicação e tentativas Quando o servidor sugere', async () => {
    const element = await render();
    await describeRule('Responda 429 para POST em /pagamentos');
    await (await suggestButton()).click();

    const call = await post();
    expect(call.request.body).toEqual({
      prompt: 'Responda 429 para POST em /pagamentos',
      lang: navigator.language,
    });
    await fixture.whenStable();
    expect(text(element.querySelector('.wait[role=status]') as HTMLElement)).toBe(AI_WAIT_HINT);
    expect(await (await suggestButton()).isDisabled()).toBe(true);

    call.flush({ rule: rule(7), explanation: 'Responde **429**.', attempts: 2 });
    await vi.waitFor(() => expect(suggested).toEqual([rule(7)]));
    await fixture.whenStable();
    expect(element.querySelector('.wait')).toBeNull();
    const result = element.querySelector('[aria-label="Suggestion"]') as HTMLElement;
    expect(text(result)).toContain('Suggested in 2 attempts.');
    expect(result.querySelector('strong')?.textContent).toBe('429');
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
    await vi.waitFor(() => expect(suggested).toHaveLength(1));
  });

  it('deve não oferecer o exemplo Quando não há mensagem aberta', async () => {
    await render();

    expect(await loader.getAllHarnesses(MatCheckboxHarness)).toHaveLength(0);
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
    expect(await (await suggestButton()).isDisabled()).toBe(false);
  });

  it('deve desabilitar os controles com a dica de configuração Quando o servidor responde 503', async () => {
    const element = await render(webhookRequest(1));
    await describeRule('x');
    await (await suggestButton()).click();

    (await post()).flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Off' });
    await vi.waitFor(async () => expect(await (await suggestButton()).isDisabled()).toBe(true));
    const textarea = await loader.getHarness(
      MatInputHarness.with({ selector: '[aria-label="Describe the rule"]' }),
    );
    expect(await textarea.isDisabled()).toBe(true);
    expect(await (await loader.getHarness(MatCheckboxHarness)).isDisabled()).toBe(true);
    expect(text(element.querySelector('mat-hint') as HTMLElement)).toBe(
      'Set WEBHOOK_AI_* to enable',
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
