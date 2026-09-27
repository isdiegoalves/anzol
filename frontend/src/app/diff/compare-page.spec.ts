import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { routes } from '../app.routes';
import { Viewport, WindowClass } from '../shell/viewport';

const [R1, R2, R3] = [1, 2, 3].map((n) => webhookRequest(n));

describe('Dado o link do Compare (#/{token}/compare/{a}/{b})', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  const windowClass = signal<WindowClass>('large');

  const page = () => harness.routeNativeElement as HTMLElement;
  const flush = async (url: string, body: object | null, status = 200) => {
    const call = await vi.waitFor(() => http.expectOne(url));
    call.flush(body, status === 200 ? undefined : { status, statusText: 'Erro' });
  };
  const open = async (a = R1.uuid, b = R2.uuid) => {
    await harness.navigateByUrl(`/${TOKEN_ID}/compare/${a}/${b}`);
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1`, requestPage([R1, R2, R3]));
  };

  beforeEach(async () => {
    Element.prototype.scrollTo ??= () => undefined;
    windowClass.set('large');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve carregar A e B pela API, mostrar a comparação ao lado da lista marcada, e passar no axe', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('[aria-label="Compare requests"]')).not.toBeNull();
    });
    expect(page().querySelector('.id-a')?.textContent).toBe(`#${R1.uuid.substring(0, 5)}`);
    expect([...page().querySelectorAll('.item.pick-a, .item.pick-b')]).toHaveLength(2);
    expect(page().querySelector('.item.pick-b .select')?.getAttribute('aria-label')).toMatch(
      /compared as B$/,
    );
    await expectNoAxeViolations(page());
  });

  it('deve trocar a B pela rota Quando outra mensagem é clicada na lista', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelectorAll('.item .select')).toHaveLength(3);
    });

    page().querySelectorAll<HTMLButtonElement>('.item .select')[2].click();

    const router = TestBed.inject(Router);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/compare/${R1.uuid}/${R3.uuid}`));
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R3.uuid}`, R3);
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('.id-b')?.textContent).toBe(`#${R3.uuid.substring(0, 5)}`);
    });
  });

  it('deve mostrar só a comparação, sem a lista, Quando a janela é compacta', async () => {
    windowClass.set('compact');
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('app-request-compare')).not.toBeNull();
    });
    expect(page().querySelector('app-request-list')).toBeNull();
  });

  it('deve dizer que uma delas sumiu Quando a API responde 404', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, { error: 'Not found' }, 404);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().textContent).toContain('One of these requests is gone');
    });
  });

  it('deve trocar A e B na hora, sem pedir de novo à API, Quando "Swap A and B" é clicado', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('.id-a')?.textContent).toBe(`#${R1.uuid.substring(0, 5)}`);
    });

    [...page().querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Swap A and B')
      ?.click();

    const router = TestBed.inject(Router);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/compare/${R2.uuid}/${R1.uuid}`));
    await harness.fixture.whenStable();
    expect(page().querySelector('.id-a')?.textContent).toBe(`#${R2.uuid.substring(0, 5)}`);
    http.expectNone(`/token/${TOKEN_ID}/request/${R1.uuid}`);
  });
});
