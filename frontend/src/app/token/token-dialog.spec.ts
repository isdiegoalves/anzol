import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { token } from '../../testing/fixtures';
import { TokenDialog, TokenDialogData } from './token-dialog';

/** `save` salva sem erro, a menos que o teste diga outra coisa. */
async function openDialog(
  data: Omit<TokenDialogData, 'save'>,
  save = vi.fn<TokenDialogData['save']>().mockResolvedValue([]),
) {
  const dialogRef = { close: vi.fn() };
  TestBed.configureTestingModule({
    imports: [TokenDialog],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { ...data, save } },
      { provide: MatDialogRef, useValue: dialogRef },
    ],
  });
  const fixture = TestBed.createComponent(TokenDialog);
  const loader: HarnessLoader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
  return { fixture, loader, dialogRef, save };
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
      schema: null,
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
    'não deve criar e deve explicar o erro e o que corrigir Quando o Retry-After é %s',
    async (_caso, valor) => {
      const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

      await (await retryAfter(loader)).setValue(valor);
      await (await retryAfter(loader)).blur();
      const field = await loader.getHarness(
        MatFormFieldHarness.with({ floatingLabelText: 'Retry-After' }),
      );

      expect(await trySave(fixture, loader, 'Create')).toBe('To save, fix: Retry-After');
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
  ])('não deve criar e deve dizer o que corrigir Quando o timeout é %s', async (_caso, timeout) => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await input(loader, '0')).setValue(timeout);

    expect(await trySave(fixture, loader, 'Create')).toBe('To save, fix: Timeout before response');
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
      schema: null,
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

type Fixture = Awaited<ReturnType<typeof openDialog>>['fixture'];

/** Resumo do que falta para salvar, ao lado do botão; `null` quando não há. */
function pendingSummary(fixture: Fixture): string | null {
  const summary = (fixture.nativeElement as HTMLElement).querySelector('.pending[role=alert]');
  return summary?.textContent?.trim() ?? null;
}

/** O botão nunca fica desabilitado em silêncio: clica e devolve o resumo do que falta. */
async function trySave(fixture: Fixture, loader: HarnessLoader, text: 'Create' | 'Edit') {
  const save = await button(loader, text);
  expect(await save.isDisabled()).toBe(false);
  await save.click();
  await fixture.whenStable();
  return pendingSummary(fixture);
}

