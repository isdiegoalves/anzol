import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID } from '../../testing/fixtures';
import {
  CountFilter,
  CountLink,
  CountScope,
  decryptionReasonFilter,
  schemaPathFilter,
  signatureReasonFilter,
} from './count-link';

@Component({
  imports: [CountLink],
  template: `<a
    [appCountLink]="token"
    [countFilter]="filter()"
    [count]="count()"
    [what]="what()"
    [countScope]="scope()"
    [countName]="name()"
    >{{ count() }}</a
  >`,
})
class Host {
  protected readonly token = TOKEN_ID;
  readonly filter = signal<CountFilter>({});
  readonly count = signal(2);
  readonly what = signal('timestamp outside tolerance');
  readonly scope = signal<CountScope | null>(null);
  readonly name = signal<string | null>(null);
}

async function open(change: (host: Host) => void = () => undefined) {
  const result = await render(Host, { providers: [provideRouter([])] });
  change(result.fixture.componentInstance);
  result.fixture.detectChanges();
  return result;
}

describe('Dado um número que conta requisições (CountLink)', () => {
  it('deve levar à Entrada com o filtro exato do motivo e dizer o que conta no nome', async () => {
    const { container } = await open((host) =>
      host.filter.set(signatureReasonFilter('timestamp outside tolerance')),
    );

    const link = screen.getByRole('link', {
      name: 'timestamp outside tolerance, 2 requests. Open in the Inbox',
    });
    expect(link.getAttribute('href')).toBe(
      `/${TOKEN_ID}?signature=invalid&signatureReason=timestamp%20outside%20tolerance`,
    );
    await expectNoAxeViolations(container);
  });

  it('deve usar o singular Quando conta uma requisição', async () => {
    await open((host) => host.count.set(1));

    expect(
      screen.getByRole('link', {
        name: 'timestamp outside tolerance, 1 request. Open in the Inbox',
      }),
    ).toBeTruthy();
  });

  it('deve levar window= só Quando a URL guarda mais que as contadas', async () => {
    const { fixture } = await open((host) => {
      host.filter.set({ answered: '429' });
      host.scope.set({ evaluated: 500, total: 1291 });
    });
    const link = () => screen.getByRole('link');
    expect(link().getAttribute('href')).toBe(`/${TOKEN_ID}?answered=429&window=500`);

    fixture.componentInstance.scope.set({ evaluated: 5, total: 5 });
    fixture.detectChanges();

    expect(link().getAttribute('href')).toBe(`/${TOKEN_ID}?answered=429`);
  });

  it('deve trocar o nome acessível pelo dado Quando a linha já diz tudo', async () => {
    await open((host) => host.name.set('429 Too Many Requests · 2 · default response'));

    expect(
      screen.getByRole('link', { name: '429 Too Many Requests · 2 · default response' }),
    ).toBeTruthy();
  });

  it('deve navegar pelo roteador no clique simples, sem recarregar a página', async () => {
    await open((host) => host.filter.set(schemaPathFilter('/valor')));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    await userEvent.click(screen.getByRole('link'));

    expect(navigate).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).serializeUrl(navigate.mock.calls[0][0] as never)).toBe(
      `/${TOKEN_ID}?schema=invalid&schemaPath=%2Fvalor`,
    );
  });
});

describe('Dado os filtros exatos de Saúde e de Métricas', () => {
  it.each([
    ['signature mismatch', 'invalid'],
    ['timestamp outside tolerance', 'invalid'],
    ['header X-Hub-Signature-256 absent', 'absent'],
    ['header stripe-signature absent', 'absent'],
  ])('deve filtrar pelo motivo exato e pelo estado certo Quando o motivo é %s', (reason, state) => {
    expect(signatureReasonFilter(reason)).toEqual({ signature: state, signatureReason: reason });
  });

  it('deve filtrar pelo caminho do erro, com a raiz vazia', () => {
    expect(schemaPathFilter('')).toEqual({ schema: 'invalid', schemaPath: '' });
  });

  it('deve filtrar pelo motivo da decifra junto do estado inválido', () => {
    expect(decryptionReasonFilter('downgrade')).toEqual({
      decryption: 'invalid',
      decryptionReason: 'downgrade',
    });
  });
});
