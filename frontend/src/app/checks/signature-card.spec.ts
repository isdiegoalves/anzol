import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { expectPut, renderCard } from '../../testing/checks';
import { token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { SignatureCard } from './signature-card';

const SALVA = token({
  default_status: 202,
  default_content: 'resposta',
  signature: { provider: 'github', secret: '••••-e2e' },
  schema: { type: 'object' },
});

const provider = (name: string) => screen.getByRole('radio', { name });
const secret = () => screen.getByLabelText(/^Secret/);
const save = () => screen.getByRole('button', { name: 'Save signature' });

describe('Dado o cartão "Signature verification" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve oferecer None e os cinco provedores num radiogroup, com None marcado, Quando a URL não verifica', async () => {
    const { container } = await renderCard(SignatureCard, token());

    const group = screen.getByRole('radiogroup', { name: 'Signature provider' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toEqual(
      ['None', 'Stripe', 'GitHub', 'Shopify', 'Slack', 'Generic'].map((name) =>
        within(group).getByRole('radio', { name }),
      ),
    );
    expect(within(group).getAllByRole('radio', { checked: true })).toEqual([provider('None')]);
    expect(provider('None').tabIndex).toBe(0);
    expect(provider('Stripe').tabIndex).toBe(-1);
    expect(screen.getByRole('region', { name: 'Signature verification' })).toBeTruthy();
    expect(screen.queryByText(/^To save/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve dizer o que falta desde o começo, com o Save habilitado, Quando o genérico é escolhido (queixa do Generic)', async () => {
    const { container, http } = await renderCard(SignatureCard, token());

    await userEvent.click(provider('Generic'));

    expect(provider('Generic').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent?.trim()).toBe(
      'To save, fill in: Signature header, Secret',
    );
    expect(screen.getByRole('textbox', { name: 'Signature header' }).hasAttribute('required')).toBe(
      true,
    );
    expect(secret().hasAttribute('required')).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    await expectNoAxeViolations(container);

    await userEvent.click(save());

    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      'To save, fill in: Signature header, Secret',
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Signature header' }));
    expect(save().getAttribute('aria-describedby')).toBe('signature-pending');
    expect(screen.getByText('The header is required.')).toBeTruthy();
    http.expectNone(() => true);
  });

  it('deve salvar o genérico com a URL inteira no PUT e mostrar o estado salvo Quando header e segredo são preenchidos', async () => {
    const { http, fixture } = await renderCard(SignatureCard, token({ default_status: 404 }));
    await userEvent.click(provider('Generic'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Signature header' }), 'X-Signature');
    await userEvent.type(screen.getByRole('textbox', { name: 'Prefix' }), 'sha256=');
    await userEvent.type(secret(), 'segredo');

    expect(
      container(fixture).querySelector('.anatomy')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('Expected header: X-Signature: sha256=<hex of HMAC-SHA256(body)>');
    await userEvent.click(save());
    const put = await expectPut(http);

    expect(put.request.body).toMatchObject({
      default_status: '404',
      signature: {
        provider: 'generic',
        secret: 'segredo',
        header: 'X-Signature',
        algorithm: 'sha256',
        encoding: 'hex',
        prefix: 'sha256=',
      },
    });
    put.flush(
      token({
        default_status: 404,
        signature: {
          provider: 'generic',
          secret: '••••gredo',
          header: 'X-Signature',
          algorithm: 'sha256',
          encoding: 'hex',
          prefix: 'sha256=',
        },
      }),
    );
    await vi.waitFor(() => expect(screen.getByText('On · Generic')).toBeTruthy());
    expect(screen.getByRole('status').textContent?.trim()).toBe('Saved.');
    expect(TestBed.inject(Preferences).token()?.signature?.provider).toBe('generic');
    expect(screen.getByRole('link', { name: 'Send a signed test' }).getAttribute('href')).toContain(
      'outbound?send=signed',
    );
  });

  it('deve reenviar o segredo mascarado e o resto da URL Quando só a tolerância muda', async () => {
    const { http } = await renderCard(
      SignatureCard,
      token({ signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 } }),
    );

    expect(secret().getAttribute('placeholder')).toBe('••••1234');
    expect(screen.getByText('Leave blank to keep the current secret')).toBeTruthy();
    const tolerance = screen.getByRole('spinbutton', { name: 'Timestamp tolerance (seconds)' });
    await userEvent.clear(tolerance);
    await userEvent.type(tolerance, '600');
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body.signature).toEqual({
      provider: 'stripe',
      secret: '••••1234',
      toleranceSeconds: 600,
    });
    put.flush(token());
  });

  it('deve exigir segredo novo e avisar Quando o provedor muda numa URL com segredo salvo', async () => {
    const { http } = await renderCard(SignatureCard, SALVA);

    await userEvent.click(provider('Shopify'));

    expect(
      screen.getByText(/^The saved GitHub secret is not reused for Shopify/).textContent?.trim(),
    ).toBe('The saved GitHub secret is not reused for Shopify: paste the Shopify secret.');
    expect(secret().hasAttribute('required')).toBe(true);
    expect(secret().getAttribute('placeholder') ?? '').toBe('');
    await userEvent.click(save());
    expect(screen.getByRole('alert').textContent?.trim()).toBe('To save, fill in: Secret');
    await userEvent.type(secret(), 'shpss_novo');
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body.signature).toEqual({ provider: 'shopify', secret: 'shpss_novo' });
    put.flush(token());
  });

  it('deve mover a escolha pelas setas (roving tabindex) Quando o foco está num provedor', async () => {
    await renderCard(SignatureCard, SALVA);

    provider('GitHub').focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(provider('Shopify').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(provider('Shopify'));
    await userEvent.keyboard('{Home}');
    expect(provider('None').getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{ArrowUp}');
    expect(provider('Generic').getAttribute('aria-checked')).toBe('true');
  });

  it('deve mandar assinatura nula e manter o schema Quando "Turn off" é salvo', async () => {
    const { http } = await renderCard(SignatureCard, SALVA);

    await userEvent.click(provider('None'));
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({
      signature: null,
      schema: { type: 'object' },
      default_content: 'resposta',
    });
    put.flush(token());
  });

  it('deve voltar ao salvo Quando Discard é clicado', async () => {
    await renderCard(SignatureCard, SALVA);
    await userEvent.click(provider('Slack'));

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(provider('GitHub').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Unsaved')).toBeNull();
  });
});

function container(fixture: { nativeElement: unknown }): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}
