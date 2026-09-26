import { TestBed } from '@angular/core/testing';
import { webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { SchemaBadge } from './schema-badge';

describe('Dado o selo de schema no detalhe da mensagem', () => {
  const render = async (request: WebhookRequest) => {
    const fixture = TestBed.createComponent(SchemaBadge);
    fixture.componentRef.setInput('request', request);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

  it('deve dizer que o corpo segue o schema, em verde, Quando a validação passou', async () => {
    const element = await render(webhookRequest(1, { schema: { valid: true, errors: [] } }));

    expect(text(element)).toBe('Schema valid');
    expect(element.querySelector('.valid')).not.toBeNull();
    expect(element.querySelector('.invalid')).toBeNull();
  });

  it('deve listar cada erro com o caminho e a mensagem, em vermelho, Quando a validação falhou', async () => {
    const element = await render(
      webhookRequest(1, {
        schema: {
          valid: false,
          errors: [
            { path: '/itens/0/qtd', message: 'must be integer' },
            { path: '/cliente', message: 'required property "nome" not found' },
          ],
        },
      }),
    );

    expect(element.querySelector('.invalid')).not.toBeNull();
    expect(text(element.querySelector('.invalid p'))).toBe('Schema invalid');
    expect([...element.querySelectorAll('li')].map(text)).toEqual([
      '/itens/0/qtd must be integer',
      '/cliente required property "nome" not found',
    ]);
    expect([...element.querySelectorAll('li code')].map(text)).toEqual([
      '/itens/0/qtd',
      '/cliente',
    ]);
  });

  it('deve mostrar (root) no lugar do caminho vazio Quando o erro é do corpo inteiro', async () => {
    const element = await render(
      webhookRequest(1, {
        content: 'nome=Ana',
        schema: { valid: false, errors: [{ path: '', message: 'body is not JSON' }] },
      }),
    );

    expect([...element.querySelectorAll('li')].map(text)).toEqual(['(root) body is not JSON']);
  });

  it.each([
    ['nulo (URL sem schema)', { schema: null }],
    ['ausente (mensagem gravada antes da validação)', {}],
  ])('não deve mostrar nada Quando o resultado é %s', async (_caso, campos) => {
    const element = await render(webhookRequest(1, campos));

    expect(text(element)).toBe('');
  });
});
