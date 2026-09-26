import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { outboundResult } from '../../testing/outbound-fixtures';
import { Preferences } from '../settings/preferences';
import { OutboundActions } from './outbound-actions';
import { OutboundPage } from './outbound-page';

describe('Dado a aba "Outbound" de uma URL', () => {
  const historyUrl = `/token/${TOKEN_ID}/outbound`;
  let fixture: ComponentFixture<OutboundPage>;
  let http: HttpTestingController;

  /** A resposta passa pelo `firstValueFrom` do serviço antes de chegar à tela. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const send = vi.fn();

  const render = async (history: object | null, init?: { status: number; statusText: string }) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OutboundActions, useValue: { send } },
      ],
    });
    TestBed.inject(Preferences).token.set(token());
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OutboundPage);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    await fixture.whenStable();
    http.expectOne(historyUrl).flush(history, init);
    await settle();
    return fixture.nativeElement as HTMLElement;
  };
  const rows = (element: HTMLElement) =>
    [...element.querySelectorAll('table[aria-label="Outbound history"] tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()),
    );

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve listar status, método, alvo, tipo e tempo, mais novo primeiro, Quando há histórico', async () => {
    const element = await render([
      outboundResult(2, { kind: 'send', method: 'PUT', status: 500, target: 'http://b/' }),
      outboundResult(1, {
        status: null,
        headers: null,
        body: null,
        error: { kind: 'timeout', message: 'no answer in 10 s' },
        target: 'http://a/',
      }),
    ]);

    expect(rows(element).map((row) => row.slice(0, 5))).toEqual([
      ['500', 'PUT', 'http://b/', 'Send', '12 ms'],
      ['Timed out', 'POST', 'http://a/', 'Replay', '12 ms'],
    ]);
    expect(rows(element)[0][5]).toMatch(/ago$/);
  });

  it('deve abrir o mais novo com headers enviados e recebidos e o corpo Quando a aba carrega', async () => {
    const element = await render([
      outboundResult(2, { request_headers: { 'x-sent': 'ida' }, body: '{"v":2}' }),
      outboundResult(1),
    ]);

    const detail = element.querySelector('section[aria-label="Outbound detail"]');
    expect(detail?.querySelector('table[aria-label="Sent headers"]')?.textContent).toContain(
      'x-sent',
    );
    expect(detail?.querySelector('table[aria-label="Response headers"]')?.textContent).toContain(
      'x-app',
    );
    expect(detail?.querySelector('pre.body')?.textContent).toBe('{"v":2}');
  });

  it('deve trocar o detalhe Quando outra linha é clicada', async () => {
    const element = await render([
      outboundResult(2, { body: 'dois' }),
      outboundResult(1, { body: 'um' }),
    ]);

    element.querySelector<HTMLElement>('tr[data-outbound-id="out-1"]')?.click();
    await settle();

    expect(element.querySelector('pre.body')?.textContent).toBe('um');
    expect(
      element.querySelector('tr[data-outbound-id="out-1"]')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('deve dizer como enviar Quando o histórico está vazio', async () => {
    const element = await render([]);

    expect(rows(element)).toEqual([
      ['Nothing sent yet. Use Replay on a request, or Send in the top bar.'],
    ]);
    expect(element.querySelector('section[aria-label="Outbound detail"]')).toBeNull();
  });

  it('deve avisar Quando a URL não existe mais', async () => {
    const element = await render(null, { status: 404, statusText: 'Not Found' });

    expect(element.querySelector('[role=alert]')?.textContent).toBe(
      'This URL no longer exists (404).',
    );
  });

  it('deve abrir o Send da URL Quando "Send…" é clicado', async () => {
    const element = await render([]);

    [...element.querySelectorAll('button')].find((b) => b.textContent?.includes('Send'))?.click();

    expect(send).toHaveBeenCalledWith();
  });
});