/** Linhas do quadro dos provedores, com as células separadas por " | ". */
function providerRows(element: HTMLElement): string[] {
  return [...element.querySelectorAll('.providers tbody tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent?.trim()).join(' | '),
  );
}

function anatomyLines(element: HTMLElement): string[] {
  return [...element.querySelectorAll('.anatomy code')].map((line) => line.textContent ?? '');
}

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

  it('deve mostrar o quadro fixo dos cinco provedores, sem destaque nem anatomia, Quando o diálogo abre em None', async () => {
    const { fixture } = await openDialog({ mode: 'create', token: token() });
    const element = fixture.nativeElement as HTMLElement;

    expect(providerRows(element)).toEqual([
      'Stripe | Stripe-Signature | "{t}.{raw body}", HMAC-SHA256, hex | Endpoint signing secret, whole (whsec_…)',
      "GitHub | X-Hub-Signature-256 | Raw body, HMAC-SHA256, hex | The webhook's secret",
      "Shopify | X-Shopify-Hmac-Sha256 | Raw body, HMAC-SHA256, base64 | The app's client secret",
      'Slack | X-Slack-Signature + X-Slack-Request-Timestamp | "v0:{timestamp}:{raw body}", HMAC-SHA256, hex | The app\'s signing secret',
      'Generic | The header you name | Raw body, HMAC-SHA1/256/512, hex or base64 | Any secret, up to 256 characters',
    ]);
    expect(element.querySelector('.providers [aria-current]')).toBeNull();
    expect(element.querySelector('.anatomy')).toBeNull();
  });

  it.each([
    ['Stripe', ['Stripe-Signature: t=<unix time>,v1=<hex of HMAC-SHA256("{t}.{body}")>']],
    ['GitHub', ['X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(body)>']],
    ['Shopify', ['X-Shopify-Hmac-Sha256: <base64 of HMAC-SHA256(body)>']],
    [
      'Slack',
      [
        'X-Slack-Signature: v0=<hex of HMAC-SHA256("v0:{timestamp}:{body}")>',
        'X-Slack-Request-Timestamp: <unix time>',
      ],
    ],
    ['Generic', ['<header>: <hex of HMAC-SHA256(body)>']],
  ])(
    'deve destacar a %s no quadro e mostrar a anatomia do header esperado Quando o provedor é escolhido',
    async (nome, anatomia) => {
      const { fixture, loader } = await openDialog({ mode: 'create', token: token() });

      await chooseProvider(loader, nome);
      const element = fixture.nativeElement as HTMLElement;

      const chosen = [...element.querySelectorAll('.providers tbody tr')].filter(
        (row) => row.getAttribute('aria-current') === 'true',
      );
      expect(chosen.map((row) => row.querySelector('th')?.textContent?.trim())).toEqual([nome]);
      expect(chosen[0].classList).toContain('chosen');
      expect(anatomyLines(element)).toEqual(anatomia);
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
    ['vazio', '', 'To save, fill in: Secret'],
    ['acima de 256 caracteres', 'x'.repeat(257), 'To save, fix: Secret'],
  ])('não deve criar e deve explicar Quando o segredo está %s', async (_caso, segredo, resumo) => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Shopify');
    await (await signatureInput(loader, 'secret')).setValue(segredo);
    await (await signatureInput(loader, 'secret')).blur();

    expect(await trySave(fixture, loader, 'Create')).toBe(resumo);
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
  ])(
    'não deve criar e deve dizer o que corrigir Quando a tolerância é %s',
    async (_caso, valor) => {
      const { fixture, loader, save } = await openDialog({ mode: 'create', token: token() });

      await chooseProvider(loader, 'Stripe');
      await (await signatureInput(loader, 'secret')).setValue('whsec_abc');
      await (await signatureInput(loader, 'toleranceSeconds')).setValue(valor);

      expect(await trySave(fixture, loader, 'Create')).toBe(
        'To save, fix: Timestamp tolerance (seconds)',
      );
      expect(save).not.toHaveBeenCalled();
    },
  );

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

  it('deve montar a anatomia e enviar header, algoritmo, encoding e prefixo Quando o genérico é preenchido', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

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
    expect(anatomyLines(fixture.nativeElement as HTMLElement)).toEqual([
      'X-Signature: sha512=<base64 of HMAC-SHA512(body)>',
    ]);
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

  it('deve marcar Signature header e Secret como obrigatórios desde o início, com Create habilitado, Quando o genérico é escolhido', async () => {
    const { fixture, loader } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');

    expect(await (await signatureInput(loader, 'header')).isRequired()).toBe(true);
    expect(await (await signatureInput(loader, 'secret')).isRequired()).toBe(true);
    expect(await (await signatureInput(loader, 'prefix')).isRequired()).toBe(false);
    expect(await (await button(loader, 'Create')).isDisabled()).toBe(false);
    expect(pendingSummary(fixture)).toBeNull();
  });

  it('deve listar o que falta, mostrar o erro de cada campo e focar o Signature header Quando Create é clicado com o genérico vazio', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');

    expect(await trySave(fixture, loader, 'Create')).toBe(
      'To save, fill in: Signature header, Secret',
    );
    expect(await (await signatureField(loader, 'Signature header')).getTextErrors()).toEqual([
      'The header is required.',
    ]);
    expect(await (await signatureField(loader, 'Secret')).getTextErrors()).toEqual([
      'The secret is required, up to 256 characters.',
    ]);
    expect(await (await signatureInput(loader, 'header')).isFocused()).toBe(true);
    expect(
      await (await (await button(loader, 'Create')).host()).getAttribute('aria-describedby'),
    ).toBe('token-form-pending');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('deve tirar do resumo o que foi preenchido e criar Quando o que faltava é preenchido', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await chooseProvider(loader, 'Generic');
    await trySave(fixture, loader, 'Create');
    await (await signatureInput(loader, 'header')).setValue('X-Signature');
    await fixture.whenStable();
    expect(pendingSummary(fixture)).toBe('To save, fill in: Secret');
    await (await signatureInput(loader, 'secret')).setValue('k');
    await fixture.whenStable();
    expect(pendingSummary(fixture)).toBeNull();
    await (await button(loader, 'Create')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: expect.objectContaining({ provider: 'generic', header: 'X-Signature' }),
      }),
    );
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

  it('deve exigir segredo novo e avisar, sem reaproveitar o salvo, Quando o provedor muda', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await chooseProvider(loader, 'Shopify');
    const secret = await signatureInput(loader, 'secret');

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.warning[role=status]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('The saved GitHub secret is not reused for Shopify: paste the Shopify secret.');
    expect(await secret.isRequired()).toBe(true);
    expect(await secret.getPlaceholder()).toBe('');
    expect(await (await signatureField(loader, 'Secret')).getTextHints()).toEqual([]);
    expect(await trySave(fixture, loader, 'Edit')).toBe('To save, fill in: Secret');
    expect(await secret.isFocused()).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();

    await secret.setValue('shpss_novo');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ signature: { provider: 'shopify', secret: 'shpss_novo' } }),
    );
  });

  it('deve voltar a manter o segredo salvo Quando o provedor volta ao salvo', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await chooseProvider(loader, 'Shopify');
    await chooseProvider(loader, 'GitHub');

    expect((fixture.nativeElement as HTMLElement).querySelector('.warning')).toBeNull();
    expect(await (await signatureInput(loader, 'secret')).isRequired()).toBe(false);
    await (await button(loader, 'Edit')).click();
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ signature: { provider: 'github', secret: '••••cdef' } }),
    );
  });

  it('deve enviar assinatura nula, e não omitir o campo, Quando None é escolhido', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: comGithub() });

    await chooseProvider(loader, 'None');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ signature: null }));
  });

  it('deve exigir o segredo Quando a URL não tinha assinatura e um provedor é escolhido', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'edit', token: token() });

    await chooseProvider(loader, 'Slack');

    expect(await trySave(fixture, loader, 'Edit')).toBe('To save, fill in: Secret');
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

