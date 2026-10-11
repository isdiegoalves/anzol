import { createHmac } from 'node:crypto';
import { Page } from '@playwright/test';
import { escutarAnuncios, expectUmAnuncio, limparAnuncios } from './support/anuncios';
import { expect, test } from './support/fixtures';
import { estadoAoVivo } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

// Item 14, E10 (CA-4): tradução em runtime, um build só. Settings › Language troca a tela para pt-BR depois de
// recarregar; sem escolha, vale o idioma do navegador, caindo para `en` (a suíte roda com `locale: 'en-US'` fixo no
// playwright.config.ts); as frases do servidor (`reason`, `failed`, 422) são traduzidas com o original à mão; datas
// por `Intl`.
// SUPOSIÇÕES (glossário pt-BR que a E10 segue; o resto da tradução é livre):
// - shell: `navigation "Seções da URL"` com os links "Entrada", "Regras", "Verificações", "Saída" e "Métricas";
//   `button` "Nova URL", "Configurações", "Ajuda", "Copiar"; `textbox "URL do webhook"`; chip "Ao vivo";
// - Inbox: `heading` "Requisições (N)"; `switch "Seguir novas"`; `group "Verificações desta requisição"` com o
//   cartão "Assinatura inválida" e, na linha seguinte, o motivo traduzido com o do servidor entre parênteses
//   ("o HMAC não bateu (signature mismatch)");
//   abas "Corpo" e "Cabeçalhos (n)"; a data da "Request Details" no formato do `Intl` pt-BR ("26 de set. de
//   2026"), na linha de metadados `group "Metadados da requisição"` (fidelidade ao C, INBOX-17);
// - Checks: `heading` h1 "Verificações"; `region "Verificação de assinatura"` com `button "Salvar assinatura"`;
// - Rules: `heading` h1 "Regras"; `button "Nova regra"`;
// - em Settings, o `radiogroup "Language"` (em pt-BR, "Idioma") tem os radios "English" e "Português (Brasil)" (o
//   nome de cada idioma na própria língua), e "Reload now" ("Recarregar agora") aplica a troca;
// - `<html lang>` acompanha o idioma ("en" / "pt-BR"); a escolha fica em `localStorage.language` ('"pt-BR"').

const SECRET = 'segredo-do-i18n';

function assinado(secret: string, body = '{"id":1}') {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  };
}

/** Escolhe pt-BR em Settings e recarrega pelo "Reload now". */
async function escolherPortugues(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const idioma = page.getByRole('radiogroup', { name: 'Language' });
  await idioma.getByRole('radio', { name: 'Português (Brasil)' }).check();
  const recarregou = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Reload now' }).click();
  await recarregou;
}

test.describe('Dado o navegador em en-US e nenhum idioma escolhido', () => {
  test('deve abrir em inglês', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page
        .getByRole('navigation', { name: 'URL sections' })
        .getByRole('link', { name: 'Inbox', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'New URL', exact: true })).toBeVisible();
  });
});

