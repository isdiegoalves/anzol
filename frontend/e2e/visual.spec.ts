import { createHmac } from 'node:crypto';
import path from 'node:path';
import { BrowserContext, Locator, Page } from '@playwright/test';
import { abrirMensagem, campoDeBusca, detalhes, verificacoes } from './support/inbox';
import { TokenTracker, expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

// Item 14, E11: regressão visual das telas principais, no tema claro e no escuro, nas classes compacta (390),
// expandida (1400) e grande (1600). Roda só na imagem Docker do Playwright da versão instalada (./e2e-visual.sh,
// `VISUAL=1`), para a fonte e o rasterizador serem os mesmos em toda máquina; as baselines estão commitadas em
// `visual.spec.ts-snapshots/`.
// O que muda de uma execução para outra fica congelado ou mascarado: o relógio do navegador é fixo, as animações
// ficam desligadas (padrão do `toHaveScreenshot`), e UUIDs, datas, hora e host (a porta do stack muda entre o CI e a
// máquina de quem roda) ficam sob máscara.
// As cenas de falha e de fora do caminho feliz (assinatura e schema inválidos, uma delas em pt-BR, filtro sem
// resultado, lista em erro, sem conexão) não usam a máscara por texto: os mesmos valores são trocados na página por
// valores fixos, e a comparação delas conta pixels (`fixarVolateis`, `fotografar`).

const SECRET = 'segredo-visual';
/**
 * O relógio do navegador fica parado um minuto à frente do início do teste: as mensagens, criadas logo em seguida,
 * aparecem sempre como "a minute ago" (entre 45 e 89 s). Com uma data fixa, o tempo relativo ("in 18 hours") mudava
 * com o dia em que o teste roda. As datas e horas absolutas continuam mascaradas.
 */
function relogio(): Date {
  return new Date(Date.now() + 60_000);
}

const TEMAS = ['light', 'dark'] as const;
const CLASSES = [
  { nome: 'compacta', viewport: { width: 390, height: 844 } },
  { nome: 'expandida', viewport: { width: 1400, height: 900 } },
  { nome: 'grande', viewport: { width: 1600, height: 1000 } },
] as const;

function github(secret: string, body: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/**
 * O que muda entre execuções em toda tela: a URL da webhook no cabeçalho e todo texto com UUID (inteiro ou o `#` dos
 * 5 primeiros), data, hora, IP ou host. As expressões casam o valor fixo que `fixarVolateis` deixa no lugar.
 */
const VOLATEIS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-/,
  /#[0-9a-f]{5}\b/,
  /\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /anzol\.test/,
];

function mascarasComuns(page: Page): Locator[] {
  return [
    page.getByRole('textbox', { name: 'Webhook URL' }),
    page.locator('app-url-switcher .name'),
    ...VOLATEIS.map((texto) => page.getByText(texto)),
  ];
}

/** Itens da lista: o `#` do UUID (o IP e a data ficam só no nome acessível e no detalhe). */
function mascarasDaLista(page: Page): Locator[] {
  return [page.locator('.item .id')];
}

/** CSS só das fotos (a altura fixa dos metadados no compacto); ver o arquivo. */
const ESTILO_DAS_FOTOS = path.join(__dirname, 'support', 'visual-fotos.css');

async function fotografar(
  page: Page,
  nome: string,
  mascaras: Locator[],
  alvo: Locator | undefined,
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(alvo ?? page).toHaveScreenshot(`${nome}.png`, {
    mask: mascaras,
    // Folga zero, medida só nesta máquina: se o Chromium das fotos mudar o serrilhado, regrava-se; não se afrouxa.
    maxDiffPixels: 0,
    stylePath: ESTILO_DAS_FOTOS,
  });
}

/**
 * Troca na página cada id, data, hora, IP, seq e host por um valor fixo do mesmo formato: o texto, e a máscara em
 * volta dele, têm o mesmo tamanho em toda execução.
 */
async function fixarVolateis(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trocas: [RegExp, (...partes: string[]) => string][] = [
      [
        /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/g,
        () => '00000000-0000-4000-8000-000000000000',
      ],
      [/#[0-9a-f]{5}\b/g, () => '#00000'],
      [/\bURL [0-9a-f]{5}\b/g, () => 'URL 00000'],
      [/\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/g, () => 'Sep 26, 2026'],
      [/\b\d{1,2} de [a-zç]{3,4}\.? de \d{4}\b/g, () => '26 de set. de 2026'],
      [
        /\b\d{1,2}:\d{2}(:\d{2})?( [AP]M)?/g,
        (_hora, segundos, periodo) =>
          `${periodo ? '9:41' : '21:41'}${segundos ? ':00' : ''}${periodo ? ' PM' : ''}`,
      ],
      [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, () => '203.0.113.7'],
      [/\bseq \d+\b/g, () => 'seq 1000000000000000'],
      [/host\.docker\.internal(?::\d+)?|localhost:\d+/g, () => 'anzol.test'],
    ];
    const fixo = (texto: string) =>
      trocas.reduce((atual, [padrao, valor]) => atual.replace(padrao, valor), texto);
    const textos = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let no = textos.nextNode(); no; no = textos.nextNode()) {
      const trocado = fixo(no.nodeValue ?? '');
      if (trocado !== no.nodeValue) {
        no.nodeValue = trocado;
      }
    }
    for (const campo of document.querySelectorAll('input')) {
      campo.value = fixo(campo.value);
    }
  });
}

