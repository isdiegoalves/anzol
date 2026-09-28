import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { Component, Injectable, inject, input, linkedSignal, signal } from '@angular/core';
import { RequestStore } from '../requests/request-store';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { outsideWaitFor, waitForCommand } from './request-filter';

/**
 * "Copy as anzol wait-for" (S10): copia o comando com os filtros ligados. Só o `match` vai para o
 * comando; com a URL protegida, o segredo vem da variável. O aviso do que foi copiado fica na
 * busca da lista, e some quando o filtro muda.
 */
@Injectable({ providedIn: 'root' })
export class WaitFor {
  private readonly store = inject(RequestStore);
  private readonly tokens = inject(TokenStore);
  private readonly clipboard = inject(Clipboard);
  private readonly origin = inject(DOCUMENT).location.origin;

  /** O que foi copiado, com o aviso do que ficou de fora; `null` depois que o filtro muda. */
  readonly copied = linkedSignal<unknown, string | null>({
    source: () => this.store.filter(),
    computation: () => null,
  });

  /** O texto que está na busca agora, mesmo antes de a busca rodar (a espera da digitação). */
  readonly typed = signal<string | null>(null);

  copy(): void {
    const token = this.tokens.token();
    if (!token) {
      return;
    }
    const filter = { ...this.store.filter(), text: this.typed() ?? this.store.filter().text };
    this.clipboard.copy(
      waitForCommand(filter, {
        server: this.origin,
        tokenId: token.uuid,
        protected: token.protected === true,
      }),
    );
    this.copied.set(copiedMessage(outsideWaitFor(filter)));
  }
}

/**
 * O botão: de ícone na linha do cabeçalho da lista (sem filtro também fica à vista, INBOX-10), ou
 * com o texto, no painel de filtros do celular.
 */
@Component({
  selector: 'app-wait-for-button',
  imports: [Icon],
  template: `
    @if (text()) {
      <button type="button" class="link" (click)="waitFor.copy()">{{ label }}</button>
    } @else {
      <button
        type="button"
        class="icon"
        [attr.aria-label]="label"
        [attr.title]="label"
        (click)="waitFor.copy()"
      >
        <app-icon name="clipboard" [size]="20" />
      </button>
    }
  `,
  styles: `
    button {
      border: 0;
      background: transparent;
      cursor: pointer;

      &:focus-visible {
        outline: 3px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      padding: 0;
      border-radius: var(--mat-sys-corner-full);
      color: var(--mat-sys-on-surface-variant);

      &:hover {
        background: var(--mat-sys-surface-container-highest);
      }
    }

    .link {
      min-height: 48px;
      padding: 0 8px;
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-large);
    }
  `,
})
export class WaitForButton {
  protected readonly waitFor = inject(WaitFor);
  /** Com o texto à vista, no lugar do ícone. */
  readonly text = input(false);
  protected readonly label = $localize`Copy as anzol wait-for`;
}

/**
 * O aviso do "Copy as anzol wait-for": o comando só leva o `match`, então diz o que ficou de fora
 * (o texto, o desfecho, o motivo exato e o caminho do schema, M1), para não sugerir um filtro que o
 * wait-for não entende.
 */
function copiedMessage(outside: ReturnType<typeof outsideWaitFor>): string {
  if (outside.length === 0) {
    return $localize`Copied the anzol wait-for command.`;
  }
  if (outside.length === 1 && outside[0] === 'text') {
    return $localize`Copied. The text search is not part of wait-for: only the filters went into --match.`;
  }
  const names = {
    text: $localize`the text search`,
    outcome: $localize`the answered-by filter`,
    reason: $localize`the signature reason`,
    path: $localize`the schema error path`,
  };
  const left = outside.map((part) => names[part]).join(', ');
  return $localize`Copied. wait-for only reads --match, so these filters were left out: ${left}:filters:.`;
}
