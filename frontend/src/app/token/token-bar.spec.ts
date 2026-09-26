import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { inboxMatcher, rulesMatcher } from '../app.routes';
import { Preferences } from '../settings/preferences';
import { TokenBar } from './token-bar';

@Component({ template: '' })
class Page {}

describe('Dado a alternância "Requests" / "Rules" na barra superior', () => {
  let fixture: ComponentFixture<TokenBar>;

  const tabs = () =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav.views a'),
    ].map((a) => ({
      text: a.textContent?.trim(),
      href: a.getAttribute('href'),
      current: a.getAttribute('aria-current'),
    }));

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
          { matcher: inboxMatcher, component: Page },
        ]),
      ],
    });
  });

  afterEach(() => localStorage.clear());

  it('deve apontar as duas abas para a URL aberta e marcar "Requests" Quando está na lista', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}`);

    expect(tabs()).toEqual([
      { text: 'Requests', href: `/${TOKEN_ID}`, current: 'page' },
      { text: 'Rules', href: `/${TOKEN_ID}/rules`, current: null },
    ]);
  });

  it('deve marcar "Rules" Quando está na aba de regras', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}/rules`);

    expect(tabs().map((tab) => tab.current)).toEqual([null, 'page']);
  });

  it('deve manter "Requests" marcada Quando uma mensagem está aberta (deep link)', async () => {
    TestBed.inject(Preferences).token.set(token());

    await render(`/${TOKEN_ID}/00000000-0000-4000-8000-000000000001/1`);

    expect(tabs().map((tab) => tab.current)).toEqual(['page', null]);
  });

  it('não deve mostrar as abas Quando ainda não há URL aberta', async () => {
    await render('/');

    expect(tabs()).toEqual([]);
  });
});
