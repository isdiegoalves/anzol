import { render } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { ICON_NAMES, Icon } from './icon';

describe('Dado os ícones da tela (app-icon)', () => {
  it('deve desenhar o anzol da marca: olhal, haste com a curva em J e a farpa', async () => {
    const { container } = await render(Icon, { inputs: { name: 'hook', size: 24 } });

    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('deve ter o anzol e não a âncora antiga na lista de ícones', () => {
    expect(ICON_NAMES).toContain('hook');
    expect(ICON_NAMES).not.toContain('anchor');
  });
});
