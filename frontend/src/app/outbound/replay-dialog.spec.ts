import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { TOKEN_ID, webhookRequest } from '../../testing/fixtures';
import { outboundResult } from '../../testing/outbound-fixtures';
import { OutboundStore } from './outbound-store';
import { ReplayDialog } from './replay-dialog';
import { rememberTarget, rememberedTarget } from './replay-target';

describe('Dado o diálogo "Replay" de uma mensagem', () => {
  const request = webhookRequest(1, { url: `http://localhost:8084/${TOKEN_ID}/pedidos?x=1` });
  const replayUrl = `/token/${TOKEN_ID}/request/${request.uuid}/replay`;
  let fixture: ComponentFixture<ReplayDialog>;
  let loader: HarnessLoader;
  let http: HttpTestingController;

  /** A resposta passa pelo `firstValueFrom` do serviço antes de chegar à tela. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  const open = async () => {
    TestBed.configureTestingModule({
      imports: [ReplayDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { request } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReplayDialog);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const target = () =>
    loader.getHarness(MatInputHarness.with({ selector: '[formControlName=url]' }));
  const timeout = () =>
    loader.getHarness(MatInputHarness.with({ selector: '[formControlName=timeout]' }));
  const replay = async () =>
    (await loader.getHarness(MatButtonHarness.with({ text: 'Replay' }))).click();
  /** Clica em Replay e responde o POST com `body` (ou o erro). */
  const answer = async (body: object, init?: { status: number; statusText: string }) => {
    await replay();
    const call = http.expectOne(replayUrl);
    call.flush(body, init);
    await settle();
    return call.request;
  };

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve abrir com o destino lembrado desta URL, Keep path ligado e timeout 10 s', async () => {
    rememberTarget(TOKEN_ID, 'http://localhost:3000/app');
    await open();

    expect(await (await target()).getValue()).toBe('http://localhost:3000/app');
    expect(await (await loader.getHarness(MatSlideToggleHarness)).isChecked()).toBe(true);
    expect(await (await timeout()).getValue()).toBe('10');
  });

  it('deve mostrar o que o Keep path acrescenta Quando a mensagem tem caminho e query', async () => {
    const element = await open();

    expect(element.textContent).toContain('Appends /pedidos?x=1 to the target');
  });

  it('deve enviar destino, keep_path e o timeout em ms e lembrar o destino Quando Replay é clicado', async () => {
    await open();
    await (await target()).setValue('http://localhost:3000/app');
    await (await loader.getHarness(MatSlideToggleHarness)).uncheck();
    await (await timeout()).setValue('5');

    const sent = await answer(outboundResult(1));

    expect(sent.method).toBe('POST');
    expect(sent.body).toEqual({
      url: 'http://localhost:3000/app',
      keep_path: false,
      timeout: 5000,
    });
    expect(rememberedTarget(TOKEN_ID)).toBe('http://localhost:3000/app');
  });

  it('deve mostrar status, tempo, headers e corpo da resposta, marcando o corte, Quando o replay volta', async () => {
    const element = await open();
    await (await target()).setValue('http://localhost:3000/app');

    await answer(outboundResult(1, { body: 'x'.repeat(10), truncated: true, duration_ms: 87 }));

    expect(element.querySelector('.status')?.textContent?.trim()).toBe('201');
    expect(element.querySelector('.duration')?.textContent).toBe('87 ms');
    expect(element.querySelector('table[aria-label="Response headers"]')?.textContent).toContain(
      'x-app',
    );
    expect(element.querySelector('pre.body')?.textContent).toBe('x'.repeat(10));
    expect(element.querySelector('.truncated')?.textContent).toContain('64 KB');
  });

  it('deve dizer para onde foi Quando o servidor troca o localhost pelo host da máquina', async () => {
    const element = await open();
    await (await target()).setValue('http://localhost:3000/app');

    await answer(outboundResult(1, { target: 'http://host.docker.internal:3000/app/pedidos?x=1' }));

    expect(element.querySelector('.note')?.textContent).toBe('Sent to host.docker.internal:3000');
  });

  it('deve explicar o bloqueio e citar WEBHOOK_OUTBOUND_ALLOW_PRIVATE Quando o alvo é bloqueado', async () => {
    const element = await open();
    await (await target()).setValue('http://10.0.0.5/');

    await answer(
      outboundResult(1, {
        status: null,
        headers: null,
        body: null,
        error: { kind: 'blocked', message: 'private address' },
      }),
    );

    const alert = element.querySelector('.error[role=alert]')?.textContent ?? '';
    expect(alert).toContain('Blocked: private address');
    expect(alert).toContain('WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true');
    expect(element.querySelector('table[aria-label="Response headers"]')).toBeNull();
  });

  it('deve dizer quando tentar de novo Quando o servidor responde 429', async () => {
    const element = await open();
    await (await target()).setValue('http://localhost:3000/app');

    await replay();
    http.expectOne(replayUrl).flush(null, {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'Retry-After': '17' },
    });
    await settle();

    expect(element.querySelector('.failure')?.textContent).toBe(
      'Too many sends from this URL (30 per minute). Try again in 17 s.',
    );
  });

  it.each([
    ['sem esquema http(s)', 'ftp://x/'],
    ['vazio', ''],
  ])('não deve enviar Quando o destino está %s', async (_caso, url) => {
    await open();
    await (await target()).setValue(url);

    await replay();

    http.expectNone(replayUrl);
    expect(TestBed.inject(OutboundStore).history()).toEqual([]);
  });

  it('não deve enviar Quando o timeout passa de 30 s', async () => {
    await open();
    await (await target()).setValue('http://localhost:3000/app');
    await (await timeout()).setValue('31');

    await replay();

    http.expectNone(replayUrl);
  });
});
