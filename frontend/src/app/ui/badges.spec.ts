import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { LiveState, LiveStatus } from './live-status';
import { MethodBadge } from './method-badge';
import { StatusCode } from './status-code';

describe('Dado o selo do método (app-method-badge)', () => {
  it.each([
    ['GET', 'success'],
    ['POST', 'info'],
    ['DELETE', 'danger'],
    ['PUT', 'primary'],
    ['HEAD', 'primary'],
    ['PATCH', 'warning'],
    ['OPTIONS', 'default'],
  ])('deve mostrar %s com o papel de cor %s e passar no axe', async (method, tone) => {
    const { container } = await render(MethodBadge, { inputs: { method } });

    expect(screen.getByText(method)).toBeTruthy();
    expect((container as HTMLElement).classList).toContain(tone);
    await expectNoAxeViolations(container);
  });
});

describe('Dado o status de uma resposta (app-status-code)', () => {
  it.each([
    [200, '200', 'OK', 's2'],
    [301, '301', 'Moved Permanently', 's3'],
    [422, '422', 'Unprocessable Content', 's4'],
    [503, '503', 'Service Unavailable', 's5'],
    [299, '299', null, 's2'],
  ])(
    'deve mostrar %i com a frase e a família e passar no axe',
    async (status, code, reason, family) => {
      const { container } = await render(StatusCode, { inputs: { status } });

      expect(screen.getByText(code)).toBeTruthy();
      if (reason) {
        expect(screen.getByText(reason)).toBeTruthy();
      }
      expect((container as HTMLElement).classList).toContain(family);
      await expectNoAxeViolations(container);
    },
  );

  it('deve separar o número da frase no texto (o leitor de tela não lê "503Service")', async () => {
    const { container } = await render(StatusCode, { inputs: { status: 503 } });

    expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe('503 Service Unavailable');
  });

  it('deve mostrar o erro de saída Quando não houve status', async () => {
    const { container } = await render(StatusCode, {
      inputs: { status: null, error: 'Connection failed' },
    });

    expect(screen.getByText('Connection failed')).toBeTruthy();
    expect((container as HTMLElement).classList).toContain('failed');
    await expectNoAxeViolations(container);
  });
});

describe('Dado o chip do tempo real (app-live-status)', () => {
  it.each([
    ['live', 'Live'],
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['offline', 'Offline'],
  ] as [LiveState, string][])(
    'deve mostrar "%s" sem ser região viva e passar no axe',
    async (state, text) => {
      const { container } = await render(LiveStatus, { inputs: { state } });

      expect(container.textContent?.trim()).toBe(text);
      // Abrir outra URL passa por "Connecting…": a queda e a volta, quem fala é a faixa "Connection".
      expect(screen.queryByRole('status')).toBeNull();
      expect((container as HTMLElement).classList).toContain(state);
      await expectNoAxeViolations(container);
    },
  );
});
