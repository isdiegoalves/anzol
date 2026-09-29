import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { OutboundResult } from '../outbound/outbound';
import { ActionPanelStore } from './action-panel-store';
import { ReplayPanel, withScheme } from './replay-panel';

describe('Dado o destino do Replay', () => {
  it.each([
    ['localhost:3000/hooks', 'http://localhost:3000/hooks'],
    ['  https://api.loja.dev ', 'https://api.loja.dev'],
    ['HTTP://x', 'HTTP://x'],
    ['', ''],
  ])('deve pôr o esquema só quando falta ("%s")', (typed, url) => {
    expect(withScheme(typed)).toBe(url);
  });
});

describe('Dado a aba Replay do painel de ação', () => {
  const request = webhookRequest(3, { url: `http://localhost:8084/${TOKEN_ID}/pedidos?x=1` });
  const replayUrl = `/token/${TOKEN_ID}/request/${request.uuid}/replay`;
  const show = async () => {
    const view = await render(ReplayPanel, {
      inputs: { request },
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      ...view,
      http: TestBed.inject(HttpTestingController),
      panel: TestBed.inject(ActionPanelStore),
    };
  };
  const result = (overrides: Partial<OutboundResult>): OutboundResult => ({
    id: 'o1',
    kind: 'replay',
    at: '2026-09-28 10:00:00',
    target: 'http://localhost:3000/hooks',
    method: 'POST',
    request_headers: {},
    duration_ms: 12,
    ...overrides,
  });
  const target = () => screen.getByRole('textbox', { name: 'Target URL' });

  afterEach(() => localStorage.clear());

  it('deve aceitar o destino sem http://, mostrar para onde manda e reenviar com Enter', async () => {
    const { http, panel, container } = await show();

    await userEvent.type(target(), 'localhost:3000/hooks');
    expect(screen.getByText(/Sends to/).textContent).toContain(
      'http://localhost:3000/hooks/pedidos?x=1',
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Keep path and query' }));
    expect(screen.getByText(/Sends to/).textContent).toContain('http://localhost:3000/hooks');
    await expectNoAxeViolations(container);
    await userEvent.type(target(), '{Enter}');

    const call = http.expectOne({ method: 'POST', url: replayUrl });
    expect(call.request.body).toEqual({
      url: 'http://localhost:3000/hooks',
      keep_path: false,
      timeout: 10_000,
    });
    expect(screen.getByRole('button', { name: 'Replaying…' })).toBeTruthy();
    call.flush(result({ status: 201, body: '{"ok":true}' }));

    await vi.waitFor(() =>
      expect(panel.result()).toBe('Replay result: 201 Created in 12 ms. {"ok":true}'),
    );
    expect(JSON.parse(localStorage.getItem('replayTargets') ?? '{}')).toEqual({
      [TOKEN_ID]: 'http://localhost:3000/hooks',
    });
  });

  it('deve dizer como o servidor chega ao endereço digitado Quando ele o troca', async () => {
    const { http, fixture } = await show();

    await userEvent.type(target(), 'localhost:3000{Enter}');
    http
      .expectOne(replayUrl)
      .flush(result({ status: 200, target: 'http://host.docker.internal:3000/pedidos?x=1' }));
    await fixture.whenStable();

    await vi.waitFor(() =>
      expect(
        screen.getByText(
          'You typed localhost:3000. The server reaches it as host.docker.internal:3000.',
        ),
      ).toBeTruthy(),
    );
  });

  it('deve dizer que o destino foi bloqueado, sem instrução de operador', async () => {
    const { http, panel } = await show();

    await userEvent.type(target(), '10.0.0.8{Enter}');
    http.expectOne(replayUrl).flush(result({ error: { kind: 'blocked', message: 'private' } }));

    await vi.waitFor(() =>
      expect(panel.result()).toBe(
        'Replay did not get an answer: Blocked: this server only sends to public addresses.',
      ),
    );
  });

  it('não deve mandar sem destino, e deve dizer o que falta', async () => {
    const { http } = await show();

    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(screen.getByRole('alert').textContent).toContain(
      'The target must be an http:// or https:// address.',
    );
    http.expectNone(replayUrl);
  });

  it('deve começar com o último destino desta URL, o mesmo que a Saída lembra', async () => {
    localStorage.setItem('replayTargets', JSON.stringify({ [TOKEN_ID]: 'http://api.loja.dev' }));

    await show();

    expect((target() as HTMLInputElement).value).toBe('http://api.loja.dev');
    expect(screen.getByRole('link', { name: 'Open in Outbound' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/outbound`,
    );
  });
});
