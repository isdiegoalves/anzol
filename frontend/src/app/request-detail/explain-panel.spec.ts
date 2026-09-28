import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subject } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { ExplainPanel, Explanations, whatTheChecksSay } from './explain-panel';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const URL_EXPLAIN = `/token/${TOKEN_ID}/request/${REQUEST_ID}/explain`;

describe('Dado o painel do "Explain"', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ExplainPanel>;

  const render = async (requestId = REQUEST_ID) => {
    fixture = TestBed.createComponent(ExplainPanel);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('requestId', requestId);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const explain = () => http.expectOne({ method: 'POST', url: URL_EXPLAIN });
  /** A região viva da espera, sem nome, dentro do `group "AI progress"` (§4.3). */
  const progress = () =>
    within(screen.getByRole('group', { name: 'AI progress' })).getByRole('status');
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('deve nascer com a região da espera vazia, dizer a espera e depois "Explanation ready."', async () => {
    fixture = TestBed.createComponent(ExplainPanel);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    fixture.componentRef.setInput('requestId', REQUEST_ID);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const element = fixture.nativeElement as HTMLElement;

    // Região criada já com o texto não é anunciada: a frase entra depois.
    expect(progress().textContent).toBe('');
    const call = explain();
    expect(call.request.body).toEqual({ lang: 'en' });
    await vi.waitFor(() =>
      expect(progress().textContent).toBe('Asking the local model. It usually takes about 9 s.'),
    );
    expect(element.textContent).not.toContain('~30 s');
    await expectNoAxeViolations(element);

    call.flush({ explanation: 'A assinatura **não confere**:\n\n- header `X-Sig`', facts: {} });
    await vi.waitFor(() => expect(element.querySelector('app-markdown')).not.toBeNull());
    expect(progress().textContent).toBe('Explanation ready.');
    expect(element.querySelector('app-markdown strong')?.textContent).toBe('não confere');
    expect(element.querySelector('app-markdown li code')?.textContent).toBe('X-Sig');
    expect(
      Object.keys(sessionStorage).filter((k) => k.startsWith(`anzol.ai.${TOKEN_ID}.`)),
    ).toEqual([`anzol.ai.${TOKEN_ID}.${REQUEST_ID}.en`]);
  });

  it('deve mostrar a explicação guardada na hora, sem pedir, e pedir outra por "Ask again"', async () => {
    sessionStorage.setItem(
      `anzol.ai.${TOKEN_ID}.${REQUEST_ID}.en`,
      JSON.stringify({
        explanation: 'guardada',
        answeredAt: new Date(2026, 8, 28, 21, 31).getTime(),
        seconds: 8.8,
      }),
    );

    const element = await render();

    http.expectNone(URL_EXPLAIN);
    expect(text(element.querySelector('app-markdown'))).toBe('guardada');
    expect(text(element.querySelector('.answered'))).toContain('Answered at 21:31, in 8.8 s.');
    expect(progress().textContent).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    explain().flush({ explanation: 'outra' });
    await vi.waitFor(() => expect(text(element.querySelector('app-markdown'))).toBe('outra'));
  });

  it('não deve cancelar o pedido Quando o painel some, e deve avisar com "Open" Quando a explicação chega', async () => {
    await render();
    const call = explain();
    const action = new Subject<void>();
    const open = vi
      .spyOn(TestBed.inject(MatSnackBar), 'open')
      .mockReturnValue({ onAction: () => action } as unknown as ReturnType<MatSnackBar['open']>);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.destroy();
    expect(call.cancelled).toBe(false);
    call.flush({ explanation: 'pronta' });

    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        'Explanation for #00000 is ready.',
        'Open',
        expect.anything(),
      ),
    );
    action.next();
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, REQUEST_ID, 1]);
    expect(TestBed.inject(Explanations).wanted()).toBe(REQUEST_ID);
    // Reaberto, o painel mostra a guardada e o pedido de abrir está atendido.
    const element = await render();
    expect(text(element.querySelector('app-markdown'))).toBe('pronta');
    expect(TestBed.inject(Explanations).wanted()).toBeNull();
  });

  it('não deve avisar por snackbar Quando a explicação chega com o painel à vista', async () => {
    const element = await render();
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    explain().flush({ explanation: 'ok' });

    await vi.waitFor(() => expect(text(element.querySelector('app-markdown'))).toBe('ok'));
    expect(open).not.toHaveBeenCalled();
  });

  it('deve abortar o pedido, dizer que cancelou e oferecer "Ask again" Quando "Cancel" é clicado', async () => {
    await render();
    const call = explain();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(call.cancelled).toBe(true);
    await vi.waitFor(() => expect(progress().textContent).toBe('Cancelled. Nothing was changed.'));
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    explain().flush({ explanation: 'ok' });
  });

  it('deve mostrar o erro e tentar de novo Quando o modelo não responde (502)', async () => {
    const element = await render();
    explain().flush({ error: 'timeout' }, { status: 502, statusText: 'Bad Gateway' });
    await vi.waitFor(() => expect(element.querySelector('[role=alert]')).not.toBeNull());
    expect(element.querySelector('[role=alert]')?.textContent).toContain(
      'The local model did not answer: timeout',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    explain().flush({ explanation: 'ok' });
    await vi.waitFor(() => expect(element.querySelector('app-markdown')?.textContent).toBe('ok'));
    expect(element.querySelector('[role=alert]')).toBeNull();
  });

  it('deve dizer que o servidor não tem IA, com o link de como ligar e sem "Try again" (503)', async () => {
    const element = await render();
    explain().flush({ error: 'AI is not configured' }, { status: 503, statusText: 'Off' });

    await vi.waitFor(() =>
      expect(text(element.querySelector('.off'))).toContain('This server has no local AI.'),
    );
    expect(screen.getByRole('link', { name: 'How to turn it on' }).getAttribute('href')).toContain(
      '#ia-local',
    );
    expect(element.textContent).not.toMatch(/WEBHOOK_AI|docker/);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('deve dizer o que as verificações gravaram, sem a IA, antes da explicação do modelo', async () => {
    const request = webhookRequest(1, {
      signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
      schema: null,
      rule: null,
      response: { status: 429 },
    });
    const loaded = TestBed.inject(RequestStore).load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([request]));
    await loaded;
    sessionStorage.setItem('anzol.ai.off', '1');

    const element = await render(request.uuid);

    const headings = [...element.querySelectorAll('h4')].map((h) => text(h));
    expect(headings).toEqual(['What the checks say', 'Explanation by the local model']);
    expect([...element.querySelectorAll('.checks li')].map((li) => text(li))).toEqual(
      whatTheChecksSay(request),
    );
    expect(whatTheChecksSay(request)).toEqual([
      'Signature invalid: signature mismatch',
      'Schema not checked: This URL did not validate a schema',
      'Default response: No rule answered',
      'Answered 429 with the default response.',
    ]);
  });
});