const schemaInput = (loader: HarnessLoader) =>
  loader.getHarness(MatInputHarness.with({ selector: '[formControlName=schema]' }));

const schemaField = (loader: HarnessLoader) =>
  loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'JSON Schema' }));

const PEDIDO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
};

describe('Dado a seção "Schema validation" do diálogo "Create New URL"', () => {
  it('deve começar vazio, explicar o campo e enviar o schema como objeto Quando um schema é colado', async () => {
    const { loader, save } = await openDialog({ mode: 'create', token: token() });

    expect(await (await schemaInput(loader)).getValue()).toBe('');
    expect(await (await schemaField(loader)).getTextHints()).toEqual([
      'Validates the JSON body of each request; leave empty to turn off',
    ]);
    await (await schemaInput(loader)).setValue(JSON.stringify(PEDIDO));
    await (await button(loader, 'Create')).click();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ schema: PEDIDO }));
  });

  it.each([
    ['JSON malformado', '{"type": ', /^Invalid JSON: /],
    ['uma lista', '[{"type": "object"}]', /^The schema must be a JSON object\.$/],
    ['um texto JSON', '"object"', /^The schema must be a JSON object\.$/],
    ['null', 'null', /^The schema must be a JSON object\.$/],
  ])('não deve criar e deve explicar no campo Quando o schema é %s', async (_caso, texto, erro) => {
    const { fixture, loader, save } = await openDialog({ mode: 'create', token: token() });

    await (await schemaInput(loader)).setValue(texto);
    await (await schemaInput(loader)).blur();

    const [mensagem] = await (await schemaField(loader)).getTextErrors();
    expect(mensagem).toMatch(erro);
    expect(await trySave(fixture, loader, 'Create')).toBe('To save, fix: JSON Schema');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('Dado a seção "Schema validation" do diálogo "Edit URL"', () => {
  it('deve vir com o schema salvo, indentado, e reenviá-lo Quando outro campo é editado', async () => {
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ schema: PEDIDO }),
    });

    expect(await (await schemaInput(loader)).getValue()).toBe(JSON.stringify(PEDIDO, null, 2));
    await (await input(loader, '200')).setValue('202');
    await (await button(loader, 'Edit')).click();

    await vi.waitFor(() =>
      expect(dialogRef.close).toHaveBeenCalledWith(
        expect.objectContaining({ default_status: '202', schema: PEDIDO }),
      ),
    );
  });

  it('deve esvaziar o campo e enviar schema nulo, e não omitir o campo, Quando "Clear schema" é clicado', async () => {
    const { loader, save } = await openDialog({ mode: 'edit', token: token({ schema: PEDIDO }) });

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Clear schema' }))).click();
    expect(await (await schemaInput(loader)).getValue()).toBe('');
    await (await button(loader, 'Edit')).click();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ schema: null }));
  });

  it('deve mostrar o schema sugerido no lugar do salvo Quando o diálogo vem de "Create schema from this request"', async () => {
    const sugerido = { $schema: PEDIDO.$schema, type: 'array' };
    const { loader } = await openDialog({
      mode: 'edit',
      token: token({ schema: PEDIDO }),
      schema: sugerido,
    });

    expect(await (await schemaInput(loader)).getValue()).toBe(JSON.stringify(sugerido, null, 2));
  });

  it('deve mostrar o erro do servidor no campo e continuar aberto Quando o servidor recusa o schema (422)', async () => {
    const recusa = 'The schema is invalid: $ref "https://exemplo.com/s.json" is not internal.';
    const save = vi.fn<TokenDialogData['save']>().mockResolvedValue([recusa]);
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'edit', token: token() }, save);

    await (await schemaInput(loader)).setValue('{"$ref": "https://exemplo.com/s.json"}');
    await (await button(loader, 'Edit')).click();

    await vi.waitFor(async () =>
      expect(await (await schemaField(loader)).getTextErrors()).toEqual([recusa]),
    );
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(await trySave(fixture, loader, 'Edit')).toBe('To save, fix: JSON Schema');
    expect(save).toHaveBeenCalledTimes(1);

    await (await schemaInput(loader)).setValue('{"type": "object"}');
    await fixture.whenStable();

    expect(await (await schemaField(loader)).getTextErrors()).toEqual([]);
    expect(pendingSummary(fixture)).toBeNull();
  });

  it('deve abrir vazio Quando o token veio do localStorage de uma versão sem schema', async () => {
    const antigo = token();
    delete antigo.schema;
    const { loader } = await openDialog({ mode: 'edit', token: antigo });

    expect(await (await schemaInput(loader)).getValue()).toBe('');
  });
});

