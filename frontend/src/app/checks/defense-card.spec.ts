import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { Router } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { renderCard } from '../../testing/checks';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { Token } from '../token/token';
import { DefenseCard } from './defense-card';
import { DefenseLabCreated, DefenseReport, DefenseScenarioResult } from './defense-lab';

const HORA = 3_600_000;
const NOVA = 'a1b2c3d4-0000-4000-8000-000000000077';
const RODADA = '7f3c2a10-0000-4000-8000-0000000000aa';
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const LABORATORIO: Token = token({
  protected: true,
  defense_lab: { expires_at: utc(Date.now() + 5 * HORA) },
});

function cenario(
  code: string,
  overrides: Partial<DefenseScenarioResult> = {},
): DefenseScenarioResult {
  return {
    code,
    family: 'integrity',
    layer: 'floor',
    title: 'Forged signature (wrong secret)',
    floor: { expected: 'invalid', actual: 'invalid', ok: true },
    detection: { request_id: id(1), verdict: 'attack', family: 'integrity', detected: true },
    containment: { request_id: id(41), status: 401, blocked: true, containable: true },
    injection: null,
    ...overrides,
  };
}

const RELATORIO: DefenseReport = {
  round_id: RODADA,
  catalog_version: 'defense-catalog/1',
  seed: 42,
  containment_seconds: 95,
  scenarios: [
    cenario('I1'),
    cenario('C1', {
      family: 'compromised_sender',
      layer: 'agent',
      title: 'Event out of order (refund with no payment)',
      floor: { expected: 'valid', actual: 'valid', ok: true },
      detection: { request_id: id(2), verdict: 'legitimate', family: null, detected: false },
      containment: { request_id: id(42), status: 200, blocked: false, containable: false },
    }),
    cenario('P1', {
      family: 'prompt_injection',
      layer: 'agent',
      title: 'Direct instruction in the body',
      floor: { expected: 'valid', actual: 'valid', ok: true },
      detection: { request_id: id(3), verdict: 'legitimate', family: null, detected: false },
      containment: { request_id: id(43), status: 200, blocked: false, containable: true },
      injection: { obeyed: true, signal: 'token' },
    }),
  ],
  detection: { attacks: 14, detected: 12, legitimate: 18, false_positives: 1 },
  containment: { attacks: 12, blocked: 10, legitimate: 18, passed: 17 },
  false_positives: [id(9)],
  coverage: { requests: 32, judged: 30 },
  actions: { rule_writes: 3, config_changes: 0, outbound: 0 },
  loosening: { signature: 'kept', schema: 'kept', loosened: false },
  injection: { scenarios: 6, obeyed: 1 },
  by_family: [],
  by_layer: [],
};

const card = () => screen.getByRole('region', { name: 'Defense lab' });
const start = () => within(card()).getByRole('button', { name: 'Start a round' });
const finish = () => within(card()).getByRole('button', { name: 'Finish the round' });

/** O `seq` da mensagem mais nova, lido antes de abrir a rodada. */
async function answerNewest(http: HttpTestingController, seq: number | null) {
  const read = await vi.waitFor(() =>
    http.expectOne(
      (sent) =>
        sent.method === 'GET' &&
        sent.url === `/token/${TOKEN_ID}/requests` &&
        sent.params.get('per_page') === '1',
    ),
  );
  expect(read.request.params.get('sorting')).toBe('newest');
  read.flush(requestPage(seq === null ? [] : [webhookRequest(1, { seq })]));
}

/** A onda 1, lida pelo `seq` depois de a rodada abrir. */
async function answerWave(http: HttpTestingController, after: number, ids: string[]) {
  const read = await vi.waitFor(() =>
    http.expectOne(
      (sent) =>
        sent.method === 'GET' &&
        sent.url === `/token/${TOKEN_ID}/requests` &&
        sent.params.get('after') === String(after),
    ),
  );
  expect(read.request.params.get('per_page')).toBe('100');
  read.flush(
    requestPage(ids.map((uuid, n) => webhookRequest(n + 1, { uuid, seq: after + n + 1 }))),
  );
}

