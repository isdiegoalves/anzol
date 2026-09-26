// Proxy do `ng serve` para o backend. Troque o destino com BACKEND_URL:
//   npx ng serve                                    → app atual (http://localhost:8084)
//   BACKEND_URL=http://localhost:8086 npx ng serve  → backend Kotlin
const target = process.env.BACKEND_URL ?? 'http://localhost:8084';

// changeOrigin: false mantém o Host do navegador, então a URL gravada na mensagem é a mesma
// que a tela mostra (http://localhost:4200/{uuid}), como quando o backend serve a tela.
const backend = { target, changeOrigin: false, secure: false };

export default {
  // API REST e o stream SSE (/token/{id}/stream).
  '/token/**': backend,
  // URL do webhook (/{uuid} e /{uuid}/qualquer/coisa), para a URL exibida na tela funcionar.
  '^/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/.*)?$': backend,
};
