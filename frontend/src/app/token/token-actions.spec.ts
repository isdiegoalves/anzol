import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { from } from 'rxjs';
import type { MockInstance } from 'vitest';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { TokenSettings } from './token';
import { KnownUrls } from './known-urls';
import { TokenActions, createError } from './token-actions';
import { TokenDialogData } from './token-dialog';
import { UrlLock } from './url-lock';

describe('Dado o erro ao criar uma URL', () => {
  it.each([
    [
      '422 com dois campos',
      new HttpErrorResponse({
        status: 422,
        error: {
          default_status: ['The default status must be an integer.'],
          timeout: ['The timeout must be an integer.'],
        },
      }),
      'Error creating token: The default status must be an integer., The timeout must be an integer.',
    ],
    ['500', new HttpErrorResponse({ status: 500 }), 'Error creating token (500)'],
    ['desconhecido', new Error('x'), 'Error creating token (unknown)'],
  ])('deve montar a mensagem do app atual Quando a API responde %s', (_caso, erro, esperado) => {
    expect(createError(erro)).toBe(esperado);
  });
});

describe('Dado o "New URL" e o "Lock" do shell', () => {
  let http: HttpTestingController;
  let snack: MockInstance<MatSnackBar['open']>;
  let navigate: MockInstance<Router['navigate']>;
  const NO_CONTENT = { status: 204, statusText: 'No Content' };

  /**
   * Simula o diálogo: com `settings`, cria por `save` e fecha com o que `save` devolveu; sem,
   * fecha sem criar.
   */
  const answerDialog = (settings: TokenSettings | undefined) => {
    const saved: Promise<boolean>[] = [];
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation((_c, config) => {
      const { save } = config?.data as TokenDialogData;
      const closed = settings ? save(settings) : Promise.resolve(false);
      saved.push(closed);
      return { afterClosed: () => from(closed) } as MatDialogRef<unknown>;
    });
    return { open, saved };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve criar, zerar não lidas, navegar e avisar Quando o diálogo é confirmado', async () => {
    const { saved } = answerDialog({ default_status: '201' });
    TestBed.inject(Preferences).unread.set(['x']);

    const done = TestBed.inject(TokenActions).createUrl();
    const call = await vi.waitFor(() => http.expectOne('/token'));
    call.flush(token({ uuid: TOKEN_ID }));
    await done;

    expect(call.request.body).toEqual({ default_status: '201' });
    expect(await saved[0]).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID]);
    expect(TestBed.inject(Preferences).unread()).toEqual([]);
    expect(snack).toHaveBeenCalledWith('New URL created', undefined, { duration: 4000 });
  });

  it('não deve chamar a API Quando o diálogo é fechado sem confirmar', async () => {
    answerDialog(undefined);

    await TestBed.inject(TokenActions).createUrl();

    http.expectNone('/token');
    expect(snack).not.toHaveBeenCalled();
  });

  it('deve avisar o erro e manter o diálogo aberto Quando o servidor recusa (422)', async () => {
    const { saved } = answerDialog({ retry_after: 'amanhã' });

    void TestBed.inject(TokenActions).createUrl();
    const call = await vi.waitFor(() => http.expectOne('/token'));
    call.flush(
      { retry_after: ['The retry after must be a number of seconds or an HTTP date.'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    expect(await saved[0]).toBe(false);
    expect(snack).toHaveBeenCalledWith(
      'Error creating token: The retry after must be a number of seconds or an HTTP date.',
      undefined,
      { duration: 10000 },
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('deve desbloquear a URL nova com o segredo antes de abri-la Quando é criada protegida', async () => {
    answerDialog({ read_secret: 'segredo-longo' });

    const done = TestBed.inject(TokenActions).createUrl();
    const create = await vi.waitFor(() => http.expectOne('/token'));
    create.flush(token({ protected: true }));
    const unlock = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/unlock`));
    unlock.flush(null, NO_CONTENT);
    await done;

    expect(create.request.body).toEqual({ read_secret: 'segredo-longo' });
    expect(unlock.request.body).toEqual({ secret: 'segredo-longo' });
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID]);
  });

  it('deve apagar o acesso, trancar a tela e avisar Quando Lock é clicado', async () => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));

    const done = TestBed.inject(TokenActions).lockUrl();
    http.expectOne(`/token/${TOKEN_ID}/lock`).flush(null, NO_CONTENT);
    await done;

    expect(TestBed.inject(UrlLock).tokenId()).toBe(TOKEN_ID);
    expect(TestBed.inject(Preferences).token()).toBeNull();
    expect(snack).toHaveBeenCalledWith('URL locked', undefined, { duration: 4000 });
  });

  describe('Dado o menu "More URL actions" (F1)', () => {
    const confirm = (answer: boolean) =>
      vi
        .spyOn(TestBed.inject(MatDialog), 'open')
        .mockReturnValue({ afterClosed: () => from([answer]) } as MatDialogRef<unknown>);

    it('deve apagar a URL, abrir uma nova e avisar Quando "Delete URL" é confirmado', async () => {
      TestBed.inject(Preferences).token.set(token());
      TestBed.inject(Preferences).unread.set(['x']);
      confirm(true);

      const done = TestBed.inject(TokenActions).deleteUrl();
      await vi.waitFor(() =>
        http.expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}` }).flush(null, NO_CONTENT),
      );
      await vi.waitFor(() =>
        http.expectOne({ method: 'POST', url: '/token' }).flush(token({ uuid: 'novo' })),
      );
      await done;

      expect(navigate).toHaveBeenCalledWith(['/', 'novo']);
      expect(TestBed.inject(Preferences).unread()).toEqual([]);
      expect(snack).toHaveBeenCalledWith('URL deleted. A new URL is open.', undefined, {
        duration: 4000,
      });
    });

    it('deve abrir a próxima URL conhecida, sem criar outra, Quando o navegador guarda mais uma', async () => {
      const outra = 'c4291aaa-2222-4222-8222-222222222222';
      TestBed.inject(Preferences).token.set(token());
      const known = TestBed.inject(KnownUrls);
      known.opened(outra);
      known.rename(outra, 'Pagamentos');
      known.opened(TOKEN_ID);
      confirm(true);

      const done = TestBed.inject(TokenActions).deleteUrl();
      await vi.waitFor(() =>
        http.expectOne({ method: 'DELETE', url: `/token/${TOKEN_ID}` }).flush(null, NO_CONTENT),
      );
      await done;

      http.expectNone({ method: 'POST', url: '/token' });
      expect(navigate).toHaveBeenCalledWith(['/', outra]);
      expect(known.urls().map((url) => url.uuid)).toEqual([outra]);
      expect(snack).toHaveBeenCalledWith('URL deleted. Pagamentos is open.', undefined, {
        duration: 4000,
      });
    });

    it('deve criar a URL com a resposta padrão e abri-la, sem diálogo, em "Create a new URL"', async () => {
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open');

      const done = TestBed.inject(TokenActions).createDefaultUrl();
      const call = await vi.waitFor(() => http.expectOne({ method: 'POST', url: '/token' }));
      expect(call.request.body).toEqual({});
      call.flush(token({ uuid: 'novo' }));
      await done;

      expect(open).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/', 'novo']);
      expect(snack).toHaveBeenCalledWith('New URL created', undefined, { duration: 4000 });
    });

    it('não deve apagar nada Quando a confirmação é cancelada', async () => {
      TestBed.inject(Preferences).token.set(token());
      confirm(false);

      await TestBed.inject(TokenActions).deleteUrl();

      http.expectNone({ method: 'DELETE', url: `/token/${TOKEN_ID}` });
      expect(navigate).not.toHaveBeenCalled();
    });

    it('deve avisar "Copied the CLI command." depois da cópia do "Copy CLI command"', () => {
      TestBed.inject(TokenActions).cliCommandCopied();

      expect(snack).toHaveBeenCalledWith('Copied the CLI command.', undefined, { duration: 1000 });
    });
  });
});
