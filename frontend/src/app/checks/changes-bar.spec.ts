import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { changesBar, expectPut, renderCard, saveButton } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { ResponseCard } from './response-card';

/** A região viva do resumo: `app-live-region`, dentro da seção da barra. */
const spoken = (container: Element) =>
  container.querySelector('app-changes-bar app-live-region') as HTMLElement;
const status = () => screen.getByRole('textbox', { name: 'Default status code' });

describe('Dado a barra de salvar de Verificações (região "Unsaved changes")', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('deve ter a região viva no DOM desde a carga, vazia, e a barra só com alteração pendente', async () => {
    const { container } = await renderCard(ResponseCard, token());

    expect(changesBar()).toBeNull();
    expect(spoken(container).getAttribute('role')).toBe('status');
    expect(spoken(container).textContent).toBe('');
    await expectNoAxeViolations(container);

    await userEvent.type(status(), '1');

    expect(changesBar()).not.toBeNull();
    // A mesma região de antes: criada já com o texto, ela não seria anunciada.
    expect(changesBar()?.contains(spoken(container))).toBe(true);
    await expectNoAxeViolations(container);
  });

  it('deve mostrar o resumo na hora e dizê-lo 1 s depois da última mudança, não a cada tecla', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = await renderCard(ResponseCard, token());

    await userEvent.type(status(), '1');
    const summary = container.querySelector('.summary') as HTMLElement;
    expect(summary.querySelector('.full')?.textContent).toBe(
      '1 unsaved change: Default status code',
    );
    // No celular a barra mostra só a contagem (o estilo troca um texto pelo outro).
    expect(summary.querySelector('.count')?.textContent).toBe('1 unsaved change');
    // O texto à vista fica fora da árvore de acessibilidade: quem fala é a região viva.
    expect(summary.getAttribute('aria-hidden')).toBe('true');
    expect(spoken(container).textContent).toBe('');

    await vi.advanceTimersByTimeAsync(1000);

    expect(spoken(container).textContent).toBe('1 unsaved change: Default status code');
    expect(spoken(container).getAttribute('role')).toBe('status');
  });

  it('deve virar alert com o que corrigir Quando o salvar acha campo inválido, e voltar a status', async () => {
    const { container } = await renderCard(ResponseCard, token());

    await userEvent.clear(status());
    await userEvent.click(saveButton());

    expect(spoken(container).getAttribute('role')).toBe('alert');
    expect(spoken(container).textContent).toBe('1 field needs attention: Default status code');
    await userEvent.type(status(), '429');
    expect(spoken(container).getAttribute('role')).toBe('status');
  });

  it('deve anunciar o salvar uma vez só, pelo announcer, com o snackbar calado', async () => {
    const { http } = await renderCard(ResponseCard, token());
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    await userEvent.clear(status());
    await userEvent.type(status(), '429');
    await userEvent.type(screen.getByRole('textbox', { name: 'Response body' }), 'x');

    await userEvent.click(saveButton());
    (await expectPut(http)).flush(token({ default_status: 429, default_content: 'x' }));

    await vi.waitFor(() => expect(changesBar()).toBeNull());
    expect(announce.mock.calls).toEqual([['Saved. 2 changes.']]);
    expect(await screen.findByText('URL updated!')).toBeTruthy();
    // O snackbar do Material fala pela região viva dele: com `politeness: 'off'`, fica calado.
    expect(
      document.querySelector('mat-snack-bar-container [aria-live]')?.getAttribute('aria-live'),
    ).toBe('off');
  });
});
