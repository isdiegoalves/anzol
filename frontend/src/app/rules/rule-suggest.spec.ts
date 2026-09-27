import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { TOKEN_ID } from '../../testing/fixtures';
import { RuleSuggest } from './rule-suggest';

/** O "Describe the rule" recolhido (RULES-16), com o formulário carregado só ao abrir. */
describe('Dado o "Describe the rule" recolhido', () => {
  const show = (open = false) =>
    render(RuleSuggest, {
      inputs: { tokenId: TOKEN_ID, open },
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

  it('deve vir recolhido, sem o formulário, e carregá-lo ao abrir pelo título', async () => {
    const { container } = await show();

    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Describe the rule', hidden: true })).toBeNull();

    await userEvent.click(screen.getByText('Describe the rule'));

    expect(details.open).toBe(true);
    expect(await screen.findByRole('textbox', { name: 'Describe the rule' })).toBeTruthy();
  });

  it('deve vir aberto e com o formulário Quando pedido (o cartão da lista vazia)', async () => {
    const { container } = await show(true);

    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true);
    expect(await screen.findByRole('textbox', { name: 'Describe the rule' })).toBeTruthy();
  });
});
