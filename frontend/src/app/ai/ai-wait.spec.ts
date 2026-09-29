import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { AiWait } from './ai-wait';

describe('Dado a espera de um pedido de IA', () => {
  const show = (inputs: { kind: 'explain' | 'suggest'; waiting?: boolean; outcome?: string }) =>
    render(AiWait, {
      inputs,
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  const progress = () =>
    within(screen.getByRole('group', { name: 'AI progress' })).getByRole('status');

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('deve ter a região viva desde a carga, vazia, sem contador nem "Cancel"', async () => {
    const { container } = await show({ kind: 'explain' });

    expect(progress().textContent).toBe('');
    expect(progress().hasAttribute('aria-label')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(container.querySelector('.seconds')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve dizer uma vez quanto costuma levar, com o contador e a barra fora da árvore', async () => {
    const { container } = await show({ kind: 'explain', waiting: true });

    expect(progress().textContent).toBe('Asking the local model. It usually takes about 9 s.');
    expect(container.querySelector('.seconds')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.bar')?.getAttribute('aria-hidden')).toBe('true');
    expect(progress().contains(container.querySelector('.seconds'))).toBe(false);
    await expectNoAxeViolations(container);
  });

  it('deve usar a mediana das últimas chamadas deste navegador', async () => {
    localStorage.setItem('anzol.aiTiming.explain', '[12, 14, 40]');

    await show({ kind: 'explain', waiting: true });

    expect(progress().textContent).toBe('Asking the local model. It usually takes about 14 s.');
  });

  it('deve contar os segundos sem mudar a frase, e avisar uma vez passado o dobro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = await show({ kind: 'suggest', waiting: true });
    const said: string[] = [];
    new MutationObserver(() => said.push(progress().textContent ?? '')).observe(progress(), {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await vi.advanceTimersByTimeAsync(12_500);

    expect(container.querySelector('.seconds')?.textContent).toBe('12 s');
    expect([...new Set(said)]).toEqual(['Still waiting. It can take up to 90 s.']);
  });

  it('deve avisar do cancelamento e emitir Quando "Cancel" é clicado', async () => {
    const { fixture, rerender } = await show({ kind: 'explain', waiting: true });
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await rerender({ inputs: { kind: 'explain', waiting: false }, partialUpdate: true });

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(progress().textContent).toBe('Cancelled. Nothing was changed.');
  });

  it('deve cancelar com Esc antes de quem já escutava o teclado, que recebe o evento tratado', async () => {
    const earlier = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    document.addEventListener('keydown', earlier);
    const { fixture } = await show({ kind: 'suggest', waiting: true });
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    const field = document.body.appendChild(document.createElement('textarea'));
    field.focus();

    await userEvent.keyboard('{Escape}');
    document.removeEventListener('keydown', earlier);
    field.remove();

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(earlier.mock.results.map(({ value }) => value as boolean)).toEqual([true]);
  });

  it('deve dizer o desfecho que a tela pede Quando o pedido termina', async () => {
    const { rerender } = await show({ kind: 'explain', waiting: true });

    await rerender({
      inputs: { kind: 'explain', waiting: false, outcome: 'Explanation ready.' },
      partialUpdate: true,
    });

    expect(progress().textContent).toBe('Explanation ready.');
  });
});
