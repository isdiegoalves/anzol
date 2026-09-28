import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import type { MockInstance } from 'vitest';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { NO_FILTER, RequestFilter } from './request-filter';
import { WaitFor, WaitForButton } from './wait-for';

describe('Dado o "Copy as anzol wait-for" (S10)', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  let copy: MockInstance;
  let container: Element;

  const filterBy = async (filter: RequestFilter) => {
    const applied = store.applyFilter(filter);
    http
      .expectOne({ method: 'POST', url: `/token/${TOKEN_ID}/requests/search` })
      .flush(requestPage([], { total: 0 }));
    await applied;
  };
  const copied = () => TestBed.inject(WaitFor).copied();

  beforeEach(async () => {
    const view = await render(WaitForButton, {
      providers: [provideHttpClient(), provideHttpClientTesting()],
      configureTestBed: (testBed) => {
        testBed.inject(Preferences).token.set(token());
        http = testBed.inject(HttpTestingController);
        store = testBed.inject(RequestStore);
      },
    });
    container = view.container;
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1)]));
    await loaded;
    copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve ser um botão de ícone com nome e title, à vista sem filtro, e copiar o comando', async () => {
    const button = screen.getByRole('button', { name: 'Copy as anzol wait-for' });
    expect(button.getAttribute('title')).toBe('Copy as anzol wait-for');

    await userEvent.click(button);

    expect(copy).toHaveBeenCalledWith(
      `anzol wait-for --server '${location.origin}' --token ${TOKEN_ID}`,
    );
    expect(copied()).toBe('Copied the anzol wait-for command.');
    await expectNoAxeViolations(container);
  });

  it('deve copiar só o match e avisar que o texto ficou de fora', async () => {
    await filterBy({ ...NO_FILTER, methods: ['GET'], text: 'pedido' });

    await userEvent.click(screen.getByRole('button', { name: 'Copy as anzol wait-for' }));

    expect(copy).toHaveBeenCalledWith(
      `anzol wait-for --server '${location.origin}' --token ${TOKEN_ID} --match '{"method":["GET"]}'`,
    );
    expect(copied()).toBe(
      'Copied. The text search is not part of wait-for: only the filters went into --match.',
    );
  });

  it('deve copiar sem o motivo e o caminho, e dizer que ficaram de fora (M1)', async () => {
    await filterBy({
      ...NO_FILTER,
      signature: 'invalid',
      signatureReason: 'signature mismatch',
      schemaPath: '/valor',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Copy as anzol wait-for' }));

    expect(copy).toHaveBeenCalledWith(
      `anzol wait-for --server '${location.origin}' --token ${TOKEN_ID} --match '{"signature":"invalid"}'`,
    );
    expect(copied()).toBe(
      'Copied. wait-for only reads --match, so these filters were left out: the signature reason, the schema error path.',
    );
  });

  it('deve manter o aviso Quando o mesmo filtro é reaplicado, e tirá-lo Quando o filtro muda (E11)', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Copy as anzol wait-for' }));

    await store.applyFilter(NO_FILTER);
    expect(copied()).toBe('Copied the anzol wait-for command.');

    await filterBy({ ...NO_FILTER, methods: ['POST'] });
    expect(copied()).toBeNull();
  });
});

describe('Dado o "Copy as anzol wait-for" no painel de filtros do celular', () => {
  it('deve mostrar o texto no lugar do ícone', async () => {
    await render('<app-wait-for-button [text]="true" />', {
      imports: [WaitForButton],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    expect(screen.getByRole('button', { name: 'Copy as anzol wait-for' }).textContent?.trim()).toBe(
      'Copy as anzol wait-for',
    );
  });
});
