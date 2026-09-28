/**
 * Os passos de um roteiro (R1). Um roteiro é uma folha de atalhos, não um wizard: todos os passos
 * ficam à vista, nenhum bloqueia o outro, e o estado de cada um vem do que a URL **tem**, sem
 * gravar nada. Este arquivo não importa Material nem Regras: a faixa "First request arrived" da
 * Entrada usa os passos 3 a 5 daqui.
 */
export type StepState = 'done' | 'todo' | 'optional';

/** Para onde o passo leva (`routerLink` e `queryParams`). */
export interface StepLink {
  commands: string[];
  queryParams?: Record<string, string>;
}

export interface GuideStep {
  id: 'send' | 'arrive' | 'signature' | 'answer' | 'retry';
  name: string;
  state: StepState;
  link?: StepLink;
}

/** O que a URL tem agora. */
export interface FirstState {
  tokenId: string;
  /** Requisições que a URL guarda. */
  requests: number;
  /** A pessoa abriu alguma requisição. */
  opened: boolean;
  /** A URL confere assinatura. */
  signature: boolean;
  /** Regras da URL. */
  rules: number;
}

/** O estado do passo como entra no nome dele: "done", "to do" ou "optional". */
export function stateText(state: StepState): string {
  switch (state) {
    case 'done':
      return $localize`:guide step state:done`;
    case 'todo':
      return $localize`:guide step state:to do`;
    case 'optional':
      return $localize`:guide step state:optional`;
  }
}

/** Os cinco passos do "First webhook"; os três últimos são opcionais até a URL os ter. */
export function firstSteps(state: FirstState): GuideStep[] {
  const { tokenId } = state;
  const arrived = state.requests > 0;
  return [
    { id: 'send', name: $localize`Send a request`, state: arrived ? 'done' : 'todo' },
    {
      id: 'arrive',
      name: $localize`See it arrive`,
      state: arrived && state.opened ? 'done' : 'todo',
    },
    {
      id: 'signature',
      name: $localize`Check the provider's signature`,
      state: state.signature ? 'done' : 'optional',
      link: { commands: ['/', tokenId, 'checks'], queryParams: { section: 'signature' } },
    },
    {
      id: 'answer',
      name: $localize`Choose the answer`,
      state: state.rules > 0 ? 'done' : 'optional',
      link: { commands: ['/', tokenId, 'rules', 'new'] },
    },
    {
      id: 'retry',
      name: $localize`Test a retry`,
      state: 'optional',
      link: { commands: ['/', tokenId], queryParams: { guide: 'retry' } },
    },
  ];
}
