import { LiveAnnouncer } from '@angular/cdk/a11y';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { ListError } from './list-error';
import { ListFailure } from './request-store';

describe('Dado a lista com a primeira carga em erro', () => {
  const failure = (attempt = 0): ListFailure => ({ kind: 'list', status: 503, attempt });
  const show = (inputs: { failure: ListFailure; arrived?: number; total?: number }) => {
    const retry = vi.fn();
    return render(ListError, { inputs, on: { retry } }).then((result) => ({ ...result, retry }));
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['nada chegou', 0, 0, 'Could not load the list (503).'],
    ['só o que chegou existe', 2, 2, 'Could not load the list (503).'],
    ['uma chegou', 1, 4, '1 arrived just now; the 3 before it did not load (503).'],
    ['uma chegou e havia uma', 1, 2, '1 arrived just now; the 1 before it did not load (503).'],
    ['duas chegaram', 2, 14, '2 arrived just now; the 12 before them did not load (503).'],
    [
      'duas chegaram e havia uma',
      2,
      3,
      '2 arrived just now; the 1 before them did not load (503).',
    ],
  ])('deve dizer o erro Quando %s', async (_caso, arrived, total, text) => {
    await show({ failure: failure(), arrived, total });

    expect(screen.getByText(text)).toBeTruthy();
  });

  it('deve dizer o erro uma vez pelo anunciador e passar no axe', async () => {
    const announce = vi.spyOn(LiveAnnouncer.prototype, 'announce');
    const { container } = await show({ failure: failure() });

    expect(announce.mock.calls.map(([text]) => text)).toEqual(['Could not load the list (503).']);
    await expectNoAxeViolations(container);
  });

  it('deve tentar de novo sozinho em 5 s e esperar mais a cada falha seguida', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { retry, fixture } = await show({ failure: failure() });
    expect(screen.getByText('Trying again in 5 s')).toBeTruthy();

    vi.advanceTimersByTime(4_000);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(retry).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('failure', failure(1));
    fixture.detectChanges();
    expect(screen.getByText('Trying again in 10 s')).toBeTruthy();
    fixture.componentRef.setInput('failure', failure(7));
    fixture.detectChanges();
    expect(screen.getByText('Trying again in 30 s')).toBeTruthy();
  });

  it('deve tentar na hora pelo "Try again now", sem tentar de novo no fim da contagem', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { retry } = await show({ failure: failure() });

    await userEvent.click(screen.getByRole('button', { name: 'Try again now' }));
    vi.advanceTimersByTime(10_000);

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
