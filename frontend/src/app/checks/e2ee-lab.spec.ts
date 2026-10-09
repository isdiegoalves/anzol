import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { Router } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { renderCard } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { LabCreated, LabReport, LabResult, Token } from '../token/token';
import { E2eeCard } from './e2ee-card';
import { labOutcome, labRunFailure } from './e2ee-lab';

const HORA = 3_600_000;
const NOVA = 'a1b2c3d4-0000-4000-8000-000000000042';
/** Data como a API grava: "Y-m-d H:i:s" em UTC. */
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const LABORATORIO: Token = token({
  protected: true,
  lab: { signer_kid: 'lab-sig-1', expires_at: utc(Date.now() + 5 * HORA) },
});

function resultado(code: string, ok: boolean, n: number): LabResult {
  return {
    code,
    description: `Cenário ${code}`,
    expected: { status: 400, state: 'invalid', reason: 'downgrade', kid: null },
    actual: ok
      ? { status: 400, state: 'invalid', reason: 'downgrade', kid: 'enc-v1', data_matches: null }
      : { status: 202, state: 'valid', reason: null, kid: 'enc-v1', data_matches: true },
    ok,
    request_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  };
}

const RELATORIO: LabReport = {
  total: 3,
  matched: 2,
  results: [resultado('P1', true, 1), resultado('N3', false, 2), resultado('X1', true, 3)],
};

const card = () => screen.getByRole('region', { name: 'E2EE decryption' });
const lab = () => within(card()).getByRole('region', { name: /^(Lab scenarios|E2EE lab)$/ });
const run = () => within(lab()).getByRole('button', { name: 'Run scenarios' });

