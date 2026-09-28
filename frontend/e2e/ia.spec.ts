import { Server, createServer } from 'node:http';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, acoes } from './support/inbox';
import { seedStorage } from './support/storage';
import { abrirRegras, novaRegra, parte, snackbar, folhaDeCriarRegra } from './support/regras';

// IA local na tela (item 13, CA-4): "Describe the rule" preenche o editor sem salvar, "Explain"
// mostra o diagnóstico, e a IA desligada (503) desabilita os controles com a dica.
//
// O app precisa estar ligado a um LLM falso OpenAI-compatível no host:
// WEBHOOK_AI_ENABLED=true e WEBHOOK_AI_BASE_URL=http://host.docker.internal:18099. O falso sobe
// aqui, neste processo, na porta 18099 (troque com E2E_LLM_PORT), e cada teste programa as
// respostas. Os testes deste arquivo rodam em sequência num só worker: o falso é um só.
// Os estados 503 e 429 são simulados na rota (page.route): o CI roda com a IA ligada.
// Item 14, E4: "Explain"/"Hide explanation" ficam no `toolbar "Request actions"` do detalhe, com a dica da IA
// desligada ao lado; a `region "Explanation"` não muda.

const LLM_PORT = Number(process.env['E2E_LLM_PORT'] ?? 18099);

interface Reply {
  /** Status HTTP do falso; fora de 2xx, o backend deve responder 502. */
  status?: number;
  content?: string;
  delayMs?: number;
}

/** LLM falso: `POST …/chat/completions` responde a próxima resposta programada, em ordem. */
class FakeLlm {
  readonly received: Record<string, unknown>[] = [];
  private readonly replies: Reply[] = [];
  private server?: Server;

  program(...replies: Reply[]): void {
    this.replies.push(...replies);
  }

  reset(): void {
    this.replies.length = 0;
    this.received.length = 0;
  }

  /** Texto de todas as mensagens enviadas ao modelo na chamada `n`. */
  prompt(n: number): string {
    return JSON.stringify(this.received[n]?.['messages'] ?? []);
  }

  start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
          res.writeHead(404).end();
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
          string,
          unknown
        >;
        this.received.push(body);
        // Sem resposta programada, erro do cliente (sem nova tentativa do lado do backend).
        const reply = this.replies.shift() ?? { status: 400, content: 'no reply programmed' };
        setTimeout(() => {
          const status = reply.status ?? 200;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify(
              status >= 300
                ? { error: { message: reply.content ?? 'fake error', type: 'invalid_request' } }
                : {
                    id: `chatcmpl-e2e-${this.received.length}`,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: body['model'] ?? 'fake',
                    choices: [
                      {
                        index: 0,
                        message: { role: 'assistant', content: reply.content ?? '' },
                        finish_reason: 'stop',
                      },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                  },
            ),
          );
        }, reply.delayMs ?? 0);
      });
    });
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(LLM_PORT, '0.0.0.0', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

const llm = new FakeLlm();

/** Regra no formato da API, como o modelo a devolve dentro de `{"rule", "explanation"}`. */
const RULE_429 = {
  name: 'Pagamentos 429',
  enabled: true,
  priority: 5,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 429, headers: { 'Retry-After': '5' }, body: '' },
};

const suggestion = (rule: object, explanation: string) => JSON.stringify({ rule, explanation });

test.describe.configure({ mode: 'default' });

test.beforeAll(() => llm.start());
test.afterAll(() => llm.stop());
test.beforeEach(() => llm.reset());

async function rulesOf(api: APIRequestContext, tokenId: string) {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Record<string, unknown>[];
}

/**
 * Item 14, E6: o editor vira a `region "New rule"` (SUPOSIÇÕES em `support/regras.ts`); o Suggest fica no topo dele,
 * com os mesmos nomes, e a regra sugerida volta à aba Match. SUPOSIÇÃO: caminho sugerido com o UUID da URL gera o
 * `alert` "The path includes this URL's token…" com `button "Remove the token from the path"`.
 */
/**
 * Fidelidade ao C, fase 2 (RULES-16): o "Describe the rule" vem recolhido; abre pelo título antes de usar. Devolve o
 * campo.
 */
async function descrever(dialog: Locator): Promise<Locator> {
  const campo = dialog.getByRole('textbox', { name: 'Describe the rule' });
  await expect(campo).toBeHidden();
  await dialog.getByText('Describe the rule', { exact: true }).click();
  await expect(campo).toBeVisible();
  return campo;
}

