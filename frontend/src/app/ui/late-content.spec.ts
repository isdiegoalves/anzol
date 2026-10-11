import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/angular';
import { LateContent } from './late-content';
import { SPOKEN_AFTER_MS } from './live-region';

describe('Dado a região viva que só existe enquanto tem o que dizer (appLateContent)', () => {
  const TEMPLATE = `
    @if (on) {
      <p role="status"><span appLateContent>Saved {{ name }}.</span></p>
    }
  `;
  const show = async (on: boolean) =>
    render(TEMPLATE, { imports: [LateContent], componentProperties: { on, name: 'Pix' } });
  const phrase = () => screen.getByRole('status').firstElementChild as HTMLElement;

  afterEach(() => vi.useRealTimers());

  it('deve pôr a frase na tela na hora, escondida do leitor, e mostrá-la a ele depois do intervalo do anunciador do CDK', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fixture } = await show(true);
    const inserted: string[] = [];
    new MutationObserver((records) =>
      records.forEach((record) =>
        record.addedNodes.forEach((node) => inserted.push(node.textContent ?? '')),
      ),
    ).observe(fixture.nativeElement, { subtree: true, childList: true });

    expect(phrase().textContent).toBe('Saved Pix.');
    expect(phrase().getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(SPOKEN_AFTER_MS - 1);
    expect(phrase().getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(1);
    expect(phrase().hasAttribute('aria-hidden')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Saved Pix.');
    await Promise.resolve();
    expect(inserted).toEqual(['Saved Pix.']);
  });

  it('não deve mexer na frase Quando a região sai antes do intervalo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { rerender, fixture } = await show(true);

    await rerender({ componentProperties: { on: false, name: 'Pix' } });
    vi.advanceTimersByTime(SPOKEN_AFTER_MS);

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
  /** Logo dentro da região, a frase num `span appLateContent` (um ícone pode vir antes dela). */
  const FIRST_IS_LATE = /^\s*(?:<app-icon[^<>]*\/>\s*)?<span\s+appLateContent[\s>]/;

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
        .filter((tag) => !FIRST_IS_LATE.test(text.slice(tag.index + tag[0].length)))
        .map((tag) => `${file}: ${tag[0].replace(/\s+/g, ' ')}`);
    });

    expect(bornWithText).toEqual([]);
  });
});
