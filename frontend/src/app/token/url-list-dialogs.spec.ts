import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { KNOWN_URLS_KEY, KnownUrls } from './known-urls';
import { ForgetUrlsDialog, UrlNicknameDialog } from './url-list-dialogs';

const A = 'd0620341-1111-4111-8111-111111111111';
const B = 'c4291aaa-2222-4222-8222-222222222222';

describe('Dado os diálogos da lista de URLs do navegador (B1)', () => {
  const close = vi.fn();

  const show = (dialog: Type<unknown>) =>
    render(dialog, {
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: A },
      ],
    });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(
      KNOWN_URLS_KEY,
      JSON.stringify([
        { uuid: A, nickname: 'Pagamentos', openedAt: '2026-09-28T12:00:00.000Z' },
        { uuid: B, nickname: '', openedAt: '2026-09-28T11:00:00.000Z' },
      ]),
    );
  });

  afterEach(() => localStorage.clear());

  describe('Dado "Rename this URL"', () => {
    it('deve abrir com o apelido de hoje, limitar a 40 e dizer que fica só no navegador', async () => {
      const { container } = await show(UrlNicknameDialog);

      const apelido = screen.getByRole('textbox', { name: 'Nickname' });
      expect(apelido).toHaveProperty('value', 'Pagamentos');
      expect(apelido.getAttribute('maxlength')).toBe('40');
      expect(screen.getByRole('heading', { name: 'Rename this URL' })).toBeTruthy();
      expect(screen.getByText('Only you see it, in this browser.')).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it('deve gravar o apelido com Enter, anunciar uma vez e fechar', async () => {
      await show(UrlNicknameDialog);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
      const apelido = screen.getByRole('textbox', { name: 'Nickname' });

      await userEvent.clear(apelido);
      await userEvent.type(apelido, 'Retry{Enter}');

      expect(TestBed.inject(KnownUrls).nicknameOf(A)).toBe('Retry');
      expect(announce.mock.calls).toEqual([['Nickname saved.']]);
      expect(close).toHaveBeenCalledWith(true);
    });

    it('deve apagar o apelido Quando o campo fica vazio', async () => {
      await show(UrlNicknameDialog);

      await userEvent.clear(screen.getByRole('textbox', { name: 'Nickname' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save nickname' }));

      expect(TestBed.inject(KnownUrls).nameOf(A)).toBe('URL d0620');
    });
  });

  describe('Dado "Forget a URL"', () => {
    it('deve ter uma caixa por URL e avisar que esquecer não apaga no servidor', async () => {
      const { container } = await show(ForgetUrlsDialog);

      expect(
        screen.getAllByRole('checkbox').map((box) => box.parentElement?.textContent?.trim()),
      ).toEqual(['Pagamentosd0620', 'URL c4291c4291']);
      expect(screen.getByText('Forgetting does not delete the URL on the server.')).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it('deve esquecer só as marcadas', async () => {
      await show(ForgetUrlsDialog);

      await userEvent.click(screen.getByRole('checkbox', { name: /Pagamentos/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      expect(
        TestBed.inject(KnownUrls)
          .urls()
          .map((url) => url.uuid),
      ).toEqual([B]);
      expect(close).toHaveBeenCalledWith(true);
    });

    it('não deve esquecer nada Quando nenhuma caixa está marcada', async () => {
      await show(ForgetUrlsDialog);

      await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

      expect(TestBed.inject(KnownUrls).urls()).toHaveLength(2);
      expect(close).toHaveBeenCalledWith(false);
    });
  });
});
