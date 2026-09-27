import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { token } from '../../testing/fixtures';
import { Token } from './token';
import { TokenDialog, TokenDialogData } from './token-dialog';

/** `save` cria sem erro, a menos que o teste diga outra coisa. */
async function openDialog(
  url: Token | null = token(),
  save = vi.fn<TokenDialogData['save']>().mockResolvedValue(true),
) {
  const dialogRef = { close: vi.fn() };
  const result = await render(TokenDialog, {
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { token: url, save } },
      { provide: MatDialogRef, useValue: dialogRef },
    ],
  });
  return { ...result, dialogRef, save };
}

const create = () => userEvent.click(screen.getByRole('button', { name: 'Create' }));
const customize = () => userEvent.click(screen.getByRole('button', { name: 'Customize response' }));
const box = (name: string) => screen.getByRole('textbox', { name });

describe('Dado o diálogo curto "Create New URL"', () => {
  it('deve criar com os padrões, sem assinatura nem schema, Quando Create é clicado direto', async () => {
    const { dialogRef, save, container } = await openDialog();

    expect(
      screen.getByRole('button', { name: 'Customize response' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Default status code' })).toBeNull();
    await expectNoAxeViolations(container);
    await create();

    const enviado = { timeout: '0', retry_after: null, auto_cleanup: null };
    expect(save).toHaveBeenCalledWith(enviado);
    expect(dialogRef.close).toHaveBeenCalledWith(enviado);
  });

  it('deve mandar status, content-type, corpo, Retry-After e limpeza Quando a resposta é personalizada', async () => {
    const { save, container } = await openDialog();

    await customize();
    await userEvent.type(box('Default status code'), '404');
    await userEvent.type(box('Content Type'), 'application/json');
    await userEvent.click(box('Response body'));
    await userEvent.paste('{"x":1}');
    await userEvent.type(box('Retry-After'), '120');
    const cleanup = screen.getByRole('radiogroup', { name: 'Auto cleanup' });
    expect(
      within(cleanup).getByRole('radio', { name: 'Disabled' }).getAttribute('aria-checked'),
    ).toBe('true');
    await userEvent.click(within(cleanup).getByRole('radio', { name: '1000' }));
    expect(screen.getByText('Keeps the 1000 most recent requests')).toBeTruthy();
    await expectNoAxeViolations(container);
    await create();

    expect(save).toHaveBeenCalledWith({
      default_status: '404',
      default_content_type: 'application/json',
      timeout: '0',
      default_content: '{"x":1}',
      retry_after: '120',
      auto_cleanup: 1000,
    });
  });

  it.each([
    [
      'o timeout é 11',
      'spinbutton',
      'Timeout before response',
      '11',
      'To save, fix: Timeout before response',
    ],
    ['o Retry-After é "amanhã"', 'textbox', 'Retry-After', 'amanhã', 'To save, fix: Retry-After'],
  ] as const)(
    'não deve criar e deve dizer o que corrigir, abrindo o campo recolhido, Quando %s',
    async (_c, role, name, valor, resumo) => {
      const { save } = await openDialog();
      await customize();
      const input = screen.getByRole(role, { name });
      await userEvent.clear(input);
      await userEvent.type(input, valor);
      await customize();

      await create();

      expect(screen.getByRole('alert').textContent?.trim()).toBe(resumo);
      await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole(role, { name })));
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('deve recusar segredo curto e confirmação diferente e dizer o que falta Quando a proteção é ligada', async () => {
    const { save } = await openDialog();

    await userEvent.click(
      screen.getByRole('switch', { name: 'Require a secret to view this URL' }),
    );
    await userEvent.type(screen.getByLabelText('Secret to view'), 'curto');
    await userEvent.type(screen.getByLabelText('Confirm secret'), 'outro');
    await create();

    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      'To save, fix: Secret to view, Confirm secret',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('deve mandar o segredo de leitura Quando a proteção é ligada com segredo e confirmação iguais', async () => {
    const { save } = await openDialog();

    await userEvent.click(
      screen.getByRole('switch', { name: 'Require a secret to view this URL' }),
    );
    await userEvent.type(screen.getByLabelText('Secret to view'), 'segredo-longo');
    await userEvent.type(screen.getByLabelText('Confirm secret'), 'segredo-longo');
    await create();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ read_secret: 'segredo-longo' }));
  });

  it('deve continuar aberto, com o que foi digitado, Quando o servidor recusa', async () => {
    const { dialogRef } = await openDialog(token(), vi.fn().mockResolvedValue(false));

    await create();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('deve mostrar o aviso de URL não encontrada Quando não há token', async () => {
    await openDialog(null);

    expect(screen.getByRole('alert').textContent).toContain('This URL could not be found.');
  });
});
