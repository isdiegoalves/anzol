import { TestBed } from '@angular/core/testing';
import { expectNoAxeViolations } from '../../testing/axe';
import { MarkdownView } from './markdown-view';

describe('Dado o texto do modelo na tela', () => {
  const render = async (text: string) => {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('text', text);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('deve mostrar parágrafo, lista, código e negrito como elementos Quando o texto é markdown', async () => {
    const element = await render(
      'A assinatura **não confere**.\n\n- header `X-Signature`\n- corpo alterado\n\n```\nsha256=abc\n```',
    );

    expect(element.querySelector('p strong')?.textContent).toBe('não confere');
    expect([...element.querySelectorAll('ul li')].map((li) => li.textContent?.trim())).toEqual([
      'header X-Signature',
      'corpo alterado',
    ]);
    expect(element.querySelector('li code')?.textContent).toBe('X-Signature');
    expect(element.querySelector('pre code')?.textContent).toBe('sha256=abc');
    await expectNoAxeViolations(element);
  });

  it('deve mostrar o HTML do modelo como texto, sem criar elementos Quando o texto tem tags e script', async () => {
    const hostile =
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:x">y</a>';
    const element = await render(`${hostile}\n\n- <b>item</b>\n\n\`<i>code</i>\``);

    expect(element.querySelector('img, script, a, b, i')).toBeNull();
    expect(element.querySelector('p')?.textContent).toBe(hostile);
    expect(element.querySelector('li')?.textContent?.trim()).toBe('<b>item</b>');
    expect(element.querySelector('code')?.textContent).toBe('<i>code</i>');
  });
});
