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
const show = () => userEvent.click(screen.getByRole('button', { name: 'Show health' }));

describe('Dado a linha do Health', () => {
  it('deve calcular o percentual entre as verificadas, sem as não verificadas', () => {
    expect(line(110, 12, 6, []).percent).toBe('90.2%');
    expect(line(0, 0, 5, []).percent).toBeNull();
  });
});

describe('Dado o cartão "Health" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve vir recolhido, com as duas taxas numa linha, "Open in Insights" e "Show health"', async () => {
    const { container, http } = await renderCard(HealthCard, token());

    http.expectOne(statsUrl(200)).flush(stats());

    await vi.waitFor(() =>
      expect(container.querySelector('.brief span')?.textContent).toBe(
        'Signatures 90.2 % valid · Schema 83.3 % valid, over the newest 128',
      ),
    );
    expect(screen.getByRole('link', { name: 'Open in Insights' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/insights`,
    );
    const button = screen.getByRole('button', { name: 'Show health' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#health-body')?.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Window' })).toBeNull();
    await expectNoAxeViolations(container);

    await show();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#health-body')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByText('the HMAC did not match (signature mismatch)')).toBeTruthy();
  });

  it('deve mostrar as taxas e os motivos das últimas 200 e passar no axe', async () => {
    const { container, http } = await renderCard(HealthCard, token());

    http.expectOne(statsUrl(200)).flush(stats());
    await show();

    await vi.waitFor(() => expect(screen.getByText('90.2%')).toBeTruthy());
    expect(screen.getByText('83.3%')).toBeTruthy();
    expect(screen.getByRole('img', { name: '110 valid, 12 invalid' })).toBeTruthy();
    expect(screen.getByText('the HMAC did not match (signature mismatch)')).toBeTruthy();
    expect(screen.getByText('(root)')).toBeTruthy();
    expect(screen.getByText(/last 128 requests \(of 300 kept\)/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Health' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve pedir de novo com a janela escolhida Quando "50" é clicado', async () => {
    const { http } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());
    await show();

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

  it('M1: deve levar o erro na raiz do corpo à Inbox com o caminho vazio', async () => {
    const { http } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(
      stats({
        total: 128,
        schema: { valid: 0, invalid: 2, unchecked: 0, paths: [{ path: '', count: 2 }] },
      }),
    );
    await show();

    const raiz = await screen.findByRole('link', { name: /\(root\)/ });
    expect(raiz.getAttribute('href')).toBe(`/${TOKEN_ID}?schema=invalid&schemaPath=`);
  });

  it('CHECKS-17: deve levar cada motivo e caminho à Inbox filtrada, com a barra proporcional ao maior', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(
      stats({
        total: 128,
        schema: { valid: 1, invalid: 4, unchecked: 0, paths: [{ path: '/id', count: 4 }] },
      }),
    );
    await show();

    // M1: o motivo exato e o caminho do erro, junto do filtro largo de hoje.
    const mismatch = await screen.findByRole('link', { name: /signature mismatch/ });
    expect(mismatch.getAttribute('href')).toBe(
      `/${TOKEN_ID}?signature=invalid&signatureReason=signature%20mismatch`,
    );
    expect(mismatch.textContent).toContain('Open in the Inbox');
    expect(mismatch.getAttribute('aria-label')).toBe(
      'the HMAC did not match (signature mismatch), 6 requests. Open in the Inbox',
    );
    expect(
      screen.getByRole('link', { name: /header stripe-signature absent/ }).getAttribute('href'),
    ).toBe(`/${TOKEN_ID}?signature=absent&signatureReason=header%20stripe-signature%20absent`);
    expect(screen.getByRole('link', { name: /\/id/ }).getAttribute('href')).toBe(
      `/${TOKEN_ID}?schema=invalid&schemaPath=%2Fid`,
    );
    const bars = [...container.querySelectorAll('.reasons .share')] as HTMLElement[];
    expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '50%', '100%']);
    expect(
      screen.getByText(
        'From the result recorded on each request. Click a line to see those requests in the Inbox.',
      ),
    ).toBeTruthy();
  });

  it('deve levar cada número à Entrada com o filtro exato, com window= Quando a URL guarda mais que a janela', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());
    await show();

    const link = (name: string) =>
      screen.getByRole('link', { name: `${name}. Open in the Inbox` }).getAttribute('href');
    await vi.waitFor(() =>
      expect(link('Signature valid, 110 requests')).toBe(`/${TOKEN_ID}?signature=valid&window=128`),
    );
    expect(link('Schema valid, 100 requests')).toBe(`/${TOKEN_ID}?schema=valid&window=128`);
    expect(link('Schema invalid, 20 requests')).toBe(`/${TOKEN_ID}?schema=invalid&window=128`);
    expect(link('the HMAC did not match (signature mismatch), 6 requests')).toBe(
      `/${TOKEN_ID}?signature=invalid&signatureReason=signature%20mismatch&window=128`,
    );
    // Inválidas e ausentes somadas não cabem num filtro só da Entrada: o número fica sem link.
    expect(screen.queryByRole('link', { name: /^Signature invalid,/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Signature valid,/ }).textContent?.trim()).toBe('110');
    await expectNoAxeViolations(container);
  });

  it('deve somar a decifra às taxas, com os motivos e a chave desconhecida levando à Entrada', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(
      stats({
        decryption: {
          valid: 40,
          invalid: 6,
          unknown_kid: 2,
          absent: 1,
          unchecked: 79,
          reasons: [
            { reason: 'downgrade', count: 4 },
            { reason: 'signature_invalid', count: 2 },
          ],
        },
      }),
    );

    await vi.waitFor(() =>
      expect(container.querySelector('.brief span')?.textContent).toBe(
        'Signatures 90.2 % valid · Schema 83.3 % valid · Decryption 83.3 % decrypted, over the newest 128',
      ),
    );
    await show();

    const link = (name: string) =>
      screen.getByRole('link', { name: `${name}. Open in the Inbox` }).getAttribute('href');
    expect(screen.getByRole('heading', { name: 'Decryption', level: 3 })).toBeTruthy();
    expect(screen.getByRole('img', { name: '40 valid, 8 invalid' })).toBeTruthy();
    expect(link('Decrypted, 40 requests')).toBe(`/${TOKEN_ID}?decryption=valid&window=128`);
    expect(link('the encrypted attribute did not come as a JWE (downgrade), 4 requests')).toBe(
      `/${TOKEN_ID}?decryption=invalid&decryptionReason=downgrade&window=128`,
    );
    expect(link('Unknown encryption key, 2 requests')).toBe(
      `/${TOKEN_ID}?decryption=unknown_kid&window=128`,
    );
    // Inválidas e chave desconhecida somadas não cabem num filtro só da Entrada.
    expect(screen.queryByRole('link', { name: /^Decryption invalid,/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve deixar a decifra de fora Quando nenhuma requisição da janela passou por ela', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(
      stats({
        decryption: {
          valid: 0,
          invalid: 0,
          unknown_kid: 0,
          absent: 0,
          unchecked: 128,
          reasons: [],
        },
      }),
    );

    await vi.waitFor(() =>
      expect(container.querySelector('.brief span')?.textContent).toBe(
        'Signatures 90.2 % valid · Schema 83.3 % valid, over the newest 128',
      ),
    );
    await show();
    expect(screen.queryByRole('heading', { name: 'Decryption' })).toBeNull();
  });

  it('CHECKS-18: deve pôr a janela no cabeçalho, o Refresh em ícone e a barra com vão entre as partes', async () => {
    const { http, container } = await renderCard(HealthCard, token());
    http.expectOne(statsUrl(200)).flush(stats());
    await show();

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
