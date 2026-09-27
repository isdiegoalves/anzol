import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { outboundResult } from '../../testing/outbound-fixtures';
import { Token } from '../token/token';
import { SendDraft } from './outbound';
import { OutboundStore } from './outbound-store';
import { rememberTarget } from './replay-target';
import { SendDialog } from './send-dialog';

describe('Dado o diálogo "Send" da URL', () => {
  const sendUrl = `/token/${TOKEN_ID}/send`;
  const signed = token({ signature: { provider: 'github', secret: '••••abcd' } });
  let fixture: ComponentFixture<SendDialog>;
  let loader: HarnessLoader;
  let http: HttpTestingController;

  /** A resposta passa pelo `firstValueFrom` do serviço antes de chegar à tela. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  const open = async (data: { token: Token; draft?: SendDraft }) => {
    TestBed.configureTestingModule({
      imports: [SendDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SendDialog);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const input = (name: string) =>
    loader.getHarness(MatInputHarness.with({ selector: `[aria-label="${name}"]` }));
  const sign = () => loader.getHarness(MatSlideToggleHarness);
  const button = async (text: string) =>
    (await loader.getHarness(MatButtonHarness.with({ text }))).click();

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve deixar a assinatura desligada e explicar por quê Quando a URL não tem assinatura', async () => {
    const element = await open({ token: token({ signature: null }) });

    expect(await (await sign()).isDisabled()).toBe(true);
    expect(element.querySelector('.sign-hint')?.textContent?.trim()).toBe(
      'This URL has no signature configured. Set one up in Edit URL to sign.',
    );
  });

  it('deve oferecer a assinatura com o provedor da URL Quando ela tem assinatura', async () => {
    const element = await open({ token: signed });

    expect(await (await sign()).isDisabled()).toBe(false);
    expect(element.querySelector('.sign-hint')?.textContent).toContain('as GitHub does');
  });

  it('deve abrir como POST vazio para o destino lembrado Quando não parte de uma mensagem', async () => {
    rememberTarget(TOKEN_ID, 'http://localhost:3000/app');
    await open({ token: token() });

    expect(await (await loader.getHarness(MatSelectHarness)).getValueText()).toBe('POST');
    expect(await (await input('URL')).getValue()).toBe('http://localhost:3000/app');
    expect(await (await input('Body')).getValue()).toBe('');
  });

  it('deve abrir preenchido com a mensagem Quando vem do "Send as new…"', async () => {
    await open({
      token: token(),
      draft: {
        method: 'PUT',
        url: 'http://x/',
        headers: [['content-type', 'application/json']],
        body: '{"a":1}',
      },
    });

    expect(await (await loader.getHarness(MatSelectHarness)).getValueText()).toBe('PUT');
    expect(await (await input('Header 1 name')).getValue()).toBe('content-type');
    expect(await (await input('Header 1 value')).getValue()).toBe('application/json');
    expect(await (await input('Body')).getValue()).toBe('{"a":1}');
  });

  it('deve enviar método, URL, headers, corpo, assinatura e timeout em ms Quando Send é clicado', async () => {
    const element = await open({ token: signed });
    const select = await loader.getHarness(MatSelectHarness);
    await select.open();
    await select.clickOptions({ text: 'PATCH' });
    await (await input('URL')).setValue('https://api.example.com/hook');
    await button('Add header');
    await (await input('Header 1 name')).setValue('X-Trace');
    await (await input('Header 1 value')).setValue('abc');
    await (await input('Body')).setValue('oi');
    await (await sign()).check();

    await button('Send');
    const call = http.expectOne(sendUrl);
    call.flush(
      outboundResult(1, {
        kind: 'send',
        target: 'https://api.example.com/hook',
        status: 204,
        body: '',
      }),
    );
    await settle();

    expect(call.request.body).toEqual({
      url: 'https://api.example.com/hook',
      method: 'PATCH',
      headers: { 'X-Trace': 'abc' },
      body: 'oi',
      sign: true,
      timeout: 10000,
    });
    expect(element.querySelector('.status .code')?.textContent?.trim()).toBe('204');
    expect(element.querySelector('.note')).toBeNull();
  });

  it('deve mandar sign falso Quando a URL não tem assinatura', async () => {
    await open({
      token: token(),
      draft: { method: 'GET', url: 'http://x/', headers: [], body: '' },
    });

    await button('Send');
    const call = http.expectOne(sendUrl);
    call.flush(outboundResult(1, { kind: 'send' }));

    expect(call.request.body).toEqual(expect.objectContaining({ method: 'GET', sign: false }));
  });

  it('deve tirar a linha do header Quando o ✕ é clicado', async () => {
    await open({
      token: token(),
      draft: { method: 'POST', url: 'http://x/', headers: [['a', '1']], body: '' },
    });

    await button('✕');
    await button('Send');
    const call = http.expectOne(sendUrl);
    call.flush(outboundResult(1));

    expect(call.request.body.headers).toEqual({});
  });

  it('não deve enviar Quando um header tem nome inválido', async () => {
    await open({
      token: token(),
      draft: { method: 'POST', url: 'http://x/', headers: [['nome ruim:', '1']], body: '' },
    });

    await button('Send');

    http.expectNone(sendUrl);
  });

  it('deve entrar no topo do histórico carregado da mesma URL Quando o send volta', async () => {
    await open({
      token: token(),
      draft: { method: 'POST', url: 'http://x/', headers: [], body: '' },
    });
    const store = TestBed.inject(OutboundStore);
    const loading = store.load(TOKEN_ID);
    http.expectOne(`/token/${TOKEN_ID}/outbound`).flush([outboundResult(1)]);
    await loading;

    await button('Send');
    http.expectOne(sendUrl).flush(outboundResult(2, { kind: 'send' }));
    await settle();

    expect(store.history().map((item) => item.id)).toEqual(['out-2', 'out-1']);
  });
});
