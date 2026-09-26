import { PORTA_LLM_FALSO, subirLlmFalso } from './llm-falso.js';

// `globalSetup` do Playwright: sobe o LLM falso no processo do runner, uma vez para todos os workers, e o
// derruba no fim. Porta já ocupada por outro LLM falso (outra execução do contrato) → reaproveita, porque
// os roteiros são por marcador; ocupada por outra coisa → avisa e segue: só os testes da IA falham, com
// a mensagem do cliente do falso.
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  try {
    const servidor = await subirLlmFalso();
    return async () => {
      servidor.closeAllConnections();
      await new Promise<void>((ok) => servidor.close(() => ok()));
    };
  } catch (erro) {
    const saude = await fetch(`http://127.0.0.1:${PORTA_LLM_FALSO}/__falso/saude`).then((r) => r.ok, () => false);
    if (!saude) console.warn(`LLM falso não subiu na porta ${PORTA_LLM_FALSO}: ${String(erro)}. Os testes da IA vão falhar.`);
    return undefined;
  }
}
