import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { inboxMatcher, outboundMatcher, rulesMatcher } from '../app.routes';
import { OutboundActions } from '../outbound/outbound-actions';
import { Preferences } from '../settings/preferences';
import { TokenBar } from './token-bar';

@Component({ template: '' })
class Page {}

describe('Dado as abas "Requests" / "Rules" / "Outbound" na barra superior', () => {
  let fixture: ComponentFixture<TokenBar>;

  const tabs = () =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav.views a'),
    ].map((a) => ({
      text: a.textContent?.trim(),
      href: a.getAttribute('href'),
      current: a.getAttribute('aria-current'),
    }));

  const sendButton = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.send');

  const render = async (url: string) => {
    const harness = await RouterTestingHarness.create();
    fixture = TestBed.createComponent(TokenBar);
    await harness.navigateByUrl(url);
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { matcher: rulesMatcher, component: Page },
          { matcher: outboundMatcher, component: Page },
          { matcher: inboxMatcher, component: Page },
        ]),
      ],
    });
  });

  afterEach(() => localStorage.clear());

  it('deve apontar as três abas para a URL aberta e marcar "Requests" Quando está na lista', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}`);

    expect(tabs()).toEqual([
      { text: 'Requests', href: `/${TOKEN_ID}`, current: 'page' },
      { text: 'Rules', href: `/${TOKEN_ID}/rules`, current: null },
      { text: 'Outbound', href: `/${TOKEN_ID}/outbound`, current: null },
    ]);
  });

  it('deve marcar "Rules" Quando está na aba de regras', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}/rules`);

    expect(tabs().map((tab) => tab.current)).toEqual([null, 'page', null]);
  });

  it('deve marcar "Outbound" Quando está no histórico de saída', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}/outbound`);

    expect(tabs().map((tab) => tab.current)).toEqual([null, null, 'page']);
  });

  it('deve manter "Requests" marcada Quando uma mensagem está aberta (deep link)', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}/00000000-0000-4000-8000-000000000001/1`);

    expect(tabs().map((tab) => tab.current)).toEqual(['page', null, null]);
  });

  it('não deve mostrar as abas nem o Send Quando ainda não há URL aberta', async () => {
    await render('/');

    expect(tabs()).toEqual([]);
    expect(sendButton()).toBeNull();
  });

  it('deve abrir o diálogo Send da URL aberta Quando "Send" é clicado', async () => {
    const send = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: OutboundActions, useValue: { send } }],
    });
    TestBed.inject(Preferences).token.set(token());
    await render(`/${TOKEN_ID}`);

    sendButton()?.click();

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith());
  });
});
