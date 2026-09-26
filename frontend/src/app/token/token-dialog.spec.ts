import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { token } from '../../testing/fixtures';
import { TokenDialog, TokenDialogData } from './token-dialog';

async function openDialog(data: TokenDialogData) {
  const dialogRef = { close: vi.fn() };
  TestBed.configureTestingModule({
    imports: [TokenDialog],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: dialogRef },
    ],
  });
  const fixture = TestBed.createComponent(TokenDialog);
  const loader: HarnessLoader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
  return { fixture, loader, dialogRef };
}

const input = (loader: HarnessLoader, placeholder: string) =>
  loader.getHarness(MatInputHarness.with({ placeholder }));

const autoCleanup = (loader: HarnessLoader) =>
  loader.getHarness(MatSelectHarness.with({ selector: '[formControlName=auto_cleanup]' }));

const autoCleanupField = (loader: HarnessLoader) =>
  loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Auto cleanup' }));

const retryAfter = (loader: HarnessLoader) =>
  loader.getHarness(MatInputHarness.with({ selector: '[formControlName=retry_after]' }));

describe('Dado o diálogo "Create New URL"', () => {
  it('deve enviar os campos preenchidos, timeout 0 e Retry-After e limpeza nulos Quando Create é clicado', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await input(loader, '200')).setValue('404');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Create' }))).click();

    expect(dialogRef.close).toHaveBeenCalledWith({
      default_status: '404',
      timeout: '0',
      retry_after: null,
      auto_cleanup: null,
      signature: null,
    });
  });

  it('deve oferecer Disabled e os limites do servidor, começando em Disabled, Quando o diálogo abre', async () => {
    const { loader } = await openDialog({ mode: 'create', token: token() });
    const select = await autoCleanup(loader);

    expect(await select.getValueText()).toBe('Disabled');
    await select.open();
    const options = await select.getOptions();
    expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
      'Disabled',
      '500',
      '1000',
      '5000',
      '10000',
    ]);
  });

  it('deve enviar o limite como número e explicar o que ele faz Quando 1000 é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });
    const select = await autoCleanup(loader);

    await select.open();
    await select.clickOptions({ text: '1000' });
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Create' }))).click();

    expect(await (await autoCleanupField(loader)).getTextHints()).toEqual([
      'Keeps the 1000 most recent requests',
    ]);
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ auto_cleanup: 1000 }));
  });

  it.each([
    ['segundos', '120'],
    ['data HTTP', 'Sun, 06 Nov 1994 08:49:37 GMT'],
  ])('deve enviar o Retry-After em %s Quando o campo é preenchido', async (_caso, valor) => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await retryAfter(loader)).setValue(valor);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Create' }))).click();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ retry_after: valor }));
  });

  it('deve explicar o campo Retry-After Quando o diálogo abre', async () => {
    const { loader } = await openDialog({ mode: 'create', token: token() });

    const field = await loader.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Retry-After' }),
    );

    expect(await field.getTextHints()).toEqual([
      'Seconds or HTTP-date; useful with 429, 503 or 3xx',
    ]);
  });

  it.each([
    ['texto', 'amanhã'],
    ['negativo', '-5'],
    ['data fora do IMF-fixdate', '2026-09-26T10:00:00Z'],
  ])(
    'não deve permitir criar e deve explicar o erro Quando o Retry-After é %s',
    async (_caso, valor) => {
      const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

      await (await retryAfter(loader)).setValue(valor);
      await (await retryAfter(loader)).blur();
      const field = await loader.getHarness(
        MatFormFieldHarness.with({ floatingLabelText: 'Retry-After' }),
      );

      expect(
        await (await loader.getHarness(MatButtonHarness.with({ text: 'Create' }))).isDisabled(),
      ).toBe(true);
      expect(await field.getTextErrors()).toEqual([
        'The retry after must be a number of seconds or an HTTP date.',
      ]);
      expect(dialogRef.close).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['acima de 10', '11'],
    ['negativo', '-1'],
    ['fracionário', '1.5'],
  ])('não deve permitir criar Quando o timeout é %s', async (_caso, timeout) => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await input(loader, '0')).setValue(timeout);
    const create = await loader.getHarness(MatButtonHarness.with({ text: 'Create' }));

    expect(await create.isDisabled()).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('deve mostrar o aviso de URL não encontrada Quando não há token', async () => {
    const { fixture } = await openDialog({ mode: 'create', token: null });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent,
    ).toContain('This URL could not be found.');
  });
});

