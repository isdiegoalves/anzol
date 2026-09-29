import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { attention, changesBar, expectPut, renderCard, saveButton } from '../../testing/checks';
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
const save = saveButton;
const card = () => screen.getByRole('region', { name: 'Signature verification' });
const note = () => within(card()).getByRole('status').textContent?.trim();

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
    expect(note()).toBe('To save, fill in: Signature header, Secret');
    expect(screen.getByRole('textbox', { name: 'Signature header' }).hasAttribute('required')).toBe(
      true,
    );
    expect(secret().hasAttribute('required')).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    await expectNoAxeViolations(container);

    await userEvent.click(save());

    expect(attention()).toBe('2 fields need attention: Signature header, Secret');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Signature header' }));
    // Quem fala é o alert da barra: o status do cartão se cala para não repetir.
    expect(within(card()).queryByText(/^To save/)).toBeNull();
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
    expect(changesBar()?.textContent).toContain(
      '4 unsaved changes: Signature provider, Signature header, Secret, Prefix',
    );
    expect(changesBar()?.textContent).not.toContain('segredo');
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
    expect(note()).toBe('Saved. Leave the secret blank to keep it.');
    expect(changesBar()).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('list', { name: 'Changes to save' }).textContent?.trim()).toBe(
      'Tolerance: 300 s → 600 s',
    );
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
    expect(attention()).toBe('1 field needs attention: Secret');
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

  describe('Dado a fidelidade ao protótipo C (F2)', () => {
    it('CHECKS-06: deve mostrar o chip "On · GitHub" com ícone e desligar pelo "Turn off" do cabeçalho', async () => {
      const { container } = await renderCard(SignatureCard, SALVA);

      const chip = container.querySelector('.card-head .state.on');
      expect(chip?.textContent?.trim()).toBe('On · GitHub');
      expect(chip?.querySelector('svg')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

      expect(provider('None').getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText(/^Saving turns signature verification off/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    });

    it('CHECKS-11: deve pintar o header de exemplo por parte e repetir a cor na legenda, mantendo a linha "Expected header:"', async () => {
      const { container } = await renderCard(SignatureCard, SALVA);

      const example = screen.getByLabelText('Example header');
      const parts = [...example.querySelectorAll('span')].map((part) => [
        part.textContent,
        part.className,
      ]);
      expect(parts).toEqual([
        ['X-Hub-Signature-256: ', 'part'],
        ['sha256=', 'part prefix'],
        [expect.stringMatching(/^[0-9a-f]+…$/), 'part sig'],
      ]);
      const keys = [...container.querySelectorAll('.legend .key')].map((key) => [
        key.textContent?.trim(),
        key.className,
      ]);
      expect(keys).toEqual([
        ['sha256=', 'key prefix'],
        ['hex', 'key sig'],
      ]);
      expect(container.querySelector('.anatomy')?.textContent).toBe(
        'Expected header: X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(body)>',
      );
    });

    it('CHECKS-11: deve montar o exemplo do genérico com o header e o prefixo digitados', async () => {
      await renderCard(SignatureCard, token());
      await userEvent.click(provider('Generic'));
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Signature header' }),
        'X-Assinatura',
      );
      await userEvent.type(screen.getByRole('textbox', { name: 'Prefix' }), 'v1=');

      const parts = [...screen.getByLabelText('Example header').querySelectorAll('span')].map(
        (part) => part.textContent,
      );
      expect(parts.slice(0, 2)).toEqual(['X-Assinatura: ', 'v1=']);
    });

    it('CHECKS-12: deve ter o título "{Provider} settings", campos contornados e a ajuda da tolerância do protótipo', async () => {
      const { container, fixture } = await renderCard(
        SignatureCard,
        token({ signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 } }),
      );

      expect(screen.getByRole('heading', { level: 3, name: 'Stripe settings' })).toBeTruthy();
      expect(container.querySelector('.settings-head')?.textContent).toContain('* required');
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const fields = await loader.getAllHarnesses(MatFormFieldHarness);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(await field.getAppearance()).toBe('outline');
      }
      expect(
        screen.getByText(
          '1 to 86400. Older or future timestamps are rejected (replay protection).',
        ),
      ).toBeTruthy();
    });
  });

  describe('Dado as decisões do dono sobre o cartão (F2 fase 2)', () => {
    it('CHECKS-07: deve pôr os três passos num painel e dizer que a comparação é em tempo constante', async () => {
      const { container } = await renderCard(SignatureCard, SALVA);

      const steps = screen.getByRole('list', { name: 'How signature verification works' });
      expect(steps.closest('.steps-panel')).toBeTruthy();
      expect(steps.textContent).toContain('compared in constant time');
      expect(container.querySelectorAll('.step-number')).toHaveLength(3);
    });

    it('CHECKS-09: deve mostrar o formato do header, a fórmula e o segredo curto do protótipo', async () => {
      await renderCard(SignatureCard, SALVA);

      const github = [...provider('GitHub').querySelectorAll('.about > *')].map((cell) =>
        cell.textContent?.trim(),
      );
      expect(github).toEqual([
        'X-Hub-Signature-256: sha256=<hex>',
        'HMAC-SHA256(secret, raw body) → hex',
        'The webhook Secret field',
      ]);
      expect(provider('Stripe').textContent).toContain('Stripe-Signature: t=…,v1=<hex>');
      expect(provider('Stripe').textContent).toContain(
        'HMAC-SHA256(secret, "{t}.{raw body}") → hex',
      );
      expect(
        screen.getByText(
          /^Where to find the secret: Repository or organization › Settings › Webhooks › Secret\./,
        ),
      ).toBeTruthy();
    });

    it('CHECKS-10: deve dizer que as já recebidas guardam o resultado e manter o pedido do segredo novo', async () => {
      await renderCard(SignatureCard, SALVA);

      await userEvent.click(provider('Shopify'));

      const banner = document.querySelector('.banner[role="status"]');
      const parts = [...(banner?.querySelectorAll('span > span') ?? [])].map((part) =>
        part.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(parts).toEqual([
        'Unsaved: switching from GitHub (saved) to Shopify. Requests already received keep the result they got on arrival.',
        'The saved GitHub secret is not reused for Shopify: paste the Shopify secret.',
      ]);
      expect(banner?.querySelector('app-icon')).toBeTruthy();
    });

    it('CHECKS-13: deve ter os ícones do protótipo na barra, "Send a signed test" com ícone e Discard contornado', async () => {
      await renderCard(SignatureCard, SALVA);

      expect(
        screen.getByRole('link', { name: 'Send a signed test' }).querySelector('app-icon'),
      ).toBeTruthy();
      await userEvent.click(provider('Slack'));
      expect(save().querySelector('app-icon')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Discard' }).hasAttribute('mat-stroked-button'),
      ).toBe(true);
    });

    it('deve desligar o "Send a signed test", com a razão, Quando há rascunho em Assinatura', async () => {
      const { container } = await renderCard(SignatureCard, SALVA);

      await userEvent.click(provider('Slack'));

      const link = screen.getByRole('link', { name: 'Send a signed test' });
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(link.hasAttribute('href')).toBe(false);
      const why = container.querySelector(`#${link.getAttribute('aria-describedby')}`);
      expect(why?.textContent?.trim()).toBe('Save first: the test uses the saved settings.');
      await expectNoAxeViolations(container);
    });

    it('deve mostrar "Save changes · Ctrl+S", com o nome acessível "Save changes"', async () => {
      await renderCard(SignatureCard, SALVA);
      await userEvent.click(provider('Slack'));

      expect(save().textContent?.replace(/\s+/g, ' ').trim()).toBe('Save changes· Ctrl+S');
      expect(save().querySelector('.keys')?.textContent).toBe('· Ctrl+S');
      expect(save().getAttribute('aria-keyshortcuts')).toBe('Control+S Meta+S');
      expect(save().querySelector('.keys')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('CHECKS-13: deve dizer "Saved." ao abrir uma assinatura salva, sumir na edição e voltar no Discard', async () => {
      await renderCard(SignatureCard, SALVA);
      const saved = 'Saved. Leave the secret blank to keep it.';

      expect(note()).toBe(saved);
      await userEvent.click(provider('Slack'));
      expect(screen.queryByText(saved)).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(note()).toBe(saved);
    });

    it('deve pôr a tolerância ao lado do Secret e deixar as ajudas crescerem sem cobrir o campo de baixo (Stripe)', async () => {
      const { container } = await renderCard(
        SignatureCard,
        token({ signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 } }),
      );

      const tolerance = screen.getByRole('spinbutton', { name: 'Timestamp tolerance (seconds)' });
      const secret = container.querySelector('input[formcontrolname="secret"]') as HTMLElement;
      const grid = tolerance.closest('.pair');
      expect(grid).toBeTruthy();
      expect(secret.closest('.pair')).toBe(grid);
      const fields = [...container.querySelectorAll('form.fields mat-form-field')];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(
          field.querySelector('.mat-mdc-form-field-subscript-dynamic-size'),
          field.textContent ?? '',
        ).toBeTruthy();
      }
    });

    it('CHECKS-13: não deve dizer "Saved." Quando a URL não verifica', async () => {
      await renderCard(SignatureCard, token());

      expect(screen.queryByText(/^Saved\./)).toBeNull();
    });
  });
});

function container(fixture: { nativeElement: unknown }): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}
