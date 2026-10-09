import { clearTranslations, loadTranslations } from '@angular/localize';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { attention, expectPut, renderCard } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { E2eeKey, E2eePolicy } from '../token/token';
import { PrivacyCard } from './privacy-card';

const POLITICA: E2eePolicy = {
  path: '$.payload',
  required: true,
  audience: 'anzol-lab',
  bindings: { jti: '$.eventId', evt: '$.tipoEvento.nome', app: '$.servico.nome' },
  max_age_seconds: 43200,
  trusted_signers: [{ kty: 'EC', crv: 'P-256', kid: 'sig-1', x: 'xx', y: 'yy' }],
};
const CHAVE: E2eeKey = {
  kid: 'enc-1',
  created_at: '2026-10-07 12:00:00',
  jwk: { kty: 'EC', crv: 'P-256', kid: 'enc-1', x: 'xx', y: 'yy', use: 'enc', alg: 'ECDH-ES' },
};

describe('Dado o cartão Privacidade com a tela em pt-BR', () => {
  beforeEach(() => loadTranslations(translations));
  afterEach(() => {
    clearTranslations();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('deve dizer em português a recusa de remover o segredo com requisição decifrada', async () => {
    const { http } = await renderCard(PrivacyCard, token({ protected: true }));

    await userEvent.click(screen.getByRole('switch'));
    await userEvent.click(screen.getByRole('button', { name: /Salvar alterações/ }));
    (await expectPut(http)).flush(
      {
        read_secret: [
          'The read secret cannot be removed while this URL has decrypted requests; delete them first.',
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(() =>
      expect(attention()).toBe('1 campo precisa de atenção: Exigir um segredo para ver esta URL'),
    );
    expect(
      within(screen.getByRole('region', { name: 'Privacidade' })).getByText(/^O servidor recusou/)
        .textContent,
    ).toBe(
      'O servidor recusou: há requisições decifradas nesta URL. Apague-as antes de remover o segredo, ou mantenha o segredo.',
    );
  });

  it('deve avisar as duas condições para remover o segredo Quando a decifra está ligada', async () => {
    await renderCard(PrivacyCard, token({ protected: true, e2ee: POLITICA, e2ee_keys: [] }));

    await userEvent.click(screen.getByRole('switch'));

    expect(
      within(screen.getByRole('region', { name: 'Privacidade' }))
        .getByText(/^Requisições decifradas guardam/)
        .textContent?.trim(),
    ).toBe(
      'Requisições decifradas guardam o valor decifrado. O servidor só remove o segredo com a decifra desligada e nenhuma requisição decifrada gravada. Para remover, desligue a decifra (pode ser neste mesmo salvar) e apague as decifradas; ou mantenha o segredo.',
    );
  });

  it('deve dizer em português a recusa de remover o segredo com a decifra ligada, com o original à mão', async () => {
    const { http } = await renderCard(
      PrivacyCard,
      token({ protected: true, e2ee: POLITICA, e2ee_keys: [CHAVE] }),
    );

    await userEvent.click(screen.getByRole('switch'));
    const card = within(screen.getByRole('region', { name: 'Privacidade' }));
    await userEvent.click(screen.getByRole('button', { name: /Salvar alterações/ }));
    (await expectPut(http)).flush(
      { e2ee: ['The e2ee requires a read secret on this URL (read_secret).'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(() =>
      expect(attention()).toBe('1 campo precisa de atenção: Exigir um segredo para ver esta URL'),
    );
    const recusa = card.getByText(/^O servidor recusou/);
    expect(recusa.textContent?.trim()).toBe(
      'O servidor recusou: a decifra está ligada. Desligue-a e apague as requisições decifradas que houver antes de remover o segredo, ou mantenha o segredo.',
    );
    expect(recusa.getAttribute('title')).toBe(
      'Original: The e2ee requires a read secret on this URL (read_secret).',
    );
  });
});
