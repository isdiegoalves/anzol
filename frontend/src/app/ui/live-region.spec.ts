import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { LiveRegion } from './live-region';

describe('Dado a região viva persistente (app-live-region, guia §4.3)', () => {
  it('deve existir vazia, com o papel status e o nome, antes de ter o que dizer', async () => {
    const { container } = await render(LiveRegion, { inputs: { label: 'Connection' } });

    const region = screen.getByRole('status', { name: 'Connection' });
    expect(region.textContent).toBe('');
    expect(region.classList).toContain('empty');
    await expectNoAxeViolations(container);
  });

  it('deve receber o texto no mesmo elemento, sem recriá-lo', async () => {
    // Dentro de um pai, como na tela: o pai muda só o `text`.
    const { rerender } = await render('<app-live-region label="Connection" [text]="text" />', {
      imports: [LiveRegion],
      componentProperties: { text: '' },
    });
    const before = screen.getByRole('status', { name: 'Connection' });

    await rerender({ componentProperties: { text: 'Connected again.' } });

    const after = screen.getByRole('status', { name: 'Connection' });
    expect(after).toBe(before);
    expect(after.textContent).toBe('Connected again.');
    expect(after.classList).not.toContain('empty');
  });

  it('deve virar alert só quando pedido (erro que impede a ação)', async () => {
    await render(LiveRegion, { inputs: { label: 'Unsaved changes', text: 'x', alert: true } });

    expect(screen.getByRole('alert', { name: 'Unsaved changes' }).textContent).toBe('x');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