const privacyToggle = (loader: HarnessLoader) =>
  loader.getHarness(MatSlideToggleHarness.with({ label: 'Require a secret to view this URL' }));

const privacyText = (fixture: Fixture) =>
  (fixture.nativeElement as HTMLElement).querySelector('[formGroupName=privacy]')?.textContent ??
  '';

/** Campos mandados ao fechar o diálogo. */
const sentKeys = (dialogRef: { close: ReturnType<typeof vi.fn> }) =>
  Object.keys(dialogRef.close.mock.calls[0][0] as object);

async function typeSecret(loader: HarnessLoader, secret: string, confirm = secret) {
  await (await signatureInput(loader, 'read_secret')).setValue(secret);
  await (await signatureInput(loader, 'read_secret_confirm')).setValue(confirm);
}

describe('Dado a seção "Privacy" do diálogo "Create New URL"', () => {
  it('deve começar desligada, sem campos de segredo, e não mandar read_secret Quando nada é mudado', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    expect(await (await privacyToggle(loader)).isChecked()).toBe(false);
    expect(
      await loader.getAllHarnesses(
        MatInputHarness.with({ selector: '[formControlName=read_secret]' }),
      ),
    ).toHaveLength(0);
    await (await button(loader, 'Create')).click();

    expect(sentKeys(dialogRef)).not.toContain('read_secret');
  });

  it('deve mandar o segredo Quando a proteção é ligada com segredo e confirmação iguais', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await privacyToggle(loader)).check();
    await typeSecret(loader, 'segredo-longo');
    await (await button(loader, 'Create')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ read_secret: 'segredo-longo' }),
    );
  });

  it.each([
    ['vazio', '', '', 'To save, fill in: Secret to view'],
    ['com menos de 8 caracteres', 'curto', 'curto', 'To save, fix: Secret to view'],
    [
      'com mais de 256 caracteres',
      'x'.repeat(257),
      'x'.repeat(257),
      'To save, fix: Secret to view',
    ],
    ['diferente da confirmação', 'segredo-longo', 'segredo-outro', 'To save, fix: Confirm secret'],
  ])(
    'não deve salvar e deve dizer o que falta Quando o segredo está %s',
    async (_caso, segredo, confirmacao, resumo) => {
      const { fixture, loader, save } = await openDialog({ mode: 'create', token: token() });

      await (await privacyToggle(loader)).check();
      await typeSecret(loader, segredo, confirmacao);

      expect(await trySave(fixture, loader, 'Create')).toBe(resumo);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('deve aceitar de novo Quando a confirmação passa a bater com o segredo', async () => {
    const { fixture, loader, dialogRef } = await openDialog({ mode: 'create', token: token() });
    await (await privacyToggle(loader)).check();
    await typeSecret(loader, 'segredo-longo', 'segredo-lon');
    expect(await trySave(fixture, loader, 'Create')).toBe('To save, fix: Confirm secret');

    await (await signatureInput(loader, 'read_secret_confirm')).setValue('segredo-longo');
    await fixture.whenStable();

    expect(pendingSummary(fixture)).toBeNull();
    await (await button(loader, 'Create')).click();
    expect(dialogRef.close).toHaveBeenCalled();
  });
});

