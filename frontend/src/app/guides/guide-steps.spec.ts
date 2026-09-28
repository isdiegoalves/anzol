import { TOKEN_ID } from '../../testing/fixtures';
import { firstSteps, stateText } from './guide-steps';

describe('Dado os passos do roteiro "First webhook" (R1)', () => {
  const empty = { tokenId: TOKEN_ID, requests: 0, opened: false, signature: false, rules: 0 };
  const states = (state: typeof empty) => firstSteps(state).map((step) => step.state);

  it('deve ter os cinco passos, na ordem, com os três últimos opcionais', () => {
    expect(firstSteps(empty).map(({ name, state }) => [name, state])).toEqual([
      ['Send a request', 'todo'],
      ['See it arrive', 'todo'],
      ["Check the provider's signature", 'optional'],
      ['Choose the answer', 'optional'],
      ['Test a retry', 'optional'],
    ]);
  });

  it('deve derivar o estado do que a URL tem, sem gravar nada', () => {
    expect(states({ ...empty, requests: 1 })).toEqual([
      'done',
      'todo',
      'optional',
      'optional',
      'optional',
    ]);
    expect(states({ ...empty, requests: 3, opened: true, signature: true, rules: 2 })).toEqual([
      'done',
      'done',
      'done',
      'done',
      'optional',
    ]);
  });

  it('não deve dar por vista a requisição Quando a URL não tem nenhuma', () => {
    expect(states({ ...empty, opened: true })[1]).toBe('todo');
  });

  it('deve levar os passos opcionais a Verificações, à regra nova e ao outro roteiro', () => {
    expect(firstSteps(empty).map((step) => step.link)).toEqual([
      undefined,
      undefined,
      { commands: ['/', TOKEN_ID, 'checks'], queryParams: { section: 'signature' } },
      { commands: ['/', TOKEN_ID, 'rules', 'new'] },
      { commands: ['/', TOKEN_ID], queryParams: { guide: 'retry' } },
    ]);
  });

  it('deve dizer o estado em palavras', () => {
    expect((['done', 'todo', 'optional'] as const).map(stateText)).toEqual([
      'done',
      'to do',
      'optional',
    ]);
  });
});
