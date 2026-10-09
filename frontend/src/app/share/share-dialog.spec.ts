import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { translations } from '../../locale/pt-BR';
import { SHARE_EXPIRATIONS, ShareLink, shareExpirationLabel } from './share';
import { ShareDialog } from './share-dialog';

const REQUEST = webhookRequest(1);
const SHARES = `/token/${TOKEN_ID}/shares`;
const CREATE = `/token/${TOKEN_ID}/request/${REQUEST.uuid}/share`;

function link(id: string, overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    id,
    url: `/#/share/${id}`,
    expires_at: '2026-10-03 12:00:00',
    redact: true,
    ...overrides,
  };
}

describe('Dado o diálogo "Share read-only link…"', () => {
  let fixture: ComponentFixture<ShareDialog>;
  let loader: HarnessLoader;
  let http: HttpTestingController;
  let snack: ReturnType<typeof vi.fn>;

  const element = () => fixture.nativeElement as HTMLElement;
  const activeLinks = () =>
    [...element().querySelectorAll('ul.links li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
  /** Espera a promessa do componente terminar e a tela refletir. */
  const settled = (check: () => void) =>
    vi.waitFor(async () => {
      await fixture.whenStable();
      check();
    });
  const clickButton = async (text: string | RegExp) => {
    await (await loader.getHarness(MatButtonHarness.with({ text }))).click();
    await fixture.whenStable();
  };

  const open = async (active: ShareLink[] = []) => {
    snack = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { request: REQUEST } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: snack } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShareDialog);
    loader = TestbedHarnessEnvironment.loader(fixture);
    http.expectOne(SHARES).flush(active);
    await fixture.whenStable();
  };

  afterEach(() => http.verify());

  it('deve vir com 7 dias, valores sensíveis escondidos e o aviso do corpo Quando abre', async () => {
    await open();
    const select = await loader.getHarness(MatSelectHarness);

    expect(await select.getValueText()).toBe('7 days');
    await select.open();
    const options = await select.getOptions();
    expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
      '1 hour',
      '1 day',
      '7 days',
      '30 days',
    ]);
    const toggle = await loader.getHarness(
      MatSlideToggleHarness.with({ label: 'Hide sensitive values' }),
    );
    expect(await toggle.isChecked()).toBe(true);
    expect(element().querySelector('.warning')?.textContent?.trim()).toBe(
      'The request body is not masked: the link shows it exactly as received.',
    );
    expect(activeLinks()).toEqual(['No active links for this URL.']);
  });

  it('deve criar o link com os padrões e mostrá-lo para copiar Quando "Create link" é clicado', async () => {
    await open();

    const done = clickButton('Create link');
    const call = await vi.waitFor(() => http.expectOne(CREATE));
    call.flush(link('AbC123'));
    await done;
    await settled(() => expect(activeLinks()[0]).toContain('AbC123'));

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual({ expires_in: '7d', redact: true });
    const input = await loader.getHarness(MatInputHarness.with({ selector: '[readonly]' }));
    expect(await input.getValue()).toBe(`${location.origin}/#/share/AbC123`);
    expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Copy link' }))).toHaveLength(
      1,
    );
  });

  it('deve mandar a validade e a máscara escolhidas Quando são mudadas antes de criar', async () => {
    await open();
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    await select.clickOptions({ text: '1 hour' });
    await (
      await loader.getHarness(MatSlideToggleHarness.with({ label: 'Hide sensitive values' }))
    ).uncheck();

    const done = clickButton('Create link');
    const call = await vi.waitFor(() => http.expectOne(CREATE));
    call.flush(link('x1', { redact: false }));
    await done;

    expect(call.request.body).toEqual({ expires_in: '1h', redact: false });
  });

  it('deve listar os links ativos da URL e marcar os desta mensagem Quando abre', async () => {
    await open([
      link('Este', { request_id: REQUEST.uuid }),
      link('Outro', { request_id: webhookRequest(2).uuid, redact: false }),
    ]);

    const [este, outro] = activeLinks();
    expect(este).toContain('Este');
    expect(este).toContain('sensitive values hidden');
    expect(este).toContain('this request');
    expect(outro).toContain('all values shown');
    expect(outro).not.toContain('this request');
  });

  it('deve revogar e tirar da lista Quando "Revoke" é clicado', async () => {
    await open([link('Um'), link('Dois')]);

    const done = (async () => {
      await (
        await loader.getHarness(
          MatButtonHarness.with({ selector: '[aria-label="Revoke link Um"]' }),
        )
      ).click();
      await fixture.whenStable();
    })();
    const call = await vi.waitFor(() => http.expectOne(`${SHARES}/Um`));
    call.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    await settled(() => expect(activeLinks().map((text) => text?.split(' ')[0])).toEqual(['Dois']));

    expect(call.request.method).toBe('DELETE');
    expect(snack).toHaveBeenCalledWith('Link revoked', undefined, { duration: 1000 });
  });

  it('deve mostrar a frase do servidor Quando a URL já tem 50 links ativos (422)', async () => {
    await open();

    const done = clickButton('Create link');
    const call = await vi.waitFor(() => http.expectOne(CREATE));
    call.flush(
      { shares: ['A URL can have at most 50 active shared links.'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await done;

    await settled(() =>
      expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'Could not create the link (422): A URL can have at most 50 active shared links.',
      ),
    );
  });
});

describe('Dado as validades do link com a tela em pt-BR', () => {
  afterEach(() => clearTranslations());

  it('deve dizer cada validade em português', () => {
    loadTranslations(translations);

    expect(SHARE_EXPIRATIONS.map(shareExpirationLabel)).toEqual([
      '1 hora',
      '1 dia',
      '7 dias',
      '30 dias',
    ]);
  });
});
