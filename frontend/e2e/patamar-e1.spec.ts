import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { escutarAnuncios, expectUmAnuncio, limparAnuncios } from './support/anuncios';
import { TokenTracker, expect, test } from './support/fixtures';
import {
  abrirFiltros,
  abrirItem,
  abrirMensagem,
  acaoDaMensagem,
  acoes,
  campoDeBusca,
  detalhes,
  filtro,
  item,
  lista,
  mostrarLista,
} from './support/inbox';
import { comHoras, horaDaApi, id5, verResultadoSeAberto } from './support/patamar';
import { gravarRegras } from './support/regras';
import { compacto } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

const CHAVE = 'x-loja-event-id';
const SECRET = 'segredo-do-patamar-e1';
const ACEITA = {
  name: 'Retry: aceita',
  priority: 1,
  match: { headers: { 'x-final': { present: true } } },
  response: { status: 200 },
};

interface Envio {
  evento?: string;
  /** A última tentativa: a regra "Retry: aceita" responde 200. */
  final?: boolean;
  assinatura?: 'certa' | 'errada';
  metodo?: string;
  caminho?: string;
}

let contador = 0;

async function enviar(tokens: TokenTracker, tokenId: string, envio: Envio): Promise<string> {
  const corpo = JSON.stringify({ n: ++contador, carimbo: `c-${contador}-${Date.now()}` });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (envio.evento) {
    headers[CHAVE] = envio.evento;
  }
  if (envio.final) {
    headers['x-final'] = '1';
  }
  if (envio.assinatura) {
    const segredo = envio.assinatura === 'certa' ? SECRET : 'outro-segredo';
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
  }
  return tokens.send(tokenId, {
    method: envio.metodo ?? 'POST',
    path: envio.caminho ?? '/notificacoes',
    headers,
    data: envio.metodo === 'GET' ? undefined : corpo,
  });
}

interface Cenario {
  tokenId: string;
  a: string[];
  b: string[];
  c: string[];
  saude: string;
}

/**
 * Três eventos intercalados e uma chamada solta, na ordem de chegada: A1, B1, A2 (assinatura errada), C1, B2, saúde
 * (GET sem a chave), A3 (final, 200) e C2. A URL responde 429 por padrão, com Retry-After 3, e verifica assinatura.
 */
async function intercalados(tokens: TokenTracker, page: Page): Promise<Cenario> {
  const tokenId = await tokens.create({
    default_status: '429',
    retry_after: '3',
    signature: { provider: 'github', secret: SECRET },
  });
  await gravarRegras(page.request, tokenId, [ACEITA]);
  const certa = { assinatura: 'certa' as const };
  const a1 = await enviar(tokens, tokenId, { evento: 'evt_a', ...certa });
  const b1 = await enviar(tokens, tokenId, { evento: 'evt_b', ...certa });
  const a2 = await enviar(tokens, tokenId, { evento: 'evt_a', assinatura: 'errada' });
  const c1 = await enviar(tokens, tokenId, { evento: 'evt_c', ...certa });
  const b2 = await enviar(tokens, tokenId, { evento: 'evt_b', ...certa });
  const saude = await enviar(tokens, tokenId, { metodo: 'GET', caminho: '/saude' });
  const a3 = await enviar(tokens, tokenId, { evento: 'evt_a', final: true, ...certa });
  const c2 = await enviar(tokens, tokenId, { evento: 'evt_c', ...certa });
  return { tokenId, a: [a1, a2, a3], b: [b1, b2], c: [c1, c2], saude };
}

function oferta(page: Page): Locator {
  return page.getByRole('region', { name: 'Group by event' });
}

function evento(page: Page, valor: string): Locator {
  return lista(page).getByRole('button', { name: new RegExp(`^Event ${valor}, `) });
}

function tentativas(page: Page, valor: string): Locator {
  return lista(page).getByRole('button', { name: `Attempts of ${valor}`, exact: true });
}

