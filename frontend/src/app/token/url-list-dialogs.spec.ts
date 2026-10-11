import { LiveAnnouncer } from '@angular/cdk/a11y';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { KNOWN_URLS_KEY, KnownUrls } from './known-urls';
import { translations } from '../../locale/pt-BR';
import { ForgetUrlsDialog, OpenUrlDialog, UrlNicknameDialog } from './url-list-dialogs';

const A = 'd0620341-1111-4111-8111-111111111111';
const B = 'c4291aaa-2222-4222-8222-222222222222';

describe('Dado os diálogos da lista de URLs do navegador', () => {
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
      expect(announce.mock.calls).toEqual([['Nickname saved.', ANNOUNCEMENT_MS]]);
      expect(close).toHaveBeenCalledWith(true);
    });

    it('deve apagar o apelido Quando o campo fica vazio', async () => {
      await show(UrlNicknameDialog);

      await userEvent.clear(screen.getByRole('textbox', { name: 'Nickname' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save nickname' }));

      expect(TestBed.inject(KnownUrls).nameOf(A)).toBe('URL d0620');
    });
  });

  describe('Dado "Open another URL"', () => {
    const endereco = () => screen.getByRole('textbox', { name: 'Address or id' });

    it('deve pedir o endereço ou o id, com a dica, e passar no axe', async () => {
      const { container } = await show(OpenUrlDialog);

      expect(screen.getByRole('heading', { name: 'Open another URL' })).toBeTruthy();
      expect(endereco().getAttribute('aria-describedby')).toBe('open-url-hint');
      expect(document.getElementById('open-url-hint')?.textContent?.trim()).toBe(
        'Paste the address of an Anzol URL, or just its id.',
      );
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open URL' })).toBeTruthy();
      await expectNoAxeViolations(container);
    });

    it.each([
      ['o endereço que recebe os webhooks', `http://localhost:8084/${B}`],
      ['o endereço com caminho e query', `https://anzol.example/${B}/pedidos?x=1`],
      ['o endereço da tela', `http://localhost:8084/#/${B}/rules`],
      [
        'o endereço de uma requisição na tela',
        `http://localhost:8084/#/${B}/00000000-0000-4000-8000-000000000001/1`,
      ],
      ['só o id', B],
      ['o id em maiúsculas, com espaços em volta', `  ${B.toUpperCase()}  `],
    ])('deve fechar com o id da URL Quando o texto é %s', async (_caso, texto) => {
      await show(OpenUrlDialog);

      await userEvent.click(endereco());
      await userEvent.paste(texto);
      await userEvent.keyboard('{Enter}');

      expect(close).toHaveBeenCalledExactlyOnceWith(B);
    });

    it('deve dizer que o endereço não tem um id de URL, uma vez, e continuar aberto', async () => {
      const { container } = await show(OpenUrlDialog);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      await userEvent.type(endereco(), 'http://localhost:8084/pedidos');
      await userEvent.click(screen.getByRole('button', { name: 'Open URL' }));

      expect(close).not.toHaveBeenCalled();
      expect(endereco().getAttribute('aria-invalid')).toBe('true');
      expect(endereco().getAttribute('aria-describedby')).toBe('open-url-error open-url-hint');
      expect(document.getElementById('open-url-error')?.textContent).toBe(
        'This address is not a valid URL id.',
      );
      expect(announce.mock.calls).toEqual([
        ['This address is not a valid URL id.', ANNOUNCEMENT_MS],
      ]);
      // Sem região viva nova: a fala é a do anunciador da tela.
      expect(container.querySelector('[role="alert"], [role="status"], [aria-live]')).toBeNull();
      expect(document.activeElement).toBe(endereco());
      await expectNoAxeViolations(container);

      await userEvent.type(endereco(), '/');

      expect(endereco().hasAttribute('aria-invalid')).toBe(false);
      expect(document.getElementById('open-url-error')).toBeNull();
    });

    it('deve dizer o título, o campo, a dica e o botão em pt-BR', async () => {
      loadTranslations(translations);
      try {
        await show(OpenUrlDialog);

        expect(screen.getByRole('heading', { name: 'Abrir outra URL' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: 'Endereço ou id' })).toBeTruthy();
        expect(document.getElementById('open-url-hint')?.textContent?.trim()).toBe(
          'Cole o endereço de uma URL do Anzol, ou só o id dela.',
        );
        expect(screen.getByRole('button', { name: 'Abrir URL' })).toBeTruthy();
      } finally {
        clearTranslations();
      }
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
