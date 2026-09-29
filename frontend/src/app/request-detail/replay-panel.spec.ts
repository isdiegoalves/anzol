import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { ChaosResult, OutboundResult } from '../outbound/outbound';
import { WebhookRequest } from '../requests/webhook-request';
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
  const show = async (shown: WebhookRequest = request) => {
    const view = await render(ReplayPanel, {
      inputs: { request: shown },
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

  describe('Dado "Inject failure"', () => {
    const falhas = () => screen.queryByRole('group', { name: 'Failures to inject' });
    const ligar = async () =>
      userEvent.click(screen.getByRole('switch', { name: 'Inject failure' }));
    const reenviar = async (http: HttpTestingController) => {
      await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
      return http.expectOne({ method: 'POST', url: replayUrl });
    };
    const caos = (fields: Partial<ChaosResult>): ChaosResult => ({
      delay_ms: 0,
      duplicate: false,
      abort_mid_body: false,
      slow_body_bps: null,
      timeout_ms: null,
      injected: [],
      body_bytes_sent: null,
      duplicate_result: null,
      ...fields,
    });

    beforeEach(() =>
      localStorage.setItem('replayTargets', JSON.stringify({ [TOKEN_ID]: 'http://app.local' })),
    );

    it('deve vir desligado, sem as falhas à vista, e reenviar sem chaos', async () => {
      const { http } = await show();

      expect(
        (screen.getByRole('switch', { name: 'Inject failure' }) as HTMLInputElement).checked,
      ).toBe(false);
      expect(falhas()).toBeNull();
      const call = await reenviar(http);

      expect(call.request.body).not.toHaveProperty('chaos');
    });

    it('deve mandar só as falhas preenchidas e dizer o que foi injetado e o que o app respondeu', async () => {
      const { http, panel, container } = await show();

      await ligar();
      const grupo = falhas() as HTMLElement;
      await userEvent.type(
        within(grupo).getByRole('spinbutton', { name: 'Delay before sending (ms)' }),
        '300',
      );
      await userEvent.click(within(grupo).getByRole('checkbox', { name: 'Send twice' }));
      await expectNoAxeViolations(container);
      const call = await reenviar(http);

      expect(call.request.body).toEqual({
        url: 'http://app.local',
        keep_path: true,
        timeout: 10_000,
        chaos: { delay_ms: 300, duplicate: true },
      });
      call.flush(
        result({
          status: 201,
          body: '{"ok":true}',
          chaos: caos({
            delay_ms: 300,
            duplicate: true,
            injected: ['delay_ms', 'duplicate'],
            duplicate_result: { status: 409, duration_ms: 4, error: null },
          }),
        }),
      );
      await vi.waitFor(() =>
        expect(panel.result()).toBe(
          'Replay result: 201 Created in 12 ms. Injected: delay 300 ms, sent twice (second: 409 Conflict). {"ok":true}',
        ),
      );
    });

    it('deve mandar corpo lento, corte e desistência', async () => {
      const { http } = await show();

      await ligar();
      const grupo = falhas() as HTMLElement;
      await userEvent.type(
        within(grupo).getByRole('spinbutton', { name: 'Slow body (bytes/s)' }),
        '100',
      );
      await userEvent.click(within(grupo).getByRole('checkbox', { name: 'Cut the body in half' }));
      await userEvent.type(
        within(grupo).getByRole('spinbutton', { name: 'Give up after (ms)' }),
        '500',
      );
      const call = await reenviar(http);

      expect((call.request.body as { chaos: unknown }).chaos).toEqual({
        abort_mid_body: true,
        slow_body_bps: 100,
        timeout_ms: 500,
      });
    });

    it.each<[string, Partial<OutboundResult>, string]>([
      [
        'o corpo foi cortado',
        {
          chaos: caos({ abort_mid_body: true, injected: ['abort_mid_body'], body_bytes_sent: 18 }),
        },
        'Replay result: no answer read. Injected: body cut after 18 bytes.',
      ],
      [
        'o Anzol desistiu de esperar',
        { chaos: caos({ timeout_ms: 500, injected: ['timeout_ms'] }) },
        'Replay result: no answer read. Injected: gave up after 500 ms.',
      ],
      [
        'nada foi injetado (o app respondeu antes do prazo)',
        { status: 200, chaos: caos({ timeout_ms: 5000 }) },
        'Replay result: 200 OK in 12 ms',
      ],
      [
        'o destino foi recusado',
        { error: { kind: 'blocked', message: 'private' }, chaos: caos({ delay_ms: 3000 }) },
        'Replay did not get an answer: Blocked: this server only sends to public addresses.',
      ],
    ])('deve dizer o resultado Quando %s', async (_caso, overrides, texto) => {
      const { http, panel } = await show();

      await ligar();
      (await reenviar(http)).flush(result(overrides));

      await vi.waitFor(() => expect(panel.result()).toBe(texto));
    });

    it('deve desabilitar o corte e dizer por quê Quando a mensagem não tem corpo', async () => {
      const { container } = await show(webhookRequest(4, { method: 'GET', content: '' }));

      await ligar();
      const grupo = falhas() as HTMLElement;
      const corte = within(grupo).getByRole('checkbox', { name: 'Cut the body in half' });

      expect((corte as HTMLInputElement).disabled).toBe(true);
      expect(corte.getAttribute('aria-describedby')).toBeTruthy();
      expect(
        container.querySelector(`#${corte.getAttribute('aria-describedby') ?? ''}`)?.textContent,
      ).toContain('This request has no body.');
      await expectNoAxeViolations(container);
    });

    it('deve dizer o resultado em pt-BR', async () => {
      loadTranslations(translations);
      try {
        const { http, panel } = await show();

        await userEvent.click(screen.getByRole('switch', { name: 'Injetar falha' }));
        await userEvent.click(screen.getByRole('button', { name: 'Reenviar' }));
        http.expectOne(replayUrl).flush(
          result({
            status: 201,
            chaos: caos({
              delay_ms: 300,
              duplicate: true,
              injected: ['delay_ms', 'duplicate'],
              duplicate_result: { status: null, duration_ms: 4, error: null },
            }),
          }),
        );

        await vi.waitFor(() =>
          expect(panel.result()).toBe(
            'Resultado do reenvio: 201 Created em 12 ms. Injetado: atraso de 300 ms, enviada duas vezes (segunda: nenhuma resposta lida).',
          ),
        );
      } finally {
        clearTranslations();
      }
    });
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