/** Digita o campo: vale com ou sem candidato achado. */
async function agruparPor(page: Page, campo: string): Promise<void> {
  await abrirFiltros(page);
  await page.getByRole('button', { name: 'Group by event…' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Group by event' });
  await dialogo.getByRole('radio', { name: 'Another header or body path' }).check();
  await dialogo.getByRole('textbox', { name: 'Header name or JSONPath' }).fill(campo);
  await dialogo.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await verResultadoSeAberto(page);
}

/**
 * No celular, a Entrada abre a primeira requisição e o endereço passa a apontar para ela; recarregado, esse endereço
 * é um link para ela, e o detalhe vem para a frente.
 */
async function listaDepoisDeRecarregar(page: Page): Promise<void> {
  if (compacto(page)) {
    await mostrarLista(page);
  }
}

async function abrirEntrada(page: Page, tokenId: string, n: number): Promise<void> {
  await page.goto(`/#/${tokenId}`);
  await expect(page.getByRole('heading', { name: `Requests (${n})` })).toBeVisible();
}

/** O fundo que o elemento mostra (o dele ou o do primeiro ancestral pintado, até a linha). */
function fundo(alvo: Locator): Promise<string> {
  return alvo.evaluate((el) => {
    for (let no: Element | null = el; no; no = no.parentElement) {
      const cor = getComputedStyle(no).backgroundColor;
      if (cor !== 'rgba(0, 0, 0, 0)' && cor !== 'transparent') {
        return cor;
      }
      if (no.getAttribute('role') === 'region') {
        break;
      }
    }
    return 'sem fundo';
  });
}

test.describe('Dado a oferta de agrupar por evento', () => {
  test('deve oferecer o agrupamento Quando as requisições repetem o mesmo campo, uma vez por URL', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);

    const faixa = oferta(page);
    await expect(faixa).toContainText(
      `Some requests repeat the same ${CHAVE}. Group them by event?`,
    );
    await expect(faixa.getByRole('button', { name: 'Group by event', exact: true })).toBeVisible();
    await expect(faixa.getByRole('button', { name: 'Choose another field…' })).toBeVisible();
    // Sem a chave, a lista é a plana: nenhuma linha de evento.
    await expect(lista(page).getByRole('button', { name: /^Event / })).toHaveCount(0);

    await faixa.getByRole('button', { name: 'Not now' }).click();
    await expect(faixa).toHaveCount(0);
    await page.reload();
    await listaDepoisDeRecarregar(page);
    await expect(page.getByRole('heading', { name: 'Requests (8)' })).toBeVisible();
    await expect(oferta(page)).toHaveCount(0);
  });

  const semRepeticao: [string, (string | undefined)[]][] = [
    ['nenhum valor se repete', ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']],
    ['o valor é o mesmo em todas', ['igual', 'igual', 'igual', 'igual', 'igual', 'igual']],
    ['só dois valores se repetem', ['x', 'y', 'x', 'y', 'x', 'y']],
    ['nenhuma requisição tem o campo', [undefined, undefined, undefined, undefined]],
  ];
  for (const [caso, valores] of semRepeticao) {
    test(`não deve oferecer nem falar em evento Quando ${caso}`, async ({ page, tokens }) => {
      const tokenId = await tokens.create();
      for (const valor of valores) {
        await enviar(tokens, tokenId, { evento: valor });
      }
      await seedStorage(page, {});
      await abrirEntrada(page, tokenId, valores.length);
      await expect(item(page, (await tokens.listed(tokenId))[0].uuid)).toBeVisible();

      await expect(oferta(page)).toHaveCount(0);
      // Pelo texto à vista (o painel de filtros recolhido pode ter o "Group by event…" no DOM).
      expect(await lista(page).innerText()).not.toMatch(/\bevents?\b/i);
      await expect(lista(page).getByRole('button', { name: /^Event / })).toHaveCount(0);
    });
  }

  test('deve oferecer o agrupamento ao abrir um link com ?event= e &key= num navegador sem a chave', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}/${a[2]}/1?event=evt_a&key=${CHAVE}`);

    await expect(detalhes(page)).toContainText(a[2]);
    if (!compacto(page)) {
      await expect(oferta(page)).toContainText(CHAVE);
      await expect(
        oferta(page).getByRole('button', { name: 'Group by event', exact: true }),
      ).toBeVisible();
    }
  });
});

test.describe('Dado a Entrada agrupada pela chave do evento', () => {
  test('deve agrupar pela oferta, dizer o estado no cabeçalho, anunciar uma vez e guardar a chave no navegador', async ({
    page,
    tokens,
  }) => {
    const { tokenId, saude, a } = await intercalados(tokens, page);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await limparAnuncios(page);

    await oferta(page).getByRole('button', { name: 'Group by event', exact: true }).click();

    await expect(lista(page)).toContainText(`Grouped by ${CHAVE}`);
    await expect(lista(page)).toContainText('3 events in the 8 loaded');
    await expectUmAnuncio(page, new RegExp(`^Grouped by ${CHAVE}\\. 3 events in the 8 loaded\\.$`));
    // O título continua contando requisições.
    await expect(page.getByRole('heading', { name: 'Requests (8)' })).toBeVisible();
    for (const valor of ['evt_a', 'evt_b', 'evt_c']) {
      await expect(evento(page, valor)).toBeVisible();
      await expect(tentativas(page, valor)).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(evento(page, 'evt_a')).toHaveAccessibleName(
      /^Event evt_a, POST \/notificacoes, 3 attempts in .+, answers 429 429 200, .*Open the newest attempt$/,
    );
    // A requisição sem o campo continua uma linha comum, no lugar dela.
    await expect(item(page, saude)).toBeVisible();
    await expect(item(page, saude)).toContainText(`#${id5(saude)}`);
    // As tentativas não aparecem soltas com o evento recolhido.
    await expect(item(page, a[0])).toHaveCount(0);
    expect((await readStorage(page))[`anzol.eventKey.${tokenId}`]).toContain(CHAVE);

    await page.reload();
    await listaDepoisDeRecarregar(page);
    await expect(evento(page, 'evt_a')).toBeVisible();
  });

  test('deve abrir a tentativa mais nova pelo corpo da linha, e só mostrar as tentativas pelo chevron', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    const aberta = compacto(page) ? null : new URL(page.url()).hash;

    await tentativas(page, 'evt_a').click();

    await expect(tentativas(page, 'evt_a')).toHaveAttribute('aria-expanded', 'true');
    if (aberta !== null) {
      expect(new URL(page.url()).hash, 'o chevron não abre requisição nenhuma').toBe(aberta);
    }
    // Da mais nova para a mais antiga, com o número da tentativa e o nome acessível de hoje depois do prefixo.
    const nomes = await lista(page)
      .getByRole('button', { name: /^Attempt \d+ of 3, / })
      .evaluateAll((botoes) => botoes.map((b) => b.getAttribute('aria-label') ?? b.textContent));
    expect(nomes.map((n) => /^Attempt (\d+) of 3/.exec(n ?? '')?.[1])).toEqual(['3', '2', '1']);
    await expect(abrirItem(page, a[2])).toHaveAccessibleName(
      new RegExp(`^Attempt 3 of 3, \\d+ s after the previous, POST /notificacoes, #${id5(a[2])}, `),
    );
    await expect(item(page, a[2])).toContainText('attempt 3');
    await expect(item(page, a[2]).getByText('200 · Retry: aceita', { exact: true })).toBeVisible();
    await expect(item(page, a[0])).toContainText('attempt 1');

    await tentativas(page, 'evt_a').click();
    await expect(item(page, a[2])).toHaveCount(0);
    await evento(page, 'evt_a').click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${a[2]}/1`));
    await expect(detalhes(page)).toContainText(a[2]);
  });

  test('não deve ter selo de julgamento nem verde na linha de evento', async ({ page, tokens }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    const linha = evento(page, 'evt_a');

    // Termina em 200 com uma assinatura que não confere: a linha diz exatamente isso, sem julgar.
    await expect(linha).toContainText(/429\s*429\s*✗\s*200/);
    await expect(linha).toContainText(/1 signatures? (do|does) not match/);
    await expect(linha).not.toContainText(
      /Delivered|Entregue|Success|Sucesso|Failed|Falhou|Recusad|Rejected/i,
    );
    await expect(linha).toHaveAccessibleName(/1 signatures? (do|does) not match/);

    // Os selos da trilha são neutros: o 200 tem o fundo do 429, e nenhum tem o verde do selo de assinatura válida.
    const de200 = await fundo(linha.getByText('200', { exact: true }));
    const de429 = await fundo(linha.getByText('429', { exact: true }).first());
    expect(de200, 'o 200 da trilha tem a mesma cor do 429').toBe(de429);
    await tentativas(page, 'evt_a').click();
    const assinaturaValida = item(page, a[2]).locator(
      'app-check-chip[data-kind="signature"][data-state="valid"]',
    );
    await expect(assinaturaValida).toBeVisible();
    expect(de200, 'a trilha não usa o verde').not.toBe(await fundo(assinaturaValida));
  });

  test('deve mostrar o evento de uma tentativa só como item comum, com o valor da chave no lugar do #id', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await intercalados(tokens, page);
    const sozinha = await enviar(tokens, tokenId, { evento: 'evt_unico', assinatura: 'certa' });
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 9);
    await agruparPor(page, CHAVE);

    await expect(evento(page, 'evt_unico')).toHaveCount(0);
    await expect(item(page, sozinha)).toContainText('evt_unico');
    await expect(item(page, sozinha)).not.toContainText(`#${id5(sozinha)}`);
    await abrirItem(page, sozinha).click();
    await expect(detalhes(page)).toContainText(sozinha);
  });

  test('deve desagrupar por "Do not group" e anunciar uma vez', async ({ page, tokens }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    await expect(evento(page, 'evt_a')).toBeVisible();
    await limparAnuncios(page);

    await lista(page).getByRole('button', { name: 'Change the event key' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Group by event' });
    await dialogo.getByRole('radio', { name: 'Do not group' }).check();
    await dialogo.getByRole('button', { name: 'Group', exact: true }).click();

    await expectUmAnuncio(page, /^Showing requests one by one\.$/);
    await expect(lista(page).getByRole('button', { name: /^Event / })).toHaveCount(0);
    await expect(item(page, a[0])).toBeVisible();
    await expect(lista(page)).not.toContainText('Grouped by');
  });

  test('deve mostrar os candidatos com a prévia no diálogo e recusar uma chave que não é cabeçalho nem JSONPath', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await abrirFiltros(page);
    await page.getByRole('button', { name: 'Group by event…' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Group by event' });

    await expect(dialogo).toContainText(
      'Requests with the same value in this field are shown together.',
    );
    const candidato = dialogo
      .getByRole('radiogroup', { name: 'Event key' })
      .getByRole('radio', { name: new RegExp(`^Header ${CHAVE}\\b.*3 values in 8`) });
    await candidato.check();
    await expect(dialogo).toContainText('The 8 loaded requests become 3 events.');
    await expect(dialogo).toContainText('Kept only in this browser.');

    await dialogo.getByRole('radio', { name: 'Another header or body path' }).check();
    const campo = dialogo.getByRole('textbox', { name: 'Header name or JSONPath' });
    await campo.fill('x-nao-existe');
    await expect(dialogo).toContainText('No loaded request has this field.');
    await campo.fill('isto não é chave');
    await dialogo.getByRole('button', { name: 'Group', exact: true }).click();
    await expect(dialogo.getByRole('alert')).toContainText(
      'This is not a header name or a JSONPath like $.id.',
    );
    await expect(dialogo).toBeVisible();
  });

  test('deve agrupar o resultado da busca e dizer em quantos eventos ele está', async ({
    page,
    tokens,
  }) => {
    const { tokenId } = await intercalados(tokens, page);
    await escutarAnuncios(page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    await limparAnuncios(page);

    await campoDeBusca(page).fill('evt_b');

    await expectUmAnuncio(page, /^2 requests match, in 1 event/);
    await expect(evento(page, 'evt_b')).toBeVisible();
    await expect(evento(page, 'evt_a')).toHaveCount(0);
  });

  test('deve mostrar a trilha inteira e dizer quantas tentativas casam Quando o filtro pega só parte do evento', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);

    await abrirFiltros(page);
    await filtro(page, 'Signature invalid').click();
    await verResultadoSeAberto(page);

    const linha = evento(page, 'evt_a');
    await expect(linha).toContainText('1 of 3 attempts match');
    await expect(linha).toContainText(/429\s*429\s*✗\s*200/);
    await expect(evento(page, 'evt_b')).toHaveCount(0);
    await tentativas(page, 'evt_a').click();
    await expect(item(page, a[1])).toBeVisible();
  });

  test('deve expandir e recolher pelas setas, com o chevron fora da ordem do Tab', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'teclado: só no desktop');
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    const antes = new URL(page.url()).hash;

    await evento(page, 'evt_a').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tentativas(page, 'evt_a')).toHaveAttribute('aria-expanded', 'true');
    await expect(tentativas(page, 'evt_a')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowRight');
    await expect(abrirItem(page, a[2])).toBeFocused();
    expect(new URL(page.url()).hash, 'as setas não abrem requisição').toBe(antes);
    await page.keyboard.press('ArrowLeft');
    await expect(evento(page, 'evt_a')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tentativas(page, 'evt_a')).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Dado o intervalo entre as tentativas e o Retry-After', () => {
  /**
   * Um evento com quatro tentativas respondidas pela resposta padrão (429, Retry-After 3), e as horas fixadas: a
   * segunda chega 1 s depois (antes da espera), a terceira 3 s depois (no limite) e a quarta 5 s depois (esperou).
   */
  async function comIntervalos(
    tokens: TokenTracker,
    page: Page,
    retryAfter: string,
    intervalos = [1, 3, 5],
  ) {
    const tokenId = await tokens.create({ default_status: '429', retry_after: retryAfter });
    const ids = [];
    for (let i = 0; i <= intervalos.length; i++) {
      ids.push(await enviar(tokens, tokenId, { evento: 'evt_r' }));
    }
    const outros = [];
    for (const outro of ['evt_s', 'evt_s', 'evt_t', 'evt_t']) {
      outros.push(await enviar(tokens, tokenId, { evento: outro }));
    }
    const base = Math.floor(Date.now() / 1000) * 1000 - 600_000;
    const horas: Record<string, string> = {};
    let quando = base;
    ids.forEach((uuid, i) => {
      quando += (i === 0 ? 0 : intervalos[i - 1]) * 1000;
      horas[uuid] = horaDaApi(quando);
    });
    // Os outros eventos também têm hora fixa, 10 s entre as tentativas: mandados em sequência,
    // chegariam a 0 s um do outro contra 3 s pedidos, e a linha deles diria que uma chegou antes.
    outros.forEach((uuid, i) => {
      horas[uuid] = horaDaApi(base + 60_000 + i * 10_000);
    });
    await seedStorage(page, {});
    await comHoras(page, tokenId, horas);
    await abrirEntrada(page, tokenId, ids.length + 4);
    await agruparPor(page, CHAVE);
    await tentativas(page, 'evt_r').click();
    return { tokenId, ids };
  }

  test('deve dar os três vereditos: chegou antes, no limite e esperou', async ({
    page,
    tokens,
  }) => {
    const { ids } = await comIntervalos(tokens, page, '3');

    await expect(item(page, ids[1])).toContainText('+1 s');
    await expect(item(page, ids[2])).toContainText('+3 s');
    await expect(item(page, ids[3])).toContainText('+5 s');
    const antes = lista(page).getByText(
      'Came 1 s after the previous answer. It asked to wait 3 s.',
    );
    const noLimite = lista(page).getByText(
      'Came about 3 s after. Times are kept to the second, so this cannot be told apart from 3 s.',
    );
    const esperou = lista(page).getByText('Waited 5 s. It asked to wait 3 s.');
    await expect(antes).toBeVisible();
    await expect(noLimite).toBeVisible();
    await expect(esperou).toBeVisible();
    // A primeira tentativa não tem anterior: três vereditos para quatro tentativas, e nenhum outro texto.
    await expect(lista(page).getByText(/It asked to wait|cannot be told apart/)).toHaveCount(3);
    await expect(lista(page)).toContainText(
      'Wait asked: Retry-After: 3, as configured now. Times are kept to the second.',
    );
    // "Chegou antes" é aviso; "no limite" e "esperou" são neutros. Nada de julgamento.
    const corDeAntes = await fundo(antes);
    expect(await fundo(noLimite)).toBe(await fundo(esperou));
    expect(corDeAntes).not.toBe(await fundo(esperou));
    await expect(lista(page)).not.toContainText(
      /too early|too soon|violat|wrong|correct|as scheduled/i,
    );
  });

  test('deve resumir na linha do evento quantas chegaram antes da espera pedida', async ({
    page,
    tokens,
  }) => {
    await comIntervalos(tokens, page, '3', [1, 2, 5]);

    await expect(evento(page, 'evt_r')).toContainText(/2 attempts came before the asked wait/);
    await expect(evento(page, 'evt_s')).not.toContainText('before the asked wait');
  });

  test('deve tratar a fronteira de um segundo: d = r − 1 é "antes" e d = r + 1 é "esperou"', async ({
    page,
    tokens,
  }) => {
    await comIntervalos(tokens, page, '3', [2, 4]);

    await expect(
      lista(page).getByText('Came 2 s after the previous answer. It asked to wait 3 s.'),
    ).toBeVisible();
    await expect(lista(page).getByText('Waited 4 s. It asked to wait 3 s.')).toBeVisible();
    await expect(lista(page).getByText(/cannot be told apart/)).toHaveCount(0);
  });

  test('deve mostrar só o intervalo Quando a espera pedida não é um número fixo de segundos', async ({
    page,
    tokens,
  }) => {
    const { ids } = await comIntervalos(tokens, page, 'Wed, 21 Oct 2026 07:28:00 GMT');

    await expect(item(page, ids[1])).toContainText('+1 s');
    await expect(lista(page)).toContainText(
      'The wait asked is not a fixed number of seconds, so only the interval is shown.',
    );
    await expect(lista(page).getByText(/It asked to wait|cannot be told apart/)).toHaveCount(0);
  });
});

