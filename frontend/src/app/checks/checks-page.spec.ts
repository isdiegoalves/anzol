import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { screen, within } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { checksMatcher } from '../app.routes';
import { Preferences } from '../settings/preferences';
import { ChecksPage } from './checks-page';

describe('Dado a página Checks', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ matcher: checksMatcher, component: ChecksPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  const open = async (url: string) => {
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(url);
    const load = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`));
    return { harness, load };
  };

  it('deve buscar a URL no servidor antes de montar os cartões (a do localStorage pode estar velha)', async () => {
    TestBed.inject(Preferences).token.set(token({ default_status: 500 }));
    const { harness, load } = await open(`/${TOKEN_ID}/checks`);

    expect(screen.getByRole('status').textContent?.trim()).toBe('Loading this URL…');
    expect(screen.queryByRole('region', { name: 'Response' })).toBeNull();
    load.flush(token({ default_status: 201 }));
    await harness.fixture.whenStable();
    const recent = await vi.waitFor(() =>
      http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`),
    );
    recent.flush(requestPage([]));
    http
      .expectOne(`/token/${TOKEN_ID}/stats?window=200`)
      .flush(null, { status: 500, statusText: 'x' });
    await harness.fixture.whenStable();

    expect(screen.getByRole('heading', { level: 1, name: 'Checks' })).toBeTruthy();
    // CHECKS-03: cada cartão abre com o ícone tonal de 40 px, na cor do papel (protótipo C).
    for (const [name, tone] of [
      ['Signature verification', 'primary'],
      ['Schema validation', 'primary'],
      ['Response', 'secondary'],
      ['Privacy', 'secondary'],
      ['Health', 'tertiary'],
    ]) {
      const region = screen.getByRole('region', { name });
      const icon = region.querySelector('.card-head .card-icon');
      expect(icon?.classList.contains(tone), `${name}: ícone ${tone}`).toBe(true);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.querySelector('svg')).toBeTruthy();
    }
    expect(
      (screen.getByRole('textbox', { name: 'Default status code' }) as HTMLInputElement).value,
    ).toBe('201');
    expect(screen.getByRole('link', { name: 'Schema' }).getAttribute('href')).toContain(
      'section=schema',
    );
    // CHECKS-05: os cinco atalhos, na ordem da §1, com o ícone de 16 px do protótipo.
    const jump = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(jump).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Signature',
      'Schema',
      'Response',
      'Privacy',
      'Health',
    ]);
    for (const link of links) {
      expect(link.querySelector('app-icon svg')?.getAttribute('width')).toBe('16');
    }
    await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
  });

  it('deve passar a mensagem ao Schema Quando a rota traz ?schema-from=', async () => {
    const { harness, load } = await open(
      `/${TOKEN_ID}/checks?schema-from=${webhookRequest(9).uuid}`,
    );
    load.flush(token());
    await harness.fixture.whenStable();

    await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/request/${webhookRequest(9).uuid}`));
  });
});
