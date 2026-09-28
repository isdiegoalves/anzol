import { randomUUID } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { compacto } from './shell';

/*
 * Patamar (a combinação), base comum B1–B3: nomes acessíveis novos do guia `.docs-arquivo/patamar/guia-combinacao.md`
 * (§3.1 a §3.3), em inglês (texto-fonte do `$localize`). O que o guia não fixa está marcado SUPOSIÇÃO no spec da
 * fatia (`patamar-b*.spec.ts`).
 */

/** Chave do `localStorage` com as URLs conhecidas do navegador (guia §4.1). */
export const CHAVE_URLS = 'anzol.urls';

export interface UrlConhecida {
  uuid: string;
  nickname?: string;
  openedAt?: string | number;
}

/** Os 5 primeiros caracteres do UUID, como a tela mostra. */
export function id5(uuid: string): string {
  return uuid.substring(0, 5);
}

/** Um UUID válido que o servidor não conhece. */
export function urlInexistente(): string {
  return randomUUID();
}

/** O botão do seletor de URLs no cabeçalho: "{apelido ou URL xxxxx}. Switch URL". */
export function seletor(page: Page): Locator {
  return page.getByRole('button', { name: /\. Switch URL$/ });
}

/**
 * Abre o seletor de URLs. No desktop é o `menu "URLs in this browser"` preso ao botão; no celular, a folha inferior
 * `dialog "URLs in this browser"`.
 */
export async function abrirSeletor(page: Page): Promise<Locator> {
  await seletor(page).click();
  const painel = page
    .getByRole('menu', { name: 'URLs in this browser' })
    .or(page.getByRole('dialog', { name: 'URLs in this browser' }));
  await expect(painel).toBeVisible();
  return painel;
}

/** O item de uma URL no seletor: `menuitemradio "{nome}, {id5}, {estado}"`. */
export function urlNoSeletor(painel: Locator, uuid: string): Locator {
  return painel.getByRole('menuitemradio', { name: new RegExp(`, ${id5(uuid)}, `) });
}

/** A lista `anzol.urls` do navegador. */
export function urlsConhecidas(page: Page): Promise<UrlConhecida[]> {
  return page.evaluate(
    (chave) => JSON.parse(localStorage.getItem(chave) ?? '[]') as UrlConhecida[],
    CHAVE_URLS,
  );
}

/** O valor de `anzol.urls` para o `seedStorage`, da mais recente para a mais antiga. */
export function listaDeUrls(urls: { uuid: string; nickname?: string }[]): string {
  const agora = Date.now();
  return JSON.stringify(
    urls.map(({ uuid, nickname }, i) => ({
      uuid,
      nickname: nickname ?? '',
      openedAt: new Date(agora - i * 60_000).toISOString(),
    })),
  );
}

/** `status "Connection"`: a região viva da faixa "sem conexão", abaixo do cabeçalho da URL. */
export function conexao(page: Page): Locator {
  return page.getByRole('status', { name: 'Connection' });
}

/** `button "Filters"` (o nome ganha ", {n} active" com filtros ligados). */
export function botaoDeFiltros(page: Page): Locator {
  return page.getByRole('button', { name: /^Filters(, \d+ active)?$/ });
}

/** `list "Active filters"`, abaixo da linha de busca. */
export function filtrosLigados(page: Page): Locator {
  return page.getByRole('list', { name: 'Active filters' });
}

/**
 * Fecha o painel de filtros no celular (folha inferior com `button "Show {n} requests"`), para a lista voltar à
 * vista. No desktop o painel empurra a lista e pode ficar aberto.
 */
export async function verResultado(page: Page): Promise<void> {
  if (compacto(page)) {
    await page.getByRole('button', { name: /^Show \d+ requests?$/ }).click();
  }
}

/** `region "Unsaved changes"`: a barra de salvar de Verificações (B3). */
export function barraDeSalvar(page: Page): Locator {
  return page.getByRole('region', { name: 'Unsaved changes' });
}

/** `status "Request notice"`: a região viva do topo do detalhe (B2). */
export function avisoDaRequisicao(page: Page): Locator {
  return page.getByRole('status', { name: 'Request notice' });
}

/** Itens inteiros dentro da janela: o retângulo do item cabe todo na área visível. */
export function itensInteirosNaTela(page: Page): Promise<number> {
  return page.locator('.item').evaluateAll((itens) => {
    const visivel = (el: Element): boolean => {
      const caixa = el.getBoundingClientRect();
      if (caixa.height === 0 || caixa.top < 0 || caixa.bottom > innerHeight) {
        return false;
      }
      // O ponto do meio do item é dele mesmo: nada (rodapé, barra fixa) o cobre.
      const meio = document.elementFromPoint(caixa.left + caixa.width / 2, caixa.bottom - 2);
      return !!meio && (el.contains(meio) || meio.contains(el));
    };
    return itens.filter(visivel).length;
  });
}