test.describe('Dado uma entrega longa', () => {
  test('deve comprimir a trilha e recolher as tentativas do meio', async ({ page, tokens }) => {
    test.skip(compacto(page), 'os números são os do desktop; o celular recolhe acima de 4');
    const tokenId = await tokens.create({ default_status: '429' });
    await gravarRegras(page.request, tokenId, [ACEITA]);
    const ids = [];
    for (let i = 0; i < 9; i++) {
      ids.push(await enviar(tokens, tokenId, { evento: 'evt_longo' }));
    }
    ids.push(await enviar(tokens, tokenId, { evento: 'evt_longo', final: true }));
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 10);
    await agruparPor(page, CHAVE);

    await expect(evento(page, 'evt_longo')).toContainText(/429\s*×\s*9/);
    await expect(evento(page, 'evt_longo')).toContainText('200');
    await expect(evento(page, 'evt_longo')).toContainText(/10 attempts in \d+ s/);

    await tentativas(page, 'evt_longo').click();
    // As 3 mais novas, o botão do meio e as 2 mais antigas.
    for (const visivel of [ids[9], ids[8], ids[7], ids[1], ids[0]]) {
      await expect(item(page, visivel)).toBeVisible();
    }
    await expect(item(page, ids[4])).toHaveCount(0);
    const todas = lista(page).getByRole('button', { name: 'Show all 10 attempts' });
    await expect(todas).toContainText('5 more attempts');
    await todas.click();
    await expect(item(page, ids[4])).toBeVisible();
  });

  test('deve ter a linha de evento de 3 linhas e 84 px, com o chevron de 48 px, no celular', async ({
    page,
    tokens,
  }) => {
    test.skip(!compacto(page), 'só no celular');
    const { tokenId } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);

    const linha = (await evento(page, 'evt_a').boundingBox())!;
    expect(Math.abs(linha.height - 84)).toBeLessThanOrEqual(1);
    const chevron = (await tentativas(page, 'evt_a').boundingBox())!;
    expect(Math.min(chevron.width, chevron.height)).toBeGreaterThanOrEqual(48);
    const rola = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(rola, 'a trilha quebra de linha, não rola de lado').toBe(false);
  });
});

