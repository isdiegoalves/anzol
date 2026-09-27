import { screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { expectPut, renderCard } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { PrivacyCard } from './privacy-card';

const NO_CONTENT = { status: 204, statusText: 'No Content' };
const toggle = () => screen.getByRole('switch', { name: 'Require a secret to view this URL' });
const save = () => screen.getByRole('button', { name: 'Save privacy' });

describe('Dado o cartão "Privacy" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve proteger com o segredo, manter o resto da URL e destrancar esta tela Quando o segredo é definido', async () => {
    const { container, http } = await renderCard(
      PrivacyCard,
      token({ schema: { type: 'object' }, default_status: 202 }),
    );
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    await expectNoAxeViolations(container);

    await userEvent.click(toggle());
    await userEvent.type(screen.getByLabelText('Secret to view'), 'segredo-longo');
    await userEvent.type(screen.getByLabelText('Confirm secret'), 'segredo-longo');
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({
      read_secret: 'segredo-longo',
      schema: { type: 'object' },
      default_status: '202',
    });
    put.flush(token({ protected: true }));
    const unlock = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/unlock`));
    expect(unlock.request.body).toEqual({ secret: 'segredo-longo' });
    unlock.flush(null, NO_CONTENT);
    await vi.waitFor(() => expect(screen.getByText('Protected')).toBeTruthy());
    expect(screen.getByLabelText('New secret')).toBeTruthy();
  });

  it('deve recusar segredo curto e confirmação diferente e dizer o que falta', async () => {
    const { http } = await renderCard(PrivacyCard, token());

    await userEvent.click(toggle());
    await userEvent.type(screen.getByLabelText('Secret to view'), 'curto');
    await userEvent.type(screen.getByLabelText('Confirm secret'), 'outro');
    await userEvent.click(save());

    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      'To save, fix: Secret to view, Confirm secret',
    );
    expect(screen.getByText('The secret must have 8 to 256 characters.')).toBeTruthy();
    expect(screen.getByText('The secrets do not match.')).toBeTruthy();
    http.expectNone((sent) => sent.method === 'PUT');
  });

  it('não deve mandar read_secret (mantém o atual) Quando a URL protegida é salva com os campos em branco', async () => {
    const { http } = await renderCard(PrivacyCard, token({ protected: true }));

    expect(
      screen.getByText('This URL is protected. Leave the fields blank to keep the current secret.'),
    ).toBeTruthy();
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).not.toHaveProperty('read_secret');
    put.flush(token({ protected: true }));
    http.expectNone(`/token/${TOKEN_ID}/unlock`);
  });

  it('deve avisar e mandar read_secret nulo Quando a proteção é desligada', async () => {
    const { http } = await renderCard(PrivacyCard, token({ protected: true }));

    await userEvent.click(toggle());
    expect(screen.getByText(/^Saving removes the secret/)).toBeTruthy();
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({ read_secret: null });
    put.flush(token({ protected: false }));
    await vi.waitFor(() => expect(screen.getByText('Open')).toBeTruthy());
  });
});
