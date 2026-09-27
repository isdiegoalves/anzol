import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import { cliListenCommand } from './token';
import { TokenStore } from './token-store';

/**
 * "Copy CLI command" (INBOX-04): copia o `anzol listen` que encaminha as mensagens da URL aberta
 * para o app local e diz se copiou. Roda na hora do clique, fora do chunk de `TokenActions`: depois
 * de um `import()`, o gesto do usuário que a cópia pede pode já ter passado (o aviso pode esperar).
 * Chame num contexto de injeção.
 */
export function injectCopyCliCommand(): () => boolean {
  const clipboard = inject(Clipboard);
  const tokens = inject(TokenStore);
  const origin = inject(DOCUMENT).location.origin;
  return () => {
    const token = tokens.token();
    return token !== null && clipboard.copy(cliListenCommand(origin, token.uuid));
  };
}
