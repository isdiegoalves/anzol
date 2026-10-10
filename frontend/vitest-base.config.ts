import { defineConfig } from 'vitest/config';

const seed = process.env['VITEST_SEED'];

export default defineConfig({
  test: {
    // Os testes que montam a tela com harness e axe passam de 5 s com a máquina ocupada; o teto
    // existe para pegar teste travado, não para medir velocidade.
    testTimeout: 15_000,
    sequence: { shuffle: true, ...(seed ? { seed: Number(seed) } : {}) },
  },
});
