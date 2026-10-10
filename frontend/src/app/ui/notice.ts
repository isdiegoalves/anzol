/** Quanto um aviso de confirmação (snackbar) fica à vista: tempo de ler a frase inteira. */
export const NOTICE_MS = 4_000;

/** O navegador não deixou copiar (sem permissão, ou a página sem o foco). */
export function copyFailedText(): string {
  return $localize`Could not copy. Select the text and copy it.`;
}

/** O DELETE de uma requisição falhou (0 sem resposta): ela volta à lista. */
export function deleteFailedText(status: number): string {
  return $localize`Could not delete (${status}:status:). The request is still here.`;
}