describe('Dado o diálogo "Edit URL"', () => {
  it('deve vir preenchido com a URL atual e devolver os campos editados Quando Edit é clicado', async () => {
    const atual = token({
      default_status: 201,
      default_content_type: 'application/json',
      timeout: 3,
    });
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: atual });

    expect(await (await input(loader, '200')).getValue()).toBe('201');
    await (await input(loader, 'text/plain')).setValue('text/xml');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Edit' }))).click();

    expect(dialogRef.close).toHaveBeenCalledWith({
      default_status: '201',
      default_content_type: 'text/xml',
      timeout: '3',
      default_content: 'ok',
      retry_after: null,
      auto_cleanup: null,
      signature: null,
    });
  });

  it('deve vir com o limite salvo e enviar nulo, e não omitir o campo, Quando Disabled é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ auto_cleanup: 500 }),
    });
    const select = await autoCleanup(loader);
    expect(await select.getValueText()).toBe('500');
    expect(await (await autoCleanupField(loader)).getTextHints()).toEqual([
      'Keeps the 500 most recent requests',
    ]);

    await select.open();
    await select.clickOptions({ text: 'Disabled' });
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Edit' }))).click();

    expect(await select.getValueText()).toBe('Disabled');
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ auto_cleanup: null }));
  });

  it.each([
    ['em segundos (número no JSON)', 120, '120'],
    ['em segundos (texto no JSON)', '120', '120'],
    ['como data HTTP', 'Sun, 06 Nov 1994 08:49:37 GMT', 'Sun, 06 Nov 1994 08:49:37 GMT'],
  ])('deve vir com o Retry-After salvo %s', async (_caso, salvo, exibido) => {
    const { loader } = await openDialog({ mode: 'edit', token: token({ retry_after: salvo }) });

    expect(await (await retryAfter(loader)).getValue()).toBe(exibido);
  });

  it('deve enviar Retry-After nulo, e não omitir o campo, Quando o valor salvo é apagado', async () => {
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ retry_after: '120' }),
    });

    await (await retryAfter(loader)).setValue('');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Edit' }))).click();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ retry_after: null }));
  });

  it('deve abrir vazio e Disabled Quando o token veio do localStorage de uma versão sem os campos', async () => {
    const antigo = token();
    delete antigo.retry_after;
    delete antigo.auto_cleanup;
    const { loader } = await openDialog({ mode: 'edit', token: antigo });

    expect(await (await retryAfter(loader)).getValue()).toBe('');
    expect(await (await autoCleanup(loader)).getValueText()).toBe('Disabled');
  });
});

const signatureSelect = (loader: HarnessLoader, control: string) =>
  loader.getHarness(MatSelectHarness.with({ selector: `[formControlName=${control}]` }));

const signatureInput = (loader: HarnessLoader, control: string) =>
  loader.getHarness(MatInputHarness.with({ selector: `[formControlName=${control}]` }));

const signatureField = (loader: HarnessLoader, label: string) =>
  loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));

const button = (loader: HarnessLoader, text: 'Create' | 'Edit') =>
  loader.getHarness(MatButtonHarness.with({ text }));

async function chooseProvider(loader: HarnessLoader, provider: string) {
  const select = await signatureSelect(loader, 'provider');
  await select.open();
  await select.clickOptions({ text: provider });
}

