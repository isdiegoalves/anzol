import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { HistoryTestPanel } from './history-test-panel';
import { HistoryTest } from './rule';

describe('Dado o resultado do teste contra o histórico', () => {
  const render = async (result: HistoryTest) => {
    const fixture = TestBed.createComponent(HistoryTestPanel);
    fixture.componentRef.setInput('result', result);
    fixture.componentRef.setInput('tokenId', TOKEN_ID);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (element: HTMLElement, selector: string) =>
    element.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

  it('deve dizer que não há mensagens Quando a URL ainda não recebeu nenhuma', async () => {
    const element = await render({ tested: 0, matched: 0, misses: [], windowFull: false });

    expect(text(element, '.summary')).toBe('No recorded requests to test against.');
    expect(element.querySelector('.misses')).toBeNull();
  });

  it('deve dizer que todas casariam, no singular, Quando a única mensagem casa', async () => {
    const element = await render({ tested: 1, matched: 1, misses: [], windowFull: false });

    expect(text(element, '.summary')).toBe('1 of 1 recorded request would match.');
    expect(element.querySelector('.misses')).toBeNull();
    expect(element.querySelector('.window')).toBeNull();
  });

  it('deve avisar que só as 500 mais recentes entraram Quando o teste cobriu 500 mensagens', async () => {
    const element = await render({ tested: 500, matched: 500, misses: [], windowFull: true });

    expect(text(element, '.window')).toBe('Only the 500 most recent requests were tested.');
  });

  it('deve listar as que não casariam com o link da mensagem na página certa', async () => {
    const uuid = 'abcdef12-0000-4000-8000-000000000001';
    const element = await render({
      tested: 3,
      matched: 1,
      misses: [
        { uuid, seq: 2, failed: ['header x-signature: absent'], page: 4 },
        { uuid: 'fedcba98-0000-4000-8000-000000000002', seq: 1, failed: ['x'], page: 4 },
      ],
      windowFull: false,
    });

    expect(text(element, 'h4')).toBe('Would not match (2)');
    const link = element.querySelector<HTMLAnchorElement>('.misses a');
    expect(link?.getAttribute('href')).toBe(`#/${TOKEN_ID}/${uuid}/4`);
    expect(link?.getAttribute('aria-label')).toBe(`Open request ${uuid}`);
    expect(text(element, '.misses .failed')).toBe('header x-signature: absent');
  });
});
