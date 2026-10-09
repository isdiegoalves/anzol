import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { changesBar, expectPut, saveButton } from '../../testing/checks';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { checksMatcher, routes } from '../app.routes';
import { Viewport, WindowClass } from '../shell/viewport';
import { Preferences } from '../settings/preferences';
import { CHECKS_DRAFT_KEY } from './checks-draft';
import { ChecksPage, checksSections } from './checks-page';

@Component({ template: 'outra página' })
class Elsewhere {}

const NO_STATS = {
  window: 200,
  evaluated: 0,
  total: 0,
  newest_seq: null,
  oldest_seq: null,
  newest_at: null,
  oldest_at: null,
  methods: {},
  signature: { valid: 0, invalid: 0, absent: 0, unchecked: 0, reasons: [] },
  schema: { valid: 0, invalid: 0, unchecked: 0, paths: [] },
  rules: { answered: [], near_miss: [], default: 0 },
  hourly: [],
};

describe('Dado a página Checks', () => {
  let http: HttpTestingController;
  const windowClass = signal<WindowClass>('large');

  beforeEach(() => {
    windowClass.set('large');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              matcher: checksMatcher,
              component: ChecksPage,
              canDeactivate: routes.find((route) => route.matcher === checksMatcher)?.canDeactivate,
            },
            { path: 'elsewhere', component: Elsewhere },
          ],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const open = async (url: string) => {
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(url);
    const load = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`));
    return { harness, load };
  };

  const ready = async (url = `/${TOKEN_ID}/checks`, saved = token({ default_status: 201 })) => {
    const { harness, load } = await open(url);
    load.flush(saved);
    await harness.fixture.whenStable();
    (
      await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`))
    ).flush(requestPage([]));
    http.expectOne(`/token/${TOKEN_ID}/stats?window=200`).flush(NO_STATS);
    for (const rules of http.match(`/token/${TOKEN_ID}/rules`)) {
      rules.flush([]);
    }
    await harness.fixture.whenStable();
    return harness;
  };

  const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
  const change = async (name: string, value: string) => {
    await userEvent.clear(box(name));
    await userEvent.type(box(name), value);
  };

  it('deve buscar a URL no servidor antes de montar os cartões (a do localStorage pode estar velha)', async () => {
    TestBed.inject(Preferences).token.set(token({ default_status: 500 }));
    const { harness, load } = await open(`/${TOKEN_ID}/checks`);

    expect(screen.getByText('Loading this URL…').getAttribute('role')).toBe('status');
    expect(screen.queryByRole('region', { name: 'Response' })).toBeNull();
    // O índice já funciona na carga: os esqueletos têm os ids dos cartões.
    expect(
      [...(harness.routeNativeElement as HTMLElement).querySelectorAll('.skeleton')].map(
        (slot) => slot.id,
      ),
    ).toEqual(checksSections().map(({ id }) => `checks-${id}`));
    load.flush(token({ default_status: 201 }));
    await harness.fixture.whenStable();
    const recent = await vi.waitFor(() =>
      http.expectOne(`/token/${TOKEN_ID}/requests?page=1&sorting=newest`),
    );
    recent.flush(requestPage([]));
    http
      .expectOne(`/token/${TOKEN_ID}/stats?window=200`)
      .flush(null, { status: 500, statusText: 'x' });
    await harness.fixture.whenStable();

    expect(screen.getByRole('heading', { level: 1, name: 'Checks' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Checks' })).toBeTruthy();
    // CHECKS-03: cada cartão abre com o ícone tonal de 40 px, na cor do papel (protótipo C).
    for (const [name, tone] of [
      ['Signature verification', 'primary'],
      ['Schema validation', 'primary'],
      ['Response', 'secondary'],
      ['Privacy', 'secondary'],
      ['Health', 'tertiary'],
    ]) {
      const region = screen.getByRole('region', { name });
      const icon = region.querySelector('.card-head .card-icon');
      expect(icon?.classList.contains(tone), `${name}: ícone ${tone}`).toBe(true);
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.querySelector('svg')).toBeTruthy();
    }
    expect(box('Default status code').value).toBe('201');
    expect(screen.getByRole('link', { name: /^Schema/ }).getAttribute('href')).toContain(
      'section=schema',
    );
    // CHECKS-05: os atalhos, na ordem da §1, com o ícone de 16 px do protótipo.
    const jump = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(jump).getAllByRole('link');
    expect(links.map((link) => link.querySelector('.jump-name')?.textContent?.trim())).toEqual([
      'Signature',
      'Schema',
      'Response',
      'Privacy',
      'E2EE',
      'Health',
    ]);
    for (const link of links) {
      expect(link.querySelector('app-icon svg')?.getAttribute('width')).toBe('16');
    }
    await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
  });

  it('deve passar a mensagem ao Schema Quando a rota traz ?schema-from=', async () => {
    const { harness, load } = await open(
      `/${TOKEN_ID}/checks?schema-from=${webhookRequest(9).uuid}`,
    );
    load.flush(token());
    await harness.fixture.whenStable();

    await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/request/${webhookRequest(9).uuid}`));
  });

  it('deve dizer que não carregou e tentar de novo pelo "Try again" Quando a leitura da URL falha', async () => {
    const { harness, load } = await open(`/${TOKEN_ID}/checks`);

    load.flush(null, { status: 500, statusText: 'x' });
    await harness.fixture.whenStable();

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load this URL.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`))).flush(token());
    await vi.waitFor(() => expect(screen.getByRole('region', { name: 'Privacy' })).toBeTruthy());
  });

  describe('Dado a ordem por assunto', () => {
    it('deve pôr os cartões numa coluna, na ordem do índice, a decifra depois da Privacidade e o Health por último', async () => {
      const harness = await ready();

      const page = harness.routeNativeElement as HTMLElement;
      expect([...page.querySelectorAll('.cards .slot')].map((slot) => slot.id)).toEqual([
        'checks-signature',
        'checks-schema',
        'checks-response',
        'checks-privacy',
        'checks-e2ee',
        'checks-health',
      ]);
      expect(
        [...page.querySelectorAll('.cards [role=region]')].map((card) =>
          card.querySelector('h2')?.textContent?.trim(),
        ),
      ).toEqual([
        'Signature verification',
        'Schema validation',
        'Response',
        'Privacy',
        'E2EE decryption',
        'Health',
      ]);
      expect(page.querySelector('.columns')).toBeNull();
      expect(page.querySelector('main')?.lastElementChild?.tagName).toBe('APP-CHANGES-BAR');
    });

    it('deve mostrar o estado salvo de cada seção no índice e marcar a do ?section=', async () => {
      await ready(
        `/${TOKEN_ID}/checks?section=response`,
        token({
          default_status: 429,
          signature: { provider: 'stripe', secret: '••••1234' },
          schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
          protected: false,
        }),
      );

      const jump = screen.getByRole('navigation', { name: 'On this page' });
      const links = within(jump).getAllByRole('link');
      const shown = (link: HTMLElement) =>
        [...link.querySelectorAll('.jump-name, .jump-state')]
          .map((part) => part.textContent?.trim())
          .join(' ');
      expect(links.map(shown)).toEqual([
        'Signature · Stripe',
        'Schema · On · 2020-12',
        'Response · 429',
        'Privacy · Open',
        'E2EE · Off',
        'Health',
      ]);
      expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
        'Signature, Stripe',
        'Schema, on',
        'Response, 429',
        'Privacy, open',
        'E2EE, off',
        'Health',
      ]);
      expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
        null,
        null,
        'location',
        null,
        null,
        null,
      ]);
    });
  });

  describe('Dado a decifra ligada numa URL sem segredo de leitura', () => {
    it('deve tirar o aviso do segredo assim que a Privacidade é ligada no rascunho, e devolvê-lo ao desligar', async () => {
      await ready(`/${TOKEN_ID}/checks`, token({ protected: false }));
      const decifra = screen.getByRole('region', { name: 'E2EE decryption' });
      const privacidade = screen.getByRole('region', { name: 'Privacy' });
      const aviso = () => within(decifra).queryByText(/^This URL has no read secret/);

      await userEvent.click(
        within(decifra).getByRole('switch', { name: 'Decrypt an attribute of each request' }),
      );
      expect(aviso()).not.toBeNull();

      const exigir = within(privacidade).getByRole('switch', {
        name: 'Require a secret to view this URL',
      });
      await userEvent.click(exigir);
      expect(aviso()).toBeNull();

      await userEvent.click(exigir);
      expect(aviso()).not.toBeNull();
    });
  });

  describe('Dado a barra de salvar', () => {
    it('não deve ter botão de salvar em cartão nenhum, nem a barra, Quando nada mudou', async () => {
      await ready();

      for (const name of ['Save signature', 'Save schema', 'Save response', 'Save privacy']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      expect(changesBar()).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    });

    it('deve mandar as alterações de dois cartões num PUT só, com a URL inteira', async () => {
      await ready(
        `/${TOKEN_ID}/checks`,
        token({ default_status: 200, signature: { provider: 'github', secret: '••••1234' } }),
      );

      await change('Default status code', '429');
      await userEvent.click(box('JSON Schema'));
      await userEvent.paste('{"type":"object"}');
      expect(changesBar()?.textContent).toContain(
        '2 unsaved changes: JSON Schema, Default status code',
      );
      expect(screen.getByRole('link', { name: 'Schema, off, unsaved' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Response, 200, unsaved' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Privacy, open' })).toBeTruthy();
      await userEvent.click(saveButton());

      const put = await expectPut(http);
      expect(put.request.body).toMatchObject({
        default_status: '429',
        schema: { type: 'object' },
        // O `PUT` troca a configuração inteira: o bloco da assinatura vai junto.
        signature: { provider: 'github', secret: '••••1234' },
      });
      put.flush(
        token({
          default_status: 429,
          schema: { type: 'object' },
          signature: { provider: 'github', secret: '••••1234' },
        }),
      );
      await vi.waitFor(() => expect(changesBar()).toBeNull());
      http.expectNone((sent) => sent.method === 'PUT');
      expect(screen.getByRole('link', { name: 'Response, 429' })).toBeTruthy();
      for (const stats of http.match(`/token/${TOKEN_ID}/stats?window=200`)) {
        stats.flush(NO_STATS);
      }
    });

    it('não deve gravar nada Quando um cartão está inválido, mesmo com outro certo', async () => {
      await ready();

      await change('Default status code', '429');
      await userEvent.click(screen.getByRole('radio', { name: /^Generic/ }));
      await userEvent.click(saveButton());

      expect(screen.getByRole('alert').textContent?.trim()).toBe(
        '2 fields need attention: Signature header, Secret',
      );
      expect(document.activeElement).toBe(box('Signature header'));
      http.expectNone((sent) => sent.method !== 'GET');
    });

    it('não deve rolar a página no clique, e sim no Tab, Quando o controle está atrás da barra', async () => {
      await ready();
      await change('Default status code', '429');
      // O jsdom passa o `:focus-visible` do campo ao botão clicado depois dele; o navegador, não.
      box('Default status code').blur();
      const rolar = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      try {
        await userEvent.click(screen.getByRole('radio', { name: /^Generic/ }));
        expect(rolar).not.toHaveBeenCalled();

        await userEvent.tab();
        expect(rolar).toHaveBeenCalled();
      } finally {
        rolar.mockRestore();
      }
    });

    it('deve salvar pelo Ctrl+S com o foco num campo', async () => {
      await ready();
      await change('Default status code', '429');

      await userEvent.keyboard('{Control>}s{/Control}');

      (await expectPut(http)).flush(token({ default_status: 429 }));
      await vi.waitFor(() => expect(changesBar()).toBeNull());
      for (const stats of http.match(`/token/${TOKEN_ID}/stats?window=200`)) {
        stats.flush(NO_STATS);
      }
    });

    it('deve voltar todos os cartões ao salvo Quando "Discard"', async () => {
      await ready();
      await change('Default status code', '429');
      await userEvent.click(screen.getByRole('switch', { name: 'Enable CORS' }));

      await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

      expect(box('Default status code').value).toBe('201');
      expect(screen.getByRole('switch', { name: 'Enable CORS' }).getAttribute('aria-checked')).toBe(
        'false',
      );
      expect(changesBar()).toBeNull();
    });
  });

  describe('Dado a guarda de saída', () => {
    const leave = () => TestBed.inject(Router).navigateByUrl('/elsewhere');
    const dialog = () => screen.findByRole('dialog', { name: 'Discard changes?' });

    it('deve sair sem perguntar Quando nada mudou', async () => {
      await ready();

      await expect(leave()).resolves.toBe(true);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('deve listar as alterações e ficar na página Quando "Keep editing"', async () => {
      await ready();
      await change('Default status code', '429');
      await userEvent.click(
        screen.getByRole('switch', { name: 'Require a secret to view this URL' }),
      );
      await userEvent.type(screen.getByLabelText('Secret to view'), 'segredo-longo');

      const left = leave();
      const open = within(await dialog());

      expect(open.getByText('Checks has 3 unsaved changes:')).toBeTruthy();
      expect(open.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
        'Default status code: 201 → 429',
        'Require a secret to view this URL: off → on',
        'Secret to view: set (not shown)',
      ]);
      expect(open.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
        'Keep editing',
        'Discard',
        'Save and leave',
      ]);
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(open.getByRole('button', { name: 'Keep editing' })),
      );
      await expectNoAxeViolations(document.body);
      await userEvent.click(open.getByRole('button', { name: 'Keep editing' }));

      await expect(left).resolves.toBe(false);
      expect(box('Default status code').value).toBe('429');
    });

    it('deve sair sem gravar Quando "Discard"', async () => {
      await ready();
      await change('Default status code', '429');

      const left = leave();
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Discard' }));

      await expect(left).resolves.toBe(true);
      http.expectNone((sent) => sent.method === 'PUT');
      expect(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID))).toBeNull();
    });

    it('deve gravar e sair Quando "Save and leave"', async () => {
      await ready();
      await change('Default status code', '429');

      const left = leave();
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Save and leave' }));
      (await expectPut(http)).flush(token({ default_status: 429 }));

      await expect(left).resolves.toBe(true);
    });

    it('deve ficar na página, como o "Save changes", Quando "Save and leave" acha campo inválido', async () => {
      await ready();
      await change('Retry-After', 'amanhã');

      const left = leave();
      await userEvent.click(within(await dialog()).getByRole('button', { name: 'Save and leave' }));

      await expect(left).resolves.toBe(false);
      await vi.waitFor(() =>
        expect(screen.getByRole('alert').textContent?.trim()).toBe(
          '1 field needs attention: Retry-After',
        ),
      );
      http.expectNone((sent) => sent.method === 'PUT');
    });

    it('deve pedir a confirmação do navegador ao fechar a aba Quando há alteração pendente', async () => {
      await ready();
      const before = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false);

      await change('Default status code', '429');
      const after = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(after);

      expect(after.defaultPrevented).toBe(true);
    });
  });

  describe('Dado o rascunho na memória da aba', () => {
    it('deve oferecer o rascunho ao reabrir e restaurar sem os segredos', async () => {
      sessionStorage.setItem(
        CHECKS_DRAFT_KEY(TOKEN_ID),
        JSON.stringify({
          savedAt: Date.now() - 180_000,
          sections: { response: { default_status: '503', cors: true } },
        }),
      );
      await ready();

      const offer = screen.getByRole('alert');
      expect(offer.textContent).toMatch(/^\s*You have a draft from .+\./);
      expect(changesBar()).toBeNull();
      await userEvent.click(within(offer).getByRole('button', { name: 'Restore draft' }));

      expect(box('Default status code').value).toBe('503');
      expect(changesBar()?.textContent).toContain('2 unsaved changes: Default status code, CORS');
      expect(screen.queryByRole('button', { name: 'Restore draft' })).toBeNull();
    });

    it('não deve guardar o segredo da assinatura nem o de leitura', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await ready();
        await userEvent.click(screen.getByRole('radio', { name: /^GitHub/ }));
        await userEvent.type(screen.getByLabelText(/^Secret/), 'whsec_muito_secreto');
        await userEvent.click(
          screen.getByRole('switch', { name: 'Require a secret to view this URL' }),
        );
        await userEvent.type(screen.getByLabelText('Secret to view'), 'segredo-de-leitura');
        vi.advanceTimersByTime(400);

        const stored = sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID)) ?? '';
        expect(JSON.parse(stored)).toMatchObject({
          sections: { signature: { provider: 'github' }, privacy: { required: true } },
        });
        expect(stored).not.toContain('whsec_muito_secreto');
        expect(stored).not.toContain('segredo-de-leitura');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Dado o celular (abaixo de 840 px)', () => {
    const fold = (name: string | RegExp) => screen.getByRole('button', { name });

    it('deve recolher os cartões, abrindo o do ?section= e os que têm alteração pendente', async () => {
      windowClass.set('compact');
      const harness = await ready(`/${TOKEN_ID}/checks?section=response`);

      expect(
        [
          'Signature verification, Off',
          'Schema validation, off',
          'Response, 201',
          'Privacy, open',
          'Health',
        ].map((name) => fold(name).getAttribute('aria-expanded')),
      ).toEqual(['false', 'false', 'true', 'false', 'false']);
      const page = harness.routeNativeElement as HTMLElement;
      const privacy = screen.getByRole('region', { name: 'Privacy' });
      expect(privacy.classList.contains('closed')).toBe(true);
      expect(privacy.contains(fold('Privacy, open'))).toBe(true);
      expect(privacy.querySelector('.card-body mat-slide-toggle')).not.toBeNull();
      expect(screen.getByRole('region', { name: 'Response' }).classList.contains('closed')).toBe(
        false,
      );

      await userEvent.click(fold('Privacy, open'));
      expect(fold('Privacy, open').getAttribute('aria-expanded')).toBe('true');
      await userEvent.click(
        screen.getByRole('switch', { name: 'Require a secret to view this URL' }),
      );
      await userEvent.click(fold('Privacy, open'));
      expect(fold('Privacy, open').getAttribute('aria-expanded')).toBe('true');
      await userEvent.click(fold('Response, 201'));
      expect(fold('Response, 201').getAttribute('aria-expanded')).toBe('false');
      await expectNoAxeViolations(page);
    });

    it('deve recolher os três passos da decifra num bloco fechado, antes das chaves', async () => {
      windowClass.set('compact');
      const harness = await ready(`/${TOKEN_ID}/checks?section=e2ee`);

      const cartao = screen.getByRole('region', { name: 'E2EE decryption' });
      expect(cartao.classList.contains('closed')).toBe(false);
      const resumo = within(cartao).getByText('How decryption works', { selector: 'summary' });
      const bloco = resumo.closest('details') as HTMLDetailsElement;
      expect(bloco.open).toBe(false);
      const passos = within(bloco).getByRole('list', {
        name: 'How decryption works',
        hidden: true,
      });
      expect(within(passos).getAllByRole('listitem', { hidden: true })).toHaveLength(3);
      const chaves = within(cartao).getByRole('region', { name: 'Encryption keys' });
      expect(bloco.compareDocumentPosition(chaves) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await userEvent.click(resumo);
      expect(bloco.open).toBe(true);
      await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
    });

    it('deve abrir o primeiro cartão Quando a rota não diz a seção', async () => {
      windowClass.set('medium');
      await ready();

      expect(fold('Signature verification, Off').getAttribute('aria-expanded')).toBe('true');
      expect(fold('Response, 201').getAttribute('aria-expanded')).toBe('false');
    });

    it('não deve ter cabeçalho recolhível Quando a janela é larga', async () => {
      await ready();

      expect(screen.queryByRole('button', { name: 'Response, 201' })).toBeNull();
      expect(screen.getByRole('list', { name: 'How decryption works' }).closest('details')).toBe(
        null,
      );
    });
  });
});

describe('Dado os atalhos "On this page" de Checks', () => {
  afterEach(() => clearTranslations());

  it('deve traduzir os rótulos Quando a tela está em pt-BR', () => {
    loadTranslations(translations);

    expect(checksSections().map((section) => section.label)).toEqual([
      'Assinatura',
      'Schema',
      'Resposta',
      'Privacidade',
      'Decifra',
      'Saúde',
    ]);
  });
});