describe('Dado a seção "Signature verification" do diálogo "Create New URL"', () => {
  it('deve começar em None e oferecer os cinco provedores Quando o diálogo abre', async () => {
    const { loader } = await openDialog({ mode: 'create', token: token() });
    const select = await signatureSelect(loader, 'provider');

    expect(await select.getValueText()).toBe('None');
    await select.open();
    const options = await select.getOptions();
    expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
      'None',
      'Stripe',
      'GitHub',
      'Shopify',
      'Slack',
      'Generic',
    ]);
  });

  it.each([
    ['GitHub', 'Sent in X-Hub-Signature-256: sha256=<hex>; use the webhook secret'],
    ['Shopify', "Sent in X-Shopify-Hmac-Sha256 (base64); use the app's client secret"],
    ['Stripe', 'Sent in Stripe-Signature: t=…,v1=…; use the endpoint signing secret (whsec_…)'],
    [
      'Slack',
      'Sent in X-Slack-Signature: v0=… with X-Slack-Request-Timestamp; use the signing secret',
    ],
    ['Generic', 'HMAC of the raw body, sent in the header you choose'],
  ])(
    'deve dizer onde a %s manda a assinatura Quando o provedor é escolhido',
    async (nome, dica) => {
      const { loader } = await openDialog({ mode: 'create', token: token() });

      await chooseProvider(loader, nome);

      expect(await (await signatureField(loader, 'Signature provider')).getTextHints()).toEqual([
        dica,
      ]);
    },
  );

  it('deve enviar provedor e segredo, sem campos do genérico nem tolerância, Quando GitHub é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'GitHub');
    await (await signatureInput(loader, 'secret')).setValue('s3cr3t');
    await (await button(loader, 'Create')).click();

    expect(await (await signatureInput(loader, 'secret')).getType()).toBe('password');
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ signature: { provider: 'github', secret: 's3cr3t' } }),
    );
  });

  it.each([
    ['vazio', ''],
    ['acima de 256 caracteres', 'x'.repeat(257)],
  ])('não deve permitir criar e deve explicar Quando o segredo está %s', async (_caso, segredo) => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Shopify');
    await (await signatureInput(loader, 'secret')).setValue(segredo);
    await (await signatureInput(loader, 'secret')).blur();

    expect(await (await button(loader, 'Create')).isDisabled()).toBe(true);
    expect(await (await signatureField(loader, 'Secret')).getTextErrors()).toEqual([
      'The secret is required, up to 256 characters.',
    ]);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it.each([
    ['Stripe', 'stripe'],
    ['Slack', 'slack'],
  ])(
    'deve sugerir a tolerância de 300 s e enviá-la como número Quando %s é escolhido',
    async (nome, provider) => {
      const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

      await chooseProvider(loader, nome);
      expect(await (await signatureInput(loader, 'toleranceSeconds')).getValue()).toBe('300');
      await (await signatureInput(loader, 'toleranceSeconds')).setValue('600');
      await (await signatureInput(loader, 'secret')).setValue('whsec_abc');
      await (await button(loader, 'Create')).click();

      expect(dialogRef.close).toHaveBeenCalledWith(
        expect.objectContaining({
          signature: { provider, secret: 'whsec_abc', toleranceSeconds: 600 },
        }),
      );
    },
  );

  it.each([
    ['zero', '0'],
    ['acima de 86400', '86401'],
    ['fracionária', '1.5'],
  ])('não deve permitir criar Quando a tolerância é %s', async (_caso, valor) => {
    const { loader } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Stripe');
    await (await signatureInput(loader, 'secret')).setValue('whsec_abc');
    await (await signatureInput(loader, 'toleranceSeconds')).setValue(valor);

    expect(await (await button(loader, 'Create')).isDisabled()).toBe(true);
  });

  it('deve esconder a tolerância e os campos do genérico Quando o provedor é GitHub', async () => {
    const { loader } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'GitHub');

    const hidden = await Promise.all(
      ['toleranceSeconds', 'header', 'prefix'].map((control) =>
        loader.getAllHarnesses(MatInputHarness.with({ selector: `[formControlName=${control}]` })),
      ),
    );
    expect(hidden.map((found) => found.length)).toEqual([0, 0, 0]);
  });

  it('deve enviar header, algoritmo, encoding e prefixo Quando o genérico é preenchido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');
    expect(await (await signatureSelect(loader, 'algorithm')).getValueText()).toBe('SHA-256');
    expect(await (await signatureSelect(loader, 'encoding')).getValueText()).toBe('Hex');
    await (await signatureInput(loader, 'secret')).setValue('k');
    await (await signatureInput(loader, 'header')).setValue('X-Signature');
    const algorithm = await signatureSelect(loader, 'algorithm');
    await algorithm.open();
    await algorithm.clickOptions({ text: 'SHA-512' });
    const encoding = await signatureSelect(loader, 'encoding');
    await encoding.open();
    await encoding.clickOptions({ text: 'Base64' });
    await (await signatureInput(loader, 'prefix')).setValue('sha512=');
    await (await button(loader, 'Create')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: {
          provider: 'generic',
          secret: 'k',
          header: 'X-Signature',
          algorithm: 'sha512',
          encoding: 'base64',
          prefix: 'sha512=',
        },
      }),
    );
  });

  it('não deve enviar prefixo Quando o genérico fica sem prefixo', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');
    await (await signatureInput(loader, 'secret')).setValue('k');
    await (await signatureInput(loader, 'header')).setValue('X-Signature');
    await (await button(loader, 'Create')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: {
          provider: 'generic',
          secret: 'k',
          header: 'X-Signature',
          algorithm: 'sha256',
          encoding: 'hex',
        },
      }),
    );
  });

  it('não deve permitir criar e deve explicar Quando o genérico fica sem header', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');
    await (await signatureInput(loader, 'secret')).setValue('k');
    await (await signatureInput(loader, 'header')).blur();

    expect(await (await signatureField(loader, 'Signature header')).getTextErrors()).toEqual([
      'The header is required.',
    ]);
    expect(await (await button(loader, 'Create')).isDisabled()).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});

