import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { OutboundActions } from './outbound-actions';
import { ReplayDialog } from './replay-dialog';
import { rememberTarget } from './replay-target';
import { SendDialog } from './send-dialog';

describe('Dado as ações de saída da tela', () => {
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    open = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: { open } }] });
  });

  afterEach(() => localStorage.clear());

  it('deve abrir o Replay com a mensagem Quando "Replay…" é pedido', () => {
    const request = webhookRequest(1);

    TestBed.inject(OutboundActions).replay(request);

    expect(open).toHaveBeenCalledWith(ReplayDialog, expect.objectContaining({ data: { request } }));
  });

  it('deve abrir o Send preenchido com a mensagem e o destino lembrado Quando "Send as new…" é pedido', () => {
    TestBed.inject(Preferences).token.set(token());
    rememberTarget(TOKEN_ID, 'http://localhost:3000/app');

    TestBed.inject(OutboundActions).send(
      webhookRequest(1, { method: 'PUT', headers: { host: ['h'], 'x-a': ['1'] } }),
    );

    expect(open).toHaveBeenCalledWith(
      SendDialog,
      expect.objectContaining({
        data: {
          token: token(),
          draft: {
            method: 'PUT',
            url: 'http://localhost:3000/app',
            headers: [['x-a', '1']],
            body: '{"n":1}',
          },
        },
      }),
    );
  });

  it('deve abrir o Send em branco Quando vem da barra da URL', () => {
    TestBed.inject(Preferences).token.set(token());

    TestBed.inject(OutboundActions).send();

    expect(open).toHaveBeenCalledWith(
      SendDialog,
      expect.objectContaining({ data: { token: token() } }),
    );
  });

  it('não deve abrir nada Quando não há URL aberta', () => {
    TestBed.inject(OutboundActions).send();

    expect(open).not.toHaveBeenCalled();
  });
});
