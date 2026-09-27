import { screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { renderCard } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { TokenStats } from '../stats/stats';
import { HealthCard, line } from './health-card';

function stats(overrides: Partial<TokenStats> = {}): TokenStats {
  return {
    window: 200,
    evaluated: 128,
    total: 300,
    newest_seq: 2,
    oldest_seq: 1,
    newest_at: '2026-09-26 14:02:07',
    oldest_at: '2026-09-25 09:13:44',
    methods: { POST: 128 },
    signature: {
      valid: 110,
      invalid: 9,
      absent: 3,
      unchecked: 6,
      reasons: [
        { reason: 'signature mismatch', count: 6 },
        { reason: 'header stripe-signature absent', count: 3 },
      ],
    },
    schema: { valid: 100, invalid: 20, unchecked: 8, paths: [{ path: '', count: 4 }] },
    rules: { answered: [], near_miss: [], default: 128 },
    hourly: [],
    ...overrides,
  };
}

const statsUrl = (window: number) => `/token/${TOKEN_ID}/stats?window=${window}`;

describe('Dado a linha do Health', () => {
  it('deve calcular o percentual entre as verificadas, sem as não verificadas', () => {
    expect(line(110, 12, 6, []).percent).toBe('90.2%');
    expect(line(0, 0, 5, []).percent).toBeNull();
  });
});

describe('Dado o cartão "Health" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve mostrar as taxas e os motivos das últimas 200 e passar no axe', async () => {
    const { container, http } = await renderCard(HealthCard, token());

    http.expectOne(statsUrl(200)).flush(stats());

    await vi.waitFor(() => expect(screen.getByText('90.2%')).toBeTruthy());
    expect(screen.getByText('83.3%')).toBeTruthy();
    expect(screen.getByRole('img', { name: '110 valid, 12 invalid' })).toBeTruthy();
    expect(screen.getByText('signature mismatch')).toBeTruthy();
    expect(screen.getByText('(root)')).toBeTruthy();
    expect(screen.getByText(/last 128 requests \(of 300 kept\)/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Health' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve pedir de novo com a janela escolhida Quando "Last 50" é clicado', async () => {
    const { http } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());

    await userEvent.click(screen.getByRole('radio', { name: 'Last 50' }));

    http.expectOne(statsUrl(50)).flush(stats({ window: 50 }));
  });

  it('deve dizer que ainda não há números Quando a URL está vazia', async () => {
    const { http } = await renderCard(HealthCard, token());

    http.expectOne(statsUrl(200)).flush(stats({ evaluated: 0, total: 0 }));

    await vi.waitFor(() =>
      expect(
        screen.getByText('No requests yet: the numbers appear as requests arrive.'),
      ).toBeTruthy(),
    );
  });

  it('deve avisar Quando o servidor não responde', async () => {
    const { http } = await renderCard(HealthCard, token());

    http.expectOne(statsUrl(200)).flush(null, { status: 500, statusText: 'Server Error' });

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent?.trim()).toBe(
        'Could not load the numbers (500).',
      ),
    );
  });
});
