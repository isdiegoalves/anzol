import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { RuleBadge } from './rule-badge';

describe('Dado o selo de regra no detalhe da mensagem', () => {
  let fixture: ComponentFixture<RuleBadge>;
  let loader: HarnessLoader;

  const render = async (request: WebhookRequest) => {
    fixture = TestBed.createComponent(RuleBadge);
    fixture.componentRef.setInput('request', request);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (element: HTMLElement) => element.textContent?.replace(/\s+/g, ' ').trim();

  it('deve dizer qual regra respondeu Quando a mensagem tem rule', async () => {
    const element = await render(
      webhookRequest(1, { rule: { id: 'r1', name: 'Pix pago' }, near_miss: null }),
    );

    expect(text(element)).toBe('Answered by rule Pix pago');
  });

  it('deve dizer a regra mais próxima e esconder as frases até expandir Quando a mensagem tem near_miss', async () => {
    const element = await render(
      webhookRequest(1, {
        rule: null,
        near_miss: {
          id: 'r2',
          name: 'Pix pago',
          failed: ['method: expected POST, got GET', 'header x-signature: absent'],
        },
      }),
    );
    const why = await loader.getHarness(MatButtonHarness.with({ text: 'Why? (2)' }));

    expect(text(element)).toBe('No rule matched — closest: Pix pago Why? (2)');
    expect(element.querySelectorAll('li')).toHaveLength(0);

    await why.click();

    expect([...element.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'method: expected POST, got GET',
      'header x-signature: absent',
    ]);
    expect(await (await why.host()).getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    ['nulos', { rule: null, near_miss: null }],
    ['ausentes (mensagem gravada antes das regras)', {}],
  ])('não deve mostrar nada Quando rule e near_miss são %s', async (_caso, campos) => {
    const element = await render(webhookRequest(1, campos));

    expect(text(element)).toBe('');
  });
});