describe('Dado o laboratório E2EE no cartão', () => {
  afterEach(() => localStorage.clear());

  describe('Quando a URL é de laboratório', () => {
    it('deve mostrar o selo, quando expira e o remetente de teste, e passar no axe', async () => {
      const { container } = await renderCard(E2eeCard, LABORATORIO);

      expect(within(lab()).getByText('Lab URL')).toBeTruthy();
      expect(within(lab()).getByText(/^Expires in 5 hours \(\w{3} \d{1,2}, \d{4} /)).toBeTruthy();
      expect(within(lab()).getByText(/the test sender lab-sig-1/)).toBeTruthy();
      expect(within(card()).queryByRole('button', { name: 'Create a lab URL' })).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve rodar os cenários e mostrar o resumo e a tabela, com os que divergem primeiro', async () => {
      const { container, http } = await renderCard(E2eeCard, LABORATORIO);

      await userEvent.click(run());

      const post = http.expectOne(`/token/${TOKEN_ID}/e2ee-lab/run`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({});
      const status = within(lab()).getByRole('status');
      await vi.waitFor(() =>
        expect(status.textContent).toContain('Running the scenarios. It takes a few seconds…'),
      );
      expect(run().getAttribute('aria-disabled')).toBe('true');
      await userEvent.click(run());
      http.expectNone(`/token/${TOKEN_ID}/e2ee-lab/run`);

      post.flush(RELATORIO);

      await vi.waitFor(() => expect(status.textContent).toContain('2 of 3 match'));
      expect(status.textContent).toContain('1 scenario differs, listed first.');
      expect(status.textContent?.replace(/\s+/g, ' ')).toContain(
        '0 decrypted as expected · 2 refused as expected · 1 differing',
      );
      const tabela = within(lab()).getByRole('table', { name: 'Scenario results' });
      const linhas = within(tabela).getAllByRole('row').slice(1);
      expect(linhas.map((linha) => within(linha).getByRole('rowheader').textContent)).toEqual([
        'N3',
        'P1',
        'X1',
      ]);
      const [diverge, confere] = linhas;
      expect(diverge.textContent).toContain('400 invalid (downgrade)');
      expect(diverge.textContent).toContain('202 valid · kid enc-v1');
      expect(diverge.textContent).toContain('data matches');
      expect(diverge.textContent).toContain('Differs');
      expect(confere.textContent).toContain('Matches');
      const link = within(diverge).getByRole('link', {
        name: 'Open request #00000000 of N3 in the Inbox',
      });
      expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/00000000-0000-4000-8000-000000000002/1`);
      expect(run().getAttribute('aria-disabled')).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve dizer quanto esperar Quando o servidor limita as rodadas (429)', async () => {
      const { http } = await renderCard(E2eeCard, LABORATORIO);

      await userEvent.click(run());
      http
        .expectOne(`/token/${TOKEN_ID}/e2ee-lab/run`)
        .flush(
          { error: 'Too many lab runs for this URL; try again later' },
          { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '42' } },
        );

      const alerta = await vi.waitFor(() => within(lab()).getByRole('alert'));
      expect(alerta.textContent).toBe(
        'Too many runs for this URL (up to 6 per minute). Try again in 42 s.',
      );
      expect(within(lab()).queryByRole('table')).toBeNull();
    });

    it('deve mostrar o erro genérico com o status Quando a rodada falha', async () => {
      const { http } = await renderCard(E2eeCard, LABORATORIO);

      await userEvent.click(run());
      http
        .expectOne(`/token/${TOKEN_ID}/e2ee-lab/run`)
        .flush('boom', { status: 500, statusText: 'Server Error' });

      await vi.waitFor(() =>
        expect(within(lab()).getByRole('alert').textContent).toBe(
          'Could not run the scenarios (500).',
        ),
      );
    });
  });

  describe('Quando a URL é comum', () => {
    const CRIADA: LabCreated = {
      token: { ...LABORATORIO, uuid: NOVA },
      read_secret: 'segredo-de-leitura-1',
      hmac_secret: 'segredo-hmac-2',
      hmac_header: 'X-Signature',
    };

    it('deve criar a URL de laboratório, destrancar, mostrar os segredos uma vez e abrir a URL nova', async () => {
      const { fixture, http } = await renderCard(E2eeCard, token({ protected: true }));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
      const page = TestbedHarnessEnvironment.documentRootLoader(fixture);
      expect(within(card()).queryByRole('button', { name: 'Run scenarios' })).toBeNull();

      await userEvent.click(within(lab()).getByRole('button', { name: 'Create a lab URL' }));

      const criar = http.expectOne('/e2ee-lab');
      expect(criar.request.method).toBe('POST');
      expect(criar.request.body).toEqual({});
      criar.flush(CRIADA, { status: 201, statusText: 'Created' });
      const destrancar = await vi.waitFor(() => http.expectOne(`/token/${NOVA}/unlock`));
      expect(destrancar.request.body).toEqual({ secret: 'segredo-de-leitura-1' });
      destrancar.flush(null, { status: 204, statusText: 'No Content' });

      const dialogo = await vi.waitFor(() => page.getHarness(MatDialogHarness));
      expect(await dialogo.getTitleText()).toBe('Lab URL created');
      const texto = await dialogo.getText();
      expect(texto).toContain("the server shows them only this once, and they don't come back");
      expect(texto).toContain('segredo-de-leitura-1');
      expect(texto).toContain('segredo-hmac-2');
      expect(texto).toContain('in the X-Signature header');
      const dialogElement = screen.getByRole('dialog', { name: 'Lab URL created' });
      await expectNoAxeViolations(dialogElement);
      await userEvent.click(
        within(dialogElement).getByRole('button', { name: 'Copy HMAC secret' }),
      );
      expect(copy).toHaveBeenCalledWith('segredo-hmac-2');
      expect(navigate).not.toHaveBeenCalled();

      await (await dialogo.getHarness(MatButtonHarness.with({ text: 'Open the lab URL' }))).click();

      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(['/', NOVA, 'checks'], {
          queryParams: { section: 'e2ee' },
        }),
      );
    });

    it('deve mostrar a recusa do servidor Quando já há laboratórios demais (422)', async () => {
      const { http } = await renderCard(E2eeCard, token({ protected: true }));

      await userEvent.click(within(lab()).getByRole('button', { name: 'Create a lab URL' }));
      http
        .expectOne('/e2ee-lab')
        .flush(
          { lab: ['There are already 20 active lab URLs; delete one or wait.'] },
          { status: 422, statusText: 'Unprocessable Entity' },
        );

      await vi.waitFor(() =>
        expect(within(lab()).getByRole('alert').textContent).toBe(
          'There are already 20 active lab URLs; delete one or wait.',
        ),
      );
      http.expectNone((sent) => sent.url.endsWith('/unlock'));
    });
  });

  it('deve descrever o estado gravado e as falhas da rodada em uma frase', () => {
    expect(labOutcome({ status: 500, state: 'unknown_kid', reason: null, kid: 'enc-x' })).toBe(
      'unknown_kid · kid enc-x',
    );
    expect(
      labOutcome({ status: 401, state: null, reason: null, kid: null, data_matches: null }),
    ).toBe('—');
    const limitado = (headers: Record<string, string>) =>
      new HttpErrorResponse({ status: 429, headers: new HttpHeaders(headers) });
    expect(labRunFailure(limitado({}))).toBe(
      'Too many runs for this URL (up to 6 per minute). Try again in a moment.',
    );
    expect(
      labRunFailure(
        new HttpErrorResponse({
          status: 422,
          error: { lab: ['This URL is not an E2EE lab URL.'] },
        }),
      ),
    ).toBe('The server refused the run: This URL is not an E2EE lab URL.');
  });
});
