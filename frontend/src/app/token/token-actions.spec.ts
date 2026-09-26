import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { MockInstance } from 'vitest';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { TokenActions, settingsError } from './token-actions';

describe('Dado o erro ao criar ou editar uma URL', () => {
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
    expect(settingsError('creating', erro)).toBe(esperado);
  });

  it('deve dizer que o erro foi ao editar Quando o PUT responde 422', () => {
    const erro = new HttpErrorResponse({
      status: 422,
      error: { retry_after: ['The retry after must be a number of seconds or an HTTP date.'] },
    });

    expect(settingsError('updating', erro)).toBe(
      'Error updating token: The retry after must be a number of seconds or an HTTP date.',
    );
  });
});

describe('Dado os botões New e Edit da barra superior', () => {
  let http: HttpTestingController;
  let snack: MockInstance<MatSnackBar['open']>;

  const answerDialog = (settings: object | undefined) =>
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of(settings),
    } as MatDialogRef<unknown>);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve criar, zerar não lidas, navegar e avisar Quando o diálogo New é confirmado', async () => {
    answerDialog({ default_status: '201' });
    TestBed.inject(Preferences).unread.set(['x']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const done = TestBed.inject(TokenActions).createUrl();
    await vi.waitFor(() => http.expectOne('/token').flush(token({ uuid: TOKEN_ID })));
    await done;

    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID]);
    expect(TestBed.inject(Preferences).unread()).toEqual([]);
    expect(snack).toHaveBeenCalledWith('New URL created');
  });

  it('não deve chamar a API Quando o diálogo é fechado sem confirmar', async () => {
    answerDialog(undefined);

    await TestBed.inject(TokenActions).createUrl();

    http.expectNone('/token');
    expect(snack).not.toHaveBeenCalled();
  });

  it('deve atualizar a URL aberta e avisar Quando o diálogo Edit é confirmado', async () => {
    TestBed.inject(Preferences).token.set(token());
    answerDialog({ default_content: 'novo' });

    const done = TestBed.inject(TokenActions).editUrl();
    const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`));
    call.flush(token({ default_content: 'novo' }));
    await done;

    expect(call.request.method).toBe('PUT');
    expect(call.request.body).toEqual({ default_content: 'novo' });
    expect(snack).toHaveBeenCalledWith('URL updated!');
  });

  it('deve mostrar o erro de validação e manter a URL como estava Quando o PUT responde 422', async () => {
    TestBed.inject(Preferences).token.set(token());
    answerDialog({ retry_after: '120' });

    const done = TestBed.inject(TokenActions).editUrl();
    const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`));
    call.flush(
      { retry_after: ['The retry after must be a number of seconds or an HTTP date.'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await done;

    expect(snack).toHaveBeenCalledWith(
      'Error updating token: The retry after must be a number of seconds or an HTTP date.',
      undefined,
      { duration: 10000 },
    );
    expect(snack).not.toHaveBeenCalledWith('URL updated!');
    expect(TestBed.inject(Preferences).token()).toEqual(token());
  });
});