/**
 * UX de Regras, E-13 (guia §3.3): a sugestão deixa de substituir o editor. Aparece como a proposta "Suggestion" com a
 * lista de mudanças e "Apply all" / "Apply conditions only" / "Dismiss". SUPOSIÇÃO: o guia diz `region "Suggestion"`
 * (existente) e hoje ela é `status "Suggestion"`; aceita os dois papéis.
 */
function sugestao(dialog: Locator): Locator {
  return dialog
    .getByRole('region', { name: 'Suggestion' })
    .or(dialog.getByRole('status', { name: 'Suggestion' }));
}

/** `status "AI progress"`: a região viva da espera da IA (patamar, B4). */
function andamento(page: Page): Locator {
  return page.getByRole('status', { name: 'AI progress' });
}

/**
 * Patamar, B4 (guia-combinacao §3.4 e §7): as conferências da sugestão terminam antes de os botões de aplicar ficarem
 * disponíveis (o botão fica `aria-disabled` por menos de 1 s); espera por isso e aplica tudo.
 */
async function aplicarTudo(dialog: Locator): Promise<void> {
  const aplicar = sugestao(dialog).getByRole('button', { name: 'Apply all' });
  await expect(aplicar).not.toHaveAttribute('aria-disabled', 'true');
  await aplicar.click();
}

async function newRuleDialog(page: Page, tokenId: string) {
  await abrirRegras(page, tokenId);
  return novaRegra(page);
}

async function openRequest(page: Page, tokenId: string, requestId: string) {
  await abrirMensagem(page, tokenId, requestId);
}

