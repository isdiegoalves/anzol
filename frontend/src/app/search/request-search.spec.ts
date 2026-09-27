import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { ScreenState } from '../shell/screen-state';
import { RequestSearch, SEARCH_DEBOUNCE_MS } from './request-search';

const searchUrl = `/token/${TOKEN_ID}/requests/search`;

describe('Dado a busca e os filtros em chips da lista', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  let clipboard: Clipboard;
  let container: HTMLElement;

  const searches = () => http.match({ method: 'POST', url: searchUrl });
  const chip = (name: string) =>
    within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name });
  const count = () => screen.queryByText(/^\d+ of \d+ requests$/)?.textContent;

  beforeEach(async () => {
    const view = await render(RequestSearch, {
      providers: [provideHttpClient(), provideHttpClientTesting()],
      configureTestBed: (testBed) => {
        testBed.inject(Preferences).token.set(token());
        http = testBed.inject(HttpTestingController);
        store = testBed.inject(RequestStore);
      },
    });
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2), webhookRequest(3)]));
    await loaded;
    await view.fixture.whenStable();
    clipboard = view.fixture.debugElement.injector.get(Clipboard);
    container = view.container as HTMLElement;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve ter a busca, os chips de método, assinatura e schema, e passar no axe', async () => {
    expect(within(container).getByRole('search')).toBeTruthy();
    expect(
      within(container)
        .getAllByRole('button', { pressed: false })
        .map((button) => button.textContent?.trim()),
    ).toEqual(['POST', 'GET', 'PUT', 'Signature invalid', 'Signature absent', 'Schema invalid']);
    await expectNoAxeViolations(container);
  });

  it('deve mostrar os demais filtros em "More filters", sem perder nenhum (INBOX-09, trava 4)', async () => {
    const more = screen.getByRole('button', { name: 'More filters' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'PATCH' })).toBeNull();

    await userEvent.click(more);

    expect(more.getAttribute('aria-expanded')).toBe('true');
    for (const name of ['PATCH', 'DELETE', 'Signature valid', 'Schema valid']) {
      expect(chip(name).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('deve buscar uma vez só, depois da pausa na digitação Quando o texto é digitado', async () => {
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'pedido');
    expect(searches()).toHaveLength(0);

    const [call] = await vi.waitFor(() => {
      const pending = searches();
      expect(pending).toHaveLength(1);
      return pending;
    });
    expect(call.request.body).toMatchObject({ text: 'pedido', match: {} });
    call.flush(requestPage([webhookRequest(2)], { total: 1 }));

    await vi.waitFor(() => expect(count()).toBe('1 of 3 requests'));
  });

  it('deve buscar na hora com o match das regras e marcar o chip Quando método, assinatura e schema são escolhidos', async () => {
    await userEvent.click(chip('POST'));
    searches()[0].flush(requestPage([], { total: 0 }));
    await userEvent.click(chip('Signature absent'));
    searches()[0].flush(requestPage([], { total: 0 }));
    await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
    await userEvent.click(chip('Schema valid'));
    const [last] = searches();

    expect(last.request.body).toMatchObject({
      match: { method: ['POST'], signature: 'absent', schema: 'valid' },
    });
    last.flush(requestPage([], { total: 0 }));
    await vi.waitFor(() => expect(count()).toBe('0 of 3 requests'));
    expect(chip('POST').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Signature absent').getAttribute('aria-pressed')).toBe('true');
  });

  it('deve deixar um só resultado de assinatura e desligar no segundo clique', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
    await userEvent.click(chip('Signature valid'));
    searches()[0].flush(requestPage([], { total: 0 }));
    await userEvent.click(chip('Signature invalid'));
    searches()[0].flush(requestPage([], { total: 0 }));
    expect(chip('Signature valid').getAttribute('aria-pressed')).toBe('false');
    expect(chip('Signature invalid').getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(chip('Signature invalid'));
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2), webhookRequest(3)]));

    await vi.waitFor(() => expect(store.filtering()).toBe(false));
  });

  it('deve voltar à lista completa, zerar os campos e sumir com o contador Quando "Clear filters" é clicado', async () => {
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear).toHaveProperty('disabled', true);
    await userEvent.click(chip('Schema invalid'));
    searches()[0].flush(requestPage([], { total: 0 }));

    await userEvent.click(clear);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2), webhookRequest(3)]));
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(searches()).toHaveLength(0);
    expect(store.filtering()).toBe(false);
    expect(store.requests()).toHaveLength(3);
    expect((screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe('');
    expect(chip('Schema invalid').getAttribute('aria-pressed')).toBe('false');
    expect(count()).toBeUndefined();
  });

  it('deve copiar o anzol wait-for só com o match e avisar que o texto ficou de fora', async () => {
    const copy = vi.spyOn(clipboard, 'copy').mockReturnValue(true);
    await userEvent.click(chip('GET'));
    searches()[0].flush(requestPage([], { total: 0 }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'pedido');

    await userEvent.click(screen.getByRole('button', { name: 'Copy as anzol wait-for' }));

    expect(copy).toHaveBeenCalledWith(
      `anzol wait-for --server '${location.origin}' --token ${TOKEN_ID} --match '{"method":["GET"]}'`,
    );
    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent?.includes('The text search is not part of wait-for')),
    ).toBe(true);
    await vi.waitFor(() => searches()[0].flush(requestPage([], { total: 0 })));
  });

  it('deve manter o "Copied…" Quando o debounce da busca dispara sem mudar o filtro (E11)', async () => {
    vi.spyOn(clipboard, 'copy').mockReturnValue(true);

    await userEvent.click(screen.getByRole('button', { name: 'Copy as anzol wait-for' }));
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 100));

    expect(
      screen
        .getAllByRole('status')
        .some((status) => status.textContent?.includes('Copied the anzol wait-for command.')),
    ).toBe(true);
    expect(searches()).toHaveLength(0);
  });

  // INBOX-31: no celular, só a linha de chips; a pílula da busca e a linha Clear/Copy aparecem pela
  // lupa da barra do topo ou com filtro ativo (a classe liga o CSS abaixo de 600 px).
  it('deve recolher a pílula no celular até a lupa abrir a busca ou haver filtro', async () => {
    const collapsed = () => container.classList.contains('collapsed');
    expect(collapsed()).toBe(true);

    TestBed.inject(ScreenState).searchOpen.set(true);
    await vi.waitFor(() => expect(collapsed()).toBe(false));
    TestBed.inject(ScreenState).searchOpen.set(false);
    await vi.waitFor(() => expect(collapsed()).toBe(true));

    await userEvent.click(chip('POST'));
    searches().forEach((search) => search.flush(requestPage([webhookRequest(1)])));
    await vi.waitFor(() => expect(collapsed()).toBe(false));
  });
});
