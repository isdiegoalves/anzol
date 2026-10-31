import { MediaMatcher } from '@angular/cdk/layout';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { render } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { RequestStore } from '../requests/request-store';
import { RuleStore } from '../rules/rule-store';
import { Preferences } from '../settings/preferences';
import { CircuitPath } from './circuit-path';

const DA_P1 = webhookRequest(7, {
  url: `http://localhost:8084/${TOKEN_ID}/webhooks/pagamentos`,
  signature: { provider: 'generic', valid: false, reason: 'signature mismatch' },
  schema: { valid: true, errors: [] },
  rule: { id: 'p1', name: 'Assinatura inválida' },
  response: { status: 401 },
});

describe('Dado o detalhe com movimento reduzido', () => {
  const mostrar = async (reduzido: boolean) => {
    const media = vi.spyOn(MediaMatcher.prototype, 'matchMedia').mockReturnValue({
      matches: reduzido,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList);
    const rendered = await render(CircuitPath, {
      providers: [provideHttpClient(), provideHttpClientTesting()],
      configureTestBed: (testBed) =>
        testBed.inject(Preferences).token.set(token({ signature: { provider: 'generic' } })),
    });
    media.mockRestore();
    const http = TestBed.inject(HttpTestingController);
    const regras = TestBed.inject(RuleStore).load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/rules`)
      .flush([
        rule(1, { id: 'p1', name: 'Assinatura inválida', priority: 1, response: { status: 401 } }),
      ]);
    await regras;
    const store = TestBed.inject(RequestStore);
    const lista = store.load(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`).flush(requestPage([DA_P1]));
    await lista;
    store.select(DA_P1.uuid);
    await rendered.fixture.whenStable();
    http.verify();
    return rendered;
  };

  it('deve dizer "path: …" da mensagem aberta, com o ✗ em vermelho de revisão', async () => {
    const { container } = await mostrar(true);

    const frase = container.querySelector('.dpath');
    expect(frase?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'path: signature ✗ → schema ✓ → P1 ✓ → 401',
    );
    expect(frase?.querySelector('.fail')?.textContent).toBe('signature ✗');
    expect((container as HTMLElement).style.display).toBe('');
    await expectNoAxeViolations(container);
  });

  it('não deve existir, nem ocupar lugar no detalhe, sem movimento reduzido', async () => {
    const { container } = await mostrar(false);

    expect(container.querySelector('.dpath')).toBeNull();
    expect((container as HTMLElement).style.display).toBe('none');
  });
});
