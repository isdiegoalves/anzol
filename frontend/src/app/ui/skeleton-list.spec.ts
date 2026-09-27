import { render } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { SkeletonList } from './skeleton-list';

describe('Dado o esqueleto de uma lista carregando', () => {
  it.each([
    [6, 84],
    [2, 60],
  ])(
    'deve desenhar %i linhas de %i px, escondidas do leitor de tela, e passar no axe',
    async (count, itemHeight) => {
      const { container } = await render(SkeletonList, { inputs: { count, itemHeight } });

      const host = container.querySelector('app-skeleton-list') ?? container;
      const rows = [...container.querySelectorAll<HTMLElement>('.ghost')];
      expect(rows).toHaveLength(count);
      expect(rows.every((row) => row.style.height === `${itemHeight}px`)).toBe(true);
      expect(host.closest('[aria-hidden="true"]')).not.toBeNull();
      await expectNoAxeViolations(container);
    },
  );
});
