import { clearTranslations, loadTranslations } from '@angular/localize';
import { screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { renderCard } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { ResponseCard } from './response-card';

// Em arquivo próprio: o texto do template é traduzido quando o componente é criado pela primeira
// vez, então a tradução tem de estar carregada antes de qualquer teste montar o cartão.
describe('Dado a barra de salvar de Verificações com a tela em pt-BR', () => {
  beforeEach(() => loadTranslations(translations));
  afterEach(() => {
    clearTranslations();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('deve dizer a barra e as alterações em português', async () => {
    await renderCard(ResponseCard, token());

    await userEvent.clear(screen.getByRole('textbox', { name: 'Status padrão' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Ligar CORS' }));

    const bar = screen.getByRole('region', { name: 'Alterações não salvas' });
    expect(bar.querySelector('.summary .full')?.textContent).toBe(
      '2 alterações não salvas: Status padrão, CORS',
    );
    expect(bar.querySelector('.summary .count')?.textContent).toBe('2 alterações não salvas');
    expect(
      screen.getByRole('button', { name: 'Salvar alterações' }).querySelector('.keys')?.textContent,
    ).toBe('· Ctrl+S');
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Conferir as alterações' }));
    expect(
      screen.getByRole('list', { name: 'Alterações a salvar' }).textContent?.replace(/\s+/g, ' '),
    ).toContain('CORS: desligado → ligado');
  });
});
