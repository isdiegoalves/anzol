import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { Preferences } from '../settings/preferences';
import { Onboarding, testPayload } from './onboarding';

const TOKEN_ID = '3dbd68f4-8890-4f56-affb-c7c9b297e666';
const URL = `http://localhost:4200/${TOKEN_ID}`;

describe('Dado o onboarding "Your URL is ready"', () => {
  const renderWith = (missing: string | null = null) =>
    render(Onboarding, {
      providers: [provideRouter([])],
      inputs: { url: URL, tokenId: TOKEN_ID, missing },
    });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('deve mostrar a URL com Copy e "Open in new tab", os destinos da URL e passar no axe', async () => {
    const { container, fixture } = await renderWith();
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);
    const pronta = screen.getByRole('region', { name: 'Your URL is ready' });

    expect(pronta.textContent).toContain(URL);
    expect(within(pronta).getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(
      URL,
    );
    await userEvent.click(within(pronta).getByRole('button', { name: 'Copy URL' }));
    expect(copy).toHaveBeenCalledWith(URL);
    for (const destino of ['rules', 'checks', 'outbound']) {
      expect(container.querySelector(`a.card[href="/${TOKEN_ID}/${destino}"]`)).not.toBeNull();
    }
    await expectNoAxeViolations(container);
  });

  it('deve mostrar o comando do CLI com o token Quando a aba CLI é escolhida', async () => {
    await renderWith();

    await userEvent.click(screen.getByRole('tab', { name: 'CLI' }));

    expect(screen.getByRole('tabpanel').textContent).toContain(
      `webhook listen --server http://localhost:4200 --forward http://localhost:3000 --token ${TOKEN_ID}`,
    );
  });

  it('deve alternar hideTutorial Quando "Close" é clicado', async () => {
    await renderWith();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(TestBed.inject(Preferences).hideTutorial()).toBe(true);
  });

  it('deve mandar um POST com JSON para a URL e dizer o status Quando "Send a test request" é clicado', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
    await renderWith();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test request' }));

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toMatchObject({ event: 'test' });
    expect(await screen.findByText(/The URL answered 200/)).toBeTruthy();
  });

  it('deve dizer que não conseguiu mandar Quando a rede falha', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWith();

    await userEvent.click(screen.getByRole('button', { name: 'Send a test request' }));

    expect(await screen.findByText(/Could not send the test request/)).toBeTruthy();
  });

  it('deve dizer qual URL não existia mais Quando a tela criou esta no lugar dela', async () => {
    const antiga = '11111111-1111-4111-8111-111111111111';
    await renderWith(antiga);

    expect(screen.getByText(/doesn't exist anymore/).textContent).toContain(
      `The URL ${antiga} doesn't exist anymore`,
    );
  });

  it('deve montar o corpo de teste como JSON', () => {
    expect(JSON.parse(testPayload(new Date('2026-09-26T12:00:00Z')))).toEqual({
      event: 'test',
      message: 'Hello from Webhook Tester',
      sent_at: '2026-09-26T12:00:00.000Z',
    });
  });

  it('deve explicar o que é um webhook na própria tela, sem link externo', async () => {
    const { container } = await renderWith();

    await userEvent.click(screen.getByText('What is a webhook?'));

    const details = container.querySelector('details.about') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('A webhook is an HTTP request');
    expect(container.querySelector('a[href^="http"]:not([href*="localhost"])')).toBeNull();
  });
});
