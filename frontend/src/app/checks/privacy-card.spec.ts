import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { attention, changesBar, expectPut, renderCard, saveButton } from '../../testing/checks';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { DecryptionResult } from '../requests/webhook-request';
import { E2eeKey } from '../token/token';
import { PrivacyCard } from './privacy-card';

const NO_CONTENT = { status: 204, statusText: 'No Content' };
const toggle = () => screen.getByRole('switch', { name: 'Require a secret to view this URL' });
const save = saveButton;
const card = () => screen.getByRole('region', { name: 'Privacy' });
const UNPROCESSABLE = { status: 422, statusText: 'Unprocessable Entity' };
const CHAVE: E2eeKey = {
  kid: 'enc-1',
  created_at: '2026-10-07 12:00:00',
  jwk: { kty: 'EC', crv: 'P-256', kid: 'enc-1', x: 'xx', y: 'yy', use: 'enc', alg: 'ECDH-ES' },
};
const DECIFRADA: DecryptionResult = {
  state: 'valid',
  kid: 'enc-1',
  signature_kid: 'sig-1',
  reason: null,
  jti: null,
  duplicate_of: null,
};
const DECRYPTED_WARNING = /^Decrypted requests keep the decrypted value/;

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
    // O segredo nunca aparece na barra nem na lista de alterações.
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(
      within(screen.getByRole('list', { name: 'Changes to save' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Require a secret to view this URL: off → on', 'Secret to view: set (not shown)']);
    expect(changesBar()?.textContent).not.toContain('segredo-longo');
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

    expect(card().querySelector('app-card-foot .note')?.textContent?.trim()).toBe(
      'To save, fix: Secret to view, Confirm secret',
    );
    await userEvent.click(save());

    expect(attention()).toBe('2 fields need attention: Secret to view, Confirm secret');
    expect(within(card()).queryByText(/^To save/)).toBeNull();
    expect(screen.getByText('The secret must have 8 to 256 characters.')).toBeTruthy();
    expect(screen.getByText('The secrets do not match.')).toBeTruthy();
    http.expectNone((sent) => sent.method === 'PUT');
  });

  it('não deve ter o que salvar (mantém o segredo atual) Quando a URL protegida fica com os campos em branco', async () => {
    const { http } = await renderCard(PrivacyCard, token({ protected: true }));

    expect(
      screen.getByText('This URL is protected. Leave the fields blank to keep the current secret.'),
    ).toBeTruthy();
    await userEvent.click(toggle());
    expect(changesBar()).not.toBeNull();
    await userEvent.click(toggle());

    expect(changesBar()).toBeNull();
    expect(within(card()).queryByText('Unsaved')).toBeNull();
    http.expectNone((sent) => sent.method === 'PUT');
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

  describe('Dado uma URL protegida que decifra', () => {
    it('deve avisar que o servidor recusa com a decifra ligada ou requisição decifrada Quando a URL tem chave de cifra', async () => {
      const { container } = await renderCard(
        PrivacyCard,
        token({ protected: true, e2ee_keys: [CHAVE] }),
      );

      await userEvent.click(toggle());

      expect(within(card()).getByText(DECRYPTED_WARNING).textContent).toContain(
        'turn decryption off (it can be in this same save) and delete the decrypted requests; or keep the secret.',
      );
      await expectNoAxeViolations(container);
    });

    it('deve avisar Quando a lista da URL tem requisição com decifra, mesmo sem chave', async () => {
      const { http } = await renderCard(PrivacyCard, token({ protected: true }));
      const load = TestBed.inject(RequestStore).load(TOKEN_ID);
      http
        .expectOne((sent) => sent.url === `/token/${TOKEN_ID}/requests`)
        .flush({
          data: [webhookRequest(1, { decryption: DECIFRADA })],
          total: 1,
          per_page: 50,
          current_page: 1,
          is_last_page: true,
          from: 1,
          to: 1,
        });
      await load;

      await userEvent.click(toggle());

      expect(within(card()).getByText(DECRYPTED_WARNING)).toBeTruthy();
    });

    it('não deve avisar da decifra Quando a URL nunca teve chave nem decifrou', async () => {
      await renderCard(PrivacyCard, token({ protected: true }));

      await userEvent.click(toggle());

      expect(within(card()).queryByText(DECRYPTED_WARNING)).toBeNull();
    });

    it('deve dizer a recusa do servidor e o que fazer Quando o PUT que remove o segredo leva 422', async () => {
      const { http } = await renderCard(
        PrivacyCard,
        token({ protected: true, e2ee_keys: [CHAVE] }),
      );

      await userEvent.click(toggle());
      await userEvent.click(save());
      (await expectPut(http)).flush(
        {
          read_secret: [
            'The read secret cannot be removed while this URL has decrypted requests; delete them first.',
          ],
        },
        UNPROCESSABLE,
      );

      await vi.waitFor(() =>
        expect(attention()).toBe('1 field needs attention: Require a secret to view this URL'),
      );
      expect(
        within(card())
          .getByText(/^The server refused/)
          .textContent?.trim(),
      ).toBe(
        'The server refused: this URL has decrypted requests. Delete them before removing the secret, or keep the secret.',
      );
      expect(within(card()).queryByText(DECRYPTED_WARNING)).toBeNull();
      expect(screen.getByText('Protected')).toBeTruthy();
    });
  });
});
