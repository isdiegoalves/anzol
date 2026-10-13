import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { JsonEditor } from './json-editor';

@Component({
  imports: [JsonEditor, ReactiveFormsModule],
  template: `
    <label for="campo">Schema</label>
    <app-json-editor
      inputId="campo"
      [formControl]="control"
      [invalid]="invalid()"
      [describedBy]="'ajuda'"
    />
    <p id="ajuda">Ajuda</p>
  `,
})
class Host {
  readonly control = new FormControl('{\n  "id": 42\n}', { nonNullable: true });
  readonly invalid = signal(false);
}

describe('Dado o editor de JSON (app-json-editor)', () => {
  const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Schema' });
  const colors = (container: Element) => container.querySelector('.colors') as HTMLElement;
  const colored = (container: Element) =>
    [...colors(container).querySelectorAll('span')]
      .filter((span) => span.className !== 't-text')
      .map((span) => [span.className, span.textContent]);

  it('deve mostrar o valor do controle na textarea, com os números de linha, e passar no axe', async () => {
    const { container } = await render(Host);

    expect(field().value).toBe('{\n  "id": 42\n}');
    expect(field().getAttribute('aria-describedby')).toBe('ajuda');
    expect(container.querySelector('.gutter')?.textContent).toBe('1\n2\n3');
    await expectNoAxeViolations(container);
  });

  it('deve repetir o texto numa camada colorida, fora do que o leitor de tela lê', async () => {
    const { container } = await render(Host);

    expect(colors(container).textContent).toBe(field().value);
    expect(colors(container).getAttribute('aria-hidden')).toBe('true');
    expect(colored(container)).toEqual([
      ['t-punct', '{'],
      ['t-key', '"id"'],
      ['t-punct', ':'],
      ['t-number', '42'],
      ['t-punct', '}'],
    ]);
  });

  it('deve levar ao controle e à camada o que é digitado, e marcá-lo como tocado ao sair', async () => {
    const { container, fixture } = await render(Host);
    const { control } = fixture.componentInstance;

    await userEvent.clear(field());
    await userEvent.type(field(), '[[true');
    expect(control.value).toBe('[true');
    expect(colors(container).textContent).toBe('[true');
    expect(colored(container)).toEqual([
      ['t-punct', '['],
      ['t-literal', 'true'],
    ]);
    expect(control.touched).toBe(false);

    await userEvent.tab();
    expect(control.touched).toBe(true);
  });

  it('deve mostrar na textarea e na camada o valor que o formulário troca', async () => {
    const { container, fixture } = await render(Host);

    fixture.componentInstance.control.setValue('"novo"');
    fixture.detectChanges();

    expect(field().value).toBe('"novo"');
    expect(colored(container)).toEqual([['t-string', '"novo"']]);
  });

  it('deve dizer que o campo é inválido Quando quem o usa diz', async () => {
    const { container, fixture } = await render(Host);
    expect(field().getAttribute('aria-invalid')).toBeNull();

    fixture.componentInstance.invalid.set(true);
    fixture.detectChanges();

    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('app-json-editor')?.classList.contains('invalid')).toBe(true);
  });

  it('deve rolar os números e as cores junto com a textarea', async () => {
    const { container } = await render(Host);
    const gutter = container.querySelector('.gutter') as HTMLElement;

    field().scrollTop = 40;
    field().scrollLeft = 12;
    field().dispatchEvent(new Event('scroll'));

    expect(gutter.scrollTop).toBe(40);
    expect((colors(container).firstElementChild as HTMLElement).style.transform).toBe(
      'translate(-12px, -40px)',
    );
  });
});
