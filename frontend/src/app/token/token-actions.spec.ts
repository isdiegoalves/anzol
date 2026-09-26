import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { from } from 'rxjs';
import type { MockInstance } from 'vitest';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { TokenSettings } from './token';
import { TokenActions, schemaErrors, settingsError } from './token-actions';
import { TokenDialog, TokenDialogData } from './token-dialog';
import { UrlLock } from './url-lock';

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

  /** Simula o diálogo: com `settings`, salva por `save` e fecha; sem, fecha sem salvar. */
  const answerDialog = (settings: TokenSettings | undefined) =>
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation((_component, config) => {
      const { save } = config?.data as TokenDialogData;
      const closed = settings ? save(settings).then(() => settings) : Promise.resolve(undefined);
      return { afterClosed: () => from(closed) } as MatDialogRef<unknown>;
    });

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

  describe('Dado a lista da URL aberta com a primeira mensagem selecionada', () => {
    const [R1, R2, R3] = [1, 2, 3].map((n) => webhookRequest(n));
    let navigate: MockInstance<Router['navigate']>;

    beforeEach(async () => {
      const store = TestBed.inject(RequestStore);
      const loaded = store.load(TOKEN_ID);
      http.expectOne(`/token/${TOKEN_ID}/requests?page=1`).flush(requestPage([R1, R2, R3]));
      await loaded;
      store.select(R1.uuid);
      navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    });

    const edit = async (antes: number | null, depois: number | null) => {
      TestBed.inject(Preferences).token.set(token({ auto_cleanup: antes as 500 | null }));
      answerDialog({ auto_cleanup: depois as 500 | null });
      const done = TestBed.inject(TokenActions).editUrl();
      const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`));
      call.flush(token({ auto_cleanup: depois as 500 | null }));
      return { done, call };
    };

    it.each([
      ['ligada', null, 1000],
      ['reduzida', 5000, 1000],
    ])(
      'deve recarregar a lista e abrir a mais próxima Quando a limpeza é %s (o corte no PUT não gera evento)',
      async (_caso, antes, depois) => {
        const { done, call } = await edit(antes, depois);
        const reload = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests?page=1`));
        reload.flush(requestPage([R2, R3], { total: 2 }));
        await done;

        expect(call.request.body).toEqual({ auto_cleanup: depois });
        expect(TestBed.inject(RequestStore).requests()).toEqual([R2, R3]);
        expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, R2.uuid, 1], { replaceUrl: true });
      },
    );

    it.each([
      ['desligada', 500, null],
      ['aumentada', 500, 1000],
      ['mantida', 1000, 1000],
    ])('não deve recarregar a lista Quando a limpeza é %s', async (_caso, antes, depois) => {
      const { done } = await edit(antes, depois);
      await done;

      http.expectNone(`/token/${TOKEN_ID}/requests?page=1`);
      expect(navigate).not.toHaveBeenCalled();
      expect(snack).toHaveBeenCalledWith('URL updated!');
    });
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

  it.each([
    ['criar', 'create', '/token'],
    ['editar', 'edit', `/token/${TOKEN_ID}`],
  ] as const)(
    'deve devolver o erro do schema ao diálogo, sem aviso, Quando o servidor recusa o schema ao %s',
    async (_caso, modo, url) => {
      TestBed.inject(Preferences).token.set(token());
      const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
        afterClosed: () => from([undefined]),
      } as MatDialogRef<unknown>);
      const actions = TestBed.inject(TokenActions);
      await (modo === 'create' ? actions.createUrl() : actions.editUrl());
      const { save } = open.mock.calls[0][1]?.data as TokenDialogData;

      const erros = save({ schema: { $ref: 'https://exemplo.com/s.json' } });
      http
        .expectOne(url)
        .flush(
          { schema: ['The schema is invalid: $ref is not internal.'] },
          { status: 422, statusText: 'Unprocessable Entity' },
        );

      expect(await erros).toEqual(['The schema is invalid: $ref is not internal.']);
      expect(snack).not.toHaveBeenCalled();
    },
  );

  it('deve abrir o Edit URL com o schema inferido do corpo Quando "Create schema from this request" é clicado', async () => {
    TestBed.inject(Preferences).token.set(token());
    const open = answerDialog(undefined);

    await TestBed.inject(TokenActions).createSchemaFrom(
      webhookRequest(1, { content: '{"id": 7, "tags": ["a"]}' }),
    );

    expect(open).toHaveBeenCalledWith(
      TokenDialog,
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'edit',
          token: token(),
          schema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {
              id: { type: 'integer' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'tags'],
          },
        }),
      }),
    );
  });
});

describe('Dado o segredo de leitura salvo pelos diálogos e o botão Lock', () => {
  let http: HttpTestingController;
  let snack: MockInstance<MatSnackBar['open']>;

  const answerDialog = (settings: TokenSettings) =>
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation((_component, config) => {
      const { save } = config?.data as TokenDialogData;
      return { afterClosed: () => from(save(settings)) } as MatDialogRef<unknown>;
    });
  const NO_CONTENT = { status: 204, statusText: 'No Content' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    snack = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
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
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/', TOKEN_ID]);
  });

  it('deve desbloquear com o segredo novo Quando o segredo é trocado (o cookie antigo cai)', async () => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));
    answerDialog({ read_secret: 'segredo-novo' });

    const done = TestBed.inject(TokenActions).editUrl();
    http.expectOne(`/token/${TOKEN_ID}`).flush(token({ protected: true }));
    const unlock = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/unlock`));
    unlock.flush(null, NO_CONTENT);
    await done;

    expect(unlock.request.body).toEqual({ secret: 'segredo-novo' });
    expect(snack).toHaveBeenCalledWith('URL updated!');
  });

  it.each([
    ['o segredo é mantido (ausente)', {}],
    ['a proteção é tirada (null)', { read_secret: null }],
  ])('não deve chamar o unlock Quando %s', async (_caso, settings: TokenSettings) => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));
    answerDialog(settings);

    const done = TestBed.inject(TokenActions).editUrl();
    http.expectOne(`/token/${TOKEN_ID}`).flush(token());
    await done;

    http.expectNone(`/token/${TOKEN_ID}/unlock`);
  });

  it('deve apagar o acesso, trancar a tela e avisar Quando Lock é clicado', async () => {
    TestBed.inject(Preferences).token.set(token({ protected: true }));

    const done = TestBed.inject(TokenActions).lockUrl();
    http.expectOne(`/token/${TOKEN_ID}/lock`).flush(null, NO_CONTENT);
    await done;

    expect(TestBed.inject(UrlLock).tokenId()).toBe(TOKEN_ID);
    expect(TestBed.inject(Preferences).token()).toBeNull();
    expect(snack).toHaveBeenCalledWith('URL locked');
  });
});

describe('Dado o erro 422 do servidor ao salvar a URL', () => {
  it.each([
    ['só do schema', { schema: ['a', 'b'] }, 422, ['a', 'b']],
    ['de outro campo', { timeout: ['x'] }, 422, []],
    ['500', { schema: ['a'] }, 500, []],
  ])(
    'deve separar as mensagens do campo Schema Quando o erro é %s',
    (_caso, body, status, esperado) => {
      expect(schemaErrors(new HttpErrorResponse({ status, error: body }))).toEqual(esperado);
    },
  );
});
