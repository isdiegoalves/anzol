import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { webhookRequest } from '../../testing/fixtures';
import { routes } from '../app.routes';
import { SharedRequest } from './share';

const SHARE_ID = 'k3Jd9QpX2mZr7Lw0aBcDeF';

function shared(overrides: Partial<SharedRequest> = {}): SharedRequest {
  return {
    ...webhookRequest(1, {
      url: 'http://localhost:8084/[redacted]/pagar',
      headers: { authorization: ['[redacted]'], 'content-type': ['application/json'] },
      query: { api_key: '[redacted]', page: '2' },
      content: '{"cartao":"4111"}',
    }),
    shared_at: '2026-09-26 12:00:00',
    expires_at: '2099-10-03 12:00:00',
    ...overrides,
  };
}

/** Rótulos de tudo o que se clica na página (botões e links que não são dados da mensagem). */
const WRITING_ACTIONS =
  /Delete|Replay|Send|Share|Compare|Explain|Create rule|Create schema|Edit|New|Lock|Permalink|Raw content/;

describe('Dado a página de um link só-leitura (#/share/{id})', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ') ?? '';
  const rows = (table: string) =>
    [...page().querySelectorAll(`table[aria-label="${table}"] tbody tr`)].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim()).join(' '),
    );
  /** As abas do detalhe só desenham a aberta. */
  const openTab = async (label: RegExp) => {
    [...page().querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => label.test(tab.textContent ?? ''))
      ?.click();
    await harness.fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  const openShare = async (respond: (url: string) => void) => {
    await harness.navigateByUrl(`/share/${SHARE_ID}`);
    await vi.waitFor(() => respond(`/share/${SHARE_ID}`));
    await harness.fixture.whenStable();
  };

  it('deve mostrar a faixa com a validade e a mensagem como chegou, mascarada, Quando o link vale', async () => {
    await openShare((url) => http.expectOne(url).flush(shared()));
    await harness.fixture.whenStable();

    expect(page().querySelector('.banner')?.textContent?.trim()).toMatch(
      /^Shared read-only link · expires Oct 3, 2099 \d+:\d\d [AP]M \(in \d+ years\)$/,
    );
    expect(page().querySelector('pre')?.textContent).toBe('{"cartao":"4111"}');
    await openTab(/^Headers/);
    expect(rows('Headers')).toEqual(['authorization [redacted]', 'content-type application/json']);
    await openTab(/^Query/);
    expect(rows('Query strings')).toEqual(['api_key [redacted]', 'page 2']);
  });

  it('não deve ter nenhum botão nem ação que escreva Quando o link vale', async () => {
    await openShare((url) => http.expectOne(url).flush(shared()));

    // Só o interruptor Pretty (papel switch), que muda a vista e não a mensagem.
    expect(
      [...page().querySelectorAll('button')].filter((b) => b.getAttribute('role') !== 'switch'),
    ).toHaveLength(0);
    const labels = [...page().querySelectorAll('a, [role="button"], [role="menuitem"]')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(labels.filter((label) => WRITING_ACTIONS.test(label))).toEqual([]);
  });

  it('deve tirar a rota da url com [redacted], sem usar token_id (S22)', async () => {
    const semToken = shared();
    delete semToken.token_id;
    await openShare((url) => http.expectOne(url).flush(semToken));

    expect(page().querySelector('h2')?.textContent).toBe('/pagar');
  });

  it('não deve chamar nenhuma rota da URL (/token/…) Quando o link é aberto', async () => {
    await openShare((url) => http.expectOne(url).flush(shared()));

    http.expectNone((request) => request.url.startsWith('/token'));
  });

  it('deve mostrar o aviso amigável, sem a mensagem, Quando o link expirou, foi revogado ou a mensagem sumiu (404)', async () => {
    await openShare((url) =>
      http.expectOne(url).flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' }),
    );

    expect(text()).toContain('This link is not available');
    expect(text()).toContain('expired, been revoked, or the request may have been deleted');
    expect(page().querySelector('app-request-view')).toBeNull();
  });

  it('deve dizer que falhou, com o status, Quando o servidor dá outro erro', async () => {
    await openShare((url) =>
      http.expectOne(url).flush(null, { status: 500, statusText: 'Server Error' }),
    );

    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Could not load the shared request (500). Try again later.',
    );
  });
});