test.describe('Dado o idioma pt-BR escolhido em Settings', () => {
  test('deve traduzir o shell, a Inbox, Checks e Rules, manter as frases do servidor e seguir em pt-BR ao recarregar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    const errada = await tokens.send(tokenId, assinado('outro-segredo'));
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${errada}/1`);

    await escolherPortugues(page);

    // Shell.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    const secoes = page.getByRole('navigation', { name: 'Seções da URL' });
    for (const nome of ['Entrada', 'Regras', 'Verificações', 'Saída', 'Métricas']) {
      // Fidelidade ao C (F1, INBOX-02/CHECKS-23): o nome pode ganhar o sufixo (", 2 não lidas", ", precisa de atenção").
      await expect(
        secoes.getByRole('link', { name: new RegExp(`^${nome}(, .+)?$`) }),
      ).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Nova URL', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configurações', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajuda', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'URL do webhook' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar', exact: true })).toBeVisible();

    // Inbox: textos traduzidos, a frase do servidor com o original entre parênteses, a data pelo Intl.
    await expect(page.getByRole('heading', { name: 'Requisições (1)' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Seguir novas' })).toBeVisible();
    const cartoes = page.getByRole('group', { name: 'Verificações desta requisição' });
    await expect(cartoes).toContainText(
      /Assinatura inválida\s*o HMAC não bateu \(signature mismatch\)/,
    );
    await expect(page.getByRole('tab', { name: /^Corpo\b/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Cabeçalhos \(\d+\)$/ })).toBeVisible();
    const detalhes = page.getByRole('group', { name: 'Metadados da requisição' });
    await expect(detalhes).toContainText(/\d{1,2} de [a-zç]{3}\.? de \d{4}/);
    await expect(detalhes).not.toContainText(/\b(AM|PM)\b/);

    // Checks.
    // Fidelidade ao C (F1, CHECKS-23): o nome ganha ", precisa de atenção" quando há falha, como o `destino()`.
    await secoes.getByRole('link', { name: /^Verificações(, .+)?$/ }).click();
    await expect(page.getByRole('heading', { name: 'Verificações', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Verificação de assinatura' })).toBeVisible();
    await page
      .getByRole('region', { name: 'Resposta', exact: true })
      .getByLabel('Status padrão')
      .fill('418');
    await expect(
      page
        .getByRole('region', { name: 'Alterações não salvas' })
        .getByRole('button', { name: /^Salvar alterações\b/ }),
    ).toBeVisible();

    // Rules.
    await secoes.getByRole('link', { name: 'Regras', exact: true }).click();
    const guarda = page.getByRole('dialog', { name: 'Descartar as alterações?' });
    await expect(guarda).toContainText('Status padrão: 200 → 418');
    await guarda.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Regras', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova regra', exact: true })).toBeVisible();

    // A escolha fica guardada e vale depois de recarregar.
    expect((await readStorage(page))['language']).toBe('"pt-BR"');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Regras', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    expect((await request.get(`/token/${tokenId}`)).status()).toBe(200);
  });

  test('deve voltar ao inglês Quando "English" é escolhido e a página recarrega', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('button', { name: 'Nova URL', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page
      .getByRole('radiogroup', { name: 'Idioma' })
      .getByRole('radio', { name: 'English' })
      .check();
    const recarregou = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Recarregar agora' }).click();
    await recarregou;

    await expect(page.getByRole('button', { name: 'New URL', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('Dado o navegador em pt-BR e nenhum idioma escolhido', () => {
  test.use({ locale: 'pt-BR' });

  test('deve abrir em pt-BR pelo idioma do navegador', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('button', { name: 'Nova URL', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Seções da URL' })
        .getByRole('link', { name: 'Entrada', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Dado o idioma pt-BR guardado e a conexão que cai e volta', () => {
  test('deve dizer a queda, o "Tentar agora" e a volta na língua da tela', async ({
    page,
    context,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/antes' });
    await escutarAnuncios(page);
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}`);
    await expect(estadoAoVivo(page)).toContainText('Ao vivo');
    await limparAnuncios(page);

    await context.setOffline(true);
    await page
      .getByRole('searchbox', { name: 'Buscar', exact: true })
      .or(page.getByRole('textbox', { name: 'Buscar', exact: true }))
      .fill('antes');

    const conexao = page.getByRole('group', { name: 'Conexão' }).locator('[role="status"]');
    await expect(conexao).toContainText(
      /Sem conexão com o servidor desde \d{1,2}:\d{2}.*\. O que você digitou está guardado\./,
    );
    const tentar = page.getByRole('button', { name: 'Tentar agora' });
    await expect(tentar).toBeVisible();

    await limparAnuncios(page);
    await context.setOffline(false);
    await tentar.click();

    await expectUmAnuncio(page, /^Conexão de volta\.$/, /^Conexão$/);
    await expect(estadoAoVivo(page)).toContainText('Ao vivo');
  });
});

