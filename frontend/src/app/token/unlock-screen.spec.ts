import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID } from '../../testing/fixtures';
import { UnlockScreen, retryAfterSeconds } from './unlock-screen';
import { UrlAccess } from './url-access';

describe('Dado a tela de desbloqueio da URL protegida', () => {
  let fixture: ComponentFixture<UnlockScreen>;
  let loader: HarnessLoader;
  let unlock: ReturnType<typeof vi.fn<UrlAccess['unlock']>>;
  let snack: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    unlock = vi.fn<UrlAccess['unlock']>();
    snack = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UrlAccess, useValue: { unlock } },
        { provide: MatSnackBar, useValue: { open: snack } },
      ],
    });
    fixture = TestBed.createComponent(UnlockScreen);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  const element = () => fixture.nativeElement as HTMLElement;
  const alert = () => element().querySelector('[role="alert"]')?.textContent?.trim();
  const unlockButton = () => loader.getHarness(MatButtonHarness.with({ text: 'Unlock' }));
  const tryUnlock = async (secret: string) => {
    await (await loader.getHarness(MatInputHarness)).setValue(secret);
    await (await unlockButton()).click();
    await fixture.whenStable();
  };

  it('deve dizer qual URL está protegida e que a captura continua Quando abre', () => {
    expect(element().textContent).toContain('This URL is protected');
    expect(element().querySelector('.url')?.textContent).toBe(
      `${location.protocol}//${location.host}/${TOKEN_ID}`,
    );
    expect(element().textContent).toContain('still captured without the secret');
  });

  it('deve desbloquear com o segredo digitado e avisar Quando o segredo está certo', async () => {
    unlock.mockResolvedValue();

    await tryUnlock('segredo-certo');

    expect(unlock).toHaveBeenCalledWith(TOKEN_ID, 'segredo-certo');
    expect(snack).toHaveBeenCalledWith('URL unlocked');
    expect(alert()).toBeUndefined();
  });

  it('não deve chamar a API Quando o segredo está vazio', async () => {
    await (await unlockButton()).click();

    expect(unlock).not.toHaveBeenCalled();
  });

  it('deve dizer que o segredo está errado e limpar o campo Quando o servidor responde 401', async () => {
    unlock.mockRejectedValue(new HttpErrorResponse({ status: 401 }));

    await tryUnlock('errado');

    expect(alert()).toBe('Wrong secret. Try again.');
    expect(await (await loader.getHarness(MatInputHarness)).getValue()).toBe('');
  });

  it('deve travar o botão e contar o Retry-After Quando o servidor responde 429', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    unlock.mockRejectedValue(
      new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '2' }) }),
    );

    await tryUnlock('qualquer');

    expect(alert()).toBe('Too many attempts. Try again in 2 seconds.');
    expect(await (await unlockButton()).isDisabled()).toBe(true);
    vi.advanceTimersByTime(1000);
    await fixture.whenStable();
    expect(alert()).toBe('Too many attempts. Try again in 1 second.');
    vi.advanceTimersByTime(1000);
    await fixture.whenStable();
    expect(alert()).toBeUndefined();
    expect(await (await unlockButton()).isDisabled()).toBe(false);
  });
});

describe('Dado o Retry-After do 429 do unlock', () => {
  const agora = Date.UTC(2026, 8, 26, 12, 0, 0);

  it.each([
    ['segundos', '42', 42],
    ['zero (espera ao menos 1 s)', '0', 1],
    ['data HTTP daqui a 30 s', 'Sat, 26 Sep 2026 12:00:30 GMT', 30],
    ['ausente (a janela de 1 min)', null, 60],
    ['ilegível', 'depois', 60],
  ])('deve esperar os segundos certos Quando o header é %s', (_caso, valor, esperado) => {
    expect(retryAfterSeconds(valor, agora)).toBe(esperado);
  });
});
