import { render, screen } from '@testing-library/angular';
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
      { rule: 'falha 1', status: 503, from: 'Started', to: 'falhou 1', stays: false },
      { rule: 'falha 2', status: 503, from: 'falhou 1', to: 'entregue', stays: false },
      { rule: 'ok', status: 200, from: 'entregue', to: 'entregue', stays: true },
    ]);
  });

  it('deve dizer "any state" e não dar status Quando a regra não exige estado e falha a conexão', () => {
    const regra = rule(9, {
      scenario: { name: 'x', newState: 'y' },
      response: { fault: 'connection_reset' },
    });

    expect(scenarioSteps([regra], 'x')).toEqual([
      { rule: 'Rule 9', status: null, from: 'any state', to: 'y', stays: false },
    ]);
  });
});

describe('Dado o diagrama de um cenário', () => {
  it('deve resumir os estados com o atual para leitor de tela, listar as transições e passar no axe', async () => {
    const { container } = await render(ScenarioDiagram, {
      inputs: { name: 'entrega', rules: ENTREGA, current: 'falhou 1' },
    });

    expect(
      screen.getByRole('img', { name: 'entrega: Started, then falhou 1 (current), then entregue' }),
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
    expect([...figura.querySelectorAll('.edge')].map((edge) => edge.textContent?.trim())).toEqual([
      '503',
      '503',
    ]);
    expect(figura.querySelector('.stays')?.textContent?.trim()).toBe('then 200 while in entregue');
    expect(container.querySelector('.steps')).toBeNull();
    await expectNoAxeViolations(container);
  });
});