test.describe('Dado o idioma pt-BR guardado, nas telas da Saída, de Métricas, do link só-leitura e do Comparar', () => {
  test.beforeEach(async ({ page }) => {
    await seedStorage(page, { language: '"pt-BR"' });
  });

  test('deve traduzir a Saída: o título, o histórico e o formulário', async ({ page, tokens }) => {
    const tokenId = await tokens.create();

    await page.goto(`/#/${tokenId}/outbound`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('heading', { name: 'Saída', level: 1 })).toBeVisible();
    await expect(page.getByText('os últimos 50 mandados pelo servidor')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Histórico de saída' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Atualizar histórico' })).toBeVisible();
    const nova = page.getByRole('region', { name: 'Nova requisição' });
    // A carga da URL termina escolhendo "Reenviar": a escolha feita antes disso seria desfeita.
    await expect(nova.getByRole('region', { name: 'Reenviar requisição' })).toBeVisible();
    const enviar = nova
      .getByRole('radiogroup', { name: 'Tipo de requisição' })
      .getByRole('radio', { name: 'Enviar', exact: true });
    await enviar.click();
    await expect(enviar).toBeChecked();
    const envio = nova.getByRole('region', { name: 'Mandar requisição' });
    await expect(envio.getByRole('combobox', { name: 'Método' })).toBeVisible();
    await expect(envio.getByRole('spinbutton', { name: 'Tempo limite (s)' })).toBeVisible();
    await expect(envio.getByRole('textbox', { name: 'Corpo' })).toBeVisible();
    await expect(envio.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
  });

  test('deve traduzir Métricas: o título, os cartões e a janela contada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: '{"id":1}' });

    await page.goto(`/#/${tokenId}/insights`);

    await expect(page.getByRole('heading', { name: 'Métricas', level: 1 })).toBeVisible();
    for (const nome of ['Resumo', 'Requisições por hora', 'Respostas por status']) {
      await expect(page.getByRole('region', { name: nome, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Respostas por status' })).toContainText(
      'Contado na requisição mais nova.',
    );
  });

  test('deve traduzir a página do link só-leitura, com o link de pé e com ele fora do ar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: '{"id":1}' });
    const link = await page.request.post(`/token/${tokenId}/request/${requestId}/share`, {
      data: {},
    });
    expect([200, 201]).toContain(link.status());
    const { id } = (await link.json()) as { id: string };

    await page.goto(`/#/share/${id}`);

    await expect(page.getByText(/Link só-leitura compartilhado · expira/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Corpo\b/ })).toBeVisible();

    await page.goto('/#/share/00000000-0000-4000-8000-000000000000');

    await expect(
      page.getByRole('heading', { name: 'Este link não está disponível', level: 1 }),
    ).toBeVisible();
  });

  test('deve traduzir o Comparar: a região, as tabelas e os títulos dos quadros', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, { headers: { 'X-Lado': 'a' }, data: 'um' });
    const b = await tokens.send(tokenId, { headers: { 'X-Lado': 'b' }, data: 'dois' });

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const view = page.getByRole('region', { name: 'Comparar requisições' });
    await expect(view.getByRole('heading', { name: 'Comparar', level: 1 })).toBeVisible();
    await expect(view.getByRole('table', { name: 'Verificações' })).toBeVisible();
    await expect(
      view.getByRole('table', { name: 'Cabeçalhos' }).getByRole('row', { name: /^x-lado\b/i }),
    ).toContainText('mudou');
    await expect(
      view.getByRole('heading', { name: /^0 mudanças explicam\s+o desfecho$/ }),
    ).toBeVisible();
    const outras = view.locator('section', {
      has: page.getByRole('heading', { name: /^\d+ outras? diferenças?$/ }),
    });
    await outras.getByRole('heading').click();
    await expect(outras.getByRole('listitem').filter({ hasText: 'x-lado' })).toHaveText(
      'cabeçalho x-lado',
    );
  });

  test('deve dizer no Comparar o que explica o desfecho: a assinatura, o cabeçalho dela e o erro de schema', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', properties: { valor: { type: 'integer' } } },
    });
    const a = await tokens.send(tokenId, assinado('outro-segredo', '{"valor":"10"}'));
    const b = await tokens.send(tokenId, assinado(SECRET, '{"valor":10}'));

    await page.goto(`/#/${tokenId}/compare/${a}/${b}`);

    const view = page.getByRole('region', { name: 'Comparar requisições' });
    await expect(
      view.getByRole('table', { name: 'Verificações' }).getByRole('rowheader'),
    ).toHaveText(['Assinatura', 'Schema', 'Resposta']);
    const explica = view.locator('section', {
      has: page.getByRole('heading', { name: /^2 mudanças explicam\s+o desfecho$/ }),
    });
    await expect(explica.getByRole('listitem')).toHaveText([
      'Assinatura: A não confere (signature mismatch) → B confere Ela vem no cabeçalho x-hub-signature-256, que difere entre A e B.',
      'Schema /valor: A veio texto, esperava inteiro (string found, integer expected) → B válido aqui',
    ]);
    await expect(explica).toContainText('e o cabeçalho de onde a assinatura foi lida.');
  });
});
