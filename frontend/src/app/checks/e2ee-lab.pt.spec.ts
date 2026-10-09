import { clearTranslations, loadTranslations } from '@angular/localize';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { renderCard } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { LabReport, LabResult } from '../token/token';
import { E2eeCard } from './e2ee-card';

const LABORATORIO = token({
  protected: true,
  lab: { signer_kid: 'lab-sig-1', expires_at: '2099-01-01 00:00:00' },
});

const resultado = (overrides: Partial<LabResult>): LabResult => ({
  code: 'P1',
  description: 'Round trip',
  expected: { status: 202, state: 'valid', reason: null, kid: null },
  actual: { status: 202, state: 'valid', reason: null, kid: 'enc-v2', data_matches: true },
  ok: true,
  request_id: null,
  ...overrides,
});

const RELATORIO: LabReport = {
  total: 4,
  matched: 3,
  results: [
    resultado({}),
    resultado({
      code: 'N1a',
      description: 'JWE without a JWS inside (the channel forging with the public key)',
      expected: { status: 400, state: 'invalid', reason: 'jws_missing', kid: null },
      actual: {
        status: 400,
        state: 'invalid',
        reason: 'jws_missing',
        kid: 'enc-v2',
        data_matches: null,
      },
    }),
    resultado({
      code: 'N4',
      description: 'JWE for a key the URL does not have',
      expected: { status: 500, state: 'unknown_kid', reason: null, kid: 'enc-v9' },
      actual: {
        status: 500,
        state: 'unknown_kid',
        reason: null,
        kid: 'enc-v9',
        data_matches: null,
      },
    }),
    resultado({
      code: 'Xz',
      description: 'A scenario the screen does not know',
      expected: { status: 400, state: 'invalid', reason: 'aud_mismatch', kid: null },
      actual: { status: 202, state: 'valid', reason: null, kid: 'enc-v2', data_matches: false },
      ok: false,
    }),
  ],
};

// O template é traduzido na primeira criação do componente no processo: por isso este arquivo à parte.
describe('Dado o relatório do laboratório com a tela em pt-BR', () => {
  beforeEach(() => loadTranslations(translations));
  afterEach(() => {
    clearTranslations();
    localStorage.clear();
  });

  it('deve dizer o que a rodada provou, contando decifrados, recusados e divergentes', async () => {
    const { container, http } = await renderCard(E2eeCard, LABORATORIO);
    const lab = screen.getByRole('region', { name: 'Cenários do laboratório' });

    await userEvent.click(within(lab).getByRole('button', { name: 'Rodar cenários' }));
    http.expectOne(`/token/${TOKEN_ID}/e2ee-lab/run`).flush(RELATORIO);

    const status = within(lab).getByRole('status');
    await vi.waitFor(() =>
      expect(status.textContent).toContain('3 de 4 cenários deram o resultado esperado'),
    );
    expect(status.textContent?.replace(/\s+/g, ' ')).toContain(
      '1 decifrado como previsto · 2 recusados como previsto · 1 divergente',
    );
    expect(lab.textContent?.replace(/\s+/g, ' ')).toContain(
      'P = deve decifrar (com a configuração padrão) · N = deve ser recusado · X = claims, cabeçalho e limites',
    );

    const linha = (code: string) => lab.querySelector(`tr[data-scenario="${code}"]`) as HTMLElement;
    const descricao = (code: string) => linha(code).querySelector('.description') as HTMLElement;
    expect(descricao('N1a').textContent?.trim()).toBe(
      'JWE sem JWS dentro (forja com a chave pública)',
    );
    expect(descricao('N1a').getAttribute('title')).toBe(
      'JWE without a JWS inside (the channel forging with the public key)',
    );
    expect(descricao('Xz').textContent?.trim()).toBe('A scenario the screen does not know');
    expect(descricao('Xz').getAttribute('title')).toBeNull();

    const texto = (code: string) => linha(code).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(texto('P1')).toContain('202 válida · kid enc-v2');
    expect(texto('P1')).toContain('data igual ao enviado');
    expect(texto('P1')).toContain('Esperado');
    expect(texto('N1a')).toContain('400 inválida (jws_missing)');
    expect(texto('N4')).toContain('500 chave desconhecida · kid enc-v9');
    expect(texto('Xz')).toContain('data diferente do enviado');
    expect(texto('Xz')).toContain('Divergiu');
    await expectNoAxeViolations(container);
  });
});
