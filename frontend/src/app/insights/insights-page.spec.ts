import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { tokenStats } from '../../testing/stats-fixtures';
import { localDate } from '../request-detail/dates';
import { Preferences } from '../settings/preferences';
import { TokenStats } from '../stats/stats';
import { InsightsPage } from './insights-page';

const URL_STATS = `/token/${TOKEN_ID}/stats`;

/** As células da linha separadas por espaço (as vazias somem). */
const rowText = (row: HTMLElement) =>
  [...row.children]
    .map((cell) => cell.textContent?.trim())
    .filter(Boolean)
    .join(' ');

describe('Dado a página Insights', () => {
  let http: HttpTestingController;

  const open = async (stats: TokenStats | null, error?: { status: number; statusText: string }) => {
    const result = await render(InsightsPage, {
      inputs: { tokenId: TOKEN_ID },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      configureTestBed: () => TestBed.inject(Preferences).token.set(token()),
    });
    http = TestBed.inject(HttpTestingController);
    const call = http.expectOne((req) => req.url === URL_STATS);
    expect(call.request.params.get('window')).toBe('500');
    call.flush(stats ?? {}, error);
    await result.fixture.whenStable();
    return result;
  };
  /** O link de contagem (F1) pelo nome, e o endereço dele. */
  const href = (container: HTMLElement, name: string | RegExp) =>
    within(container).getByRole('link', { name }).getAttribute('href');
  const region = (name: string) => screen.getByRole('region', { name });

  afterEach(() => http.verify());

  it('deve mostrar os KPIs com a janela explícita, os gráficos com tabela e passar no axe', async () => {
    const { container } = await open(tokenStats());

    // UX-21: a página é o `main` do destino, com o nome do `h1`.
    expect(screen.getByRole('main', { name: 'Insights' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const summary = region('Summary');
    expect(summary.textContent).toContain('128 of the 128 kept');
    // UX-19: a hora local por extenso, como a Entrada, com o UTC no `title`.
    const from = localDate('2026-09-25 09:13:44');
    const to = localDate('2026-09-26 14:02:07');
    expect(summary.textContent?.replace(/\s+/g, ' ')).toContain(
      `The 128 most recent of the 128 requests this URL keeps, from ${from} to ${to}.`,
    );
    expect(
      [...summary.querySelectorAll('.window time')].map((time) => time.getAttribute('title')),
    ).toEqual(['2026-09-25 09:13:44 UTC', '2026-09-26 14:02:07 UTC']);
    const kpis = [...summary.querySelectorAll('.kpi')].map((kpi) =>
      [...kpi.querySelectorAll('dt, .value, .of')]
        .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    );
    expect(kpis).toEqual([
      'Requests 128 of the 128 kept',
      'Answered by a rule 44 34% of these requests',
      'Default response 84 66% of these requests',
      'Near misses 2 2% of these requests',
      'Signature valid 110 86% of these requests',
      'Signature invalid or absent 12 9% of these requests',
      'Schema invalid 20 16% of these requests',
    ]);
    expect(summary.textContent?.replace(/\s+/g, ' ')).toContain('Methods: POST 120, GET 8');
    // F1 (UX-18): cada número que conta requisições leva à Entrada com o filtro exato daquela contagem.
    expect(href(summary, 'All requests, 128 requests. Open in the Inbox')).toBe(`/${TOKEN_ID}`);
    expect(href(summary, 'Default response, 84 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?outcome=default`,
    );
    expect(href(summary, 'Signature valid, 110 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?signature=valid`,
    );
    expect(href(summary, 'Schema invalid, 20 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?schema=invalid`,
    );
    expect(href(summary, 'GET, 8 requests. Open in the Inbox')).toBe(`/${TOKEN_ID}?methods=GET`);
    // Somas sem um filtro só na Entrada ficam sem link.
    expect(within(summary).queryByRole('link', { name: /^Near misses,/ })).toBeNull();
    expect(
      within(summary).queryByRole('link', { name: /^Signature invalid or absent,/ }),
    ).toBeNull();

    const perHour = region('Requests per hour');
    expect(within(perHour).getByRole('img').getAttribute('aria-label')).toContain('peak 12');
    const rows = within(within(perHour).getByRole('table', { name: 'Requests per hour data' }))
      .getAllByRole('row')
      .map(rowText);
    expect(rows).toEqual([
      'Hour Requests Methods',
      `${localDate('2026-09-26 12:00:00')} 5 POST 5`,
      `${localDate('2026-09-26 13:00:00')} 0`,
      `${localDate('2026-09-26 14:00:00')} 12 POST 10, GET 2`,
    ]);
    expect(perHour.querySelector('tbody time')?.getAttribute('title')).toBe(
      '2026-09-26 12:00:00 UTC',
    );
    expect(perHour.textContent).toMatch(/local time \(UTC[+−]\d+(:\d{2})?\)/);

    expect(within(region('Signature')).getByRole('img').getAttribute('aria-label')).toBe(
      'Signature: Valid 110 (86%), Invalid 9 (7%), Absent 3 (2%), Not checked 6 (5%)',
    );
    expect(
      within(region('Signature')).getByRole('table', { name: 'Signature failure reasons' })
        .textContent,
    ).toContain('signature mismatch');
    // F1 (UX-18): cada motivo e cada caminho levam ao filtro exato (M1), o mesmo do Health de Checks.
    expect(href(region('Signature'), 'signature mismatch, 6 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?signature=invalid&signatureReason=signature%20mismatch`,
    );
    expect(href(region('Signature'), 'Signature: Absent, 3 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?signature=absent`,
    );
    expect(within(region('Signature')).queryByRole('link', { name: /Not checked/ })).toBeNull();
    expect(href(region('Schema'), '/amount, 4 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?schema=invalid&schemaPath=%2Famount`,
    );
    expect(within(region('Schema')).getByRole('img').getAttribute('aria-label')).toBe(
      'Schema: Valid 100 (78%), Invalid 20 (16%), Not checked 8 (6%)',
    );
    const rules = within(region('Rules'));
    expect(rules.getAllByRole('row').slice(1, 4).map(rowText)).toEqual([
      'Stripe payment OK 41 → 32%',
      'Refund queued 3 → 2%',
      'Default response 84 → 66%',
    ]);
    expect(rules.getByRole('link', { name: 'Refund queued' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/rules/a`,
    );
    expect(href(region('Rules'), 'Stripe payment OK, 41 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?outcome=rule&rule=b&ruleName=Stripe%20payment%20OK`,
    );
    expect(
      href(region('Rules'), 'Closest rule: Refund queued, 2 requests. Open in the Inbox'),
    ).toBe(`/${TOKEN_ID}?outcome=near_miss&rule=a&ruleName=Refund%20queued`);
    // A tabela que rola de lado recebe foco pelo teclado (axe scrollable-region-focusable, E11).
    const rolagem = screen.getByRole('region', { name: 'Hourly data' });
    expect(rolagem.getAttribute('tabindex')).toBe('0');
    await expectNoAxeViolations(container);
  });

  it('deve levar ao dashboard do Grafana e reler os números no "Refresh"', async () => {
    await open(tokenStats());

    const grafana = screen.getByRole('link', { name: 'Open in Grafana' });
    expect(grafana.getAttribute('href')).toBe(
      `${location.protocol}//${location.hostname}:3000/d/webhook-site`,
    );
    expect(grafana.getAttribute('target')).toBe('_blank');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    http.expectOne((req) => req.url === URL_STATS).flush(tokenStats({ evaluated: 3 }));

    await vi.waitFor(() => expect(region('Summary').textContent).toContain('3 of the 128 kept'));
  });

  it('deve mostrar a janela e dizer que não há mensagens, sem os gráficos, Quando a URL está vazia', async () => {
    await open(
      tokenStats({
        evaluated: 0,
        total: 0,
        hourly: [],
        newest_at: null,
        oldest_at: null,
      }),
    );

    expect(region('Summary').textContent).toContain('0 of the 0 kept');
    expect(within(region('Summary')).getByText('No requests yet')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Requests per hour' })).toBeNull();
  });

  it('deve reler com a janela escolhida em "Window" (Last 50/200/500, padrão 500) e dizer as mais novas', async () => {
    const { fixture } = await open(tokenStats({ total: 1291, evaluated: 500 }));
    expect(region('Summary').textContent).toContain('the newest 500 of 1291 kept');
    const loader = TestbedHarnessEnvironment.loader(fixture);

    const janela = await loader.getHarness(
      MatSelectHarness.with({ selector: '[aria-label="Window"]' }),
    );
    expect(await janela.getValueText()).toBe('Last 500');
    // Campo contornado, como a janela do Health de Checks, junto de Refresh e do Grafana.
    const campo = document.querySelector('[aria-label="Window"]')?.closest('mat-form-field');
    expect(campo?.classList).toContain('mat-form-field-appearance-outline');
    expect(campo?.parentElement?.classList).toContain('actions');
    await janela.open();
    expect(await Promise.all((await janela.getOptions()).map((o) => o.getText()))).toEqual([
      'Last 50',
      'Last 200',
      'Last 500',
    ]);
    await janela.clickOptions({ text: 'Last 50' });

    const call = await vi.waitFor(() => http.expectOne((req) => req.url === URL_STATS));
    expect(call.request.params.get('window')).toBe('50');
    call.flush(tokenStats({ total: 1291, evaluated: 50, window: 50 }));
    await vi.waitFor(() =>
      expect(region('Summary').textContent).toContain('the newest 50 of 1291 kept'),
    );
  });

  it('F1: deve levar window= Quando a URL guarda mais que a janela, para a Entrada contar sobre as mesmas', async () => {
    await open(tokenStats({ total: 1291, evaluated: 500 }));

    expect(href(region('Summary'), 'All requests, 500 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?window=500`,
    );
    expect(href(region('Summary'), 'Default response, 84 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?outcome=default&window=500`,
    );
    expect(href(region('Signature'), 'signature mismatch, 6 requests. Open in the Inbox')).toBe(
      `/${TOKEN_ID}?signature=invalid&signatureReason=signature%20mismatch&window=500`,
    );
  });

  it('deve avisar Quando a URL não existe mais (410)', async () => {
    await open(null, { status: 410, statusText: 'Gone' });

    expect(screen.getByRole('alert').textContent).toContain('This URL no longer exists (410).');
  });
});
