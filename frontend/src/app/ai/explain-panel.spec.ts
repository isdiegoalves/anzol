import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { AI_WAIT_HINT } from './ai-client';
import { ExplainPanel } from './explain-panel';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const URL_EXPLAIN = `/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`;

describe('Dado o painel do "Explain"', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ExplainPanel>;

  const render = async () => {
    fixture = TestBed.createComponent(ExplainPanel);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('requestId', REQUEST_ID);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const explain = () => http.expectOne({ method: 'POST', url: URL_EXPLAIN });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve pedir o diagnóstico ao abrir, avisar da espera e mostrar o markdown Quando o servidor responde', async () => {
    const element = await render();

    const call = explain();
    expect(call.request.body).toEqual({ lang: navigator.language });
    expect(element.querySelector('[role=status]')?.textContent?.trim()).toBe(AI_WAIT_HINT);

    call.flush({ explanation: 'A assinatura **não confere**:\n\n- header `X-Sig`', facts: {} });
    await vi.waitFor(() => expect(element.querySelector('app-markdown')).not.toBeNull());
    expect(element.querySelector('[role=status]')).toBeNull();
    expect(element.querySelector('app-markdown strong')?.textContent).toBe('não confere');
    expect(element.querySelector('app-markdown li code')?.textContent).toBe('X-Sig');
  });

  it('deve mostrar o erro e tentar de novo Quando o modelo não responde (502)', async () => {
    const element = await render();
    explain().flush({ error: 'timeout' }, { status: 502, statusText: 'Bad Gateway' });
    await vi.waitFor(() => expect(element.querySelector('[role=alert]')).not.toBeNull());
    expect(element.querySelector('[role=alert]')?.textContent).toContain(
      'The local model did not answer: timeout',
    );

    const loader = TestbedHarnessEnvironment.loader(fixture);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Try again' }))).click();
    explain().flush({ explanation: 'ok' });
    await vi.waitFor(() => expect(element.querySelector('app-markdown')?.textContent).toBe('ok'));
    expect(element.querySelector('[role=alert]')).toBeNull();
  });

  it('deve dar a dica de configuração, sem "Try again", Quando a IA está desligada (503)', async () => {
    const element = await render();
    explain().flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Off' });

    await vi.waitFor(() =>
      expect(element.querySelector('[role=alert]')?.textContent).toContain(
        'Set WEBHOOK_AI_* to enable',
      ),
    );
    const loader = TestbedHarnessEnvironment.loader(fixture);
    expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Try again' }))).toHaveLength(
      0,
    );
  });
});
