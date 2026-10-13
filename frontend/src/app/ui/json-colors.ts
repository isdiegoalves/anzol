import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { jsonTokens } from './json-tokens';

/** O que a camada copia da `textarea` para o texto dela cair no mesmo lugar. */
const COPIED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

/**
 * As cores de JSON do `app-code-view` sobre a `textarea` que vem dentro dele, que continua sendo o
 * campo: é com ela que o leitor de tela, o teclado, a seleção e o desfazer falam. Só o JSON válido
 * ganha cor; o resto fica como texto simples (com `partial`, também o JSON pela metade, para o campo
 * que só recebe JSON). A camada some no alto contraste.
 */
@Component({
  selector: 'app-json-colors',
  template: `@if (tokens(); as pieces) {
      <pre
        class="colors"
        aria-hidden="true"
        inert
        #layer
      ><code>@for (token of pieces; track $index) {<span [class]="'t-' + token.kind">{{ token.text }}</span>}</code></pre>
    }
    <ng-content />`,
  styleUrl: './json-colors.scss',
  // A `textarea` é do template de quem usa: com o encapsulamento, os estilos daqui não a alcançariam.
  encapsulation: ViewEncapsulation.None,
  host: { '[class.colored]': 'tokens() !== null' },
})
export class JsonColors {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly text = input.required<string>();
  readonly partial = input(false, { transform: booleanAttribute });

  protected readonly tokens = computed(() =>
    this.partial() || isJson(this.text()) ? jsonTokens(this.text()) : null,
  );
  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer');

  constructor() {
    const follow = () => this.follow();
    afterNextRender(() => this.area()?.addEventListener('scroll', follow));
    inject(DestroyRef).onDestroy(() => this.area()?.removeEventListener('scroll', follow));
    afterRenderEffect(() => {
      const layer = this.layer()?.nativeElement;
      const area = this.area();
      // O texto novo pode ter outra altura: a camada volta a acompanhar a rolagem.
      this.tokens();
      if (!layer || !area) {
        return;
      }
      const style = getComputedStyle(area);
      for (const property of COPIED) {
        layer.style[property] = style[property];
      }
      this.follow();
    });
  }

  private area(): HTMLTextAreaElement | null {
    return this.host.querySelector('textarea');
  }

  private follow(): void {
    const layer = this.layer()?.nativeElement;
    const area = this.area();
    if (layer && area) {
      layer.scrollTop = area.scrollTop;
      layer.scrollLeft = area.scrollLeft;
    }
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
