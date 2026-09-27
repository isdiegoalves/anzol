import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { Viewport, WindowClass } from '../shell/viewport';
import { Rule } from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore } from './rule-store';

const URL_REGRAS = `/token/${TOKEN_ID}/rules`;
const isLatestRequest = (req: HttpRequest<unknown>) =>
  req.url.endsWith('/requests') && req.params.get('sorting') === 'newest';

/**
 * O editor como folha abaixo de 1200 px (F8: "Back to list", ⋮ "More actions", "Details").
 */
describe('Dado o editor numa janela estreita (F8)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RuleEditor>;
  const windowClass = signal<WindowClass>('expanded');
  const closed = vi.fn();

  const open = async (data: RuleEditorData, rules: Rule[]) => {
    const store = TestBed.inject(RuleStore);
    const loaded = store.load(TOKEN_ID);
    http.expectOne(URL_REGRAS).flush(rules);
    await loaded;
    fixture = TestBed.createComponent(RuleEditor);
    fixture.componentRef.setInput('data', data);
    fixture.componentInstance.closed.subscribe(closed);
    await fixture.whenStable();
    for (const call of http.match(isLatestRequest)) {
      call.flush(requestPage([]));
    }
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    closed.mockReset();
    windowClass.set('expanded');
    TestBed.configureTestingModule({
      imports: [RuleEditor],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Viewport, useValue: { windowClass } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deve abrir como folha com "Back to list", Save e ⋮, sem Discard nem Delete à vista', async () => {
    const root = await open({ index: 0 }, [rule(1)]);
    const header = within(root.querySelector('.editor-header') as HTMLElement);

    expect(root.classList).toContain('sheet');
    expect(header.getByRole('button', { name: 'Back to list' })).toBeTruthy();
    expect(header.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(header.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(header.queryByRole('button', { name: 'Delete rule' })).toBeNull();
    await expectNoAxeViolations(root);

    await userEvent.click(header.getByRole('button', { name: 'More actions' }));
    const itens = await screen.findAllByRole('menuitem');
    expect(itens.map((item) => item.textContent?.trim())).toEqual([
      'Duplicate rule',
      'Delete rule',
      'Discard',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Discard' }));
    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(false));
  });

  it('deve voltar à lista pelo "Back to list" e recolher prioridade e Enabled em "Details"', async () => {
    const root = await open({ index: 0 }, [rule(1, { priority: 2 })]);

    const details = root.querySelector('.editor-header details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent?.trim()).toBe(
      'Details (Priority 2 · Enabled)',
    );
    expect(details.querySelector('input[aria-label="Priority"]')).not.toBeNull();
    await userEvent.click(within(root).getByRole('button', { name: 'Back to list' }));
    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(false));
  });

  it('deve ter o cabeçalho de sempre na largura grande', async () => {
    windowClass.set('large');
    const root = await open({ index: 0 }, [rule(1)]);

    expect(root.classList).not.toContain('sheet');
    expect(within(root).queryByRole('button', { name: 'Back to list' })).toBeNull();
    expect(within(root).getByRole('button', { name: 'Discard' })).toBeTruthy();
  });
});
