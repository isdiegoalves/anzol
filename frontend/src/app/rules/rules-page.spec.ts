import { LiveAnnouncer } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subject } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { FakeEventSource } from '../../testing/fake-event-source';
import { rule } from '../../testing/rule-fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { Viewport, WindowClass } from '../shell/viewport';
import { TokenStats } from '../stats/stats';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { Rule } from './rule';
import { ruleFromRequest } from './rule-from-request';
import { RuleStore } from './rule-store';
import { RulesPage } from './rules-page';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const URL_STATS = `/token/${TOKEN_ID}/stats`;
const URL_MENSAGENS = `/token/${TOKEN_ID}/requests`;

/** `stats` com os hits por regra; o resto não importa para a lista. */
function stats(rules: Partial<TokenStats['rules']> = {}, evaluated = 12): Partial<TokenStats> {
  return { evaluated, rules: { answered: [], near_miss: [], default: 0, ...rules } };
}

describe('Dado a página Rules', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const windowClass = signal<WindowClass>('large');
  /** Nome, prioridade ("P1"), match e status de cada linha (o item de 3 linhas do C, RULES-01). */
  const rows = () =>
    [...document.querySelectorAll('tbody tr[data-rule-id]')].map((row) =>
      ['.name', '.priority', '.match', '.status .code'].map((part) =>
        row.querySelector(part)?.textContent?.trim(),
      ),
    );
  /** O botão da linha, que abre o editor (RULES-01/04). */
  const openButton = (id: string) => row(id).querySelector('td.item button') as HTMLButtonElement;
  const row = (id: string) => document.querySelector(`[data-rule-id="${id}"]`) as HTMLElement;
  const renderPage = async (
    inputs: { ruleId?: string; from?: string } = {},
    configure?: () => void,
  ) => {
    const result = await render(RulesPage, {
      inputs: { tokenId: TOKEN_ID, ...inputs },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Viewport, useValue: { windowClass } },
      ],
      configureTestBed: () => {
        TestBed.inject(Preferences).token.set(token());
        configure?.();
      },
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return result;
  };
  /** Abre a página com as regras salvas e os hits de `stats`. */
  const open = async (
    rules: Rule[],
    inputs: { ruleId?: string; from?: string } = {},
    hits: Partial<TokenStats> = stats(),
  ) => {
    const result = await renderPage(inputs);
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(rules);
    await vi.waitFor(() => http.expectOne(URL_STATS).flush(hits));
    await screen.findByRole('table', { name: 'Rules' });
    return result;
  };
  /** Lista vazia: a página lê a mensagem mais nova (o cartão "Create from the latest request"). */
  const flushLatest = (data: unknown[]) =>
    vi.waitFor(() =>
      http
        .expectOne((req) => req.url === URL_MENSAGENS && req.params.get('per_page') === '1')
        .flush({ data, total: data.length, is_last_page: true }),
    );
  /** O `PUT` das mudanças que partem da lista lê antes a do servidor (`saveIfUnchanged`). */
  const expectGuardedPut = async (server: Rule[], lista: Rule[]) => {
    await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(server));
    await expectPut(lista);
  };
  const expectPut = async (lista: Rule[]) => {
    const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    expect(call.request.body).toEqual(lista);
    call.flush(lista);
  };

  // A página assina o SSE da URL (WM-38); o jsdom não tem EventSource.
  beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));

  afterEach(() => {
    windowClass.set('large');
    // O editor aberto lê a mensagem mais nova como exemplo (WM-16, F3): não é assunto da lista.
    http.match(
      (req) => req.params.get('sorting') === 'newest' && req.params.get('per_page') === '1',
    );
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('deve listar nome, prioridade, match e status na ordem de avaliação, com os hits e a resposta padrão no fim', async () => {
    const { container } = await open(
      [
        rule(1, { priority: 5 }),
        rule(2, {
          name: 'Pix',
          priority: 1,
          match: { method: ['GET', 'HEAD'], path: { prefix: '/api' } },
        }),
      ],
      {},
      stats(
        {
          answered: [{ id: 'r2', name: 'Pix', count: 41 }],
          near_miss: [{ id: 'r1', name: 'Rule 1', count: 3 }],
          default: 84,
        },
        128,
      ),
    );

    expect(rows()).toEqual([
      ['Pix', 'P1', 'GET, HEAD · path starts with /api', '202'],
      ['Rule 1', 'P5', 'POST /r1', '201'],
    ]);
    expect(row('r2').querySelector('.hits')?.textContent?.trim()).toBe(
      'Answered 41 of the last 128',
    );
    expect(row('r1').querySelector('.hits')?.textContent?.trim()).toBe(
      'Answered 0 of the last 128 · 3 near misses',
    );
    // Sem botões Edit/Delete na linha: a linha inteira abre o editor (RULES-04).
    expect(within(row('r1')).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(row('r1')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(row('r1')).getByRole('button', { name: 'Rule 1' })).toBe(openButton('r1'));
    // A resposta padrão é um link para Checks › Response, com o tipo e o atraso (RULES-09).
    const padrao = document.querySelector('tfoot tr') as HTMLElement;
    const link = within(padrao).getByRole('link', { name: 'Default response' });
    expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/checks?section=response`);
    expect(padrao.textContent).toContain('When no rule matches · text/plain · no delay');
    expect(padrao.querySelector('.status .code')?.textContent?.trim()).toBe('200');
    expect(padrao.querySelector('.hits')?.textContent?.trim()).toBe('Answered 84');
    expect(screen.getByText('Hits over the last 128 requests kept.')).toBeTruthy();
    // A tabela que rola de lado recebe foco pelo teclado (axe scrollable-region-focusable, E11).
    const rolagem = screen.getByRole('region', { name: 'Rule table' });
    expect(rolagem.getAttribute('tabindex')).toBe('0');
    await expectNoAxeViolations(container);
  });

  it('deve funcionar sem os hits Quando stats falha', async () => {
    await renderPage();
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]);
    await vi.waitFor(() => http.expectOne(URL_STATS).flush({}, { status: 500, statusText: 'x' }));
    await screen.findByRole('table', { name: 'Rules' });

    // Sem os hits, a linha 3 diz que eles não vieram, e não "Answered 0" (guia §3.2, estados).
    expect(row('r1').querySelector('.hits')?.textContent?.trim()).toBe('Hits unavailable');
  });

  it('deve dizer a janela no singular Quando a URL guarda só uma requisição', async () => {
    await open([rule(1)], {}, stats({}, 1));

    expect(await screen.findByText('Hits over the last 1 request kept.')).toBeTruthy();
  });

  it('deve ser o main da tela, com o nome do destino', async () => {
    await open([rule(1)]);

    expect(screen.getByRole('main', { name: 'Rules' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Rules',
    ]);
  });

  it('deve explicar que não há regras Quando a lista está vazia', async () => {
    await open([]);
    await flushLatest([]);

    expect(screen.getByText(/No rules yet/)).toBeTruthy();
    expect(rows()).toEqual([]);
  });

  it('deve carregar a URL no cabeçalho Quando o link aponta para outra URL que a salva', async () => {
    await render(RulesPage, {
      inputs: { tokenId: TOKEN_ID },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);

    http.expectOne(URL_REGRAS).flush([]);
    http.expectOne(`/token/${TOKEN_ID}`).flush(token());
    await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));
    await flushLatest([]);

    expect(TestBed.inject(Preferences).token()?.uuid).toBe(TOKEN_ID);
  });

  it('não deve permitir criar, importar nem exportar Quando a lista ainda não carregou (o PUT apagaria as regras salvas)', async () => {
    await renderPage();

    for (const name of ['New rule', 'Import', 'Export']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    http.expectOne(URL_REGRAS).flush([rule(1)]);
    await vi.waitFor(() =>
      expect((screen.getByRole('button', { name: 'New rule' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    http.expectOne(URL_STATS).flush(stats());
  });

  it('deve avisar e não listar Quando a URL não existe mais (410)', async () => {
    await renderPage();

    http.expectOne(URL_REGRAS).flush({ success: false }, { status: 410, statusText: 'Gone' });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'This URL no longer exists (410).',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  describe('Dado o cabeçalho e a regra desligada (RULES-06/08)', () => {
    it('deve contar as ligadas ao lado do h1, com a frase curta e Import/Export com rótulo (WM-19)', async () => {
      await open([rule(1), rule(2, { enabled: false }), rule(3)]);

      const titulo = screen.getByRole('heading', { name: 'Rules', level: 1 });
      expect(titulo.parentElement?.querySelector('.count')?.textContent?.trim()).toBe('3 · 2 on');
      // Sem espaço nas pontas: o texto é casado inteiro (RULES-06).
      expect(document.querySelector('.heading .hint')?.textContent).toBe(
        "Rules are checked in this order. The first one that matches answers. A catch-all rule answers whatever is left; the URL's default response answers when no rule does.",
      );
      for (const name of ['Import', 'Export']) {
        const botao = screen.getByRole('button', { name });
        expect(botao.getAttribute('title')).toMatch(/\S/);
        expect(botao.textContent?.trim()).toBe(name);
      }
      expect(screen.getByText('Hits over the last 12 requests kept.')).toBeTruthy();
    });

    // WM-29, AT-42: sem mensagens, nada de "the last 0"; com mensagens, a frase de sempre.
    it('deve dizer que ainda não há requisições em vez de "the last 0 requests"', async () => {
      await open([rule(1)], {}, stats({}, 0));

      expect(document.querySelector('.hint.window')?.textContent).toBe(
        'No requests yet: the hits start with the first one.',
      );
    });

    it('deve marcar a regra desligada com OFF e dizer que ela não é avaliada no lugar dos hits', async () => {
      await open([rule(1), rule(2, { enabled: false })]);

      expect(row('r2').querySelector('.off')?.textContent?.trim()).toBe('OFF');
      expect(row('r2').querySelector('.hits')?.textContent?.trim()).toBe('Not checked while off');
      expect(row('r1').querySelector('.off')).toBeNull();
    });
  });

  describe('Dado uma mudança que parte da lista (toggle, ordem, apagar)', () => {
    it('deve salvar a lista inteira com a regra desligada Quando o toggle é desligado', async () => {
      await open([rule(1), rule(2)]);

      await userEvent.click(screen.getByRole('switch', { name: 'Enable rule Rule 2' }));

      await expectGuardedPut([rule(1), rule(2)], [rule(1), { ...rule(2), enabled: false }]);
      expect(
        screen.getByRole('switch', { name: 'Enable rule Rule 2' }).getAttribute('aria-checked'),
      ).toBe('false');
    });

    it('não deve salvar, deve avisar e voltar o switch Quando a lista mudou em outro lugar', async () => {
      await open([rule(1), rule(2)]);

      await userEvent.click(screen.getByRole('switch', { name: 'Enable rule Rule 2' }));
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(2), rule(3)]),
      );

      const alert = await screen.findByText(/The rules changed elsewhere/);
      expect(alert.closest('[role=alert]')).not.toBeNull();
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
      expect(
        screen.getByRole('switch', { name: 'Enable rule Rule 2' }).getAttribute('aria-checked'),
      ).toBe('true');

      await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(2), rule(3)]);
      await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));
      await vi.waitFor(() => expect(rows()).toHaveLength(3));
      expect(screen.queryByText(/The rules changed elsewhere/)).toBeNull();
    });

    it('deve trocar ordem e prioridades Quando "Move up" é clicado numa regra de prioridade maior', async () => {
      await open([rule(1, { priority: 1 }), rule(2, { priority: 5 })]);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();

      await userEvent.click(within(row('r2')).getByRole('button', { name: 'Move up' }));

      await expectGuardedPut(
        [rule(1, { priority: 1 }), rule(2, { priority: 5 })],
        [rule(2, { priority: 1 }), rule(1, { priority: 5 })],
      );
      await vi.waitFor(() => expect(rows().map((r) => r[0])).toEqual(['Rule 2', 'Rule 1']));
      expect(announce).toHaveBeenCalledWith('Rule 2 moved to position 1 of 2', ANNOUNCEMENT_MS);
    });

    it('deve só trocar a ordem Quando "Move down" é clicado entre regras de mesma prioridade', async () => {
      await open([rule(1), rule(2), rule(3)]);

      await userEvent.click(within(row('r1')).getByRole('button', { name: 'Move down' }));

      await expectGuardedPut([rule(1), rule(2), rule(3)], [rule(2), rule(1), rule(3)]);
    });

    it('não deve oferecer subir a primeira nem descer a última', async () => {
      await open([rule(1), rule(2)]);

      expect(
        (within(row('r1')).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (within(row('r2')).getByRole('button', { name: 'Move down' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it('deve mover com as setas na alça "Reorder", anunciar a posição e manter o foco nela', async () => {
      await open([rule(1), rule(2), rule(3)]);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();

      screen.getByRole('button', { name: 'Reorder Rule 1' }).focus();
      await userEvent.keyboard('{ArrowDown}');

      await expectGuardedPut([rule(1), rule(2), rule(3)], [rule(2), rule(1), rule(3)]);
      await vi.waitFor(() =>
        expect(announce).toHaveBeenCalledWith('Rule 1 moved to position 2 of 3', ANNOUNCEMENT_MS),
      );
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Rule 1' })),
      );
    });

    it('não deve mover com a seta para cima na primeira regra', async () => {
      await open([rule(1), rule(2)]);

      screen.getByRole('button', { name: 'Reorder Rule 1' }).focus();
      await userEvent.keyboard('{ArrowUp}');

      http.expectNone({ method: 'GET', url: URL_REGRAS });
    });

    it('deve salvar sem a regra, voltar à lista e oferecer desfazer Quando "Delete rule" é clicado no editor', async () => {
      await open([rule(1), rule(2)], { ruleId: 'r1' });
      const desfazer = new Subject<void>();
      const snack = vi
        .spyOn(TestBed.inject(MatSnackBar), 'open')
        .mockReturnValue({ onAction: () => desfazer } as unknown as ReturnType<
          MatSnackBar['open']
        >);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete rule' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(2)]);
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Rule deleted', 'Undo', { duration: 5000 }),
      );
      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules']);

      desfazer.next();
      await expectGuardedPut([rule(2)], [rule(1), rule(2)]);
    });

    it('não deve desfazer o Delete e deve avisar Quando a lista mudou em outro lugar depois de apagar', async () => {
      await open([rule(1), rule(2)], { ruleId: 'r1' });
      const desfazer = new Subject<void>();
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockReturnValue({
        onAction: () => desfazer,
      } as unknown as ReturnType<MatSnackBar['open']>);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete rule' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(2)]);
      await vi.waitFor(() => expect(snack).toHaveBeenCalled());
      desfazer.next();
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(2), rule(3)]),
      );

      expect(await screen.findByText(/The rules changed elsewhere/)).toBeTruthy();
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
    });
    it('deve avisar na página aberta depois Quando o Undo acha a lista mudada (o editor fechou e a rota trocou)', async () => {
      await open([rule(1)]);

      TestBed.inject(RuleStore).changedElsewhere.set(true);

      expect(
        (await screen.findByText(/The rules changed elsewhere/)).closest('[role=alert]'),
      ).not.toBeNull();
    });

    it('deve devolver só a regra apagada, sem apagar a de outra aba, Quando o Undo vem depois de um Reload', async () => {
      await open([rule(1), rule(2)], { ruleId: 'r2' });
      const desfazer = new Subject<void>();
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockReturnValue({
        onAction: () => desfazer,
      } as unknown as ReturnType<MatSnackBar['open']>);

      // Apaga a regra 2; outra aba acrescenta a 3; o toggle avisa e a lista é relida.
      await userEvent.click(await screen.findByRole('button', { name: 'Delete rule' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(1)]);
      await vi.waitFor(() => expect(snack).toHaveBeenCalled());
      await userEvent.click(screen.getByRole('switch', { name: 'Enable rule Rule 1' }));
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(3)]),
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Reload' }));
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(3)]);
      await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));
      await vi.waitFor(() => expect(rows()).toHaveLength(2));

      desfazer.next();

      // A regra 2 volta à posição de antes, sobre a lista de agora: a 3 continua.
      await expectGuardedPut([rule(1), rule(3)], [rule(1), rule(2), rule(3)]);
    });
  });

  describe('Dado o editor aberto pela rota', () => {
    // O formulário vem por import(), que frio, numa máquina ocupada, passa do 1 s das esperas:
    // carregado antes, os testes medem o editor, não o carregamento do módulo.
    beforeAll(() => import('./rule-suggest-form'));

    it('deve levar a rules/new Quando "New rule" é clicado e a rules/{id} Quando a linha é clicada', async () => {
      await open([rule(1)]);

      await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
      await userEvent.click(openButton('r1'));

      expect(navigate.mock.calls).toEqual([
        [['/', TOKEN_ID, 'rules', 'new']],
        [['/', TOKEN_ID, 'rules', 'r1']],
      ]);
    });

    it('deve mostrar a região "Edit rule {nome}" ao lado da lista e passar no axe', async () => {
      const { container } = await open([rule(1), rule(2)], { ruleId: 'r2' });

      const editor = await screen.findByRole('region', { name: 'Edit rule Rule 2' });
      expect(
        (within(editor).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
      ).toBe('Rule 2');
      expect(
        within(editor)
          .getAllByRole('tab')
          .map((tab) => tab.textContent?.trim().split(/\s/)[0]),
      ).toEqual(['Match', 'Response', 'Scenario', 'Test']);
      expect(openButton('r2').getAttribute('aria-current')).toBe('true');
      expect(openButton('r1').hasAttribute('aria-current')).toBe(false);
      // Lista e editor lado a lado com a divisória do app-split (RULES-10/11): a lista mostra tudo.
      expect(screen.getByRole('separator', { name: 'Resize rule list and editor' })).toBeTruthy();
      expect(row('r1').querySelector('.match')?.textContent?.trim()).toBe('POST /r1');
      await expectNoAxeViolations(container);
    });

    it('deve mostrar só o editor, sem a lista, Quando a janela é estreita', async () => {
      windowClass.set('expanded');
      await renderPage({ ruleId: 'r1' });
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]);
      await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));

      await screen.findByRole('region', { name: 'Edit rule Rule 1' });
      expect(screen.queryByRole('table', { name: 'Rules' })).toBeNull();
      expect(screen.queryByRole('separator')).toBeNull();
    });

    it('deve deixar só o aviso do editor Quando a regra aberta sai da lista (apagada em outra aba)', async () => {
      await open([rule(1), rule(2)], { ruleId: 'r2' });
      const editor = await screen.findByRole('region', { name: 'Edit rule Rule 2' });

      // O Save acha a lista mudada; o Reload do editor traz a lista sem a regra 2.
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]));
      await userEvent.click(await within(editor).findByRole('button', { name: 'Reload' }));
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]);

      await vi.waitFor(() =>
        expect(screen.getAllByRole('alert').map((alert) => alert.textContent?.trim())).toEqual([
          'This rule no longer exists in the list; Save adds it as a new rule.',
        ]),
      );
    });

    it('deve avisar Quando a regra da rota não existe', async () => {
      await open([rule(1)], { ruleId: 'sumiu' });

      expect(screen.getByRole('alert').textContent).toContain('This rule no longer exists.');
      expect(screen.queryByRole('region', { name: /rule/ })).toBeNull();
    });

    it('deve partir da mensagem de "?from=" e usá-la como exemplo', async () => {
      const mensagem = webhookRequest(4, { url: `http://localhost/${TOKEN_ID}/pedidos` });
      await renderPage({ ruleId: 'new', from: mensagem.uuid });
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]);
      http.expectOne(`/token/${TOKEN_ID}/request/${mensagem.uuid}`).flush(mensagem);
      await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));

      const editor = await screen.findByRole('region', { name: 'New rule' });
      expect(
        (within(editor).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
      ).toBe(ruleFromRequest(mensagem).name);
      // O "Describe the rule" carrega o formulário ao abrir (RULES-16).
      await userEvent.click(within(editor).getByText('Describe the rule'));
      expect(await within(editor).findByText(/Use the open request as example/)).toBeTruthy();
    });

    it.each([
      ['desta URL', TOKEN_ID, true],
      ['de outra URL', '11111111-2222-4333-8444-555555555555', false],
    ])(
      'deve oferecer a mensagem aberta como exemplo só se ela for desta URL Quando a aberta é %s',
      async (_caso, tokenId, oferece) => {
        await renderPage({ ruleId: 'new' }, () =>
          vi
            .spyOn(TestBed.inject(RequestStore), 'selected')
            .mockReturnValue(webhookRequest(3, { token_id: tokenId })),
        );
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([]);
        await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));

        const editor = await screen.findByRole('region', { name: 'New rule' });
        await userEvent.click(within(editor).getByText('Describe the rule'));
        await within(editor).findByRole('textbox', { name: 'Describe the rule' });
        const box = within(editor).getByRole('checkbox', {
          name: /Use the open request as example/,
        });
        expect(box.getAttribute('aria-disabled') === 'true').toBe(!oferece);
      },
    );

    /**
     * `rules` e `rules/{id}` são rotas diferentes: cada troca cria outra instância da página. Aqui,
     * como o router: destrói a página e abre outra na rota nova, com a lista relida.
     */
    const routeTo = async (
      fixture: ComponentFixture<RulesPage>,
      ruleId: string | undefined,
      rules: Rule[],
    ) => {
      fixture.destroy();
      const next = TestBed.createComponent(RulesPage);
      next.componentRef.setInput('tokenId', TOKEN_ID);
      next.componentRef.setInput('ruleId', ruleId);
      document.body.appendChild(next.nativeElement);
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(rules));
      await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));
      return next;
    };

    it('deve levar o foco ao nome no topo do editor Quando a regra é aberta com Enter na lista', async () => {
      const { fixture } = await open([rule(1), rule(2)]);

      openButton('r2').focus();
      await userEvent.keyboard('{Enter}');
      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules', 'r2']);
      await routeTo(fixture, 'r2', [rule(1), rule(2)]);

      const editor = await screen.findByRole('region', { name: 'Edit rule Rule 2' });
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(within(editor).getByRole('textbox', { name: 'Name' })),
      );
    });

    it.each([
      ['lado a lado', 'large' as WindowClass, 'Discard'],
      // F8: na folha do editor, a saída é o "Back to list" do cabeçalho.
      ['só o editor', 'expanded' as WindowClass, 'Back to list'],
    ])(
      'deve devolver o foco ao item da regra Quando o editor é descartado (%s)',
      async (_, janela, saida) => {
        windowClass.set(janela);
        // Na janela estreita, a lista só aparece de novo quando o editor fecha.
        const { fixture } = await renderPage({ ruleId: 'r2' });
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(2)]);
        await vi.waitFor(() => http.expectOne(URL_STATS).flush(stats()));
        const editor = await screen.findByRole('region', { name: 'Edit rule Rule 2' });

        await userEvent.click(within(editor).getByRole('button', { name: saida }));
        await vi.waitFor(() => expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules']));
        await routeTo(fixture, undefined, [rule(1), rule(2)]);

        await vi.waitFor(() => expect(document.activeElement).toBe(openButton('r2')));
      },
    );

    it('deve devolver o foco a "New rule" Quando a regra nova é descartada', async () => {
      const { fixture } = await open([rule(1)], { ruleId: 'new' });
      const editor = await screen.findByRole('region', { name: 'New rule' });

      await userEvent.click(within(editor).getByRole('button', { name: 'Discard' }));
      await routeTo(fixture, undefined, [rule(1)]);

      await vi.waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New rule' })),
      );
    });

    it('deve voltar à lista e avisar Quando a regra é salva, e só voltar Quando é cancelada', async () => {
      await open([rule(1)], { ruleId: 'new' });
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
      const editor = await screen.findByRole('region', { name: 'New rule' });

      await userEvent.click(within(editor).getByRole('button', { name: 'Discard' }));
      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules']);
      expect(snack).not.toHaveBeenCalled();

      await userEvent.type(within(editor).getByRole('textbox', { name: 'Name' }), 'Nova');
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]));
      const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      expect((call.request.body as Rule[]).map((r) => r.name)).toEqual(['Rule 1', 'Nova']);
      call.flush([rule(1), rule(2, { name: 'Nova' })]);

      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Rule saved', undefined, {
          duration: 4000,
          politeness: 'off',
        }),
      );
      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules']);
    });

    it('deve salvar a regra editada no lugar dela Quando a lista foi reordenada com o editor aberto', async () => {
      await open([rule(1, { priority: 1 }), rule(2, { priority: 5 })], { ruleId: 'r1' });
      const editor = await screen.findByRole('region', { name: 'Edit rule Rule 1' });

      await userEvent.click(within(row('r2')).getByRole('button', { name: 'Move up' }));
      await expectGuardedPut(
        [rule(1, { priority: 1 }), rule(2, { priority: 5 })],
        [rule(2, { priority: 1 }), rule(1, { priority: 5 })],
      );
      const name = within(editor).getByRole('textbox', { name: 'Name' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Editada');
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

      await vi.waitFor(() =>
        http
          .expectOne({ method: 'GET', url: URL_REGRAS })
          .flush([rule(2, { priority: 1 }), rule(1, { priority: 5 })]),
      );
      const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      expect((call.request.body as Rule[]).map((r) => r.name)).toEqual(['Rule 2', 'Editada']);
      call.flush(call.request.body as Rule[]);
    });
  });

  describe('Dado regras com template, atraso, falha ou cenário', () => {
    const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;
    const comCenario = rule(2, {
      scenario: { name: 'Retry', requiredState: 'Started', newState: 'falhou-1' },
    });
    const flags = (id: string) =>
      [...row(id).querySelectorAll('.flag')].map((flag) => [
        flag.textContent?.trim(),
        flag.getAttribute('title'),
      ]);
    const flushScenarios = () =>
      vi.waitFor(() =>
        http
          .expectOne({ method: 'GET', url: URL_CENARIOS })
          .flush([{ name: 'Retry', state: 'falhou-1', states: ['Started', 'falhou-1'] }]),
      );

    it('deve mostrar indicadores discretos com o detalhe no título, sem mudar as colunas da lista', async () => {
      await open([
        rule(1, { response: { template: true, delay: { fixed: 250 }, fault: null } }),
        rule(3, { response: { fault: 'empty_response' } }),
      ]);

      expect(flags('r1')).toEqual([
        ['Template', 'Body and header values are templates'],
        ['Delay', 'Delay: 250 ms'],
      ]);
      expect(flags('r3')).toEqual([['Fault', 'Fault: empty response (close without writing)']]);
      expect(rows()[0]).toEqual(['Rule 1', 'P5', 'POST /r1 · delay 250 ms', '200']);
      // L11: o selo já diz "Fault"; o lugar do status mostra o tipo, e não um segundo "Fault".
      expect(document.querySelector('tr[data-rule-id="r3"] .status')?.textContent?.trim()).toBe(
        'Empty response',
      );
    });

    it('não deve pedir os cenários nem mostrar o painel Quando nenhuma regra usa cenário', async () => {
      await open([rule(1)]);

      http.expectNone({ method: 'GET', url: URL_CENARIOS });
      expect(document.querySelector('app-scenario-panel')).toBeNull();
    });

    it('não deve mostrar os cenários abaixo da lista: eles ficam na aba Scenario do editor (RULES-12)', async () => {
      await open([rule(1), comCenario]);
      await flushScenarios();

      expect(document.querySelector('app-scenario-panel')).toBeNull();
      expect(screen.queryByRole('table', { name: 'Scenarios' })).toBeNull();
    });

    it('deve agrupar as regras do cenário sob um cabeçalho com o estado atual e dizer a transição (RULES-07)', async () => {
      await open([rule(1), comCenario]);
      await flushScenarios();

      const grupo = document.querySelector('tbody tr.scenario-group') as HTMLElement;
      await vi.waitFor(() =>
        expect(grupo.querySelector('.state')?.textContent?.trim()).toBe('state: falhou-1'),
      );
      expect(grupo.querySelector('th[scope="rowgroup"]')?.textContent).toContain(
        'Scenario "Retry"',
      );
      // O cabeçalho vem logo antes da regra do cenário.
      expect(grupo.nextElementSibling?.getAttribute('data-rule-id')).toBe('r2');
      expect(row('r2').querySelector('.hits')?.textContent?.trim()).toBe(
        'Started → falhou-1 · Answered 0 of the last 12',
      );
    });
  });

  describe('Dado "Turn all rules off" (WM-37)', () => {
    it('deve confirmar dizendo quantas param, desligar todas e oferecer Desfazer', async () => {
      await open([rule(1), rule(2), rule(3, { enabled: false })]);
      const onAction = new Subject<void>();
      const snack = vi
        .spyOn(TestBed.inject(MatSnackBar), 'open')
        .mockReturnValue({ onAction: () => onAction } as never);

      await userEvent.click(screen.getByRole('button', { name: 'Turn all rules off' }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Turn all rules off?' }));
      expect(dialog.getByText('2 rules stop answering until turned on again.')).toBeTruthy();
      await userEvent.click(dialog.getByRole('button', { name: 'Turn off' }));

      const off = [rule(1), rule(2), rule(3)].map((r) => ({ ...r, enabled: false }));
      await expectGuardedPut([rule(1), rule(2), rule(3, { enabled: false })], off);
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('2 rules turned off', 'Undo', { duration: 5000 }),
      );
      onAction.next();
      await expectGuardedPut(off, [rule(1), rule(2), rule(3, { enabled: false })]);
    });

    it('não deve gravar nada Quando a confirmação é cancelada', async () => {
      await open([rule(1)]);

      await userEvent.click(screen.getByRole('button', { name: 'Turn all rules off' }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Turn all rules off?' }));
      expect(dialog.getByText('1 rule stops answering until turned on again.')).toBeTruthy();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

      http.expectNone({ method: 'GET', url: URL_REGRAS });
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });

  describe('Dado o export e o import', () => {
    const chooseFile = (content: string) => {
      const input = document.querySelector<HTMLInputElement>('input[type=file]');
      if (!input) {
        throw new Error('sem input de arquivo');
      }
      const file = new File([content], 'rules.json', { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    };
    const alertText = () => document.querySelector('[role=alert]')?.textContent ?? '';

    // L3: o input de arquivo escondido não é parada do Tab; o "Import" já o aciona.
    it('deve ir do "Import" direto ao "Export" pelo Tab', async () => {
      await open([rule(1)]);

      screen.getByRole('button', { name: 'Import' }).focus();
      await userEvent.tab();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Export' }));
    });

    it('deve baixar o JSON do GET /rules com o nome da URL Quando "Export" é clicado', async () => {
      await open([rule(1)]);
      const blobs: Blob[] = [];
      vi.stubGlobal('URL', {
        createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:regras'),
        revokeObjectURL: vi.fn(),
      });
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);

      await userEvent.click(screen.getByRole('button', { name: 'Export' }));
      http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1), rule(2)]);

      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(`rules-${TOKEN_ID}.json`);
      expect(JSON.parse(await blobs[0].text())).toEqual([rule(1), rule(2)]);
      vi.unstubAllGlobals();
    });

    /** O diálogo "Import rules" (WM-19) já aberto pelo arquivo escolhido. */
    const importDialog = () => screen.findByRole('dialog', { name: 'Import rules' });

    it('deve mostrar a diferença por id antes de gravar e não gravar nada Quando cancela', async () => {
      await open([rule(1), rule(2), rule(3)]);

      chooseFile(
        JSON.stringify([
          rule(1),
          rule(2, { name: 'Pix pago', response: { ...rule(2).response, status: 200 } }),
          { ...rule(9), id: undefined },
        ]),
      );

      const dialog = within(await importDialog());
      expect(dialog.getByText('This file has 3 rules. Compared with the 3 saved:')).toBeTruthy();
      expect(dialog.getByText('1 unchanged · 1 changed · 1 removed · 1 new')).toBeTruthy();
      expect(
        dialog.getByText('Pix pago — name "Rule 2" → "Pix pago"; response.status 202 → 200'),
      ).toBeTruthy();
      expect(dialog.getByRole('radio', { name: 'Replace the 3 saved rules' })).toBeTruthy();
      expect(dialog.getByRole('radio', { name: 'Merge: keep the 3, add 1' })).toBeTruthy();
      await expectNoAxeViolations(document.body);

      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
      http.expectNone({ method: 'GET', url: URL_REGRAS });
    });

    it('deve substituir a lista pelo arquivo e oferecer Desfazer Quando "Replace" é escolhido', async () => {
      await open([rule(1)]);
      const onAction = new Subject<void>();
      const snack = vi
        .spyOn(TestBed.inject(MatSnackBar), 'open')
        .mockReturnValue({ onAction: () => onAction } as never);

      chooseFile(JSON.stringify([rule(7), rule(8)]));
      await userEvent.click(within(await importDialog()).getByRole('button', { name: 'Replace' }));

      await expectGuardedPut([rule(1)], [rule(7), rule(8)]);
      await vi.waitFor(() => expect(rows().map((r) => r[0])).toEqual(['Rule 7', 'Rule 8']));
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Imported 2 rules', 'Undo', { duration: 5000 }),
      );

      onAction.next();

      await expectGuardedPut([rule(7), rule(8)], [rule(1)]);
    });

    it('deve manter as salvas e acrescentar só as de id novo Quando "Merge" é escolhido', async () => {
      await open([rule(1), rule(2)]);

      chooseFile(JSON.stringify([rule(2, { name: 'Mudada' }), rule(5)]));
      const dialog = within(await importDialog());
      await userEvent.click(dialog.getByRole('radio', { name: 'Merge: keep the 2, add 1' }));
      await userEvent.click(dialog.getByRole('button', { name: 'Merge' }));

      await expectGuardedPut([rule(1), rule(2)], [rule(1), rule(2), rule(5)]);
    });

    it('deve desabilitar o "Merge" e dizer o motivo Quando passaria de 100 regras', async () => {
      const salvas = Array.from({ length: 99 }, (_, i) => rule(i + 1));
      await open(salvas);

      chooseFile(JSON.stringify([rule(200), rule(201)]));

      const dialog = within(await importDialog());
      expect(
        (dialog.getByRole('radio', { name: 'Merge: keep the 99, add 2' }) as HTMLInputElement)
          .disabled,
      ).toBe(true);
      expect(dialog.getByText('Would exceed 100 rules.')).toBeTruthy();
      await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    });

    it('deve mostrar os erros do servidor e manter a lista Quando o import responde 422', async () => {
      await open([rule(1)]);

      chooseFile(JSON.stringify([rule(7)]));
      await userEvent.click(within(await importDialog()).getByRole('button', { name: 'Replace' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]));
      const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      call.flush(
        { '0.match.path.regex': ['The regex is invalid.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      await vi.waitFor(() =>
        expect(alertText()).toContain('Rule 1 › match.path.regex: The regex is invalid.'),
      );
      expect(rows().map((r) => r[0])).toEqual(['Rule 1']);
    });

    it.each([
      ['não é JSON', '{', 'The file is not valid JSON.'],
      ['não é uma lista', '{"name":"a"}', 'The file must contain a JSON list of rules.'],
    ])(
      'não deve chamar a API e deve explicar Quando o arquivo %s',
      async (_caso, conteudo, erro) => {
        await open([rule(1)]);

        chooseFile(conteudo);

        await vi.waitFor(() => expect(alertText()).toContain(erro));
        http.expectNone({ method: 'PUT', url: URL_REGRAS });
        expect(document.querySelector('ul[role]')).toBeNull();
        await expectNoAxeViolations(document.body);
      },
    );
  });
});
