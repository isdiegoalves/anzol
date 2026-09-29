import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { Menu, MenuItem } from './menu';

describe('Dado o botão ⋮ com menu (app-menu)', () => {
  const renderMenu = async () => {
    const actions = { edit: vi.fn(), open: vi.fn(), remove: vi.fn() };
    const items: MenuItem[] = [
      { label: 'Edit URL', icon: 'settings', action: actions.edit },
      { label: 'Open in new tab', action: actions.open },
      { label: 'Delete URL', icon: 'trash', action: actions.remove },
    ];
    const result = await render(Menu, { inputs: { label: 'More URL actions', items } });
    return { ...result, actions };
  };

  it('deve abrir com o foco no primeiro item, andar pelas setas e rodar a ação do Enter', async () => {
    const user = userEvent.setup();
    const { container, actions, fixture } = await renderMenu();
    const trigger = screen.getByRole('button', { name: 'More URL actions' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    await fixture.whenStable();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'More URL actions' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit URL' }));
    await expectNoAxeViolations(container);

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete URL' }));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    await user.keyboard('{Enter}');

    expect(actions.open).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('deve fechar com Esc e devolver o foco ao botão, sem rodar ação', async () => {
    const user = userEvent.setup();
    const { actions, fixture } = await renderMenu();
    const trigger = screen.getByRole('button', { name: 'More URL actions' });

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await fixture.whenStable();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit URL' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete URL' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
  });

  it('deve trocar pelos itens do nível abaixo, com o foco no primeiro, e rodar a ação do escolhido', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const { fixture } = await render(Menu, {
      inputs: {
        label: 'More actions',
        items: [
          { label: 'Settings', action: vi.fn() },
          {
            label: 'Guides',
            items: [
              { label: 'First webhook', action: first },
              { label: 'Test a retry', action: vi.fn() },
            ],
          },
        ],
      },
    });
    const trigger = screen.getByRole('button', { name: 'More actions' });

    await user.click(trigger);
    const guides = screen.getByRole('menuitem', { name: 'Guides' });
    expect(guides.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(guides);
    await fixture.whenStable();

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'First webhook',
      'Test a retry',
    ]);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'First webhook' }));
    await user.keyboard('{Enter}');

    expect(first).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Guides' })).toBeTruthy();
  });

  it('deve fechar com um clique fora', async () => {
    const user = userEvent.setup();
    await renderMenu();

    await user.click(screen.getByRole('button', { name: 'More URL actions' }));
    await user.click(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
