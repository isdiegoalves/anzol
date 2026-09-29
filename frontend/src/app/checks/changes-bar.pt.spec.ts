import { clearTranslations, loadTranslations } from '@angular/localize';
import { screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { renderCard } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { ResponseCard } from './response-card';

// O template é traduzido na primeira criação do componente no processo: aqui só se confere o que
// vem do `$localize` no código.
describe('Dado a barra de salvar de Verificações com a tela em pt-BR', () => {
  beforeEach(() => loadTranslations(translations));
  afterEach(() => {
    clearTranslations();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('deve dizer a barra e as alterações em português', async () => {
    const { container } = await renderCard(ResponseCard, token());
    const field = (name: string) =>
      container.querySelector(`[formcontrolname="${name}"]`) as HTMLElement;

    await userEvent.clear(field('default_status'));
    await userEvent.type(field('default_status'), '429');
    await userEvent.click(field('cors').querySelector('button') as HTMLElement);

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(bar.querySelector('.summary .full')?.textContent).toBe(
      '2 alterações não salvas: Status padrão, CORS',
    );
    expect(bar.querySelector('.summary .count')?.textContent).toBe('2 alterações não salvas');
    await userEvent.click(bar.querySelector('.review') as HTMLElement);
    expect([...bar.querySelectorAll('.changes li')].map((item) => item.textContent)).toEqual([
      'Status padrão: 200 → 429',
      'CORS: desligado → ligado',
    ]);
  });
});
