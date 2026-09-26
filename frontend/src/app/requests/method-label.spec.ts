import { methodColor } from './method-label';

describe('Dado o método HTTP de uma mensagem', () => {
  it.each([
    ['POST', 'info'],
    ['GET', 'success'],
    ['DELETE', 'danger'],
    ['HEAD', 'primary'],
    ['PATCH', 'warning'],
    ['PUT', 'default'],
    ['', 'default'],
  ])('deve usar a cor do label do app atual Quando o método é "%s"', (metodo, esperado) => {
    expect(methodColor(metodo)).toBe(esperado);
  });
});
