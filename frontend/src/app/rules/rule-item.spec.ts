import { render } from '@testing-library/angular';
import { RuleItem } from './rule-item';

describe('Dado um item da lista de regras com indicadores (RULES-11)', () => {
  const show = () =>
    render(RuleItem, {
      inputs: {
        baseId: 'rule-1',
        name: 'Refund queued for manual review',
        priority: 1,
        flags: [
          { label: 'template', detail: 'Handlebars' },
          { label: 'delay', detail: 'Fixed 300 ms' },
        ],
        status: 202,
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
    expect([...title.querySelectorAll('.flag')].map((flag) => flag.textContent)).toEqual([
      'template',
      'delay',
    ]);
    expect(getComputedStyle(title).flexWrap).toBe('wrap');
    expect(container.querySelector('.line1 > .status')).not.toBeNull();
  });
});
