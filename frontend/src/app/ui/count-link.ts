import { LocationStrategy } from '@angular/common';
import { Directive, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

/**
 * O filtro exato de uma contagem, nos parâmetros da rota da Entrada (`signature`,
 * `signatureReason`, `schema`, `schemaPath`, `outcome`, `rule`, `ruleName`, `methods` e, da B2,
 * `answered` com o status exato). Vazio: a Entrada sem filtro.
 */
export type CountFilter = Readonly<Record<string, string>>;

/**
 * M1: um motivo de assinatura, pela frase crua do servidor, junto do estado largo que a Entrada já
 * tinha (o header ausente é "absent"; o resto, "invalid"). Saúde e Métricas usam esta mesma função,
 * então os dois links saem iguais.
 */
export function signatureReasonFilter(reason: string): CountFilter {
  return {
    signature: /^header \S+ absent$/.test(reason) ? 'absent' : 'invalid',
    signatureReason: reason,
  };
}

/** M1: um caminho de erro de schema (JSON Pointer; `''` é a raiz), junto do "Schema invalid". */
export function schemaPathFilter(path: string): CountFilter {
  return { schema: 'invalid', schemaPath: path };
}

/** Sobre quantas requisições o número foi contado (`evaluated`) e quantas a URL guarda (`total`). */
export interface CountScope {
  evaluated: number;
  total: number;
}

/**
 * F1 (UX-18): um número de Saúde ou de Métricas que conta requisições vira link para a Entrada com
 * o filtro exato daquela contagem, para o número do link e o da lista baterem. É o único lugar que
 * monta esse endereço. Quando a contagem cobriu só as mais novas (a URL guarda mais que a janela),
 * o link leva `window={n}`, e a Entrada conta sobre as mesmas n.
 *
 * O nome acessível é "{what}, {n} requests. Open in the Inbox"; `countName` o troca quando a linha
 * já diz tudo (as linhas de "Answers by status").
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
  /** O que foi contado ("timestamp outside tolerance"), no começo do nome acessível. */
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

  /** Clique simples navega sem recarregar; com modificador, o navegador abre o `href` (outra aba). */
  protected navigate(event: MouseEvent): boolean {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return true;
    }
    void this.router.navigateByUrl(this.tree());
    return false;
  }
}
