import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expectNoAxeViolations } from '../../testing/axe';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { routes } from '../app.routes';
import { Viewport, WindowClass } from '../shell/viewport';
import { CompareStore } from './compare-store';

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
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2, R3]));
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

  // B2 (CA-5): a comparação não abre com outra no lugar; diz qual lado falta.
  it('deve dizer qual lado não existe mais, sem comparar, Quando a API responde 404 para ele', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, { error: 'Not found' }, 404);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().textContent).toContain(
        `Request B (#${R2.uuid.substring(0, 5)}) no longer exists. Nothing was compared.`,
      );
    });
    expect(page().textContent).not.toContain(`Request A (#`);
    expect(page().querySelector('app-request-compare')).toBeNull();
    await expectNoAxeViolations(page());
  });

  it('deve voltar à Inbox com o lado que existe esperando a outra escolha Quando "Choose another request" é clicado', async () => {
    // A Inbox abre o tempo real.
    vi.stubGlobal('EventSource', FakeEventSource);
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, { error: 'Not found' }, 404);
    const choose = await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      const button = [...page().querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Choose another request',
      );
      expect(button).toBeDefined();
      return button as HTMLButtonElement;
    });

    choose.click();

    const router = TestBed.inject(Router);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R3]));
    await harness.fixture.whenStable();
    expect(TestBed.inject(CompareStore).picking()?.uuid).toBe(R1.uuid);
    vi.unstubAllGlobals();
  });

  it('deve dizer os dois lados Quando nenhum existe mais', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, { error: 'Not found' }, 404);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, { error: 'Not found' }, 404);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().textContent).toContain(
        `Request A (#${R1.uuid.substring(0, 5)}) no longer exists. Request B (#${R2.uuid.substring(0, 5)}) no longer exists. Nothing was compared.`,
      );
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

  it('deve pôr no selo da regra o status gravado na mensagem (RULES-30, C3)', async () => {
    const answered = webhookRequest(2, {
      rule: { id: 'r1', name: 'Lado A' },
      response: { status: 201 },
    });
    await open(R1.uuid, answered.uuid);
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${answered.uuid}`, answered);

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('table[aria-label="Checks"]')?.textContent).toContain(
        '201 · Lado A',
      );
    });
  });

  // RULES-35: a lista diz o modo, sem a busca; o Esc sai do Compare para a A na Inbox.
  it('deve avisar o modo Compare na lista, sem a busca, e sair pelo Esc', async () => {
    await open();
    await flush(`/token/${TOKEN_ID}/request/${R1.uuid}`, R1);
    await flush(`/token/${TOKEN_ID}/request/${R2.uuid}`, R2);
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(page().querySelector('app-request-compare')).not.toBeNull();
    });

    const band = [...page().querySelectorAll('[role="status"]')].find((status) =>
      status.textContent?.includes('Compare mode.'),
    );
    expect(band?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Compare mode. Click a request to make it B. Press Esc to leave.',
    );
    expect(page().querySelector('[role="search"]')).toBeNull();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    const router = TestBed.inject(Router);
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/${R1.uuid}/1`));
    // A Inbox abre de novo a URL.
    await flush(`/token/${TOKEN_ID}`, token());
    await flush(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`, requestPage([R1, R2, R3]));
  });
});