test.describe('Dado o editor de regra com a IA ligada', () => {
  test('deve avisar da espera e preencher o editor com a regra sugerida sem salvar, e gravar só no Save Quando "Suggest" é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);
    const prompt = 'Responda 429 com Retry-After 5 para POST em /pagamentos';
    llm.program({
      delayMs: 1500,
      content: suggestion(RULE_429, 'Answers **429** to `POST /pagamentos`.'),
    });

    await (await descrever(dialog)).fill(prompt);
    await dialog.getByRole('button', { name: 'Suggest' }).click();

    // Patamar, B4 (espera honesta): a frase fixa dos ~30 s sai; a espera diz o tempo de costume.
    await expect(andamento(page)).toContainText('Asking the local model. It usually takes about');
    // E-13: nada muda no editor até "Apply all".
    await expect(sugestao(dialog)).toContainText('status 200 → 429');
    await expect(dialog.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue('');
    await aplicarTudo(dialog);
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Pagamentos 429',
    );
    await expect(dialog.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue(
      '/pagamentos',
    );
    await parte(dialog, 'Response');
    await expect(dialog.getByRole('spinbutton', { name: 'Status' })).toHaveValue('429');
    await expect(dialog.getByRole('textbox', { name: 'Response header 1 name' })).toHaveValue(
      'Retry-After',
    );
    const result = sugestao(dialog);
    await expect(result).toContainText('Suggested in 1 attempt.');
    await expect(result.locator('strong')).toHaveText('429');
    expect(llm.prompt(0)).toContain(prompt);
    expect(await rulesOf(request, tokenId)).toEqual([]);

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const saved = await rulesOf(request, tokenId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(
      expect.objectContaining({
        name: 'Pagamentos 429',
        response: expect.objectContaining({ status: 429, headers: { 'Retry-After': '5' } }),
      }),
    );
  });

  test('deve mandar a mensagem aberta como exemplo Quando a opção é marcada no editor aberto pela mensagem', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      path: '/pedidos',
      headers: { 'Content-Type': 'application/json' },
      data: '{"pedido":"e2e-exemplo-7731"}',
    });
    await openRequest(page, tokenId, requestId);
    await page.getByRole('button', { name: 'Create rule from this request' }).click();
    // UX de Regras, WM-31: a folha "Create rule from this request" vem antes; "Open in editor" leva ao editor.
    // Patamar, R1: a folha é a aba "Create rule" do painel de ação (ou o diálogo de antes).
    await folhaDeCriarRegra(page).getByRole('button', { name: 'Open in editor' }).click();
    const dialog = page.getByRole('region', { name: 'New rule', exact: true });
    await expect(dialog).toBeVisible();
    llm.program({ content: suggestion({ ...RULE_429, name: 'Pedidos' }, 'Matches the order.') });

    // O checkbox fica dentro do Suggest recolhido (RULES-16): abre antes.
    const campo = await descrever(dialog);
    await dialog.getByRole('checkbox', { name: /Use the open request as example/ }).check();
    await campo.fill('Igual a esta mensagem');
    const [call] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith(`/token/${tokenId}/rules/suggest`)),
      dialog.getByRole('button', { name: 'Suggest' }).click(),
    ]);

    expect(call.postDataJSON()).toEqual(
      expect.objectContaining({ prompt: 'Igual a esta mensagem', request_id: requestId }),
    );
    await aplicarTudo(dialog);
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Pedidos');
    expect(llm.prompt(0)).toContain('e2e-exemplo-7731');
  });

  // UX de Regras, E-13 (guia §3.3): proposta com a lista de mudanças; aplicar tudo, só as condições, descartar e
  // desfazer.
  test('deve propor a sugestão como lista de mudanças, aplicar só as condições, descartar e desfazer', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);
    const proposta = {
      name: 'Acme',
      enabled: true,
      priority: 5,
      match: { headers: { 'x-tenant': { equals: 'acme' } } },
      response: { status: 201, headers: {}, body: '{"ok":true}' },
    };
    const status = dialog.getByRole('spinbutton', { name: 'Status' });
    llm.program(
      { content: suggestion(proposta, 'Only acme.') },
      { content: suggestion(proposta, 'Only acme.') },
      { content: suggestion(proposta, 'Only acme.') },
    );

    await (await descrever(dialog)).fill('201 para o tenant acme');
    await dialog.getByRole('button', { name: 'Suggest' }).click();
    const lista = sugestao(dialog);
    await expect(lista).toContainText('+ header x-tenant = acme');
    await expect(lista).toContainText('status 200 → 201');
    await expect(lista).toContainText('body changed');
    await lista.getByRole('button', { name: 'Apply conditions only' }).click();
    await parte(dialog, 'Match');
    await expect(dialog.getByRole('textbox', { name: 'Header 1 value' })).toHaveValue('acme');
    await parte(dialog, 'Response');
    await expect(status).toHaveValue('200');

    await dialog.getByRole('button', { name: 'Suggest' }).click();
    await sugestao(dialog).getByRole('button', { name: 'Dismiss' }).click();
    await expect(sugestao(dialog)).toHaveCount(0);
    await expect(status).toHaveValue('200');

    await dialog.getByRole('button', { name: 'Suggest' }).click();
    await aplicarTudo(dialog);
    await expect(status).toHaveValue('201');
    await expect(snackbar(page, 'Suggestion applied')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(status).toHaveValue('200');
    expect(await rulesOf(request, tokenId)).toEqual([]);
  });

  test('deve mostrar os últimos erros e manter o editor Quando o modelo erra a regra 3 vezes (422)', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);
    const invalid = suggestion({ ...RULE_429, response: { status: 999 } }, 'wrong');
    llm.program({ content: invalid }, { content: invalid }, { content: invalid });

    await (await descrever(dialog)).fill('status impossível');
    await dialog.getByRole('button', { name: 'Suggest' }).click();

    const alert = dialog.getByRole('alert', { name: 'Suggestion errors' });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText('status');
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
    expect(llm.received).toHaveLength(3);
    expect(await rulesOf(request, tokenId)).toEqual([]);
  });

  test('deve avisar e tirar o token do caminho Quando a regra sugerida traz o UUID da URL no path', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);
    llm.program({
      content: suggestion(
        { ...RULE_429, match: { path: { equals: `/${tokenId}/pagamentos` } } },
        'Uses the full URL.',
      ),
    });

    await (await descrever(dialog)).fill('429 em pagamentos');
    await dialog.getByRole('button', { name: 'Suggest' }).click();
    await aplicarTudo(dialog);

    const aviso = dialog
      .getByRole('alert')
      .filter({ hasText: "The path includes this URL's token" });
    await expect(aviso).toBeVisible();
    await aviso.getByRole('button', { name: 'Remove the token from the path' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue(
      '/pagamentos',
    );
    await expect(aviso).toHaveCount(0);
  });

  test('deve dizer que o modelo não respondeu Quando o LLM falha (502)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);
    llm.program({ status: 500, content: 'model crashed' });

    await (await descrever(dialog)).fill('qualquer regra');
    await dialog.getByRole('button', { name: 'Suggest' }).click();

    await expect(dialog.getByRole('alert', { name: 'Suggestion errors' })).toContainText(
      'The local model did not answer',
    );
    await expect(dialog.getByRole('button', { name: 'Suggest' })).toBeEnabled();
  });
});