describe('Dado a seção "Privacy" do diálogo "Edit URL"', () => {
  it('deve vir ligada e dizer que em branco mantém o segredo Quando a URL é protegida', async () => {
    const { fixture, loader } = await openDialog({
      mode: 'edit',
      token: token({ protected: true }),
    });

    expect(await (await privacyToggle(loader)).isChecked()).toBe(true);
    expect(privacyText(fixture)).toContain(
      'This URL is protected. Leave the fields blank to keep the current secret.',
    );
    expect(
      await loader.getAllHarnesses(MatFormFieldHarness.with({ floatingLabelText: 'New secret' })),
    ).toHaveLength(1);
  });

  it('não deve mandar read_secret (o servidor mantém o atual) Quando os campos ficam em branco', async () => {
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ protected: true }),
    });

    await (await button(loader, 'Edit')).click();

    expect(sentKeys(dialogRef)).not.toContain('read_secret');
  });

  it('deve mandar o segredo novo Quando o segredo é trocado', async () => {
    const { loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ protected: true }),
    });

    await typeSecret(loader, 'segredo-novo');
    await (await button(loader, 'Edit')).click();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ read_secret: 'segredo-novo' }),
    );
  });

  it('deve recusar pelo nome do campo, "New secret", Quando o segredo novo é curto', async () => {
    const { fixture, loader, save } = await openDialog({
      mode: 'edit',
      token: token({ protected: true }),
    });

    await typeSecret(loader, 'curto');

    expect(await trySave(fixture, loader, 'Edit')).toBe('To save, fix: New secret');
    expect(save).not.toHaveBeenCalled();
  });

  it('deve avisar e mandar read_secret null Quando a proteção é desligada', async () => {
    const { fixture, loader, dialogRef } = await openDialog({
      mode: 'edit',
      token: token({ protected: true }),
    });

    await (await privacyToggle(loader)).uncheck();

    expect(privacyText(fixture)).toContain('Saving removes the secret');
    await (await button(loader, 'Edit')).click();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ read_secret: null }));
  });

  it('não deve mandar read_secret Quando a URL não é protegida e continua assim', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'edit', token: token() });

    expect(await (await privacyToggle(loader)).isChecked()).toBe(false);
    await (await button(loader, 'Edit')).click();

    expect(sentKeys(dialogRef)).not.toContain('read_secret');
  });

  it('deve exigir o segredo Quando a proteção é ligada numa URL que não era protegida', async () => {
    const { fixture, loader } = await openDialog({ mode: 'edit', token: token() });

    await (await privacyToggle(loader)).check();

    expect(await trySave(fixture, loader, 'Edit')).toBe('To save, fill in: Secret to view');
  });
});
