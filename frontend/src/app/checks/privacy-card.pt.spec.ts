import { clearTranslations, loadTranslations } from '@angular/localize';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { attention, expectPut, renderCard } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { PrivacyCard } from './privacy-card';

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
});
