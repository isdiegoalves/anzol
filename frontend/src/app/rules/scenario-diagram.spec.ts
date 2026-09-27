import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { ScenarioDiagram, scenarioSteps } from './scenario-diagram';

/** "falha 2×, depois 200", como no readme. */
const ENTREGA: Rule[] = [
  rule(1, {
    name: 'falha 1',
    scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou 1' },
    response: { status: 503 },
  }),
  rule(2, {
    name: 'falha 2',
    scenario: { name: 'entrega', requiredState: 'falhou 1', newState: 'entregue' },
    response: { status: 503 },
  }),
  rule(3, {
    name: 'ok',
    scenario: { name: 'entrega', requiredState: 'entregue' },
    response: { status: 200 },
  }),
  rule(4, {
    name: 'desligada',
    enabled: false,
    scenario: { name: 'entrega', requiredState: 'Started' },
  }),
  rule(5, { name: 'outro cenário', scenario: { name: 'outro' } }),
];

describe('Dado as regras de um cenário (scenarioSteps)', () => {
  it('deve dar uma transição por regra ligada do cenário, na ordem da lista', () => {
    expect(scenarioSteps(ENTREGA, 'entrega')).toEqual([
      {
        rule: 'falha 1',
        id: 'r1',
        request: 'POST /r1',
        status: 503,
        from: 'Started',
        to: 'falhou 1',
        stays: false,
      },
      {
        rule: 'falha 2',
        id: 'r2',
        request: 'POST /r2',
        status: 503,
        from: 'falhou 1',
        to: 'entregue',
        stays: false,
      },
      {
        rule: 'ok',
        id: 'r3',
        request: 'POST /r3',
        status: 200,
        from: 'entregue',
        to: 'entregue',
        stays: true,
      },
    ]);
  });

  it('deve dizer "any state" e não dar status Quando a regra não exige estado e falha a conexão', () => {
    const regra = rule(9, {
      scenario: { name: 'x', newState: 'y' },
      response: { fault: 'connection_reset' },
    });

    expect(scenarioSteps([regra], 'x')).toEqual([
      {
        rule: 'Rule 9',
        id: 'r9',
        request: 'POST /r9',
        status: null,
        from: 'any state',
        to: 'y',
        stays: false,
      },
    ]);
  });
});

describe('Dado o diagrama de um cenário', () => {
  it('deve resumir os estados com o atual para leitor de tela, listar as transições e passar no axe', async () => {
    const { container } = await render(ScenarioDiagram, {
      inputs: { name: 'entrega', rules: ENTREGA, current: 'falhou 1' },
    });

    expect(
      screen.getByRole('img', {
        name: 'entrega: Started, then falhou 1 (current), then entregue',
      }),
    ).toBeTruthy();
    const steps = [...container.querySelectorAll('.steps li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(steps).toEqual([
      'Started → falha 1 503 Service Unavailable → falhou 1',
      'falhou 1 → falha 2 503 Service Unavailable → entregue',
      'entregue → ok 200 OK → stays in entregue',
    ]);
    await expectNoAxeViolations(container);
  });

  it('deve pôr o status de cada transição entre os pills e dizer o que responde sem mudar de estado (RULES-24)', async () => {
    const { container } = await render(ScenarioDiagram, {
      inputs: { name: 'entrega', rules: ENTREGA, current: 'falhou 1', showSteps: false },
    });

    const figura = screen.getByRole('img');
    // E-09: a seta diz o que casa e o que responde.
    expect([...figura.querySelectorAll('.edge')].map((edge) => edge.textContent?.trim())).toEqual([
      'POST /r1 → 503',
      'POST /r2 → 503',
    ]);
    expect(figura.querySelector('.stays')?.textContent?.trim()).toBe('then 200 while in entregue');
    expect(container.querySelector('.steps')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('Dado o diagrama na aba Scenario, com a URL (E-09)', () => {
  it('deve pôr um link por seta para a regra, fora da imagem do diagrama', async () => {
    const { container } = await render(ScenarioDiagram, {
      inputs: {
        name: 'entrega',
        rules: ENTREGA,
        current: 'Started',
        tokenId: 'tk',
        showSteps: false,
      },
      providers: [provideRouter([])],
    });

    const links = screen.getByRole('list', { name: 'Rules of this scenario' });
    const link = within(links).getByRole('link', { name: 'POST /r1 → 503' });
    expect(link.getAttribute('href')).toBe('/tk/rules/r1');
    expect(
      within(links)
        .getAllByRole('link')
        .map((a) => a.textContent?.trim()),
    ).toEqual(['POST /r1 → 503', 'POST /r2 → 503', 'POST /r3 → 200']);
    expect(screen.getByRole('img').querySelector('a')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve piscar o estado atual uma vez Quando ele muda', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender } = await render(ScenarioDiagram, {
      inputs: { name: 'entrega', rules: ENTREGA, current: 'Started' },
    });
    expect(container.querySelector('.pill.changed')).toBeNull();

    await rerender({
      inputs: { name: 'entrega', rules: ENTREGA, current: 'falhou 1' },
      partialUpdate: true,
    });

    await vi.waitFor(() =>
      expect(container.querySelector('.pill.changed')?.textContent?.trim()).toBe('falhou 1'),
    );
    await vi.advanceTimersByTimeAsync(1300);
    await vi.waitFor(() => expect(container.querySelector('.pill.changed')).toBeNull());
    vi.useRealTimers();
  });
});
