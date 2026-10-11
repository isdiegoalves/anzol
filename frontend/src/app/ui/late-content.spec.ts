import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/angular';
import { LateContent } from './late-content';

describe('Dado a região viva que só existe enquanto tem o que dizer (appLateContent)', () => {
  const TEMPLATE = `
    @if (on) {
      <p role="status"><ng-container *appLateContent>Saved {{ name }}.</ng-container></p>
    }
  `;

  it('deve criar a região vazia e pôr o conteúdo numa tarefa depois', async () => {
    const { rerender, fixture } = await render(TEMPLATE, {
      imports: [LateContent],
      componentProperties: { on: false, name: 'Pix' },
    });
    const seen: string[] = [];
    new MutationObserver(() =>
      seen.push(screen.queryByRole('status')?.textContent ?? 'sem região'),
    ).observe(fixture.nativeElement, { subtree: true, childList: true, characterData: true });

    await rerender({ componentProperties: { on: true, name: 'Pix' } });
    expect(screen.getByRole('status').textContent).toBe('');

    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved Pix.'));
    expect(seen).toEqual(['', 'Saved Pix.']);
  });

  it('não deve pôr o conteúdo Quando a região sai antes dele', async () => {
    const { rerender, fixture } = await render(TEMPLATE, {
      imports: [LateContent],
      componentProperties: { on: true, name: 'Pix' },
    });

    await rerender({ componentProperties: { on: false, name: 'Pix' } });
    await new Promise((done) => setTimeout(done, 20));

    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
});

describe('Dado as regiões vivas escritas nos templates', () => {
  /** As que existem desde que o componente nasce e só trocam o que há dentro: já nascem vazias. */
  const PERSISTENT = [
    'checks/e2ee-card.html',
    'checks/e2ee-lab.html',
    'checks/health-card.html',
    'guides/first-guide.html',
    'guides/retry-guide.html',
    'onboarding/onboarding.html',
    'rules/rule-from-request-dialog.html',
    'rules/rule-list-filter.ts',
    'ui/live-region.ts',
  ];
  const LIVE = /<[a-z][^<>]*?\s(?:role="status"|aria-live="(?:polite|assertive)")[^<>]*>/g;

  function sources(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        return sources(path);
      }
      return /\.(html|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('deve nascer vazia toda a que fica dentro de um bloco condicional', () => {
    const bornWithText = sources('src/app').flatMap((path) => {
      const file = path.replace(/^src\/app\//, '');
      if (PERSISTENT.includes(file)) {
        return [];
      }
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(LIVE)]
        .filter(
          (tag) =>
            !/^\s*<ng-container \*appLateContent/.test(text.slice(tag.index + tag[0].length)),
        )
        .map((tag) => `${file}: ${tag[0].replace(/\s+/g, ' ')}`);
    });

    expect(bornWithText).toEqual([]);
  });
});
