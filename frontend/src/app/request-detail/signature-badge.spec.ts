import { TestBed } from '@angular/core/testing';
import { webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { SignatureBadge } from './signature-badge';

describe('Dado o selo de assinatura no detalhe da mensagem', () => {
  const render = async (request: WebhookRequest) => {
    const fixture = TestBed.createComponent(SignatureBadge);
    fixture.componentRef.setInput('request', request);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (element: HTMLElement) => element.textContent?.replace(/\s+/g, ' ').trim();

  it.each([
    ['stripe', 'Stripe'],
    ['github', 'GitHub'],
    ['shopify', 'Shopify'],
    ['slack', 'Slack'],
    ['generic', 'Generic'],
  ] as const)(
    'deve dizer que a assinatura confere, com o nome do provedor, Quando a mensagem veio assinada pela %s',
    async (provider, nome) => {
      const element = await render(
        webhookRequest(1, { signature: { provider, valid: true, reason: null } }),
      );

      expect(text(element)).toBe(`Signature valid — ${nome}`);
      expect(element.querySelector('.valid')).not.toBeNull();
    },
  );

  it.each([
    'signature mismatch',
    'header X-Hub-Signature-256 absent',
    'timestamp outside tolerance (412 s)',
  ])('deve dizer por que a assinatura não confere Quando o motivo é "%s"', async (reason) => {
    const element = await render(
      webhookRequest(1, { signature: { provider: 'github', valid: false, reason } }),
    );

    expect(text(element)).toBe(`Signature invalid — ${reason}`);
    expect(element.querySelector('.invalid')).not.toBeNull();
  });

  it.each([
    ['nula (URL sem verificação)', { signature: null }],
    ['ausente (mensagem gravada antes da verificação)', {}],
  ])('não deve mostrar nada Quando a assinatura é %s', async (_caso, campos) => {
    const element = await render(webhookRequest(1, campos));

    expect(text(element)).toBe('');
  });
});
