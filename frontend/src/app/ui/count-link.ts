import { LocationStrategy } from '@angular/common';
import { Directive, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

/** Os parâmetros da rota da Entrada que filtram a mesma contagem; vazio é a Entrada sem filtro. */
export type CountFilter = Readonly<Record<string, string>>;

/**
 * O motivo vai com a frase crua do servidor. Saúde e Métricas usam esta mesma função, para os dois
 * links saírem iguais.
 */
export function signatureReasonFilter(reason: string): CountFilter {
  return {
    signature: /^header \S+ absent$/.test(reason) ? 'absent' : 'invalid',
    signatureReason: reason,
  };
}

/** O motivo vai como o servidor o grava (`downgrade`); só a decifra inválida tem motivo. */
export function decryptionReasonFilter(reason: string): CountFilter {
  return { decryption: 'invalid', decryptionReason: reason };
}

/** `path` é JSON Pointer: `''` é a raiz, não "sem caminho". */
export function schemaPathFilter(path: string): CountFilter {
  return { schema: 'invalid', schemaPath: path };
}

/** Sobre quantas requisições o número foi contado (`evaluated`) e quantas a URL guarda (`total`). */
export interface CountScope {
  evaluated: number;
  total: number;
}

/**
 * Número de Saúde ou de Métricas que leva à Entrada com o filtro exato da contagem; é o único lugar
 * que monta esse endereço. Se a contagem cobriu só as mais novas, leva `window={n}` junto.
 */
@Directive({
  selector: 'a[appCountLink]',
  host: {
    '[attr.href]': 'href()',
    '[attr.aria-label]': 'name()',
    '(click)': 'navigate($event)',
  },
})
export class CountLink {
  private readonly router = inject(Router);
  private readonly location = inject(LocationStrategy);

  /** A URL (o UUID do token). */
  readonly appCountLink = input.required<string>();
  readonly countFilter = input<CountFilter>({});
  readonly count = input.required<number>();
  readonly what = input<string>('');
  readonly countScope = input<CountScope | null>(null);
  readonly countName = input<string | null>(null);

  private readonly tree = computed(() => {
    const scope = this.countScope();
    const cut = scope !== null && scope.total > scope.evaluated;
    return this.router.createUrlTree(['/', this.appCountLink()], {
      queryParams: { ...this.countFilter(), ...(cut && { window: String(scope.evaluated) }) },
    });
  });
  protected readonly href = computed(() =>
    this.location.prepareExternalUrl(this.router.serializeUrl(this.tree())),
  );
  protected readonly name = computed(() => {
    const given = this.countName();
    if (given !== null) {
      return given;
    }
    const what = this.what();
    const count = this.count();
    return count === 1
      ? $localize`${what}:what:, 1 request. Open in the Inbox`
      : $localize`${what}:what:, ${count}:count: requests. Open in the Inbox`;
  });

  /** Com modificador, o navegador abre o `href` (outra aba); sem, `false` evita recarregar a página. */
  protected navigate(event: MouseEvent): boolean {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return true;
    }
    void this.router.navigateByUrl(this.tree());
    return false;
  }
}
