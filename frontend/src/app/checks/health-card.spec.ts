import { screen, within } from '@testing-library/angular';
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

  it('deve pedir de novo com a janela escolhida Quando "50" é clicado', async () => {
    const { http } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());

    await userEvent.click(screen.getByRole('combobox', { name: 'Window' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Last 50' }));

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

  it('CHECKS-17: deve levar cada motivo e caminho à Inbox filtrada, com a barra proporcional ao maior', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(
      stats({
        schema: { valid: 1, invalid: 4, unchecked: 0, paths: [{ path: '/id', count: 4 }] },
      }),
    );

    const mismatch = await screen.findByRole('link', { name: /signature mismatch/ });
    expect(mismatch.getAttribute('href')).toBe(`/${TOKEN_ID}?signature=invalid`);
    expect(mismatch.textContent).toContain('Show in Inbox');
    expect(
      screen.getByRole('link', { name: /header stripe-signature absent/ }).getAttribute('href'),
    ).toBe(`/${TOKEN_ID}?signature=absent`);
    expect(screen.getByRole('link', { name: /\/id/ }).getAttribute('href')).toBe(
      `/${TOKEN_ID}?schema=invalid`,
    );
    const bars = [...container.querySelectorAll('.reasons .share')] as HTMLElement[];
    expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '50%', '100%']);
    expect(
      screen.getByText(
        'From the result recorded on each request. Click a line to see those requests in the Inbox.',
      ),
    ).toBeTruthy();
  });

  it('CHECKS-18: deve pôr a janela no cabeçalho, o Refresh em ícone e a barra com vão entre as partes', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());

    const head = container.querySelector('.card-head') as HTMLElement;
    await vi.waitFor(() =>
      expect(within(head).getByRole('combobox', { name: 'Window' }).textContent).toContain(
        'Last 200',
      ),
    );
    const refresh = within(head).getByRole('button', { name: 'Refresh' });
    expect(refresh.textContent?.trim()).toBe('');
    expect(refresh.querySelector('app-icon')).toBeTruthy();
    expect(container.querySelector('.bar.gapped')).toBeTruthy();
  });
});
