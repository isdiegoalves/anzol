import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { ShellSettings } from '../shell/shell-settings';
import { Viewport, WindowClass } from '../shell/viewport';
import { FilterChips } from './filter-chips';
import { NO_FILTER } from './request-filter';
import { RESULT_ANNOUNCE_MS, RequestSearch } from './request-search';
import { WaitFor } from './wait-for';

const searchUrl = `/token/${TOKEN_ID}/requests/search`;
const listUrl = `/token/${TOKEN_ID}/requests?page=1&sorting=newest`;
const THREE = [webhookRequest(1), webhookRequest(2), webhookRequest(3)];

describe('Dado a busca da lista numa linha, com os filtros atrás de "Filters" (B1)', () => {
  let http: HttpTestingController;
  let store: RequestStore;
  let container: HTMLElement;
  const windowClass = signal<WindowClass>('large');

  const searches = () => http.match({ method: 'POST', url: searchUrl });
  const filters = () => screen.getByRole('button', { name: /^Filters/ });
  const group = () => screen.queryByRole('group', { name: 'Filters' });
  const openPanel = async () => {
    if (!group()) {
      await userEvent.click(filters());
    }
  };
  const chip = (name: string | RegExp) =>
    within(group() as HTMLElement).getByRole('button', { name });
  /** A região do resultado e a do "Copied…", as duas sempre no DOM. */
  const regions = () => screen.getAllByRole('status').map((status) => status.textContent ?? '');
  const result = () => regions()[0];
  const activeFilters = () => screen.queryByRole('list', { name: 'Active filters' });
  /** Liga um chip e responde à busca dele. */
  const press = async (name: string, found = THREE.slice(0, 1)) => {
    await openPanel();
    await userEvent.click(chip(name));
    searches().forEach((search) => search.flush(requestPage(found, { total: found.length })));
  };

  beforeEach(async () => {
    windowClass.set('large');
    const view = await render(RequestSearch, {
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
      configureTestBed: (testBed) => {
        testBed.inject(Preferences).token.set(token());
        http = testBed.inject(HttpTestingController);
        store = testBed.inject(RequestStore);
      },
    });
    const loaded = store.load(TOKEN_ID);
    http.expectOne(listUrl).flush(requestPage(THREE));
    await loaded;
    await view.fixture.whenStable();
    container = view.container as HTMLElement;
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve mostrar só a busca e o botão "Filters" recolhido, sem chips nem linha de resultado', async () => {
    expect(within(container).getByRole('search', { name: 'Filter requests' })).toBeTruthy();
    expect(filters().getAttribute('aria-label')).toBe('Filters');
    expect(filters().textContent?.trim()).toBe('Filters');
    expect(filters().getAttribute('aria-expanded')).toBe('false');
    expect(filters().hasAttribute('aria-controls')).toBe(false);
    expect(group()).toBeNull();
    expect(activeFilters()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(regions()).toEqual(['', '']);
    await expectNoAxeViolations(container);
  });

  it('deve abrir o painel com todos os chips de hoje em quatro subgrupos, sem "More filters"', async () => {
    await userEvent.click(filters());

    expect(filters().getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(filters().getAttribute('aria-controls') ?? '')).not.toBeNull();
    expect(
      within(group() as HTMLElement)
        .getAllByRole('group')
        .map((subgroup) => [
          subgroup.getAttribute('aria-labelledby') &&
            document.getElementById(subgroup.getAttribute('aria-labelledby') ?? '')?.textContent,
          within(subgroup)
            .getAllByRole('button')
            .map((button) => button.textContent?.trim()),
        ]),
    ).toEqual([
      ['Method', ['POST', 'GET', 'PUT', 'DELETE', 'PATCH']],
      ['Signature', ['Signature invalid', 'Signature absent', 'Signature valid']],
      ['Schema', ['Schema invalid', 'Schema valid']],
      [
        'Answer',
        [
          'Answered by rule…',
          'Near miss of…',
          'Default response',
          // À vista só a classe; o nome acessível é "Answered 2xx".
          '2xx',
          '3xx',
          '4xx',
          '5xx',
        ],
      ],
    ]);
    expect(screen.queryByRole('button', { name: 'More filters' })).toBeNull();
    await expectNoAxeViolations(container);

    await userEvent.click(filters());
    expect(group()).toBeNull();
  });

  it('deve contar os filtros no botão, listá-los em "Active filters" e tirar um por vez', async () => {
    await press('POST');
    await press('Default response');

    expect(filters().getAttribute('aria-label')).toBe('Filters, 2 active');
    expect(filters().textContent?.trim()).toBe('Filters · 2');
    const list = activeFilters() as HTMLElement;
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual([
      'Remove this filter: method POST',
      'Remove this filter: Default response',
      'Clear filters',
    ]);
    await expectNoAxeViolations(container);

    await userEvent.click(
      within(list).getByRole('button', { name: 'Remove this filter: Default response' }),
    );
    expect(searches()[0].request.body).toMatchObject({ match: { method: ['POST'] } });
    expect(searches()).toHaveLength(0);
    http.expectNone(listUrl);
    expect(store.filter().outcome ?? null).toBeNull();
    expect(filters().getAttribute('aria-label')).toBe('Filters, 1 active');
  });

  // C2 (WM-27): o desfecho vai na busca, fora do `match`; o chip ativo diz a regra.
  it('deve filtrar pelas respondidas por uma regra escolhida no menu, e tirar ao clicar de novo', async () => {
    await openPanel();
    await userEvent.click(chip('Answered by rule…'));
    http.expectOne(`/token/${TOKEN_ID}/rules`).flush([
      { id: '11111111-2222-4333-8444-555555555555', name: 'Pix', priority: 1 },
      { id: '22222222-2222-4333-8444-555555555555', name: 'Tudo', priority: 9 },
    ]);
    const menu = await screen.findByRole('menu', { name: 'Rules' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Pix', 'Tudo']);

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Pix' }));
    const [search] = searches();
    expect(search.request.body).toMatchObject({
      match: {},
      outcome: { type: 'rule', rule: '11111111-2222-4333-8444-555555555555' },
    });
    search.flush(requestPage([webhookRequest(1)]));

    const ativo = await vi.waitFor(() => chip(/^Answered by: Pix/));
    expect(ativo.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(ativo);
    expect(store.filter().outcome ?? null).toBeNull();
    // Sem filtro, a lista volta à página 1 sem busca.
    await vi.waitFor(() => http.expectOne(listUrl).flush(requestPage([webhookRequest(1)])));
  });

  it('deve buscar uma vez só, depois da pausa na digitação, e listar o texto entre os ligados', async () => {
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'pedido');
    expect(searches()).toHaveLength(0);

    const [call] = await vi.waitFor(() => {
      const pending = searches();
      expect(pending).toHaveLength(1);
      return pending;
    });
    expect(call.request.body).toMatchObject({ text: 'pedido', match: {} });
    call.flush(requestPage([webhookRequest(2)], { total: 1 }));

    await vi.waitFor(
      () => expect(result()).toBe('1 request matches · search runs on the server over all 3'),
      { timeout: 2000 },
    );
    // O texto não conta no botão, mas se tira como os filtros.
    expect(filters().getAttribute('aria-label')).toBe('Filters');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove this filter: Search: pedido' }),
    );
    http.expectOne(listUrl).flush(requestPage(THREE));
    expect((screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe('');
  });

  it('deve oferecer o subgrupo da decifra só Quando a URL decifra, e buscar pelo match.decryption', async () => {
    await openPanel();
    expect(within(group() as HTMLElement).queryByRole('group', { name: 'Decryption' })).toBeNull();
    await userEvent.click(filters());
    TestBed.inject(Preferences).token.set(
      token({
        e2ee: {
          path: '$.payload',
          required: true,
          audience: 'anzol-lab',
          bindings: { jti: '$.id', evt: '$.tipo', app: '$.app' },
          max_age_seconds: 43200,
          trusted_signers: [],
        },
      }),
    );
    await openPanel();

    expect(
      within(group() as HTMLElement)
        .getAllByRole('group')
        .map((g) => g.querySelector('.name')?.textContent),
    ).toEqual(['Method', 'Signature', 'Schema', 'Answer', 'Decryption']);
    const decifra = within(group() as HTMLElement).getByRole('group', { name: 'Decryption' });
    expect(
      within(decifra)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim()),
    ).toEqual(['Decryption invalid', 'Unknown encryption key', 'Decrypted', 'Plaintext']);
    await userEvent.click(within(decifra).getByRole('button', { name: 'Unknown encryption key' }));
    const [last] = searches();
    expect(last.request.body).toMatchObject({ match: { decryption: 'unknown_kid' } });
    last.flush(requestPage([], { total: 0 }));
    expect(
      within(decifra)
        .getByRole('button', { name: 'Unknown encryption key' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await expectNoAxeViolations(container);
  });

  it('deve buscar na hora com o match das regras Quando método, assinatura e schema são escolhidos', async () => {
    await press('POST', []);
    await press('Signature absent', []);
    await openPanel();
    await userEvent.click(chip('Schema valid'));
    const [last] = searches();

    expect(last.request.body).toMatchObject({
      match: { method: ['POST'], signature: 'absent', schema: 'valid' },
    });
    last.flush(requestPage([], { total: 0 }));
    await vi.waitFor(
      () => expect(result()).toBe('0 requests match · search runs on the server over all 3'),
      { timeout: 2000 },
    );
    expect(chip('POST').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Signature absent').getAttribute('aria-pressed')).toBe('true');
  });

  it('deve deixar um só resultado de assinatura e desligar no segundo clique', async () => {
    await press('Signature valid', []);
    await press('Signature invalid', []);
    expect(chip('Signature valid').getAttribute('aria-pressed')).toBe('false');
    expect(chip('Signature invalid').getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(chip('Signature invalid'));
    http.expectOne(listUrl).flush(requestPage(THREE));

    await vi.waitFor(() => expect(store.filtering()).toBe(false));
  });

  it('deve dizer só o resultado, uma vez, depois que os filtros param de mudar', async () => {
    await openPanel();
    await userEvent.click(chip('POST'));
    // A busca ainda não voltou: nada de "Searching…", e a região segue vazia, demore o que demorar.
    expect(regions()).toEqual(['', '']);
    await new Promise((resolve) => setTimeout(resolve, RESULT_ANNOUNCE_MS + 100));
    expect(regions()).toEqual(['', '']);
    searches()[0].flush(requestPage(THREE.slice(0, 2), { total: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result()).toBe('');

    await vi.waitFor(
      () => expect(result()).toBe('2 requests match · search runs on the server over all 3'),
      { timeout: 2000 },
    );
  });

  describe('Dado o filtro pelo status respondido', () => {
    const scanUrl = (page: number) =>
      `/token/${TOKEN_ID}/requests?page=${page}&per_page=100&sorting=newest`;
    const answered = (n: number, status: number) => webhookRequest(n, { response: { status } });

    it('deve dizer quantas casam entre as mais novas, uma vez, sem "Look in older requests"', async () => {
      await openPanel();
      await userEvent.click(chip('Answered 4xx'));
      expect(chip('Answered 4xx').getAttribute('aria-pressed')).toBe('true');
      await vi.waitFor(() =>
        http
          .expectOne(scanUrl(1))
          .flush(requestPage([answered(3, 201), answered(2, 429), answered(1, 404)])),
      );

      await vi.waitFor(() => expect(result()).toBe('2 match among the newest 3'), {
        timeout: 2000,
      });
      expect(screen.queryByRole('button', { name: 'Look in older requests' })).toBeNull();
      expect(within(activeFilters() as HTMLElement).getByText('Answered 4xx')).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it('deve oferecer "Look in older requests" Quando a URL guarda mais que as varridas', async () => {
      const page = (n: number) =>
        requestPage(
          Array.from({ length: 100 }, (_, i) => answered(n * 1000 + i, 200)),
          { total: 505, per_page: 100, current_page: n, is_last_page: false },
        );
      await openPanel();
      await userEvent.click(chip('Answered 5xx'));
      for (const n of [1, 2, 3, 4, 5]) {
        await vi.waitFor(() => http.expectOne(scanUrl(n)).flush(page(n)));
      }

      await vi.waitFor(() => expect(result()).toBe('0 match among the newest 500'), {
        timeout: 2000,
      });
      const older = vi.spyOn(store, 'lookOlder').mockResolvedValue();
      await userEvent.click(screen.getByRole('button', { name: 'Look in older requests' }));
      expect(older).toHaveBeenCalledOnce();
    });

    it('deve dizer que contou sobre as mais novas, como Métricas, sem "Look in older requests"', async () => {
      const page = requestPage([answered(3, 429), answered(2, 429), answered(1, 200)], {
        total: 812,
        per_page: 100,
        is_last_page: false,
      });

      const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'], window: 3 });
      await vi.waitFor(() => http.expectOne(scanUrl(1)).flush(page));
      await applied;

      await vi.waitFor(
        () => expect(result()).toBe('2 requests match. Counted over the newest 3, as in Insights.'),
        { timeout: 2000 },
      );
      expect(screen.queryByRole('button', { name: 'Look in older requests' })).toBeNull();
    });

    it('deve mostrar o status exato ligado, com o texto das condições, e tirá-lo', async () => {
      const applied = store.applyFilter({ ...NO_FILTER, answered: ['429'] });
      await vi.waitFor(() => http.expectOne(scanUrl(1)).flush(requestPage([answered(1, 429)])));
      await applied;
      await openPanel();

      expect(chip('answered 429').getAttribute('aria-pressed')).toBe('true');
      await userEvent.click(
        within(activeFilters() as HTMLElement).getByRole('button', {
          name: 'Remove this filter: answered 429',
        }),
      );
      await vi.waitFor(() => http.expectOne(listUrl).flush(requestPage(THREE)));
      expect(store.filter().answered ?? []).toEqual([]);
    });
  });

  describe('Dado um filtro por valor', () => {
    const chips = () => TestBed.inject(FilterChips);
    const header = { kind: 'header' as const, name: 'x-loja-event-id', value: 'evt_1' };

    it('deve buscar pelo valor, listá-lo por extenso e dizer "Filtered by …" uma vez', async () => {
      chips().filterByValue(header);
      const search = await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }));
      expect(search.request.body).toMatchObject({
        match: { headers: { 'x-loja-event-id': { equals: 'evt_1' } } },
      });
      search.flush(requestPage(THREE.slice(0, 2), { total: 2 }));

      await vi.waitFor(
        () =>
          expect(result()).toBe(
            'Filtered by header x-loja-event-id = evt_1. 2 requests match · search runs on the server over all 3',
          ),
        { timeout: 2000 },
      );
      expect(filters().getAttribute('aria-label')).toBe('Filters, 1 active');
      expect(
        within(activeFilters() as HTMLElement).getByRole('button', {
          name: 'Remove this filter: header x-loja-event-id = evt_1',
        }),
      ).toBeTruthy();
      expect(chips().takeAdded()).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve voltar ao filtro anterior e marcar "not accepted" Quando a busca recusa o match', async () => {
      chips().filterByValue(header);
      (await vi.waitFor(() => http.expectOne({ method: 'POST', url: searchUrl }))).flush(
        { 'match.headers.x-loja-event-id': ['The match is invalid.'] },
        { status: 422, statusText: 'Unprocessable Content' },
      );
      (await vi.waitFor(() => http.expectOne(listUrl))).flush(requestPage(THREE));

      await vi.waitFor(() => expect(store.filter().values ?? []).toEqual([]));
      expect(activeFilters()?.textContent).toContain(
        'header x-loja-event-id = evt_1 — not accepted',
      );
      expect(filters().getAttribute('aria-label')).toBe('Filters');
      await userEvent.click(
        screen.getByRole('button', {
          name: 'Remove this filter: header x-loja-event-id = evt_1 — not accepted',
        }),
      );
      expect(activeFilters()).toBeNull();
    });

    it('deve trocar o valor do mesmo campo e somar o de outro', async () => {
      chips().filterByValue(header);
      chips().filterByValue({ ...header, value: 'evt_2' });
      chips().filterByValue({ kind: 'query', name: 'tipo', value: 'pix' });
      searches().forEach((search) => search.flush(requestPage([])));

      expect(store.filter().values).toEqual([
        { kind: 'header', name: 'x-loja-event-id', value: 'evt_2' },
        { kind: 'query', name: 'tipo', value: 'pix' },
      ]);
    });
  });

  it('deve voltar à lista completa, zerar os campos e dizer "Filters cleared" Quando "Clear filters" é clicado', async () => {
    await press('Schema invalid', THREE.slice(1, 2));
    await vi.waitFor(() => expect(result()).toMatch(/^1 request matches/), { timeout: 2000 });

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    http.expectOne(listUrl).flush(requestPage(THREE));

    await vi.waitFor(() => expect(result()).toBe('Filters cleared. 3 requests.'), {
      timeout: 2000,
    });
    // Fica só para o leitor de tela, e não é esvaziada depois.
    expect(screen.getAllByRole('status')[0].classList).toContain('quiet');
    expect(searches()).toHaveLength(0);
    expect(store.filtering()).toBe(false);
    expect(store.requests()).toHaveLength(3);
    expect((screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement).value).toBe('');
    expect(activeFilters()).toBeNull();
    await openPanel();
    expect(chip('Schema invalid').getAttribute('aria-pressed')).toBe('false');
  });

  it('deve dizer "No filter. {n} requests." Quando o último filtro é desligado', async () => {
    await press('POST', THREE.slice(0, 2));
    await vi.waitFor(() => expect(result()).toMatch(/^2 requests match/), { timeout: 2000 });

    await userEvent.click(screen.getByRole('button', { name: 'Remove this filter: method POST' }));
    http.expectOne(listUrl).flush(requestPage(THREE));

    await vi.waitFor(() => expect(result()).toBe('No filter. 3 requests.'), { timeout: 2000 });
  });

  // M1: o motivo exato e o caminho vêm do Health; a Entrada os mostra como filtros que se tiram.
  it('deve mostrar o motivo exato e o caminho do schema no painel e entre os ligados (M1)', async () => {
    const applied = store.applyFilter({
      ...NO_FILTER,
      signatureReason: 'signature mismatch',
      schemaPath: '',
    });
    searches()[0].flush(requestPage([], { total: 0 }));
    await applied;
    await openPanel();

    const motivo = await vi.waitFor(() => chip(/^signature: signature mismatch/));
    expect(motivo.getAttribute('aria-pressed')).toBe('true');
    expect(chip(/^schema error at \(root\)/).getAttribute('aria-pressed')).toBe('true');
    expect(filters().getAttribute('aria-label')).toBe('Filters, 2 active');
    expect(
      screen.getByRole('button', { name: 'Remove this filter: signature: signature mismatch' }),
    ).toBeTruthy();
    await expectNoAxeViolations(container);

    await userEvent.click(motivo);
    const [search] = searches();
    expect(search.request.body).toMatchObject({ schema_path: '' });
    expect(search.request.body).not.toHaveProperty('signature_reason');
    search.flush(requestPage([], { total: 0 }));
    expect(store.filter().signatureReason ?? null).toBeNull();
  });

  it('deve avisar do texto que ficou de fora Quando o wait-for é copiado antes de a busca rodar', async () => {
    vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'pedido');

    TestBed.inject(WaitFor).copy();

    await vi.waitFor(() =>
      expect(regions()[1]).toBe(
        'Copied. The text search is not part of wait-for: only the filters went into --match.',
      ),
    );
    await vi.waitFor(() => searches().forEach((search) => search.flush(requestPage([]))));
  });

  it('deve mostrar o aviso do "Copy as anzol wait-for", na região que já existia', async () => {
    vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    TestBed.inject(WaitFor).copy();

    await vi.waitFor(() => expect(regions()[1]).toBe('Copied the anzol wait-for command.'));
  });

  // INBOX-10/25: sem resultado, o "Clear filters" é o do estado vazio da lista (dois com o mesmo
  // nome confundem o leitor de tela).
  it('deve tirar o "Clear filters" da busca Quando o filtro não acha nada', async () => {
    await press('PUT', []);

    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Remove this filter: method PUT' })).toBeTruthy();
  });

  describe('Dado o teclado', () => {
    it('deve abrir pela tecla F com o foco no primeiro chip, e fechar por ela devolvendo o foco ao botão', async () => {
      await userEvent.keyboard('f');

      await vi.waitFor(() => expect(document.activeElement).toBe(chip('POST')));
      await userEvent.keyboard('f');
      expect(group()).toBeNull();
      expect(document.activeElement).toBe(filters());
    });

    it('não deve abrir pela tecla F digitada na busca, nem com os atalhos desligados', async () => {
      await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'f');
      expect(group()).toBeNull();
      await vi.waitFor(() => searches().forEach((search) => search.flush(requestPage([]))));

      (document.activeElement as HTMLElement).blur();
      TestBed.inject(ShellSettings).shortcuts.set(false);
      await userEvent.keyboard('f');
      expect(group()).toBeNull();
    });

    it('deve andar entre os chips com as setas, como uma parada só do Tab, e fechar com Esc', async () => {
      await userEvent.keyboard('f');
      await vi.waitFor(() => expect(document.activeElement).toBe(chip('POST')));

      await userEvent.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(chip('GET'));
      await userEvent.keyboard('{End}');
      expect(document.activeElement).toBe(chip('Answered 5xx'));
      await userEvent.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(chip('POST'));
      await userEvent.keyboard('{ArrowLeft}{Home}{ArrowDown}');
      expect(document.activeElement).toBe(chip('GET'));
      expect(
        within(group() as HTMLElement)
          .getAllByRole('button')
          .filter((button) => button.tabIndex >= 0),
      ).toEqual([chip('GET')]);

      await userEvent.keyboard(' ');
      expect(chip('GET').getAttribute('aria-pressed')).toBe('true');
      searches().forEach((search) => search.flush(requestPage([])));

      await userEvent.keyboard('{Escape}');
      expect(group()).toBeNull();
      expect(document.activeElement).toBe(filters());
    });
  });

  describe('Dado o celular', () => {
    beforeEach(() => windowClass.set('compact'));

    it('deve abrir os filtros como folha, com "Show {n} requests" e o wait-for dentro dela', async () => {
      await press('POST', THREE.slice(0, 2));

      expect(container.querySelector('app-filter-panel')?.classList).toContain('sheet');
      expect(screen.getByRole('button', { name: 'Copy as anzol wait-for' })).toBeTruthy();
      await expectNoAxeViolations(container);

      await userEvent.click(screen.getByRole('button', { name: 'Show 2 requests' }));
      expect(group()).toBeNull();
      expect(document.activeElement).toBe(filters());
    });

    it('deve dizer "Show 1 request" no singular, e o total da URL sem filtro', async () => {
      await openPanel();
      expect(screen.getByRole('button', { name: 'Show 3 requests' })).toBeTruthy();

      await press('POST');
      expect(await screen.findByRole('button', { name: 'Show 1 request' })).toBeTruthy();
    });
  });

  // INBOX-08: o texto diz o que a busca do servidor olha, e o "/" do atalho fica à vista.
  it('deve dizer onde busca e mostrar o atalho "/"', () => {
    const box = screen.getByRole('textbox', { name: 'Search' });
    expect(box.getAttribute('placeholder')).toBe('Search path, IP, header or body');
    expect(container.querySelector('[role="search"] kbd')?.textContent).toBe('/');
  });
});
