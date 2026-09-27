import { LiveAnnouncer } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { FakeEventSource } from '../../testing/fake-event-source';
import { rule } from '../../testing/rule-fixtures';
import { Preferences } from '../settings/preferences';
import { Viewport, WindowClass } from '../shell/viewport';
import { TokenStats } from '../stats/stats';
import { Token } from '../token/token';
import { Rule, RuleMatch } from './rule';
import { RuleIntents } from './rule-intents';
import { RuleStore } from './rule-store';
import { RulesPage } from './rules-page';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const URL_STATS = `/token/${TOKEN_ID}/stats`;
const URL_MENSAGENS = `/token/${TOKEN_ID}/requests`;

function stats(rules: Partial<TokenStats['rules']> = {}, evaluated = 12): Partial<TokenStats> {
  return { evaluated, rules: { answered: [], near_miss: [], default: 0, ...rules } };
}

/** Regra só com o `match` dado. */
const com = (n: number, match: RuleMatch, overrides: Partial<Rule> = {}): Rule =>
  rule(n, {
    match: { method: [], path: null, query: {}, headers: {}, body: [], ...match },
    ...overrides,
  });

describe('Dado a lista de Regras com ordem e diagnóstico (F2)', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;
  const windowClass = signal<WindowClass>('large');
  const row = (id: string) => document.querySelector(`[data-rule-id="${id}"]`) as HTMLElement;
  /** A linha da ação do diagnóstico, logo abaixo do item (fora de td.item, que só tem o botão). */
  const fixFor = (id: string) => document.querySelector(`[data-fix-for="${id}"]`) as HTMLElement;
  const text = (id: string, part: string) =>
    row(id).querySelector(part)?.textContent?.replace(/\s+/g, ' ').trim();
  const flags = (id: string) =>
    [...row(id).querySelectorAll('.flag')].map((flag) => flag.textContent?.trim());

  const renderPage = async (
    inputs: { ruleId?: string; from?: string } = {},
    configure?: () => void,
    tokenOverrides: Partial<Token> = {},
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
        // Antes de qualquer inject: o configure pode trocar um provider (ActivatedRoute).
        configure?.();
        TestBed.inject(Preferences).token.set({ ...token(), ...tokenOverrides });
      },
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return result;
  };
  const open = async (
    rules: Rule[],
    options: {
      inputs?: { ruleId?: string; from?: string };
      hits?: Partial<TokenStats> | 'fail';
      token?: Partial<Token>;
      configure?: () => void;
    } = {},
  ) => {
    const result = await renderPage(options.inputs, options.configure, options.token);
    http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(rules);
    const hits = options.hits ?? stats();
    await vi.waitFor(() =>
      hits === 'fail'
        ? http.expectOne(URL_STATS).flush({}, { status: 500, statusText: 'x' })
        : http.expectOne(URL_STATS).flush(hits),
    );
    await screen.findByRole('table', { name: 'Rules' });
    return result;
  };
  const expectGuardedPut = async (server: Rule[]) => {
    await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }).flush(server));
    const call = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    const body = call.request.body as Rule[];
    call.flush(body);
    return body;
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
    vi.useRealTimers();
  });

  describe('Dado a ordem (E-01, WM-08)', () => {
    it('deve dizer a frase do modelo mental e a posição efetiva "#n" ao lado do P', async () => {
      const { container } = await open([
        rule(1, { priority: 5 }),
        rule(2, { priority: 1 }),
        rule(3, { priority: 5, enabled: false }),
        rule(4, { priority: 5 }),
      ]);

      expect(document.querySelector('.heading .hint')?.textContent).toBe(
        "Rules are checked in this order. The first one that matches answers. A catch-all rule answers whatever is left; the URL's default response answers when no rule does.",
      );
      expect(text('r2', '.position')).toBe('#1');
      expect(text('r1', '.position')).toBe('#2');
      expect(text('r4', '.position')).toBe('#3');
      expect(text('r3', '.position')).toBe('—');
      expect(within(row('r1')).getByRole('img', { name: 'Position 2 of 3' })).toBeTruthy();
      expect(
        within(row('r3')).getByRole('img', { name: 'Not in the order while off' }),
      ).toBeTruthy();
      // Empate de prioridade: a ordem da lista decide, e o título diz com quem.
      expect(row('r1').querySelector('.position')?.getAttribute('title')).toBe(
        'Same priority as Rule 4; the list order decides.',
      );
      expect(row('r2').querySelector('.position')?.getAttribute('title')).toBe(
        'Checked top to bottom; the first match answers.',
      );
      expect(row('r2').querySelector('.priority')?.getAttribute('title')).toBe(
        'Priority 1 · lower answers first; ties keep the list order',
      );
      // A posição entra na descrição do botão da linha.
      expect(
        within(row('r1')).getByRole('button', { name: 'Rule 1' }).getAttribute('aria-describedby'),
      ).toContain('-position');
      await expectNoAxeViolations(container);
    });

    it('deve abrir a regra nova antes da primeira pega-tudo ligada, com a prioridade dela', async () => {
      const tudo = com(9, {}, { name: 'Tudo o resto', priority: 9 });
      await open([rule(1, { priority: 1 }), tudo], { inputs: { ruleId: 'new' } });

      const editor = await screen.findByRole('region', { name: 'New rule' });
      expect(
        (within(editor).getByRole('spinbutton', { name: 'Priority' }) as HTMLInputElement).value,
      ).toBe('9');
      expect(within(editor).getByRole('note').textContent?.trim()).toBe(
        'Placed before "Tudo o resto" so it can answer (same priority, earlier in the list).',
      );

      // Salvar grava a regra nova logo antes da pega-tudo, sem mexer nas vizinhas.
      await userEvent.type(within(editor).getByRole('textbox', { name: 'Name' }), 'Nova');
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: URL_REGRAS }).flush([rule(1, { priority: 1 }), tudo]),
      );
      const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
      const body = put.request.body as Rule[];
      expect(body.map((r) => [r.name, r.priority])).toEqual([
        ['Rule 1', 1],
        ['Nova', 9],
        ['Tudo o resto', 9],
      ]);
      // O servidor dá o id da nova: a lista a destaca e anuncia, como no lote (WM-35).
      put.flush(body.map((r) => ({ ...r, id: r.id ?? 'nova' })));
      await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('1 rule created'));
      expect(TestBed.inject(RuleIntents).created()?.ids).toEqual(['nova']);
    });

    it('deve abrir a regra nova no fim, com P5, Quando não há pega-tudo ligada', async () => {
      await open([rule(1), com(9, {}, { enabled: false, priority: 1 })], {
        inputs: { ruleId: 'new' },
      });

      const editor = await screen.findByRole('region', { name: 'New rule' });
      expect(
        (within(editor).getByRole('spinbutton', { name: 'Priority' }) as HTMLInputElement).value,
      ).toBe('5');
    });
  });

  describe('Dado os selos e o diagnóstico (WM-09, E-11, WM-30)', () => {
    it('deve mostrar "Shadowed by" com a causa e mover para antes da que sombreia', async () => {
      const pix = rule(1, { name: 'Pix pago', priority: 2 });
      const copia = { ...pix, id: 'r2', name: 'Pix pago (copy)', priority: 3 };
      const { container } = await open([pix, copia]);
      const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

      expect(flags('r2')).toEqual(['Shadowed by Pix pago']);
      expect(text('r2', '.hits')).toBe(
        'Never answers: "Pix pago" comes first and matches everything this rule matches.',
      );
      expect(flags('r1')).toEqual([]);
      // td.item continua só com o botão que abre o editor (o linhaDaRegra/abrirRegra do E2E).
      expect(
        within(row('r2').querySelector('td.item') as HTMLElement).getAllByRole('button'),
      ).toHaveLength(1);
      await expectNoAxeViolations(container);

      await userEvent.click(
        within(fixFor('r2')).getByRole('button', { name: 'Move before Pix pago' }),
      );
      const body = await expectGuardedPut([pix, copia]);

      // As prioridades seguem as posições (moveInOrder): a cópia fica com P2 e a original com P3.
      expect(body.map((r) => [r.name, r.priority])).toEqual([
        ['Pix pago (copy)', 2],
        ['Pix pago', 3],
      ]);
      await vi.waitFor(() =>
        expect(snack).toHaveBeenCalledWith(
          'Moved before Pix pago · priorities updated',
          undefined,
          expect.anything(),
        ),
      );
    });

    it('não deve acusar sombra Quando só a regex é igual ao literal (nunca avalia regex)', async () => {
      await open([
        com(1, { path: { regex: '/pix' } }, { priority: 1 }),
        com(2, { path: { equals: '/pix' } }, { priority: 2 }),
      ]);

      expect(flags('r2')).toEqual([]);
    });

    it('deve dizer no "OFF" que a regra desligada ficaria sombreada se ligada', async () => {
      const pix = rule(1, { name: 'Pix pago', priority: 2 });
      await open([pix, { ...pix, id: 'r2', name: 'Cópia', enabled: false }]);

      expect(flags('r2')).toEqual([]);
      expect(row('r2').querySelector('.off')?.getAttribute('title')).toBe(
        'Would be shadowed by Pix pago if turned on',
      );
    });

    it('deve mostrar "Never matches" com o link para Checks Quando a URL não verifica assinaturas', async () => {
      const { container } = await open([com(1, { signature: 'invalid' }, { name: 'Assinatura' })], {
        token: { signature: null, schema: null },
      });

      expect(flags('r1')).toEqual(['Never matches']);
      expect(text('r1', '.hits')).toBe('This URL does not check signatures.');
      const link = within(fixFor('r1')).getByRole('link', { name: 'Set up in Checks' });
      expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/checks?section=signature`);
      await expectNoAxeViolations(container);
    });

    it('não deve dizer "Never matches" Quando a configuração de assinatura ainda não é conhecida', async () => {
      await open([com(1, { signature: 'invalid' })], { token: { signature: undefined } });

      expect(flags('r1')).toEqual([]);
    });

    it('deve dizer o estado que nenhuma regra ligada produz (provável erro de digitação)', async () => {
      const exige = rule(1, { scenario: { name: 'e', requiredState: 'entrege' } });
      await open([exige]);
      await vi.waitFor(() =>
        http
          .expectOne(`/token/${TOKEN_ID}/scenarios`)
          .flush([{ name: 'e', state: 'Started', states: ['Started', 'entrege'] }]),
      );

      await vi.waitFor(() => expect(flags('r1')).toEqual(['Scenario', 'Never matches']));
      expect(text('r1', '.hits')).toBe(
        'No enabled rule leads to state "entrege" — probably a typo.',
      );
      expect(row('r1').querySelector('.flag-never')?.getAttribute('title')).toBe(
        'Probably: the state can be set by hand',
      );
    });

    it('deve marcar a pega-tudo e avisar que as mensagens deixam de guardar o "por quê"', async () => {
      await open([rule(1), com(2, {}, { name: 'Tudo o resto', priority: 9 })]);

      expect(flags('r2')).toEqual(['Catch-all']);
      expect(screen.getByRole('note').textContent?.trim()).toBe(
        '"Tudo o resto" answers whatever is left. While it is on, messages don\'t keep why the other rules didn\'t match — use "Why not rule…?" on a message.',
      );
    });

    it('não deve avisar da pega-tudo desligada, nem chamar de pega-tudo a regra só com método', async () => {
      await open([com(1, {}, { enabled: false }), com(2, { method: ['GET'] })]);

      expect(screen.queryByRole('note')).toBeNull();
      expect(flags('r2')).toEqual([]);
    });

    it('deve dizer "Likely shadowed" só depois do teste, com as casadas todas respondidas pela anterior', async () => {
      const a = rule(1, { name: 'A', priority: 1 });
      const b = rule(2, { name: 'B', priority: 2 });
      await open([a, b]);
      expect(flags('r2')).toEqual([]);

      const store = TestBed.inject(RuleStore);
      store.tested.set(new Map([['r2', { match: { ...b.match }, matches: ['m1'] }]]));
      const recent = await vi.waitFor(() =>
        http.expectOne((req) => req.url === URL_MENSAGENS && req.params.get('page') === '1'),
      );
      recent.flush({
        data: [webhookRequest(1, { uuid: 'm1', rule: { id: 'r1', name: 'A' } })],
        is_last_page: true,
        total: 1,
      });

      await vi.waitFor(() => expect(flags('r2')).toEqual(['Likely shadowed by A']));
      // Sem prova, a linha 3 continua com os hits; a ação fica à mão.
      expect(text('r2', '.hits')).toBe('Answered 0 of the last 12');
      expect(within(fixFor('r2')).getByRole('button', { name: 'Move before A' })).toBeTruthy();
    });
  });

  describe('Dado o interruptor e os hits (WM-20, WM-29)', () => {
    it('deve dizer para onde vai o que ela respondia Quando a regra é desligada agora', async () => {
      await open([rule(1), rule(2, { enabled: false })]);

      await userEvent.click(screen.getByRole('switch', { name: 'Enable rule Rule 1' }));
      await expectGuardedPut([rule(1), rule(2, { enabled: false })]);

      await vi.waitFor(() =>
        expect(text('r1', '.hits')).toBe(
          'Off · what it answered now goes to the next matching rule, or the default response.',
        ),
      );
      expect(text('r2', '.hits')).toBe('Not checked while off');
    });

    it('deve dizer "No requests yet" em vez de "0 of the last 0"', async () => {
      await open([rule(1)], { hits: stats({}, 0) });

      expect(text('r1', '.hits')).toBe('No requests yet');
      expect(document.querySelector('tfoot .hits')?.textContent?.trim()).toBe('No requests yet');
    });
  });

  describe('Dado o filtro (WM-03)', () => {
    const regras = [
      rule(1, { name: 'Pix pago' }),
      rule(2, { name: 'Entrega', enabled: false }),
      rule(3, { name: 'Outra', match: { method: ['GET'], path: { equals: '/pix/estorno' } } }),
    ];

    it('deve filtrar por nome e caminho, contar e dizer quando nada casa', async () => {
      const { container } = await open(regras, {
        hits: stats({ answered: [{ id: 'r3', name: 'Outra', count: 2 }] }),
      });
      const filtro = screen.getByRole('searchbox', { name: 'Filter rules' });

      await userEvent.type(filtro, 'PIX');
      expect(
        [...document.querySelectorAll('tbody tr[data-rule-id]')].map(
          (r) => r.id || r.getAttribute('data-rule-id'),
        ),
      ).toEqual(['r1', 'r3']);
      expect(screen.getByRole('status').textContent?.trim()).toBe('2 of 3 rules');
      await expectNoAxeViolations(container);

      await userEvent.clear(filtro);
      await userEvent.type(filtro, 'nada');
      expect(screen.getByText('No rule matches "nada".')).toBeTruthy();
    });

    it('deve filtrar pelos chips "No hits" e "Off", com aria-pressed', async () => {
      await open(regras, { hits: stats({ answered: [{ id: 'r3', name: 'Outra', count: 2 }] }) });

      const semHits = screen.getByRole('button', { name: 'No hits' });
      await userEvent.click(semHits);
      expect(semHits.getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelectorAll('tbody tr[data-rule-id]').length).toBe(2);

      await userEvent.click(screen.getByRole('button', { name: 'Off' }));
      expect(
        [...document.querySelectorAll('tbody tr[data-rule-id]')].map((r) =>
          r.getAttribute('data-rule-id'),
        ),
      ).toEqual(['r2']);
    });

    it('deve desabilitar "No hits" com a explicação Quando os hits não chegaram', async () => {
      await open(regras, { hits: 'fail' });

      const semHits = screen.getByRole('button', { name: 'No hits' }) as HTMLButtonElement;
      expect(semHits.disabled).toBe(true);
      expect(semHits.getAttribute('title')).toBe('Hits not loaded yet');
      expect(text('r1', '.hits')).toBe('Hits unavailable');
    });
  });

  describe('Dado duplicar, modelos e o destaque (WM-21, WM-11, WM-35)', () => {
    it('deve duplicar pelo ⋮ da linha: regra nova com a cópia, logo após a original', async () => {
      const intents = () => TestBed.inject(RuleIntents);
      await open([rule(1, { priority: 3, enabled: false }), rule(2)]);

      await userEvent.click(screen.getByRole('button', { name: 'More actions for Rule 1' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules', 'new']);
      const pedido = intents().pending();
      expect(pedido?.insertAt).toBe(1);
      expect(pedido?.draft).toMatchObject({ name: 'Rule 1 (copy)', enabled: true, priority: 3 });
      expect(pedido?.draft.id).toBeUndefined();
    });

    it('deve duplicar pelo "Duplicate rule" do editor: a cópia do formulário, logo após a original', async () => {
      await open([rule(1), rule(2)], { inputs: { ruleId: 'r1' } });
      const editor = await screen.findByRole('region', { name: 'Edit rule Rule 1' });

      await userEvent.click(within(editor).getByRole('button', { name: 'Duplicate rule' }));

      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules', 'new']);
      const pedido = TestBed.inject(RuleIntents).pending();
      expect(pedido?.insertAt).toBe(1);
      expect(pedido?.draft).toMatchObject({ name: 'Rule 1 (copy)', enabled: true });
      expect(pedido?.draft.id).toBeUndefined();
    });

    it('deve abrir o editor da regra nova com a cópia pedida', async () => {
      await open([rule(1)], {
        inputs: { ruleId: 'new' },
        configure: () =>
          TestBed.inject(RuleIntents).request({
            draft: { ...rule(1), id: undefined, name: 'Rule 1 (copy)' },
            insertAt: 1,
          }),
      });

      const editor = await screen.findByRole('region', { name: 'New rule' });
      expect(
        (within(editor).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
      ).toBe('Rule 1 (copy)');
    });

    it('deve apagar pelo ⋮ da linha, com Undo', async () => {
      await open([rule(1), rule(2)]);

      await userEvent.click(screen.getByRole('button', { name: 'More actions for Rule 2' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const body = await expectGuardedPut([rule(1), rule(2)]);

      expect(body.map((r) => r.id)).toEqual(['r1']);
    });

    it('deve oferecer os modelos no menu ao lado de "New rule" e abrir o escolhido como rascunho', async () => {
      await open([rule(1)]);

      await userEvent.click(screen.getByRole('button', { name: 'New rule from template' }));
      const menu = await screen.findByRole('menu', { name: 'Rule templates' });
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent?.trim()),
      ).toEqual([
        'Accept everything (200)',
        'Unavailable (503)',
        'Reject invalid signature (401)',
        'Fail N times, then accept',
        '429 with Retry-After',
        'Echo the body (template)',
        'Delay 30 s',
        'Drop the connection',
      ]);
      await userEvent.click(within(menu).getByRole('menuitem', { name: '429 with Retry-After' }));

      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules', 'new']);
      expect(TestBed.inject(RuleIntents).pending()?.draft).toMatchObject({
        name: 'Rate limited',
        response: { status: 429, headers: { 'Retry-After': '5' } },
      });
    });

    it('deve destacar as recém-criadas por 5 s e anunciar quantas', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await open([rule(1), rule(2), rule(3)]);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      TestBed.inject(RuleIntents).markCreated(['r2', 'r3']);

      await vi.waitFor(() => expect(row('r2').classList).toContain('just-created'));
      expect(row('r3').classList).toContain('just-created');
      expect(row('r1').classList).not.toContain('just-created');
      expect(text('r2', '.created')).toBe('New');
      expect(announce).toHaveBeenCalledWith('2 rules created');

      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() => expect(row('r2').classList).not.toContain('just-created'));
    });
  });

  describe('Dado os cenários na lista (WM-32, WM-33)', () => {
    const URL_CENARIOS = `/token/${TOKEN_ID}/scenarios`;
    const entrega = (n: number, requiredState: string, newState?: string) =>
      rule(n, {
        name: `entrega ${n}`,
        match: { method: ['POST'], path: { equals: '/entrega' }, query: {}, headers: {}, body: [] },
        scenario: { name: 'entrega', requiredState, ...(newState && { newState }) },
      });
    const group = () => document.querySelector('tbody tr.scenario-group') as HTMLElement;
    const flushState = (state: string) =>
      vi.waitFor(() =>
        http
          .expectOne({ method: 'GET', url: URL_CENARIOS })
          .flush([{ name: 'entrega', state, states: ['Started', 'x'] }]),
      );

    it('deve avisar do estado terminal e dizer para onde cai a próxima requisição', async () => {
      const tudo = com(9, {}, { name: 'Tudo o resto', priority: 9 });
      const { container } = await open([entrega(1, 'Started', 'entregue'), tudo]);
      await flushState('entregue');

      await vi.waitFor(() =>
        expect(within(group()).getByRole('note').textContent?.trim()).toBe(
          'No enabled rule answers in state "entregue"; the next request falls to Tudo o resto.',
        ),
      );
      await expectNoAxeViolations(container);
    });

    it('deve avisar Quando só uma regra desligada responderia no estado de agora', async () => {
      await open([entrega(1, 'Started', 'x'), { ...entrega(2, 'x'), enabled: false }]);
      await flushState('x');

      await vi.waitFor(() => expect(within(group()).getByRole('note')).toBeTruthy());
    });

    it('não deve avisar Quando uma regra ligada do cenário responde em qualquer estado', async () => {
      const qualquer = rule(3, {
        name: 'qualquer',
        match: { method: ['GET'], path: null, query: {}, headers: {}, body: [] },
        scenario: { name: 'entrega' },
      });
      await open([entrega(1, 'Started', 'x'), qualquer]);
      await flushState('x');

      await vi.waitFor(() => expect(group().textContent).toContain('state: x'));
      expect(within(group()).queryByRole('note')).toBeNull();
    });

    it('não deve avisar Quando uma regra ligada do cenário responde no estado de agora', async () => {
      await open([entrega(1, 'Started', 'x'), entrega(2, 'x')]);
      await flushState('x');

      await vi.waitFor(() => expect(group().textContent).toContain('state: x'));
      expect(within(group()).queryByRole('note')).toBeNull();
    });

    it('deve dizer "the default response" sem pega-tudo e voltar só este cenário a Started', async () => {
      await open([entrega(1, 'Started', 'fim')]);
      await flushState('fim');
      await vi.waitFor(() =>
        expect(within(group()).getByRole('note').textContent).toContain(
          'the next request falls to the default response.',
        ),
      );

      await userEvent.click(within(group()).getByRole('button', { name: 'Reset scenario' }));
      const put = await vi.waitFor(() =>
        http.expectOne({ method: 'PUT', url: `${URL_CENARIOS}/entrega` }),
      );
      expect(put.request.body).toEqual({ state: 'Started' });
      put.flush({});
      await flushState('Started');
      await vi.waitFor(() => expect(within(group()).queryByRole('note')).toBeNull());
    });

    it('deve abrir o assistente "Sequence" pelo modelo "Fail N times, then accept"', async () => {
      await open([rule(1)]);

      await userEvent.click(screen.getByRole('button', { name: 'New rule from template' }));
      await userEvent.click(
        await screen.findByRole('menuitem', { name: 'Fail N times, then accept' }),
      );

      expect(await screen.findByRole('dialog', { name: 'Sequence' })).toBeTruthy();
    });
  });

  describe('Dado a regra aberta pelo cartão de uma mensagem (WM-10)', () => {
    it('deve oferecer "Back to request", que volta à mensagem', async () => {
      await open([rule(1)], {
        inputs: { ruleId: 'r1' },
        configure: () =>
          TestBed.overrideProvider(ActivatedRoute, {
            useValue: { queryParamMap: of(convertToParamMap({ 'from-request': 'm1' })) },
          }),
      });
      await screen.findByRole('region', { name: 'Edit rule Rule 1' });

      await userEvent.click(screen.getByRole('button', { name: 'Back to request' }));

      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'm1', 1]);
    });

    it('não deve oferecer "Back to request" Quando a regra não veio de uma mensagem', async () => {
      await open([rule(1)], { inputs: { ruleId: 'r1' } });
      await screen.findByRole('region', { name: 'Edit rule Rule 1' });

      expect(screen.queryByRole('button', { name: 'Back to request' })).toBeNull();
    });
  });

  describe('Dado a lista vazia (WM-02)', () => {
    const flushLatest = (data: unknown[]) =>
      vi.waitFor(() =>
        http
          .expectOne((req) => req.url === URL_MENSAGENS && req.params.get('per_page') === '1')
          .flush({ data, total: data.length, is_last_page: true }),
      );

    it('deve oferecer três caminhos, o da última requisição só com mensagens', async () => {
      const { container } = await open([]);
      const mensagem = webhookRequest(7);
      await flushLatest([mensagem]);

      for (const name of [
        'Describe it in words',
        'Start from a template',
        'Create from the latest request',
      ]) {
        expect(await screen.findByRole('button', { name })).toBeTruthy();
      }
      expect(screen.getByText(/No rules yet/)).toBeTruthy();
      await expectNoAxeViolations(container);

      await userEvent.click(screen.getByRole('button', { name: 'Create from the latest request' }));
      expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules', 'new'], {
        queryParams: { from: mensagem.uuid },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Describe it in words' }));
      expect(TestBed.inject(RuleIntents).pending()?.openSuggest).toBe(true);

      await userEvent.click(screen.getByRole('button', { name: 'Start from a template' }));
      expect(await screen.findByRole('menu', { name: 'Rule templates' })).toBeTruthy();
    });

    it('não deve oferecer a última requisição Quando a URL não tem mensagens', async () => {
      await open([]);
      await flushLatest([]);

      expect(screen.queryByRole('button', { name: 'Create from the latest request' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Describe it in words' })).toBeTruthy();
    });
  });
});
