import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { token, webhookRequest } from '../../testing/fixtures';
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

  it('deve ter só o redirect (o CORS foi para Checks; o resto, para Pretty, Follow new e as abas)', async () => {
    const toggles = await loader.getAllHarnesses(MatSlideToggleHarness);

    expect(await Promise.all(toggles.map((item) => item.getLabelText()))).toEqual([
      'Auto redirect',
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
});
