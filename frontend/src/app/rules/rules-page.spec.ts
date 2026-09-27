import { LiveAnnouncer } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subject } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { TokenStats } from '../stats/stats';
import { Rule } from './rule';
import { ruleFromRequest } from './rule-from-request';
import { RulesPage } from './rules-page';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const URL_STATS = `/token/${TOKEN_ID}/stats`;

/** `stats` com os hits por regra; o resto não importa para a lista. */
function stats(rules: Partial<TokenStats['rules']> = {}, evaluated = 12): Partial<TokenStats> {
  return { evaluated, rules: { answered: [], near_miss: [], default: 0, ...rules } };
}

describe('Dado a página Rules', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const rows = () =>
    [...document.querySelectorAll('tbody tr[data-rule-id]')].map((row) =>
      [...row.querySelectorAll('td.data')].map((cell) => cell.textContent?.trim()),
    );
  const row = (id: string) => document.querySelector(`[data-rule-id="${id}"]`) as HTMLElement;
  const renderPage = async (
    inputs: { ruleId?: string; from?: string } = {},
    configure?: () => void,
  ) => {
    const result = await render(RulesPage, {
      inputs: { tokenId: TOKEN_ID, ...inputs },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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

  afterEach(() => {
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
      ['Pix', '1', 'GET, HEAD /api*', '202'],
      ['Rule 1', '5', 'POST /r1', '201'],
    ]);
    expect(row('r2').querySelector('.hits')?.textContent?.trim()).toBe('Answered 41');
    expect(row('r1').querySelector('.hits')?.textContent?.trim()).toBe(
      'Answered 0 · 3 near misses',
    );
    const padrao = document.querySelector('tfoot tr') as HTMLElement;
    expect(within(padrao).getByRole('rowheader').textContent).toContain('Default response');
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

    expect(row('r1').querySelector('.hits')?.textContent?.trim()).toBe('');
  });

  it('deve dizer a janela no singular Quando a URL guarda só uma requisição', async () => {
    await open([rule(1)], {}, stats({}, 1));

    expect(await screen.findByText('Hits over the last 1 request kept.')).toBeTruthy();
  });

  it('deve explicar que não há regras Quando a lista está vazia', async () => {
    await open([]);

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
      expect(announce).toHaveBeenCalledWith('Rule 2 moved to position 1 of 2');
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
        expect(announce).toHaveBeenCalledWith('Rule 1 moved to position 2 of 3'),
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

    it('deve salvar sem a regra e oferecer desfazer Quando "Delete" é clicado', async () => {
      await open([rule(1), rule(2)]);
      const desfazer = new Subject<void>();
      const snack = vi
        .spyOn(TestBed.inject(MatSnackBar), 'open')
        .mockReturnValue({ onAction: () => desfazer } as unknown as ReturnType<
          MatSnackBar['open']
        >);

      await userEvent.click(within(row('r1')).getByRole('button', { name: 'Delete' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(2)]);
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Rule deleted', 'Undo', { duration: 5000 }),
      );

      desfazer.next();
      await expectGuardedPut([rule(2)], [rule(1), rule(2)]);
    });

    it('não deve desfazer o Delete e deve avisar Quando a lista mudou em outro lugar depois de apagar', async () => {
      await open([rule(1), rule(2)]);
      const desfazer = new Subject<void>();
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockReturnValue({
        onAction: () => desfazer,
      } as unknown as ReturnType<MatSnackBar['open']>);

      await userEvent.click(within(row('r1')).getByRole('button', { name: 'Delete' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(2)]);
      await vi.waitFor(() => expect(snack).toHaveBeenCalled());
      desfazer.next();
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(2), rule(3)]),
      );

      expect(await screen.findByText(/The rules changed elsewhere/)).toBeTruthy();
      http.expectNone({ method: 'PUT', url: URL_REGRAS });
    });
    it('deve devolver só a regra apagada, sem apagar a de outra aba, Quando o Undo vem depois de um Reload', async () => {
      await open([rule(1), rule(2)]);
      const desfazer = new Subject<void>();
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open').mockReturnValue({
        onAction: () => desfazer,
      } as unknown as ReturnType<MatSnackBar['open']>);

      // Apaga a regra 2; outra aba acrescenta a 3; o toggle avisa e a lista é relida.
      await userEvent.click(within(row('r2')).getByRole('button', { name: 'Delete' }));
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
    it('deve levar a rules/new Quando "New rule" é clicado e a rules/{id} Quando "Edit" é clicado', async () => {
      await open([rule(1)]);

      await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
      await userEvent.click(within(row('r1')).getByRole('button', { name: 'Edit' }));

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
      expect(row('r2').classList).toContain('open');
      await expectNoAxeViolations(container);
    });

    it('deve deixar só o aviso do editor Quando a regra aberta sai da lista (apagada ao lado)', async () => {
      await open([rule(1), rule(2)], { ruleId: 'r2' });
      await screen.findByRole('region', { name: 'Edit rule Rule 2' });

      await userEvent.click(within(row('r2')).getByRole('button', { name: 'Delete' }));
      await expectGuardedPut([rule(1), rule(2)], [rule(1)]);

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
      expect(within(editor).getByText(/Use the open request as example/)).toBeTruthy();
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
        expect(within(editor).queryByText(/Use the open request as example/) !== null).toBe(
          oferece,
        );
      },
    );

    it('deve voltar à lista e avisar Quando a regra é salva, e só voltar Quando é cancelada', async () => {
      await open([rule(1)], { ruleId: 'new' });
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
      const editor = await screen.findByRole('region', { name: 'New rule' });

      await userEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
      expect(navigate).toHaveBeenLastCalledWith(['/', TOKEN_ID, 'rules']);
      expect(snack).not.toHaveBeenCalled();

      await userEvent.type(within(editor).getByRole('textbox', { name: 'Name' }), 'Nova');
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1)]));
      const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      expect((call.request.body as Rule[]).map((r) => r.name)).toEqual(['Rule 1', 'Nova']);
      call.flush([rule(1), rule(2, { name: 'Nova' })]);

      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Rule saved', undefined, { duration: 4000 }),
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
        ['template', 'Body and header values are templates'],
        ['delay', 'Delay: 250 ms'],
      ]);
      expect(flags('r3')).toEqual([['fault', 'Fault: empty response (close without writing)']]);
      expect(rows()[0]).toEqual(['Rule 1', '5', 'POST /r1', '200']);
    });

    it('não deve pedir os cenários nem mostrar o painel Quando nenhuma regra usa cenário', async () => {
      await open([rule(1)]);

      http.expectNone({ method: 'GET', url: URL_CENARIOS });
      expect(document.querySelector('app-scenario-panel')).toBeNull();
    });

    it('deve mostrar o painel com o diagrama do cenário e relê-lo Quando uma regra salva usa cenário', async () => {
      await open([rule(1), comCenario]);
      await flushScenarios();

      const diagrama = await screen.findByRole('img', {
        name: 'Retry: Started, then falhou-1 (current)',
      });
      expect(diagrama).toBeTruthy();
      await userEvent.click(screen.getByRole('switch', { name: 'Enable rule Rule 1' }));
      await expectGuardedPut([rule(1), comCenario], [{ ...rule(1), enabled: false }, comCenario]);

      await flushScenarios();
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

    it('deve substituir a lista pelo arquivo e avisar Quando o import é aceito', async () => {
      await open([rule(1)]);
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

      chooseFile(JSON.stringify([rule(7), rule(8)]));

      await expectPut([rule(7), rule(8)]);
      await vi.waitFor(() => expect(rows().map((r) => r[0])).toEqual(['Rule 7', 'Rule 8']));
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith('Imported 2 rules', undefined, { duration: 4000 }),
      );
    });

    it('deve mostrar os erros do servidor e manter a lista Quando o import responde 422', async () => {
      await open([rule(1)]);

      chooseFile(JSON.stringify([rule(7)]));
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