interface Tela {
  nome: string;
  /** Só nestas classes (padrão: todas). */
  classes?: readonly (typeof CLASSES)[number]['nome'][];
  /** Só nestes temas (padrão: os dois). */
  temas?: readonly (typeof TEMAS)[number][];
  /** Sem a máscara por texto: os valores fixos de `fixarVolateis` ficam na foto. */
  semMascaraDeTexto?: boolean;
  abrir(page: Page, tokens: TokenTracker, context: BrowserContext): Promise<Locator[]>;
  /** Só este elemento, inteiro, em vez da tela à vista. */
  alvo?(page: Page): Locator;
}

/** A decifra exige segredo de leitura: a URL nasce protegida e o navegador a destranca. */
const SEGREDO_DE_LEITURA = 'segredo-visual-decifra';
/** Chave pública fixa de quem assina: gerada a cada execução, ela mudaria o texto de "Trusted signers". */
const SIGNATARIO = {
  kty: 'EC',
  crv: 'P-256',
  kid: 'sig-visual',
  x: 'A2r-0Le5cRJDUtmbpiGt62kFMAjipu5JRQ1hMw8RZwo',
  y: 'd_FwMCLxN-MDLKNs1xMTnApN__m7MLKJT3vf3DzXWHk',
};

/**
 * Verificações aberta no cartão da decifra. A janela cresce na altura (a classe é a da largura) para o cartão
 * caber inteiro: a página rola dentro do `main`, e a foto de um elemento não passa da área visível dele.
 */
async function abrirDecifra(page: Page, tokens: TokenTracker, ligada: boolean): Promise<Locator[]> {
  const tokenId = await tokens.create({
    read_secret: SEGREDO_DE_LEITURA,
    ...(ligada && {
      e2ee: {
        path: '$.payload',
        required: true,
        audience: 'anzol-lab',
        bindings: { jti: '$.eventId', evt: '$.tipoEvento.nome', app: '$.servico.nome' },
        max_age_seconds: 43200,
        trusted_signers: [SIGNATARIO],
      },
    }),
  });
  const segredo = { 'X-Anzol-Secret': SEGREDO_DE_LEITURA };
  if (ligada) {
    const chave = await page.request.post(`/token/${tokenId}/keys`, {
      headers: segredo,
      data: { kid: 'enc-visual' },
    });
    expect(chave.status()).toBe(201);
  }
  await seedStorage(page, {});
  const destrancou = await page.request.post(`/token/${tokenId}/unlock`, {
    data: { secret: SEGREDO_DE_LEITURA },
  });
  expect(destrancou.ok()).toBe(true);
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 1400, height: 4000 });
  await page.goto(`/#/${tokenId}/checks?section=e2ee`);
  const cartao = page.getByRole('region', { name: 'E2EE decryption' });
  await expect(cartao.locator('.card-head')).toContainText(ligada ? 'On · $.payload' : 'Off');
  if (ligada) {
    await expect(cartao.getByRole('region', { name: 'Encryption keys' })).toContainText(
      'enc-visual',
    );
  }
  await cartao.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  return [];
}

/**
 * A busca espera a pessoa parar de digitar, e conta essa espera pela hora do navegador, que aqui está parada: o
 * relógio anda de novo depois do texto.
 */
async function buscar(page: Page, texto: string): Promise<void> {
  await campoDeBusca(page).fill(texto);
  await page.clock.setFixedTime(relogio());
}

/**
 * URL que confere assinatura e schema, com uma entrega que passa e três que falham de jeitos diferentes: sem
 * assinatura e sem JSON, respondida com 503 por uma regra, e com a assinatura e o schema inválidos (a devolvida).
 */
