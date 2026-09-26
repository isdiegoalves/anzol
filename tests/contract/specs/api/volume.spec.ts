import { JSON_ACCEPT, disparar, expect, test, type Listagem } from '../../support/contrato.js';

// Listagem com a maior opção da limpeza automática cheia (plano de features, item 02). No app
// Laravel, 10.000 mensagens de 15 KB derrubavam a listagem (500, corpo vazio: memory_limit do PHP);
// o custo de uma página não pode depender do total da URL.

const QUANTIDADE = 10_000;
const CORPO = JSON.stringify({ dados: 'x'.repeat(15_000) });

/** Teto generoso para uma página de 50 itens, medido no cliente (inclui rede local e JSON). */
const PRAZO_POR_PAGINA_MS = 2_000;

test('10.000 mensagens de ~15 KB: cada página responde 200 com 50 itens em até 2 s', async ({ request, tokens }) => {
  test.setTimeout(900_000);
  const token = await tokens.criar({ auto_cleanup: 10000 });
  await disparar(request, token.uuid, QUANTIDADE, {
    paralelas: 20,
    opcoes: { method: 'POST', data: CORPO, headers: { 'Content-Type': 'application/json' } },
  });

  const paginas: Array<[string, number]> = [
    ['', 1],
    ['sorting=newest', 1],
    ['page=100', 100],
    ['sorting=newest&page=200', 200],
  ];
  for (const [query, pagina] of paginas) {
    const inicio = performance.now();
    const res = await request.get(`/token/${token.uuid}/requests${query ? `?${query}` : ''}`, { headers: JSON_ACCEPT });
    const corpo = (await res.json()) as Listagem;
    const decorrido = performance.now() - inicio;

    expect(res.status(), query).toBe(200);
    expect(corpo.total, query).toBe(QUANTIDADE);
    expect(corpo.current_page, query).toBe(pagina);
    expect(corpo.data, query).toHaveLength(50);
    expect(corpo.is_last_page, query).toBe(pagina === 200);
    expect(corpo.data[0]!.content, query).toBe(CORPO);
    expect(decorrido, `GET ?${query} levou ${Math.round(decorrido)} ms`).toBeLessThanOrEqual(PRAZO_POR_PAGINA_MS);
  }
});
