/**
 * Limpeza ao fim de cada teste, passe ou falhe: processos do CLI, servidores locais e tokens
 * criados na 8084. Roda em ordem inversa ao registro (o CLI morre antes de o token sumir).
 */
const pendentes = [];

export function aoFinal(fn) {
  pendentes.push(fn);
}

export async function limparTudo() {
  const erros = [];
  while (pendentes.length > 0) {
    const fn = pendentes.pop();
    try {
      await fn();
    } catch (e) {
      erros.push(e);
    }
  }
  if (erros.length > 0) throw new AggregateError(erros, `falha na limpeza: ${erros.map((e) => e.message).join('; ')}`);
}
