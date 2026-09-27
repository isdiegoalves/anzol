import { Locator, Page } from '@playwright/test';

/**
 * Shell da interface nova (item 14, E3). Os nomes acessíveis vêm da tabela "Nomes acessíveis" da §1 do plano, que
 * é o contrato entre as specs e as fatias. Os marcados "assumido" não estão na tabela: foram lidos do estudo C e
 * precisam entrar nela (ou ser trocados aqui) antes da E3 fechar.
 */

/** Os cinco destinos do rail (e da barra inferior abaixo de 600 px), na ordem. */
export const DESTINOS = ['Inbox', 'Rules', 'Checks', 'Outbound', 'Insights'] as const;
export type Destino = (typeof DESTINOS)[number];

/** Caminho de cada destino depois de `#/{token}` (tabela "Rotas" da §1). */
export const CAMINHO: Record<Destino, string> = {
  Inbox: '',
  Rules: '/rules',
  Checks: '/checks',
  Outbound: '/outbound',
  Insights: '/insights',
};

/** `navigation "URL sections"`: o rail (≥ 600 px) ou a barra inferior (< 600 px); só um visível por vez. */
export function secoes(page: Page): Locator {
  return page.getByRole('navigation', { name: 'URL sections' });
}

/**
 * Um destino do rail. Fidelidade ao C (INBOX-02, CHECKS-23): o nome ganha o sufixo do contador ("Inbox, 3 unread") ou
 * da atenção ("Checks, needs attention").
 */
export function destino(page: Page, nome: Destino): Locator {
  return secoes(page).getByRole('link', { name: new RegExp(`^${nome}(, .+)?$`) });
}

/** `status` com "Live", "Reconnecting…" ou "Offline" no cabeçalho da URL. */
export function estadoAoVivo(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: /(^|\s)(Live|Reconnecting…|Offline)(\s|$)/ });
}

/**
 * Fidelidade ao C (F1, INBOX-29/30): abaixo de 600 px, "New URL", "Settings" e "Help" saem da barra do topo e vão
 * para o menu ⋮ `button "More actions"` (itens "Send", "New URL", "Delete URL", "Settings" e "Help", e "Lock" numa
 * URL com segredo destrancada); "Edit URL" também fica nele. SUPOSIÇÃO: o corte é o mesmo do "More URL actions", que só existe a partir de 600 px.
 */
export function compacto(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1400) < 600;
}

/** O menu ⋮ da barra do topo no compacto. */
export function maisAcoes(page: Page): Locator {
  return page.getByRole('button', { name: 'More actions', exact: true });
}

/**
 * Uma ação do shell pronta para clicar: o botão, ou, no compacto, o `menuitem` do menu "More actions" (que esta
 * função abre).
 */
export async function acaoDoShell(
  page: Page,
  nome: 'New URL' | 'Settings' | 'Help' | 'Lock',
): Promise<Locator> {
  if (!compacto(page)) {
    return page.getByRole('button', { name: nome, exact: true });
  }
  await maisAcoes(page).click();
  return page.getByRole('menuitem', { name: nome, exact: true });
}

/** FAB "New URL" (§1: `button "New URL"`). */
export function novaUrl(page: Page): Locator {
  return page.getByRole('button', { name: 'New URL', exact: true });
}

/** Assumido (C §3.1: "Settings e Help embaixo" no rail): `button "Settings"`. */
export function configuracoes(page: Page): Locator {
  return page.getByRole('button', { name: 'Settings', exact: true });
}

/** Assumido: `button "Help"`, com a folha de atalhos e o About. */
export function ajuda(page: Page): Locator {
  return page.getByRole('button', { name: 'Help', exact: true });
}

/** Assumido: em Settings, `radiogroup "Theme"` com `radio` "System", "Light" e "Dark". */
export function tema(page: Page): Locator {
  return page.getByRole('radiogroup', { name: 'Theme' });
}

/**
 * Luminância relativa (WCAG) do fundo que o usuário vê no centro da tela: o primeiro fundo opaco subindo a partir
 * do elemento do centro. Sem fundo opaco nenhum, vale o `color-scheme` da raiz (o canvas do navegador).
 */
export function luminanciaDoFundo(page: Page): Promise<number> {
  return page.evaluate(() => {
    const contexto = document.createElement('canvas').getContext('2d');
    if (!contexto) {
      throw new Error('canvas 2d indisponível');
    }
    const rgba = (cor: string): number[] => {
      contexto.clearRect(0, 0, 1, 1);
      contexto.fillStyle = cor;
      contexto.fillRect(0, 0, 1, 1);
      return [...contexto.getImageData(0, 0, 1, 1).data];
    };
    const canal = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    let el: Element | null = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el) {
      const [r, g, b, a] = rgba(getComputedStyle(el).backgroundColor);
      if (a === 255) {
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
      }
      el = el.parentElement;
    }
    return getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 0 : 1;
  });
}

/** Fundo escuro e claro, com folga larga: o tema Harbor escuro fica bem abaixo, o claro bem acima. */
export const FUNDO_ESCURO = 0.2;
export const FUNDO_CLARO = 0.6;

/** A página rola na horizontal? (WCAG 1.4.10, reflow.) */
export function rolaNaHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}
