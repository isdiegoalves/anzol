import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TOKEN_ID } from '../testing/fixtures';
import { App } from './app';
import { inboxMatcher } from './app.routes';
import { UrlLock } from './token/url-lock';

const OUTRO = '11111111-1111-4111-8111-111111111111';

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