test.describe('Dado uma mensagem com a IA ligada e o navegador em pt-BR', () => {
  test.use({ locale: 'pt-BR' });

  // Patamar, B4 (guia-combinacao §3.4 e §7; UX-43): o `lang` segue o idioma da tela, não o do navegador.
  test('deve pedir o diagnóstico no idioma da tela e mostrar o markdown sem executar o HTML do modelo Quando "Explain" é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: '{"valor":10}' });
    // Item 14, E10: com o navegador em pt-BR a tela abriria em pt-BR (CA-4); a tela fica em inglês pela escolha em
    // Settings, e o `lang` do Explain é o da tela.
    await seedStorage(page, { language: '"en"' });
    await openRequest(page, tokenId, requestId);
    llm.program({
      delayMs: 1000,
      content: [
        'A mensagem foi respondida pela **resposta padrão**.',
        '',
        '- nenhuma regra casou',
        '- sem assinatura configurada',
        '',
        '```',
        'POST / 200',
        '```',
        '',
        '<img src=x onerror="window.__xss=1"><b>negrito cru</b>',
      ].join('\n'),
    });

    await expect(acoes(page).getByRole('button', { name: 'Explain' })).toBeVisible();
    const [call] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith(`/request/${requestId}/explain`)),
      acoes(page).getByRole('button', { name: 'Explain' }).click(),
    ]);

    expect(call.postDataJSON()).toEqual(expect.objectContaining({ lang: 'en' }));
    const panel = page.getByRole('region', { name: 'Explanation' });
    await expect(andamento(page)).toContainText('Asking the local model. It usually takes about');
    await expect(panel.locator('strong')).toHaveText('resposta padrão');
    await expect(panel.getByRole('listitem')).toHaveText([
      'nenhuma regra casou',
      'sem assinatura configurada',
    ]);
    await expect(panel.locator('pre code')).toHaveText('POST / 200');
    await expect(panel).toContainText('<img src=x onerror="window.__xss=1"><b>negrito cru</b>');
    await expect(panel.locator('img, b, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(
      undefined,
    );

    // Patamar, R1: a explicação fica na aba Explain do painel de ação; esconde-se fechando o painel.
    await page
      .getByRole('button', { name: 'Hide explanation' })
      .or(page.getByRole('button', { name: 'Close panel' }))
      .first()
      .click();
    await expect(panel).toBeHidden();
  });
});

test.describe('Dado a IA desligada ou no limite (respostas simuladas na rota)', () => {
  // Patamar, B4 (guia-combinacao §3.4 e §7; UX-15): com a IA desligada os botões ficam `aria-disabled` com a razão
  // "This server has no local AI."; a frase com WEBHOOK_AI_* sai da tela.
  test('deve desligar "Explain" e "Suggest" com a razão Quando o servidor responde 503', async ({
    page,
    tokens,
  }) => {
    await page.route(/\/token\/[^/]+\/(request\/[^/]+\/explain|rules\/suggest)$/, (route) =>
      route.fulfill({ status: 503, json: { error: 'AI is not configured' } }),
    );
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await openRequest(page, tokenId, requestId);

    await acoes(page).getByRole('button', { name: 'Explain' }).click();

    await expect(page.getByText('This server has no local AI.').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'How to turn it on' }).first()).toBeVisible();
    await expect(page.getByText(/WEBHOOK_AI/)).toHaveCount(0);
    const explicar = acoes(page).getByRole('button', { name: 'Explain' });
    await expect(explicar).toHaveAttribute('aria-disabled', 'true');
    await expect(explicar).toHaveAccessibleDescription(/This server has no local AI\./);

    // A mesma sessão da tela (só o hash muda): o editor já abre com a IA desligada.
    const dialog = await newRuleDialog(page, tokenId);
    // A dica e o campo ficam dentro do Suggest recolhido (RULES-16): abre antes.
    await descrever(dialog);
    await expect(dialog.getByText('This server has no local AI.')).toBeVisible();
    await expect(dialog.getByText(/WEBHOOK_AI/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Suggest' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('deve dizer quando tentar de novo Quando o servidor responde 429 com Retry-After', async ({
    page,
    tokens,
  }) => {
    await page.route(/\/token\/[^/]+\/rules\/suggest$/, (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '30' },
        json: { error: 'Too many AI calls' },
      }),
    );
    const tokenId = await tokens.create();
    const dialog = await newRuleDialog(page, tokenId);

    await (await descrever(dialog)).fill('qualquer');
    await dialog.getByRole('button', { name: 'Suggest' }).click();

    await expect(dialog.getByRole('alert', { name: 'Suggestion errors' })).toContainText(
      'Try again in 30 s.',
    );
    await expect(dialog.getByRole('button', { name: 'Suggest' })).toBeEnabled();
  });
});
