import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { RuleItem, RulePosition } from './rule-item';

describe('Dado um item da lista de regras com indicadores (RULES-11)', () => {
  const show = (inputs: { position?: RulePosition; created?: boolean; off?: boolean } = {}) =>
    render(RuleItem, {
      inputs: {
        baseId: 'rule-1',
        name: 'Refund queued for manual review',
        priority: 1,
        flags: [
          { label: 'template', text: 'Template', detail: 'Handlebars' },
          { label: 'delay', text: 'Delay', detail: 'Fixed 300 ms' },
        ],
        status: 202,
        ...inputs,
      },
    });

  it('deve manter o nome numa linha, com reticências, e deixar os indicadores descerem', async () => {
    const { container } = await show();

    const name = container.querySelector('.name') as HTMLElement;
    expect(name.textContent).toBe('Refund queued for manual review');
    expect(name.getAttribute('title')).toBe('Refund queued for manual review');
    const nameStyle = getComputedStyle(name);
    expect(nameStyle.whiteSpace).toBe('nowrap');
    expect(nameStyle.textOverflow).toBe('ellipsis');
    expect(nameStyle.overflow).toBe('hidden');

    // Nome e indicadores dividem um bloco que quebra; prioridade e status ficam na linha 1.
    const title = name.parentElement as HTMLElement;
    expect(title.classList).toContain('title');
    // O texto do selo é o traduzido, não o tipo (WM-08).
    expect([...title.querySelectorAll('.flag')].map((flag) => flag.textContent)).toEqual([
      'Template',
      'Delay',
    ]);
    expect(getComputedStyle(title).flexWrap).toBe('wrap');
    // O nome inteiro não entra na largura mínima da célula: a lista de 440 px não alarga.
    expect(getComputedStyle(title).getPropertyValue('contain')).toBe('inline-size');
    expect(container.querySelector('.line1 > .status')).not.toBeNull();
  });

  it('deve mostrar a posição efetiva "#3" ao lado do P, com o nome "Position 3 of 7" (E-01)', async () => {
    const { container } = await show({
      position: { value: 3, label: 'Position 3 of 7', title: 'Checked top to bottom' },
    });

    const position = screen.getByRole('img', { name: 'Position 3 of 7' });
    expect(position.textContent).toBe('#3');
    expect(position.getAttribute('title')).toBe('Checked top to bottom');
    expect(position.previousElementSibling?.classList).toContain('priority');
    await expectNoAxeViolations(container);
  });

  it('deve mostrar "—" Quando a regra está desligada, fora da ordem', async () => {
    await show({
      off: true,
      position: { value: null, label: 'Not in the order while off', title: '' },
    });

    expect(screen.getByRole('img', { name: 'Not in the order while off' }).textContent).toBe('—');
  });

  it('deve marcar a recém-criada com um selo, e não só com cor (WM-35)', async () => {
    const { container } = await show({ created: true });

    expect(container.querySelector('.created')?.textContent).toBe('New');
  });
});
