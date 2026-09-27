import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { OptionsBar } from './options-bar';
import { Preferences } from './preferences';
import { Redirector } from './redirect';

describe('Dado a barra de opções acima do detalhe', () => {
  let loader: HarnessLoader;
  let preferences: Preferences;
  let http: HttpTestingController;

  const toggle = (label: string) => loader.getHarness(MatSlideToggleHarness.with({ label }));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [OptionsBar],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    preferences = TestBed.inject(Preferences);
    http = TestBed.inject(HttpTestingController);
    preferences.token.set(token({ cors: false }));
    const fixture = TestBed.createComponent(OptionsBar);
    fixture.componentRef.setInput('request', webhookRequest(1));
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve ter só o redirect e o CORS (o resto foi para Pretty, Follow new e as abas)', async () => {
    const toggles = await loader.getAllHarnesses(MatSlideToggleHarness);

    expect(await Promise.all(toggles.map((item) => item.getLabelText()))).toEqual([
      'Auto redirect',
      'Enable CORS BETA',
    ]);
  });

  it('deve desabilitar redirect automático e "Redirect Now" Quando não há URL de redirect', async () => {
    expect(await (await toggle('Auto redirect')).isDisabled()).toBe(true);
    expect(
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Redirect Now' }))).isDisabled(),
    ).toBe(true);
  });

  it('deve reenviar a mensagem aberta Quando "Redirect Now" é clicado com URL configurada', async () => {
    const redirect = vi.spyOn(TestBed.inject(Redirector), 'redirect').mockResolvedValue();
    preferences.redirectUrl.set('http://destino');

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Redirect Now' }))).click();

    expect(redirect).toHaveBeenCalledWith(webhookRequest(1));
  });

  it('deve refletir o valor do servidor e avisar Quando o CORS é ligado', async () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const cors = await toggle('Enable CORS BETA');

    await cors.toggle();
    http.expectOne(`/token/${TOKEN_ID}/cors/toggle`).flush({ enabled: true });
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith('CORS enabled.', undefined, { duration: 1000 }),
    );

    expect(await cors.isChecked()).toBe(true);
    expect(preferences.token()?.cors).toBe(true);
  });

  it('deve avisar o erro do servidor Quando o CORS não pode ser alternado', async () => {
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');

    await (await toggle('Enable CORS BETA')).toggle();
    http
      .expectOne(`/token/${TOKEN_ID}/cors/toggle`)
      .flush({ success: false, error: { message: 'Gone' } }, { status: 410, statusText: 'Gone' });

    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith('Could not toggle CORS: Gone', undefined, {
        duration: 1000,
      }),
    );
  });
});
