import { Component, signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { EmptyState } from './empty-state';
import { Pane } from './pane';
import { SPLIT_STEP, Split } from './split';

@Component({
  imports: [Pane],
  template: `
    <app-pane [heading]="heading()">
      <button type="button" paneActions>Refresh</button>
      <p>Conteúdo</p>
    </app-pane>
  `,
})
class PaneHost {
  readonly heading = signal<string | null>('Requests (3)');
}

describe('Dado o painel (app-pane)', () => {
  it('deve virar a região com o nome do título, com as ações no cabeçalho, e passar no axe', async () => {
    const { container } = await render(PaneHost);

    const region = screen.getByRole('region', { name: 'Requests (3)' });
    expect(screen.getByRole('heading', { level: 2, name: 'Requests (3)' })).toBeTruthy();
    expect(region.querySelector('header button')?.textContent).toBe('Refresh');
    expect(screen.getByText('Conteúdo')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve ser só a superfície, sem região nem título, Quando não tem título', async () => {
    const { container, fixture } = await render(PaneHost);
    fixture.componentInstance.heading.set(null);
    await fixture.whenStable();

    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

@Component({
  imports: [Split],
  template: `
    <app-split
      label="Resize list and detail"
      [min]="200"
      [max]="600"
      [(width)]="width"
      storageKey="splitWidth"
    >
      <p splitStart>Lista</p>
      <p splitEnd>Detalhe</p>
    </app-split>
  `,
})
class SplitHost {
  readonly width = signal(360);
}

describe('Dado a divisória redimensionável (app-split)', () => {
  afterEach(() => localStorage.clear());

  it('deve ter o papel separator com o valor e passar no axe', async () => {
    const { container } = await render(SplitHost);

    const separator = screen.getByRole('separator', { name: 'Resize list and detail' });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    expect(separator.getAttribute('aria-valuemin')).toBe('200');
    expect(separator.getAttribute('aria-valuemax')).toBe('600');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.getByText('Lista')).toBeTruthy();
    expect(screen.getByText('Detalhe')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve redimensionar pelo teclado (setas, Home e End), gravar a largura e respeitar os limites', async () => {
    const user = userEvent.setup();
    const { fixture } = await render(SplitHost);
    const separator = screen.getByRole('separator');

    separator.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await fixture.whenStable();
    expect(fixture.componentInstance.width()).toBe(360 + 2 * SPLIT_STEP);
    expect(separator.getAttribute('aria-valuenow')).toBe(String(360 + 2 * SPLIT_STEP));
    expect(localStorage.getItem('splitWidth')).toBe(String(360 + 2 * SPLIT_STEP));

    await user.keyboard('{End}{ArrowRight}');
    expect(fixture.componentInstance.width()).toBe(600);

    await user.keyboard('{Home}{ArrowLeft}');
    expect(fixture.componentInstance.width()).toBe(200);
  });

  it('deve abrir com a largura gravada Quando há uma no localStorage', async () => {
    localStorage.setItem('splitWidth', '480');

    const { fixture } = await render(SplitHost);

    expect(fixture.componentInstance.width()).toBe(480);
  });
});

describe('Dado o estado vazio (app-empty-state)', () => {
  it('deve mostrar o título, a frase e a ação projetada, e passar no axe', async () => {
    const { container } = await render(
      `<app-empty-state heading="No requests match the filters" text="New requests that match will appear here live.">
         <button type="button">Clear filters</button>
       </app-empty-state>`,
      { imports: [EmptyState] },
    );

    expect(screen.getByText('No requests match the filters')).toBeTruthy();
    expect(screen.getByText('New requests that match will appear here live.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve ficar só com o título Quando não tem frase nem ação', async () => {
    const { container } = await render(EmptyState, { inputs: { heading: 'Nothing yet' } });

    expect(container.querySelectorAll('p')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });
});
