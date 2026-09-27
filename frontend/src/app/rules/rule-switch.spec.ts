import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { RuleSwitch } from './rule-switch';

describe('Dado o interruptor da linha da regra (F8)', () => {
  it('deve ser um switch com nome, mudar na hora ao clicar e avisar o novo estado', async () => {
    const changed = vi.fn();
    const { container } = await render(RuleSwitch, {
      inputs: { checked: true, label: 'Enable rule Pix' },
      on: { changed },
    });
    const sw = screen.getByRole('switch', { name: 'Enable rule Pix' });
    expect(sw.getAttribute('aria-checked')).toBe('true');

    await userEvent.click(sw);

    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(changed).toHaveBeenCalledWith(false);
    await expectNoAxeViolations(container);
  });

  it('deve voltar ao estado salvo com revert() Quando a gravação falha', async () => {
    const { fixture } = await render(RuleSwitch, {
      inputs: { checked: true, label: 'Enable rule Pix' },
    });
    const sw = screen.getByRole('switch', { name: 'Enable rule Pix' });
    await userEvent.click(sw);

    fixture.componentInstance.revert();
    fixture.detectChanges();

    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('deve ter o alvo de 44 px de altura (o trilho do M3 mede 32)', async () => {
    await render(RuleSwitch, { inputs: { checked: false, label: 'Enable rule Pix' } });

    const estilo = getComputedStyle(screen.getByRole('switch'));
    expect(estilo.height).toBe('44px');
    expect(estilo.width).toBe('52px');
  });
});