test.describe('Dado comparar com a tentativa anterior do mesmo evento', () => {
  function comparacao(page: Page): Locator {
    return page.getByRole('region', { name: 'Compare requests' });
  }

  test('deve comparar com a tentativa anterior do evento, e não com a vizinha da lista', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a, saude } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    // A3 tem como vizinha na lista a chamada de saúde, de outro assunto; a anterior do evento é a A2.
    await abrirMensagem(page, tokenId, a[2]);

    await acaoDaMensagem(page, 'Compare with attempt 2');

    const lados = comparacao(page);
    await expect(lados).toContainText(`#${id5(a[1])}`);
    await expect(lados).toContainText(`#${id5(a[2])}`);
    await expect(lados).not.toContainText(`#${id5(saude)}`);

    // "Previous pair" anda dentro do evento: A1 com A2.
    await lados.getByRole('button', { name: 'Previous pair' }).click();
    await expect(lados).toContainText(`#${id5(a[0])}`);
    await expect(lados).toContainText(`#${id5(a[1])}`);
    await expect(lados).not.toContainText(`#${id5(a[2])}`);
    await expect(lados.getByRole('button', { name: 'Previous pair' })).toBeDisabled();
  });

  test('deve desligar o botão, com a razão, na primeira tentativa do evento', async ({
    page,
    tokens,
  }) => {
    test.skip(compacto(page), 'no celular a ação fica no More; a razão é conferida no desktop');
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});
    await abrirEntrada(page, tokenId, 8);
    await agruparPor(page, CHAVE);
    await abrirMensagem(page, tokenId, a[0]);

    const botao = acoes(page).getByRole('button', { name: /^Compare with attempt/ });
    await expect(botao).toHaveAttribute('aria-disabled', 'true');
    await expect(botao).toHaveAccessibleDescription(
      'This is the first attempt kept of this event.',
    );
  });

  test('não deve oferecer "comparar com a anterior" sem a chave do evento', async ({
    page,
    tokens,
  }) => {
    const { tokenId, a } = await intercalados(tokens, page);
    await seedStorage(page, {});

    await abrirMensagem(page, tokenId, a[2]);

    await expect(page.getByRole('button', { name: /^Compare with attempt/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Compare with attempt/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Compare with (the )?previous/i })).toHaveCount(
      0,
    );
  });
});
