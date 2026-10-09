import { signal } from '@angular/core';
import { Viewport, WindowClass } from '../shell/viewport';
import { WebhookRequest } from '../requests/webhook-request';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import type { Mock } from 'vitest';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Rule } from './rule';
import { RuleDrafts } from './rule-draft';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const DRAFT_R1 = `draft:${TOKEN_ID}:rule:r1`;
const DRAFT_NEW = `draft:${TOKEN_ID}:rule:new`;

/**
 * Proteção do editor (F1): Save e Test nunca desabilitados (WM-12), a guarda de rascunho em toda
 * saída e o rascunho da aba (E-04), os atalhos (WM-13) e a posição da regra nova (E-01, WM-21).
 */

/** `GET /requests` da mensagem mais nova (o exemplo do editor, WM-16). */
const isLatestRequest = (req: HttpRequest<unknown>) =>
  req.url.endsWith('/requests') &&
  req.params.get('sorting') === 'newest' &&
  req.params.get('per_page') === '1';

describe('Dado o editor de regra com alterações', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleEditor>;
  let loader: HarnessLoader;
  let page: HarnessLoader;
  let closed: Mock<(saved: boolean) => void>;
  let onServer: Rule[] = [];

  const open = async (
    data: RuleEditorData,
    rules: Rule[] = [rule(1)],
    latest: WebhookRequest[] = [],
  ) => {
    onServer = rules;
    const store = TestBed.inject(RuleStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(URL_REGRAS).flush(rules);
    await loaded;
    fixture = TestBed.createComponent(RuleEditor);
    fixture.componentRef.setInput('data', data);
    fixture.componentInstance.closed.subscribe(closed);
    loader = TestbedHarnessEnvironment.loader(fixture);
    page = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await fixture.whenStable();
    // A mensagem de exemplo (WM-16): a mais nova da URL, quando o editor não recebeu uma.
    for (const call of http.match(isLatestRequest)) {
      call.flush(requestPage(latest));
    }
    await fixture.whenStable();
  };
  const root = () => fixture.nativeElement as HTMLElement;
  const input = (label: string) =>
    loader.getHarness(MatInputHarness.with({ selector: `[aria-label="${label}"]` }));
  const button = (text: string) => loader.getHarness(MatButtonHarness.with({ text }));
  const blockedText = () =>
    root().querySelector('.blocked[role="alert"]')?.textContent?.trim() ?? null;
  const put = async () => {
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: URL_REGRAS }))).flush(onServer);
    return vi.waitFor(() => http.expectOne({ method: 'PUT', url: URL_REGRAS }));
  };
  const dialog = () => page.getHarnessOrNull(MatDialogHarness);
  const dialogButton = async (text: string) =>
    (await vi.waitFor(() => page.getHarness(MatDialogHarness))).getHarness(
      MatButtonHarness.with({ text }),
    );
  const key = async (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };

  beforeEach(() => {
    sessionStorage.clear();
    closed = vi.fn();
    TestBed.configureTestingModule({
      imports: [RuleEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Largura grande: o cabeçalho com todos os botões (abaixo de 1200 px é a folha, F8).
        { provide: Viewport, useValue: { windowClass: signal<WindowClass>('large') } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('Dado o Save e o Test sempre habilitados (WM-12)', () => {
    it('deve abrir a aba do primeiro campo inválido, levar o foco a ele e resumir o que falta', async () => {
      await open({ index: 0 });
      await (await button('Add body field (JSONPath)')).click();
      await (await input('Status')).setValue('99');
      (root().querySelector('#rule-tab-test') as HTMLElement).click();
      await fixture.whenStable();

      await (await button('Save')).click();

      expect(blockedText()).toBe('To save, fix: Body 1 path (required), Status (100–599)');
      expect(root().querySelector('#rule-tab-match')?.getAttribute('aria-selected')).toBe('true');
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          root().querySelector('input[aria-label="Body 1 path"]'),
        ),
      );
      await expectNoAxeViolations(root());
    });

    it('deve seguir para a aba Response Quando o primeiro inválido está nela', async () => {
      await open({ index: 0 });
      await (await input('Status')).setValue('700');

      await (await button('Save')).click();

      expect(root().querySelector('#rule-tab-response')?.getAttribute('aria-selected')).toBe(
        'true',
      );
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(root().querySelector('input[aria-label="Status"]')),
      );
    });
  });

  describe('Dado a guarda de rascunho (E-04)', () => {
    it('não deve perguntar nada Quando não há alteração', async () => {
      await open({ index: 0 });

      await (await button('Discard')).click();

      expect(await dialog()).toBeNull();
      expect(closed).toHaveBeenCalledWith(false);
    });

    it('deve perguntar "Discard changes?" com "Keep editing" como foco inicial e continuar editando', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Pix pago');

      await (await button('Discard')).click();

      const confirm = await vi.waitFor(() => page.getHarness(MatDialogHarness));
      expect(await confirm.getTitleText()).toBe('Discard changes?');
      expect(await confirm.getContentText()).toBe('"Rule 1" has unsaved changes.');
      await vi.waitFor(() =>
        expect(document.activeElement?.textContent?.trim()).toBe('Keep editing'),
      );
      await expectNoAxeViolations(document.body);
      await (await dialogButton('Keep editing')).click();
      await vi.waitFor(async () => expect(await dialog()).toBeNull());
      expect(closed).not.toHaveBeenCalled();
      expect(await (await input('Name')).getValue()).toBe('Pix pago');
    });

    it('deve fechar e apagar o rascunho da aba Quando "Discard" é confirmado', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Pix pago');
      await vi.waitFor(() => expect(sessionStorage.getItem(DRAFT_R1)).not.toBeNull());

      await (await button('Discard')).click();
      await (await dialogButton('Discard')).click();

      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(false));
      expect(sessionStorage.getItem(DRAFT_R1)).toBeNull();
      // Saída confirmada: a rota que vem depois não pergunta de novo.
      expect(await fixture.componentInstance.confirmLeave()).toBe(true);
    });

    it('deve perguntar pela rota (outra regra, rail) e responder pelo diálogo', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Mudou');

      const leaving = fixture.componentInstance.confirmLeave();
      await (await dialogButton('Keep editing')).click();

      expect(await leaving).toBe(false);
    });

    it('deve pedir ao navegador para confirmar Quando a aba fecha com alterações', async () => {
      await open({ index: 0 });
      const antes = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(antes);
      expect(antes.defaultPrevented).toBe(false);

      await (await input('Name')).setValue('Mudou');
      const depois = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(depois);

      expect(depois.defaultPrevented).toBe(true);
    });
  });

  describe('Dado o rascunho na aba (E-04)', () => {
    it('deve gravar a regra sem os valores de cabeçalhos sensíveis, 300 ms depois da mudança', async () => {
      await open({ index: 0 }, [
        rule(1, {
          match: {
            method: [],
            path: null,
            query: {},
            headers: { Authorization: { equals: 'Bearer s3cr3t' }, 'X-Tenant': { equals: 'acme' } },
            body: [],
          },
        }),
      ]);

      await (await input('Name')).setValue('Com segredo');

      await vi.waitFor(() => expect(sessionStorage.getItem(DRAFT_R1)).not.toBeNull());
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_R1) ?? '{}');
      expect(draft.omitted).toBe(true);
      expect(draft.rule.name).toBe('Com segredo');
      expect(draft.rule.match.headers).toEqual({
        Authorization: { equals: '' },
        'X-Tenant': { equals: 'acme' },
      });
      expect(JSON.stringify(draft)).not.toContain('s3cr3t');
    });

    it.each(['beforeunload', 'pagehide'])(
      'deve gravar o rascunho na hora Quando a página recarrega antes dos 300 ms (%s)',
      async (evento) => {
        await open({ index: 0 });
        await (await input('Name')).setValue('Recarregou');
        expect(sessionStorage.getItem(DRAFT_R1)).toBeNull();

        window.dispatchEvent(new Event(evento, { cancelable: true }));

        expect(JSON.parse(sessionStorage.getItem(DRAFT_R1) ?? '{}').rule?.name).toBe('Recarregou');
      },
    );

    it('deve oferecer o rascunho ao reabrir a regra e restaurá-lo com o foco no nome', async () => {
      TestBed.inject(RuleDrafts).save(
        TOKEN_ID,
        'r1',
        { ...rule(1), name: 'Rascunho', response: { status: 503, headers: { Cookie: 'a=1' } } },
        Date.now() - 3 * 60_000,
      );
      await open({ index: 0 });

      const offer = root().querySelectorAll('.draft[role="alert"] p');
      expect([...offer].map((p) => p.textContent?.trim())).toEqual([
        'You have a draft from 3 minutes ago.',
        'Sensitive header values were not kept.',
      ]);
      await expectNoAxeViolations(root());
      await (await button('Restore draft')).click();

      expect(await (await input('Name')).getValue()).toBe('Rascunho');
      expect(await (await input('Status')).getValue()).toBe('503');
      expect(root().querySelector('.unsaved')).not.toBeNull();
      expect(root().querySelector('.draft')).toBeNull();
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(root().querySelector('.name-input')),
      );
    });

    it('deve apagar o rascunho Quando "Discard draft" é clicado', async () => {
      TestBed.inject(RuleDrafts).save(TOKEN_ID, undefined, { ...rule(9), name: 'Nova' });
      await open({ index: null });

      await (await button('Discard draft')).click();

      expect(root().querySelector('.draft')).toBeNull();
      expect(sessionStorage.getItem(DRAFT_NEW)).toBeNull();
      expect(await (await input('Name')).getValue()).toBe('');
    });

    it('deve apagar o rascunho Quando a regra é salva', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Salva');
      await vi.waitFor(() => expect(sessionStorage.getItem(DRAFT_R1)).not.toBeNull());

      await (await button('Save')).click();
      const call = await put();
      call.flush(call.request.body);

      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(true));
      expect(sessionStorage.getItem(DRAFT_R1)).toBeNull();
    });
  });

  describe('Dado os atalhos (WM-13)', () => {
    it('deve anunciar os atalhos no Save e no Test', async () => {
      await open({ index: 0 });

      const save = root().querySelector('.editor-header button[aria-keyshortcuts]');
      expect(save?.getAttribute('aria-keyshortcuts')).toBe('Control+S Meta+S');
      expect(save?.getAttribute('title')).toBe('Save · Ctrl+S');
      const test = root().querySelector('button.test');
      expect(test?.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
      expect(test?.getAttribute('title')).toBe('Test against history · Ctrl+Enter');
    });

    it('deve salvar com Ctrl+S mesmo com o foco no corpo da resposta, sem abrir o "Salvar página"', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Atalho');
      const corpo = root().querySelector('textarea[aria-label="Response body"]') as HTMLElement;

      const event = await key({ key: 's', ctrlKey: true }, corpo);

      expect(event.defaultPrevented).toBe(true);
      const call = await put();
      expect((call.request.body as Rule[])[0].name).toBe('Atalho');
      call.flush(call.request.body);
      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(true));
    });

    it('deve testar com Cmd+Enter', async () => {
      await open({ index: 0 });

      const event = await key({ key: 'Enter', metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      const test = await vi.waitFor(() =>
        http.expectOne({ method: 'POST', url: `${URL_REGRAS}/test` }),
      );
      test.flush({ matches: [], misses: [] });
      (await vi.waitFor(() => http.expectOne((req) => req.params.get('per_page') === '1'))).flush({
        data: [],
        total: 0,
      });
    });

    it('deve fechar com Esc, passando pela pergunta, mas não Quando o Esc já fechou outra coisa', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Mudou');

      const tratado = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      tratado.preventDefault();
      document.dispatchEvent(tratado);
      await fixture.whenStable();
      expect(await dialog()).toBeNull();

      await key({ key: 'Escape' });
      await (await dialogButton('Discard')).click();
      await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    });

    it('não deve salvar com Ctrl+S Quando um diálogo está aberto', async () => {
      await open({ index: 0 });
      await (await input('Name')).setValue('Mudou');
      await (await button('Discard')).click();
      await vi.waitFor(() => page.getHarness(MatDialogHarness));

      await key({ key: 's', ctrlKey: true });

      http.expectNone({ method: 'GET', url: URL_REGRAS });
      await (await dialogButton('Keep editing')).click();
    });
  });

  describe('Dado a posição da regra nova (E-01, WM-21)', () => {
    it('deve inserir a regra nova no índice pedido e avisar antes de qual pega-tudo ela entrou', async () => {
      await open({ index: null, insertAt: 1, placedBefore: 'Tudo o resto' }, [rule(1), rule(2)]);

      expect(root().querySelector('.placed[role="note"]')?.textContent?.trim()).toBe(
        'Placed before "Tudo o resto" so it can answer (same priority, earlier in the list).',
      );
      await (await input('Name')).setValue('Nova');
      await (await button('Save')).click();

      const call = await put();
      expect((call.request.body as Rule[]).map(({ name }) => name)).toEqual([
        'Rule 1',
        'Nova',
        'Rule 2',
      ]);
      call.flush(call.request.body);
    });

    it('deve emitir a regra como está no editor Quando "Duplicate rule" é clicado', async () => {
      await open({ index: 0 });
      const duplicated = vi.fn();
      fixture.componentInstance.duplicateRequested.subscribe(duplicated);
      await (await input('Name')).setValue('Editada');

      await (
        await loader.getHarness(
          MatButtonHarness.with({ selector: '[aria-label="Duplicate rule"]' }),
        )
      ).click();

      expect(duplicated).toHaveBeenCalledWith({ ...rule(1), name: 'Editada' });
    });

    it('deve abrir o "Describe the rule" expandido Quando pedido', async () => {
      await open({ index: null, openSuggest: true });

      expect((root().querySelector('details.suggest') as HTMLDetailsElement).open).toBe(true);
    });
  });
});
