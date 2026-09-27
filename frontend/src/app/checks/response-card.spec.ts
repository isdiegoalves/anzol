import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { expectPut, renderCard } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { ResponseCard } from './response-card';

const SALVA = token({
  default_status: 202,
  default_content_type: 'application/json',
  timeout: 2,
  default_content: 'antes',
  retry_after: 30,
  auto_cleanup: 500,
  signature: { provider: 'github', secret: '••••1234' },
  schema: { type: 'object' },
});

const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save response' });

describe('Dado o cartão "Response" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve vir com a resposta salva e a limpeza marcada, e passar no axe', async () => {
    const { container } = await renderCard(ResponseCard, SALVA);

    expect(box('Default status code').value).toBe('202');
    expect(box('Content Type').value).toBe('application/json');
    expect(box('Response body').value).toBe('antes');
    expect(box('Retry-After').value).toBe('30');
    expect(
      (screen.getByRole('spinbutton', { name: 'Timeout before response' }) as HTMLInputElement)
        .value,
    ).toBe('2');
    const cleanup = screen.getByRole('radiogroup', { name: 'Auto cleanup' });
    expect(
      within(cleanup)
        .getAllByRole('radio')
        .map((r) => r.textContent?.trim()),
    ).toEqual(['Disabled', '500', '1000', '5000', '10000']);
    expect(within(cleanup).getByRole('radio', { name: '500' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByText(/^Keeps the 500 most recent requests/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve mandar a resposta com a assinatura e o schema salvos (CA-11) Quando Save response é clicado', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '201');
    await userEvent.clear(box('Retry-After'));
    await userEvent.click(screen.getByRole('radio', { name: 'Disabled' }));
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toEqual({
      default_status: '201',
      default_content_type: 'application/json',
      timeout: '2',
      default_content: 'antes',
      retry_after: null,
      auto_cleanup: null,
      signature: { provider: 'github', secret: '••••1234' },
      schema: { type: 'object' },
    });
    put.flush({ ...SALVA, default_status: 201, retry_after: null, auto_cleanup: null });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent?.trim()).toBe('Saved.'));
  });

  it.each([
    [
      'o timeout',
      'spinbutton',
      'Timeout before response',
      '11',
      'To save, fix: Timeout before response',
    ],
    ['o Retry-After', 'textbox', 'Retry-After', 'amanhã', 'To save, fix: Retry-After'],
  ] as const)(
    'deve dizer o que corrigir e focar o campo Quando %s é inválido',
    async (_c, role, name, valor, resumo) => {
      const { http } = await renderCard(ResponseCard, SALVA);
      const input = screen.getByRole(role, { name });

      await userEvent.clear(input);
      await userEvent.type(input, valor);
      await userEvent.click(save());

      expect(screen.getByRole('alert').textContent?.trim()).toBe(resumo);
      expect(document.activeElement).toBe(input);
      http.expectNone((sent) => sent.method === 'PUT');
    },
  );

  it('deve ligar o CORS na hora, sem Save, Quando o switch é clicado', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.click(screen.getByRole('switch', { name: 'Enable CORS' }));

    const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`));
    expect(call.request.method).toBe('PUT');
    call.flush({ enabled: true });
    await vi.waitFor(() => expect(TestBed.inject(Preferences).token()?.cors).toBe(true));
    http.expectNone(`/token/${TOKEN_ID}`);
  });
});
