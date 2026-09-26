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

const autoCleanup = (loader: HarnessLoader) => loader.getHarness(MatSelectHarness);

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
