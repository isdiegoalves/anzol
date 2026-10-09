import { clearTranslations, loadTranslations } from '@angular/localize';
import { render, screen, within } from '@testing-library/angular';
import { translations } from '../../locale/pt-BR';
import { FieldDiff } from './field-diff';

describe('Dado a tabela de campos da comparação', () => {
  const show = () =>
    render(FieldDiff, {
      inputs: {
        label: 'Query',
        rows: [{ name: 'x', a: '', b: '1', status: 'different' }],
        empty: '',
      },
    });
  const values = () =>
    [...within(screen.getByRole('table')).getAllByRole('cell')]
      .filter((cell) => cell.classList.contains('value'))
      .map((cell) => cell.textContent?.trim());

  it('deve dizer "(empty)" no valor vazio', async () => {
    await show();

    expect(values()).toEqual(['(empty)', '1']);
  });

  describe('Com a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it('deve dizer "(vazio)" no valor vazio', async () => {
      await show();

      expect(values()).toEqual(['(vazio)', '1']);
    });
  });
});
