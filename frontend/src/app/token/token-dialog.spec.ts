import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
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

describe('Dado o diálogo "Create New URL"', () => {
  it('deve enviar só os campos preenchidos, com timeout 0 como no app atual, Quando Create é clicado', async () => {
    const { loader, dialogRef } = await openDialog({ mode: 'create', token: token() });

    await (await input(loader, '200')).setValue('404');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Create' }))).click();

    expect(dialogRef.close).toHaveBeenCalledWith({ default_status: '404', timeout: '0' });
  });

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
    });
  });
});
