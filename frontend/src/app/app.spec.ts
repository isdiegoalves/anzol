import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FakeEventSource } from '../testing/fake-event-source';
import { TOKEN_ID, token } from '../testing/fixtures';
import { App } from './app';
import { inboxMatcher } from './app.routes';
import { Preferences } from './settings/preferences';
import { UrlLock } from './token/url-lock';

const OUTRO = '11111111-1111-4111-8111-111111111111';

// O shell abre o tempo real da URL aberta (o jsdom não tem SSE).
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

@Component({ selector: 'app-page', template: 'página da URL' })
class Page {}

describe('Dado a URL protegida sem acesso', () => {
  let fixture: ComponentFixture<App>;
  let lock: UrlLock;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ matcher: inboxMatcher, component: Page }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    lock = TestBed.inject(UrlLock);
    fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(`/${TOKEN_ID}`);
    await fixture.whenStable();
  });

  afterEach(() => localStorage.clear());

  it('deve trocar a página pela tela de desbloqueio Quando a URL da rota é trancada', async () => {
    expect(text()).toContain('página da URL');

    lock.lock(TOKEN_ID);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('This URL is protected');
    });
    expect(text()).not.toContain('página da URL');
  });

  it('deve tirar a tela de desbloqueio e recriar a página Quando a URL é destrancada', async () => {
    lock.lock(TOKEN_ID);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('This URL is protected');
    });

    lock.release();
    await fixture.whenStable();

    expect(text()).toContain('página da URL');
    expect(text()).not.toContain('This URL is protected');
  });

  it('deve mostrar a página Quando a URL trancada não é a da rota (navegou para outra)', async () => {
    lock.lock(TOKEN_ID);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('This URL is protected');
    });

    await TestBed.inject(Router).navigateByUrl(`/${OUTRO}`);
    await fixture.whenStable();

    expect(text()).toContain('página da URL');
    expect(text()).not.toContain('This URL is protected');
  });
});

describe('Dado a página do link só-leitura', () => {
  afterEach(() => localStorage.clear());

  it('deve ficar só com a marca, sem o shell (nenhum botão, destino ou URL)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'share/:shareId', component: Page },
          { matcher: inboxMatcher, component: Page },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    TestBed.inject(Preferences).token.set(token({ protected: true }));
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/share/abc123');
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('página da URL');
    expect(element.querySelector('a.brand')?.textContent).toContain('Anzol');
    expect(element.querySelectorAll('button')).toHaveLength(0);
    expect(element.querySelector('nav')).toBeNull();
    expect(element.querySelector('input')).toBeNull();
  });
});
