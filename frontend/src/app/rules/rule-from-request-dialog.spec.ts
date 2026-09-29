import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { Rule } from './rule';
import { RuleFromRequestDialog } from './rule-from-request-dialog';
import { RuleIntents } from './rule-intents';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;

const EVENTO = webhookRequest(1, {
  url: `http://localhost/${TOKEN_ID}/pagamentos?env=prod`,
  query: { env: 'prod' },
  headers: { 'x-tenant': ['acme'] },
  content: JSON.stringify({ id: 'p2', status: 'pago', created_at: 1790512142 }),
});

/** "Create rule from this request" (WM-31, E-03): as caixas, a contagem e as duas saídas. */
describe('Dado a folha "Create rule from this request"', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  /** Os `rules/test` da contagem: a de agora e a do mesmo método e caminho (base, uma vez). */
  const counts = async (atual: number, base?: number) => {
    // A base sai na hora; a contagem, 600 ms depois da última escolha.
    const pending: ReturnType<HttpTestingController['match']> = [];
    await vi.waitFor(
      () => {
        pending.push(...http.match({ method: 'POST', url: `${URL_REGRAS}/test` }));
        expect(pending.length).toBeGreaterThanOrEqual(base === undefined ? 1 : 2);
      },
      { timeout: 3000 },
    );
    for (const call of pending) {
      const regra = call.request.body as Rule;
      const soBase =
        Object.keys(regra.match?.query ?? {}).length === 0 &&
        (regra.match?.body ?? []).length === 0;
      const n = soBase && base !== undefined ? base : atual;
      call.flush({
        matches: Array.from({ length: n }, (_, i) => ({ uuid: `m${i}`, seq: i })),
        misses: [],
      });
    }
  };
  const open = async (request: WebhookRequest = EVENTO) => {
    TestBed.inject(MatDialog).open(RuleFromRequestDialog, { data: request });
    return screen.findByRole('dialog', { name: 'Create rule from this request' });
  };
  const box = (dialog: HTMLElement, name: string | RegExp) =>
    within(dialog).getByRole('checkbox', { name }) as HTMLInputElement;

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve propor as condições sem id nem data, com a resposta e a contagem ao vivo', async () => {
    const dialog = await open();
    await counts(3, 3);

    expect(box(dialog, 'Method POST').checked).toBe(true);
    expect(box(dialog, 'Path /pagamentos').checked).toBe(true);
    expect(box(dialog, 'Query env = prod').checked).toBe(true);
    expect(box(dialog, 'Header x-tenant = acme').checked).toBe(false);
    expect(box(dialog, 'Body $.status = "pago"').checked).toBe(true);
    expect(box(dialog, 'Body $.id = "p2"').checked).toBe(false);
    expect(box(dialog, 'Body $.created_at = 1790512142').checked).toBe(false);
    expect(dialog.textContent).toContain('(looks like an id)');
    expect(dialog.textContent).toContain('(timestamp)');
    expect(within(dialog).getByRole('radiogroup', { name: 'Path match' })).toBeTruthy();
    expect(
      (within(dialog).getByRole('spinbutton', { name: 'Status' }) as HTMLInputElement).value,
    ).toBe('200');
    await vi.waitFor(() =>
      expect(dialog.textContent).toContain('3 of the last 500 requests would match'),
    );
    await expectNoAxeViolations(dialog);
  });

  // R2-L3 e R2-L6: os cabeçalhos de transporte ficam recolhidos no fim, e a Resposta sobe.
  it('deve recolher host, content-length, accept e user-agent num "4 more headers" fechado', async () => {
    const dialog = await open({
      ...EVENTO,
      headers: {
        'content-length': ['17'],
        'x-tenant': ['acme'],
        accept: ['*/*'],
        'user-agent': ['curl/8'],
        host: ['localhost'],
      },
    });
    await counts(1, 1);

    const recolhidos = dialog.querySelector<HTMLDetailsElement>('details.transport');
    expect(recolhidos?.open).toBe(false);
    expect(recolhidos?.querySelector('summary')?.textContent?.trim()).toBe('4 more headers');
    for (const nome of [/^Header host = /, /^Header content-length = /, /^Header accept = /]) {
      expect(recolhidos?.contains(box(dialog, nome))).toBe(true);
    }
    expect(recolhidos?.contains(box(dialog, /^Header x-tenant = /))).toBe(false);
    // A Resposta vem antes das caixas de cabeçalho: no celular ela fica à vista sem rolar.
    const ordem = [...dialog.querySelectorAll('h3')].map((h) => h.textContent?.trim());
    expect(ordem).toEqual(['Conditions', 'Response', 'Header conditions']);
    expect(
      dialog.querySelector('section.headers')?.contains(box(dialog, /^Header x-tenant = /)),
    ).toBe(true);
  });

  it('deve avisar que é específica demais e afrouxar com "Loosen" (E-03)', async () => {
    const dialog = await open();
    await counts(1, 6);
    await vi.waitFor(() =>
      expect(dialog.textContent).toContain(
        'Too specific: only this request would match (of the last 500).',
      ),
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Loosen' }));

    expect(box(dialog, 'Body $.status = "pago"').checked).toBe(false);
    expect(box(dialog, 'Query env = prod').checked).toBe(false);
    await counts(6);
    await vi.waitFor(() => expect(dialog.textContent).not.toContain('Too specific'));
  });

  it('deve gravar antes da pega-tudo, com a prioridade dela, e abrir a lista (E-01)', async () => {
    const snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const dialog = await open();
    await counts(1, 1);
    const status = within(dialog).getByRole('spinbutton', { name: 'Status' });
    await userEvent.clear(status);
    await userEvent.type(status, '201');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));

    const tudo = rule(9, { name: 'Tudo o resto', priority: 9, match: {} });
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush([tudo]);
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush([tudo]);
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
    const lista = put.request.body as Rule[];
    expect(lista.map(({ name }) => name)).toEqual(['POST /pagamentos', 'Tudo o resto']);
    expect(lista[0]).toMatchObject({
      priority: 9,
      match: {
        method: ['POST'],
        path: { equals: '/pagamentos' },
        query: { env: { equals: 'prod' } },
        body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
      },
      response: { status: 201 },
    });
    put.flush([{ ...lista[0], id: 'novo' }, tudo]);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules']));
    expect(snack).toHaveBeenCalledWith('Rule saved', undefined, {
      duration: 4000,
      politeness: 'off',
    });
    expect(TestBed.inject(RuleIntents).created()?.ids).toEqual(['novo']);
    // R2-M1: a lista abre com o foco na linha da regra criada, e não no body.
    expect(TestBed.inject(RuleStore).pendingFocus()).toEqual({ rule: 'novo' });
    for (const call of http.match({ method: 'POST', url: `${URL_REGRAS}/test` })) {
      call.flush({ matches: [], misses: [] });
    }
  });

  it('deve levar o rascunho ao editor da regra nova com a mensagem de exemplo, sem gravar', async () => {
    const dialog = await open();
    await counts(1, 1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open in editor' }));

    expect(TestBed.inject(RuleIntents).pending()?.draft).toMatchObject({
      name: 'POST /pagamentos',
      match: { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] },
    });
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'rules', 'new'], {
      queryParams: { from: EVENTO.uuid },
    });
    // R2-M2: o editor abre com o foco no Nome, como no "New rule".
    expect(TestBed.inject(RuleStore).pendingFocus()).toBe('editor');
    http.expectNone({ method: 'PUT', url: URL_REGRAS });
  });
});
