import { clearTranslations, loadTranslations } from '@angular/localize';
import { render, screen } from '@testing-library/angular';
import { translations } from '../../locale/pt-BR';
import { RuleTabs } from './rule-tabs';

describe('Dado as abas do editor de regra', () => {
  const nomes = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());

  it('deve chamar a primeira aba de "Match" em inglês', async () => {
    await render(RuleTabs, { inputs: { current: 'match' } });
    expect(nomes()).toEqual(['Match', 'Response', 'Scenario', 'Test']);
  });

  // M4, AT-38 (decisão 11 do guia): em pt-BR a aba é "Condições", não "Casamento".
  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it('deve chamar a primeira aba de "Condições"', async () => {
      await render(RuleTabs, { inputs: { current: 'match' } });
      expect(nomes()[0]).toBe('Condições');
    });
  });
});
