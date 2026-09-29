import { render, screen, within } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { LiveRegion } from './live-region';

describe('Dado a região viva com nome (o nome fica no grupo em volta)', () => {
  it('deve pôr o nome num group e deixar o status de dentro sem nome', async () => {
    const { container } = await render('<app-live-region label="Connection" [text]="text" />', {
      imports: [LiveRegion],
      componentProperties: { text: '' },
    });

    const group = screen.getByRole('group', { name: 'Connection' });
    const status = within(group).getByRole('status');
    expect(status.hasAttribute('aria-label')).toBe(false);
    expect(status.textContent).toBe('');
    expect(screen.queryByRole('status', { name: 'Connection' })).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('Dado a região viva persistente (app-live-region)', () => {
  it('deve existir vazia, com o papel status e o nome, antes de ter o que dizer', async () => {
    const { container } = await render(LiveRegion, { inputs: { label: 'Connection' } });

    const region = within(screen.getByRole('group', { name: 'Connection' })).getByRole('status');
    expect(region.textContent).toBe('');
    expect(screen.getByRole('group', { name: 'Connection' }).classList).toContain('empty');
    await expectNoAxeViolations(container);
  });

  it('deve receber o texto no mesmo elemento, sem recriá-lo', async () => {
    const { rerender } = await render('<app-live-region label="Connection" [text]="text" />', {
      imports: [LiveRegion],
      componentProperties: { text: '' },
    });
    const before = within(screen.getByRole('group', { name: 'Connection' })).getByRole('status');

    await rerender({ componentProperties: { text: 'Connected again.' } });

    const after = within(screen.getByRole('group', { name: 'Connection' })).getByRole('status');
    expect(after).toBe(before);
    expect(after.textContent).toBe('Connected again.');
    expect(screen.getByRole('group', { name: 'Connection' }).classList).not.toContain('empty');
  });

  it('deve virar alert só quando pedido (erro que impede a ação)', async () => {
    await render(LiveRegion, { inputs: { label: 'Unsaved changes', text: 'x', alert: true } });

    const group = screen.getByRole('group', { name: 'Unsaved changes' });
    expect(within(group).getByRole('alert').textContent).toBe('x');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
