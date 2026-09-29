// Proxy do `ng serve` para o backend (padrão: o app do docker compose em http://localhost:8084).
// Troque o destino com BACKEND_URL, ex.: BACKEND_URL=http://localhost:8080 npx ng serve.
const target = process.env.BACKEND_URL ?? 'http://localhost:8084';

// changeOrigin: false mantém o Host do navegador, então a URL gravada na mensagem é a mesma
// que a tela mostra (http://localhost:4200/{uuid}), como quando o backend serve a tela.
// Também é o que deixa as escritas passarem na conferência de Origin da gestão (item 12): o
// backend recebe `Host: localhost:4200` e `Origin: http://localhost:4200`, mesma porta e nome da
// lista `anzol.allowed-hosts`, então é "mesma origem". Com changeOrigin: true o Host viraria o
// do backend e todo POST/PUT/DELETE em /token levaria 403 "origin not allowed". Em outra porta
// (npx ng serve --port 4300) vale o mesmo; o nome precisa ser um da lista (localhost, 127.0.0.1).
const backend = { target, changeOrigin: false, secure: false };

export default {
  // API REST e o stream SSE (/token/{id}/stream).
  '/token/**': backend,
  // Leitura do link só-leitura (GET /share/{id}); a página dele é a rota #/share/{id}.
  '/share/**': backend,
  // URL do webhook (/{uuid} e /{uuid}/qualquer/coisa), para a URL exibida na tela funcionar.
  '^/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/.*)?$': backend,
};