async function openRound(http: HttpTestingController, seed?: string) {
  if (seed !== undefined) {
    await userEvent.type(within(card()).getByRole('textbox', { name: /^Seed/ }), seed);
  }
  await userEvent.click(start());
  await answerNewest(http, 7);
  const post = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds`));
  post.flush(
    { round_id: RODADA, catalog_version: 'defense-catalog/1', requests: 2 },
    { status: 201, statusText: 'Created' },
  );
  await answerWave(http, 7, [id(1), id(2)]);
  return post;
}

describe('Dado o laboratório de defesa em Checks', () => {
  afterEach(() => localStorage.clear());

  describe('Quando a URL é comum', () => {
    const CRIADA: DefenseLabCreated = {
      token: { ...LABORATORIO, uuid: NOVA },
      read_secret: 'segredo-de-leitura-9',
      briefing: 'Briefing de teste.',
      scenarios: [],
    };

    it('deve criar a URL, destrancar, mostrar o segredo e o briefing uma vez e abrir a URL nova', async () => {
      const { container, fixture, http } = await renderCard(DefenseCard, token());
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
      const page = TestbedHarnessEnvironment.documentRootLoader(fixture);
      expect(within(card()).queryByRole('button', { name: 'Start a round' })).toBeNull();
      await expectNoAxeViolations(container);

      await userEvent.click(
        within(card()).getByRole('button', { name: 'Create a defense lab URL' }),
      );

      const criar = http.expectOne('/defense-lab');
      expect(criar.request.method).toBe('POST');
      expect(criar.request.body).toEqual({});
      criar.flush(CRIADA, { status: 201, statusText: 'Created' });
      const destrancar = await vi.waitFor(() => http.expectOne(`/token/${NOVA}/unlock`));
      expect(destrancar.request.body).toEqual({ secret: 'segredo-de-leitura-9' });
      destrancar.flush(null, { status: 204, statusText: 'No Content' });

      const dialogo = await vi.waitFor(() => page.getHarness(MatDialogHarness));
      expect(await dialogo.getTitleText()).toBe('Defense lab URL created');
      const texto = await dialogo.getText();
      expect(texto).toContain('segredo-de-leitura-9');
      expect(texto).toContain('Briefing de teste.');
      expect(localStorage.getItem(`anzol.defenseBriefing.${NOVA}`)).toBe('Briefing de teste.');
      await dialogo.close();

      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(['/', NOVA, 'checks'], {
          queryParams: { section: 'defense' },
        }),
      );
    });

    it('deve dizer por que não criou Quando o servidor já tem 20 laboratórios ativos (422)', async () => {
      const { http } = await renderCard(DefenseCard, token());

      await userEvent.click(
        within(card()).getByRole('button', { name: 'Create a defense lab URL' }),
      );
      http
        .expectOne('/defense-lab')
        .flush(
          { defense_lab: ['There are already 20 active defense lab URLs; delete one or wait.'] },
          { status: 422, statusText: 'Unprocessable Entity' },
        );

      const alerta = await vi.waitFor(() => within(card()).getByRole('alert'));
      expect(alerta.textContent).toContain('The server already has 20 active defense lab URLs.');
      expect(alerta.textContent).toContain(
        '(There are already 20 active defense lab URLs; delete one or wait.)',
      );
    });
  });

  describe('Quando a URL é de laboratório de defesa, sem rodada', () => {
    it('deve mostrar o selo, quando expira e os limites da vaga, e passar no axe', async () => {
      const { container } = await renderCard(DefenseCard, LABORATORIO);

      expect(within(card()).getByText('Defense lab URL')).toBeTruthy();
      expect(within(card()).getByText(/^Expires in 5 hours \(/)).toBeTruthy();
      expect(card().textContent).toContain(
        'holds one of the 20 slots on the server for 30 minutes',
      );
      expect(start()).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it('deve abrir a rodada, guardar o id e a onda 1, e mostrar o roteiro do agente', async () => {
      const { container, http } = await renderCard(DefenseCard, LABORATORIO);

      const post = await openRound(http);

      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({});
      await vi.waitFor(() =>
        expect(within(card()).getByRole('status').textContent).toContain(
          'Round 7f3c2a10 is open: wave 1 delivered 2 requests.',
        ),
      );
      expect(JSON.parse(localStorage.getItem(`anzol.defenseRound.${TOKEN_ID}`)!)).toMatchObject({
        round_id: RODADA,
        requests: [id(1), id(2)],
      });
      const roteiro = within(card()).getByRole('region', { name: 'Prompt for your agent' });
      expect(roteiro.textContent).toContain(`Defend round ${RODADA}`);
      expect(roteiro.textContent).toContain(`on URL ${TOKEN_ID}`);
      expect(finish()).toBeTruthy();
      expect(within(card()).queryByRole('button', { name: 'Start a round' })).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve mandar a semente digitada', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      const post = await openRound(http, '42');

      expect(post.request.body).toEqual({ seed: 42 });
    });

    it('deve recusar na tela a semente que não é inteiro de 0 a 2^53 − 1', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      await userEvent.type(within(card()).getByRole('textbox', { name: /^Seed/ }), '-3');
      await userEvent.click(start());

      expect(within(card()).getByRole('alert').textContent).toContain(
        'The seed must be a whole number from 0 to 9007199254740991.',
      );
      http.expectNone(`/token/${TOKEN_ID}/defense-lab/rounds`);
    });

    it('deve dizer quanto esperar Quando o servidor não tem vaga (429)', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      await userEvent.click(start());
      await answerNewest(http, null);
      const post = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds`));
      post.flush(
        { error: 'There are already 20 active defense lab URLs; delete one or wait.' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '120' } },
      );

      const alerta = await vi.waitFor(() => within(card()).getByRole('alert'));
      expect(alerta.textContent).toContain('The server already has 20 active defense lab URLs.');
      expect(alerta.textContent).toContain('Try again in 120 s.');
      expect(start()).toBeTruthy();
    });

    it('deve explicar Quando já há rodada aberta em outro lugar (409)', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      await userEvent.click(start());
      await answerNewest(http, 3);
      (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds`))).flush(
        { message: 'This URL already has an open round; finish it first' },
        { status: 409, statusText: 'Conflict' },
      );

      const alerta = await vi.waitFor(() => within(card()).getByRole('alert'));
      expect(alerta.textContent).toContain('Paste its id below to read or finish it.');
    });

    it('deve ler o relatório de uma rodada pelo id colado', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      await userEvent.type(within(card()).getByRole('textbox', { name: 'Round id' }), RODADA);
      await userEvent.click(within(card()).getByRole('button', { name: 'Open the round' }));
      http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`).flush(RELATORIO);

      await vi.waitFor(() =>
        expect(within(card()).getByText('12 of 14 attacks detected')).toBeTruthy(),
      );
    });

    it('deve dizer Quando o id colado não é de uma rodada da URL (404)', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      await userEvent.type(within(card()).getByRole('textbox', { name: 'Round id' }), RODADA);
      await userEvent.click(within(card()).getByRole('button', { name: 'Open the round' }));
      http
        .expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`)
        .flush({ message: 'Round not found' }, { status: 404, statusText: 'Not Found' });

      const alerta = await vi.waitFor(() => within(card()).getByRole('alert'));
      expect(alerta.textContent).toContain('There is no round with this id on this URL.');
    });
  });

  describe('Quando há rodada guardada', () => {
    beforeEach(() =>
      localStorage.setItem(
        `anzol.defenseRound.${TOKEN_ID}`,
        JSON.stringify({ round_id: RODADA, requests: [id(1), id(2)] }),
      ),
    );

    it('deve reconhecer a rodada aberta ao recarregar e fechá-la, mostrando o relatório', async () => {
      const { container, http } = await renderCard(DefenseCard, LABORATORIO);
      http
        .expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`)
        .flush(
          { message: 'This round is still open; finish it to get the report' },
          { status: 409, statusText: 'Conflict' },
        );
      await vi.waitFor(() => expect(finish()).toBeTruthy());

      await userEvent.click(finish());
      const fechar = http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}/finish`);
      expect(fechar.request.method).toBe('POST');
      expect(fechar.request.body).toEqual({});
      fechar.flush(RELATORIO);

      const resumo = await vi.waitFor(() => within(card()).getByText('12 of 14 attacks detected'));
      expect(resumo).toBeTruthy();
      const numeros = within(card()).getByRole('list', { name: 'Round results' });
      const texto = numeros.textContent?.replace(/\s+/g, ' ');
      expect(texto).toContain('False positives 1 of 18 legitimate');
      expect(texto).toContain('Contained 10 of 12 containable attacks blocked in wave 2');
      expect(texto).toContain('Legitimate passed 17 of 18 in wave 2');
      expect(texto).toContain('Coverage 30 of 32 judged');
      expect(texto).toContain('Injection obeyed 1 of 6');
      expect(texto).toContain('Signature and schema kept');
      expect(texto).toContain('Time to contain 95 s');
      const tabela = within(card()).getByRole('table', { name: 'Results by scenario' });
      const linhas = within(tabela).getAllByRole('row').slice(1);
      expect(
        linhas.map((linha) => within(linha).getByRole('rowheader').textContent?.trim()),
      ).toEqual(['I1', 'C1', 'P1']);
      expect(linhas[0].textContent).toContain('Detected');
      expect(linhas[0].textContent).toContain('Blocked (401)');
      expect(linhas[1].textContent).toContain('Missed');
      expect(linhas[1].textContent).toContain('Not containable');
      expect(linhas[2].textContent).toContain('Obeyed (token)');
      const onda1 = within(linhas[0]).getByRole('link', {
        name: 'Open the wave 1 request of I1 in the Inbox',
      });
      expect(onda1.getAttribute('href')).toBe(`/${TOKEN_ID}/${id(1)}/1`);
      expect(within(card()).getByText(/Seed 42 · defense-catalog\/1/)).toBeTruthy();
      expect(within(card()).getByRole('button', { name: 'Start another round' })).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it('deve mostrar o relatório ao recarregar Quando a rodada já fechou', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`).flush(RELATORIO);

      await vi.waitFor(() =>
        expect(within(card()).getByText('12 of 14 attacks detected')).toBeTruthy(),
      );
    });

    it('deve esquecer a rodada Quando o servidor não a conhece mais (404)', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);

      http
        .expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`)
        .flush({ message: 'Round not found' }, { status: 404, statusText: 'Not Found' });

      await vi.waitFor(() => expect(start()).toBeTruthy());
      expect(localStorage.getItem(`anzol.defenseRound.${TOKEN_ID}`)).toBeNull();
    });

    it('deve conferir de novo a rodada e mostrar o relatório Quando o agente a fechou', async () => {
      const { http } = await renderCard(DefenseCard, LABORATORIO);
      http
        .expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`)
        .flush(
          { message: 'This round is still open; finish it to get the report' },
          { status: 409, statusText: 'Conflict' },
        );
      await vi.waitFor(() => expect(finish()).toBeTruthy());

      await userEvent.click(within(card()).getByRole('button', { name: 'Check the round' }));
      http.expectOne(`/token/${TOKEN_ID}/defense-lab/rounds/${RODADA}`).flush(RELATORIO);

      await vi.waitFor(() =>
        expect(within(card()).getByText('12 of 14 attacks detected')).toBeTruthy(),
      );
    });
  });
});
