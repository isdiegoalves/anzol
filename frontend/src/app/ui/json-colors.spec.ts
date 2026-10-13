import { Component, signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { JsonColors } from './json-colors';

@Component({
  imports: [JsonColors],
  template: `
    <label for="corpo">Corpo</label>
    <app-json-colors [text]="text()" [partial]="partial()">
      <textarea id="corpo" [value]="text()"></textarea>
    </app-json-colors>
  `,
})
class Host {
  readonly text = signal('{"ok": true}');
  readonly partial = signal(false);
}

describe('Dado as cores de JSON sobre uma textarea (app-json-colors)', () => {
  const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Corpo' });
  const wrapper = (container: Element) => container.querySelector('app-json-colors') as HTMLElement;
  const layer = (container: Element) => wrapper(container).querySelector<HTMLElement>('.colors');
  const colored = (container: Element) =>
    [...(layer(container)?.querySelectorAll('span') ?? [])]
      .filter((span) => span.className !== 't-text')
      .map((span) => [span.className, span.textContent]);

  it('deve repetir o JSON válido numa camada colorida, fora do que o leitor de tela e o teclado alcançam', async () => {
    const { container } = await render(Host);

    expect(layer(container)?.textContent).toBe('{"ok": true}');
    expect(colored(container)).toEqual([
      ['t-punct', '{'],
      ['t-key', '"ok"'],
      ['t-punct', ':'],
      ['t-literal', 'true'],
      ['t-punct', '}'],
    ]);
    expect(layer(container)?.getAttribute('aria-hidden')).toBe('true');
    expect(layer(container)?.hasAttribute('inert')).toBe(true);
    expect(wrapper(container).classList.contains('colored')).toBe(true);
    expect(field().parentElement).toBe(wrapper(container));
    await expectNoAxeViolations(container);
  });

  it.each([
    ['texto simples', 'pedido recebido'],
    ['um template', '{"id": {{jsonPath request.body \'$.id\'}}}'],
    ['JSON pela metade', '{"ok": '],
    ['vazio', ''],
  ])('deve ficar sem camada Quando o texto é %s', async (_caso, text) => {
    const { container, fixture } = await render(Host);

    fixture.componentInstance.text.set(text);
    fixture.detectChanges();

    expect(layer(container)).toBeNull();
    expect(wrapper(container).classList.contains('colored')).toBe(false);
  });

  it('deve colorir também o JSON pela metade Quando o campo só recebe JSON (partial)', async () => {
    const { container, fixture } = await render(Host);

    fixture.componentInstance.partial.set(true);
    fixture.componentInstance.text.set('{"ok": ');
    fixture.detectChanges();

    expect(colored(container)).toEqual([
      ['t-punct', '{'],
      ['t-key', '"ok"'],
      ['t-punct', ':'],
    ]);
  });

  it('deve rolar a camada junto com a textarea', async () => {
    const { container } = await render(Host);

    field().scrollTop = 40;
    field().scrollLeft = 12;
    field().dispatchEvent(new Event('scroll'));

    expect([layer(container)?.scrollLeft, layer(container)?.scrollTop]).toEqual([12, 40]);
  });
});