async function comFalhas(page: Page, tokens: TokenTracker): Promise<[string, string]> {
  const tokenId = await tokens.create({
    signature: { provider: 'github', secret: SECRET },
    schema: { type: 'object', required: ['id'], properties: { valor: { type: 'integer' } } },
  });
  const regras = await page.request.put(`/token/${tokenId}/rules`, {
    data: [
      {
        name: 'Fora do ar',
        priority: 1,
        match: { path: { equals: '/falha' } },
        response: { status: 503 },
      },
    ],
  });
  expect(regras.status()).toBe(200);
  await tokens.send(tokenId, { path: '/pedidos', ...github(SECRET, '{"id":42,"valor":10}') });
  await tokens.send(tokenId, { method: 'GET', path: '/status' });
  await tokens.send(tokenId, { path: '/falha', ...github(SECRET, '{"id":43,"valor":10}') });
  const invalida = await tokens.send(tokenId, {
    path: '/pedidos',
    ...github('outro-segredo', '{"valor":"10","itens":[{"sku":"A1","qtd":2}]}'),
  });
  return [tokenId, invalida];
}

const TELAS: Tela[] = [
  {
    nome: 'inbox-detalhe',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({
        signature: { provider: 'github', secret: SECRET },
        schema: { type: 'object', required: ['id'] },
      });
      await tokens.send(tokenId, { method: 'GET', path: '/status' });
      const requestId = await tokens.send(tokenId, {
        path: '/pedidos',
        ...github(SECRET, '{"id":42,"itens":[{"sku":"A1","qtd":2}],"status":"pago"}'),
      });
      await seedStorage(page, { formatJsonEnable: 'true', hideTutorial: 'true' });
      await abrirMensagem(page, tokenId, requestId);
      await expect(verificacoes(page)).toContainText('Signature valid');
      return [...mascarasDaLista(page), detalhes(page)];
    },
  },
  {
    nome: 'checks',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({
        default_status: '202',
        default_content: '{"ok":true}',
        default_content_type: 'application/json',
        signature: { provider: 'github', secret: SECRET },
        schema: { type: 'object', required: ['id'] },
      });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/checks`);
      await expect(page.getByRole('region', { name: 'Signature verification' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Health' })).toBeVisible();
      return [];
    },
  },
  {
    nome: 'checks-decifra-desligada',
    abrir: (page, tokens) => abrirDecifra(page, tokens, false),
    alvo: (page) => page.getByRole('region', { name: 'E2EE decryption' }),
  },
  {
    nome: 'checks-decifra-ligada',
    abrir: (page, tokens) => abrirDecifra(page, tokens, true),
    alvo: (page) => page.getByRole('region', { name: 'E2EE decryption' }),
  },
  {
    nome: 'rules-editor',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const response = await page.request.put(`/token/${tokenId}/rules`, {
        data: [
          {
            name: 'Pix pago',
            priority: 1,
            match: {
              method: ['POST'],
              path: { equals: '/pagamentos' },
              body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
            },
            response: { status: 201, headers: {}, body: '{"ok":true}' },
          },
          { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
        ],
      });
      expect(response.status()).toBe(200);
      const [{ id }] = (await response.json()) as { id: string }[];
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/rules/${id}`);
      await expect(page.getByRole('region', { name: 'Edit rule Pix pago' })).toBeVisible();
      return [];
    },
  },
  {
    // UX de Regras, F8 (WM-41): a lista de regras no celular, com os selos de diagnóstico da F2 (pega-tudo, sombra,
    // nunca casa, desligada) e o grupo de cenário; as 3 linhas, a alça, o interruptor, ↑/↓ e o ⋮ por item.
    nome: 'rules-lista',
    classes: ['compacta'],
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const pix = {
        method: ['POST'],
        path: { equals: '/pagamentos' },
        headers: { 'X-Tenant': { equals: 'acme' } },
      };
      const response = await page.request.put(`/token/${tokenId}/rules`, {
        data: [
          {
            name: 'Assinatura inválida',
            priority: 1,
            match: { signature: 'invalid' },
            response: { status: 401 },
          },
          { name: 'Pix pago', priority: 2, match: pix, response: { status: 201 } },
          { name: 'Pix pago (copy)', priority: 2, match: pix, response: { status: 201 } },
          {
            name: 'entrega 1/2',
            priority: 3,
            match: { path: { equals: '/entrega' } },
            scenario: { name: 'entrega', requiredState: 'Started', newState: 'entrega 2' },
            response: { status: 503 },
          },
          {
            name: 'entrega 2/2',
            priority: 3,
            match: { path: { equals: '/entrega' } },
            scenario: { name: 'entrega', requiredState: 'entrega 2' },
            response: { status: 200 },
          },
          {
            name: 'Reset de conexão',
            priority: 4,
            enabled: false,
            response: { fault: 'connection_reset' },
          },
          { name: 'Tudo o resto', priority: 9, response: { status: 404 } },
        ],
      });
      expect(response.status()).toBe(200);
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/rules`);
      const tabela = page.getByRole('table', { name: 'Rules' });
      await expect(tabela).toContainText('Tudo o resto');
      // O cabeçalho da página ocupa a primeira tela a 390 px: a foto começa na lista.
      await tabela.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      return [];
    },
  },
  {
    nome: 'outbound',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/outbound`);
      await expect(page.getByRole('table', { name: 'Outbound history' })).toBeVisible();
      return [];
    },
  },
  {
    nome: 'insights',
    async abrir(page, tokens) {
      const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
      await tokens.send(tokenId, github(SECRET, '{"id":1}'));
      await tokens.send(tokenId, github(SECRET, '{"id":2}'));
      await tokens.send(tokenId, github('outro-segredo', '{"id":3}'));
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/insights`);
      // Fidelidade ao C, fase 2 (RULES-39): "N of the N kept" quando a URL guarda menos que a janela.
      await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
        /\b3 of the 3 kept\b/,
      );
      // O gráfico e a tabela por hora dependem da hora em que o teste roda.
      return [page.getByRole('region', { name: 'Requests per hour' })];
    },
  },
  {
    nome: 'compare',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      // User-agent curto: o resumo do cartão A/B ("#xxxxx · {user-agent}", fidelidade ao C) quebrava a linha conforme a
      // largura dos dígitos do UUID, e a foto mudava de uma execução para outra.
      const json = { 'Content-Type': 'application/json', 'User-Agent': 'anzol-visual' };
      const a = await tokens.send(tokenId, {
        headers: { ...json, 'X-Retry': '1' },
        data: '{"id":42,"status":"pending"}',
      });
      const b = await tokens.send(tokenId, {
        headers: { ...json, 'X-Retry': '2' },
        data: '{"id":42,"status":"paid"}',
      });
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}/compare/${a}/${b}`);
      const view = page.getByRole('region', { name: 'Compare requests' });
      await expect(view).toBeVisible();
      // As linhas do "#xxxxx · …" e da data nos cartões A/B (fidelidade ao C, RULES-28) têm a largura do texto: a
      // máscara do texto mudaria de tamanho com os dígitos do UUID. A linha inteira (flex, largura cheia) é estável.
      return [view.locator('.card-side .line:nth-child(n+2)')];
    },
  },
  {
    nome: 'onboarding',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}`);
      const pronta = page.getByRole('region', { name: 'Your URL is ready' });
      await expect(pronta).toBeVisible();
      return [pronta.locator('.url'), pronta.locator('.command')];
    },
  },
  {
    nome: 'share',
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, {
        path: '/hook?token=abc123&page=2',
        headers: { 'Content-Type': 'application/json', authorization: 'Bearer secreto' },
        data: '{"cartao":"4111","valor":10}',
      });
      const link = await page.request.post(`/token/${tokenId}/request/${requestId}/share`, {
        data: {},
      });
      expect([200, 201]).toContain(link.status());
      const { id } = (await link.json()) as { id: string };
      await seedStorage(page, { formatJsonEnable: 'true' });
      await page.goto(`/#/share/${id}`);
      const faixa = page.getByRole('status').filter({ hasText: 'Shared read-only link · expires' });
      await expect(faixa).toBeVisible();
      return [faixa, detalhes(page)];
    },
  },
  {
    // O detalhe de uma entrega com a assinatura e o schema inválidos: os cartões e as marcas no corpo na cor de
    // erro e, ao lado (fora do compacto), a lista com os selos de falha.
    nome: 'falha-detalhe',
    temas: ['dark'],
    semMascaraDeTexto: true,
    async abrir(page, tokens) {
      const [tokenId, invalida] = await comFalhas(page, tokens);
      await seedStorage(page, { hideTutorial: 'true' });
      await abrirMensagem(page, tokenId, invalida);
      await expect(verificacoes(page)).toContainText('Signature invalid');
      await expect(verificacoes(page)).toContainText('Schema invalid');
      return [];
    },
  },
  {
    nome: 'falha-detalhe-pt-BR',
    temas: ['light'],
    semMascaraDeTexto: true,
    async abrir(page, tokens) {
      const [tokenId, invalida] = await comFalhas(page, tokens);
      await seedStorage(page, { hideTutorial: 'true', language: '"pt-BR"' });
      await page.goto(`/#/${tokenId}/${invalida}/1`);
      const cartoes = page.getByRole('group', { name: 'Verificações desta requisição' });
      await expect(cartoes).toContainText('Assinatura inválida');
      await expect(cartoes).toContainText('Schema inválido');
      return [];
    },
  },
  {
    nome: 'falha-lista',
    temas: ['light'],
    semMascaraDeTexto: true,
    async abrir(page, tokens) {
      const [tokenId] = await comFalhas(page, tokens);
      await seedStorage(page, { hideTutorial: 'true' });
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requests (4)' })).toBeVisible();
      await expect(
        page.getByRole('listitem').filter({
          has: page.locator('app-check-chip[data-kind="rule"]', { hasText: '503' }),
        }),
      ).toBeVisible();
      return [];
    },
  },
  {
    nome: 'filtro-sem-resultado',
    temas: ['light'],
    semMascaraDeTexto: true,
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/pedidos', data: '{"id":42}' });
      await seedStorage(page, { hideTutorial: 'true' });
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
      await buscar(page, 'nada-casa');
      await expect(page.getByText('No requests match these filters')).toBeVisible();
      // A linha do resultado entra na tela um instante depois da lista vazia.
      await expect(
        page.getByText('0 requests match · search runs on the server over all 1'),
      ).toBeVisible();
      return [];
    },
  },
  {
    nome: 'lista-com-erro',
    temas: ['light'],
    semMascaraDeTexto: true,
    async abrir(page, tokens) {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/pedidos', data: '{"id":42}' });
      await seedStorage(page, { hideTutorial: 'true' });
      await page.route(/\/token\/[^/]+\/requests\?/, (rota) => rota.fulfill({ status: 503 }));
      await page.goto(`/#/${tokenId}`);
      await expect(page.locator('app-list-error')).toContainText('Could not load the list (503).');
      return [page.locator('app-list-error .countdown')];
    },
  },
  {
    nome: 'sem-conexao',
    temas: ['light'],
    semMascaraDeTexto: true,
    async abrir(page, tokens, context) {
      const tokenId = await tokens.create();
      await tokens.send(tokenId, { path: '/pedidos', data: '{"id":42}' });
      await seedStorage(page, { hideTutorial: 'true' });
      await page.goto(`/#/${tokenId}`);
      await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
      await expect(page.locator('app-live-status')).toContainText('Live');
      await context.setOffline(true);
      await buscar(page, 'pedidos');
      await expect(page.getByRole('button', { name: 'Try again now' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Connection' })).toContainText(
        'What you typed is kept.',
      );
      await expect(page.getByText('Could not search (0).')).toBeVisible();
      return [page.locator('app-connection-band .countdown')];
    },
  },
];

test.use({ axeNoFim: false });

async function abrirEFotografar(
  tela: Tela,
  variante: string,
  page: Page,
  tokens: TokenTracker,
  context: BrowserContext,
): Promise<void> {
  await page.clock.setFixedTime(relogio());
  const mascaras = await tela.abrir(page, tokens, context);
  await fixarVolateis(page);
  await fotografar(
    page,
    `${tela.nome}-${variante}`,
    tela.semMascaraDeTexto ? mascaras : [...mascarasComuns(page), ...mascaras],
    tela.alvo?.(page),
  );
}

for (const colorScheme of TEMAS) {
  for (const classe of CLASSES) {
    test.describe(`Dado o tema ${colorScheme} na classe ${classe.nome}`, () => {
      test.use({ colorScheme, viewport: classe.viewport });

      const telas = TELAS.filter(
        (tela) =>
          (!tela.classes || tela.classes.includes(classe.nome)) &&
          (!tela.temas || tela.temas.includes(colorScheme)),
      );
      for (const tela of telas) {
        test(`deve bater com a baseline: ${tela.nome}`, async ({ page, tokens, context }) => {
          await abrirEFotografar(tela, `${colorScheme}-${classe.nome}`, page, tokens, context);
        });
      }
    });
  }
}

// As cores forçadas do sistema (o alto contraste do Windows), em que fundo e sombra somem: a requisição aberta com
// falha (moldura, selo em negativo, régua, destino atual) e o editor de regra (interruptor, aba e método escolhidos).
test.describe('Dado as cores forçadas do sistema na classe expandida', () => {
  test.use({ colorScheme: 'light', viewport: CLASSES[1].viewport, forcedColors: 'active' });

  for (const tela of TELAS.filter(({ nome }) => ['falha-detalhe', 'rules-editor'].includes(nome))) {
    test(`deve bater com a baseline: ${tela.nome}`, async ({ page, tokens, context }) => {
      await abrirEFotografar(tela, 'forcadas-expandida', page, tokens, context);
    });
  }
});
