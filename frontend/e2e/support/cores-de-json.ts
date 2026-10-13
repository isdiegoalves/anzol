import { Locator } from '@playwright/test';
import { expect } from './fixtures';

/** A camada de cores que o `app-json-colors` põe sobre a `textarea`. */
export function camadaDeCores(campo: Locator): Locator {
  return campo.locator('xpath=..').locator('.colors');
}

/** O que a camada e a `textarea` medem: onde o texto começa, a caixa dele, a altura que rola, a rolagem e a letra. */
function medidas(campo: Locator) {
  return campo.evaluate((area: HTMLTextAreaElement) => {
    const de = (el: HTMLElement) => {
      const caixa = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return {
        x: caixa.left + el.clientLeft + parseFloat(css.paddingLeft),
        y: caixa.top + el.clientTop + parseFloat(css.paddingTop),
        largura: el.clientWidth,
        altura: el.clientHeight,
        conteudo: el.scrollHeight,
        rolagem: [el.scrollLeft, el.scrollTop],
        letra: [css.fontFamily, css.fontSize, css.lineHeight, css.letterSpacing, css.whiteSpace],
      };
    };
    return {
      camada: de(area.parentElement!.querySelector<HTMLElement>('.colors')!),
      campo: de(area),
    };
  });
}

/**
 * A camada repete o texto da `textarea` e o põe no mesmo lugar, parada e rolada: mesma caixa (a barra de rolagem
 * conta), mesma letra e mesma altura de conteúdo, que é o mesmo número de linhas.
 */
export async function conferirCamadaDeCores(
  campo: Locator,
  rolar: readonly [number, number],
): Promise<void> {
  await expect(camadaDeCores(campo)).toHaveText(await campo.inputValue());
  const parado = await medidas(campo);
  expect(parado.camada).toEqual(parado.campo);

  await campo.evaluate((area, [x, y]) => area.scrollTo(x, y), rolar);
  await expect.poll(async () => (await medidas(campo)).camada.rolagem).toEqual([...rolar]);
  const rolado = await medidas(campo);
  expect(rolado.camada).toEqual(rolado.campo);
}

/** A tinta do texto da `textarea`: transparente com a camada de cores por cima; sem ela, visível. */
export function tintaDoTexto(campo: Locator): Promise<'transparente' | 'visível'> {
  return campo.evaluate((area) =>
    getComputedStyle(area).webkitTextFillColor === 'rgba(0, 0, 0, 0)' ? 'transparente' : 'visível',
  );
}