describe('Dado a seção "Signature verification" do diálogo "Edit URL"', () => {
  const comGithub = () => token({ signature: { provider: 'github', secret: '••••cdef' } });

  it('deve mostrar o provedor salvo e o segredo mascarado, com o campo vazio, Quando a URL tem assinatura', async () => {
    const { loader } = await openDialog({ mode: 'edit', token: comGithub() });
    const secret = await signatureInput(loader, 'secret');

    expect(await (await signatureSelect(loader, 'provider')).getValueText()).toBe('GitHub');
    expect(await secret.getValue()).toBe('');
    expect(await secret.getPlaceholder()).toBe('••••cdef');
    expect(await (await signatureField(loader, 'Secret')).getTextHints()).toEqual([
      'Leave blank to keep the current secret',
    ]);
  });

  it('deve reenviar o mascarado, e não um segredo, Quando outro campo é editado e o segredo não é mexido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await (await input(loader, '200')).setValue('202');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        default_status: '202',
        signature: { provider: 'github', secret: '••••cdef' },
      }),
    );
  });

  it('deve enviar o segredo novo Quando ele é digitado', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await (await signatureInput(loader, 'secret')).setValue('novo');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ signature: { provider: 'github', secret: 'novo' } }),
    );
  });

  it('deve manter o segredo salvo, sem exigir outro, Quando só o provedor muda', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await chooseProvider(loader, 'Shopify');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ signature: { provider: 'shopify', secret: '••••cdef' } }),
    );
  });

  it('deve enviar assinatura nula, e não omitir o campo, Quando None é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await chooseProvider(loader, 'None');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ signature: null }));
  });

  it('deve exigir o segredo Quando a URL não tinha assinatura e um provedor é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: token() });

    await chooseProvider(loader, 'Slack');

    expect(await (await button(loader, 'Edit')).isDisabled()).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('deve vir com os campos do genérico salvos e mantê-los Quando Edit é clicado', async () => {
    const salvo = {
      provider: 'generic' as const,
      secret: '••••1234',
      header: 'X-Sig',
      algorithm: 'sha1' as const,
      encoding: 'base64' as const,
      prefix: 'sha1=',
    };
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ signature: salvo }),
    });

    expect(await (await signatureInput(loader, 'header')).getValue()).toBe('X-Sig');
    expect(await (await signatureSelect(loader, 'algorithm')).getValueText()).toBe('SHA-1');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ signature: salvo }));
  });

  it('deve vir com a tolerância salva Quando a URL usa Stripe', async () => {
    const { loader } = await openDialog({
      mode: 'edit',
      token: token({ signature: { provider: 'stripe', secret: '••••abcd', toleranceSeconds: 60 } }),
    });

    expect(await (await signatureInput(loader, 'toleranceSeconds')).getValue()).toBe('60');
  });

  it('deve abrir em None Quando o token veio do localStorage de uma versão sem assinatura', async () => {
    const antigo = token();
    delete antigo.signature;
    const { loader } = await openDialog({ mode: 'edit', token: antigo });

    expect(await (await signatureSelect(loader, 'provider')).getValueText()).toBe('None');
  });
});
