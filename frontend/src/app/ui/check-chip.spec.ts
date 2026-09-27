import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../testing/axe';
import { webhookRequest } from '../../testing/fixtures';
import { CheckResult, checksOf } from '../pipeline/pipeline';
import { CheckChip } from './check-chip';

const [valid] = checksOf(
  webhookRequest(1, { signature: { provider: 'stripe', valid: true, reason: null } }),
);
const [invalid] = checksOf(
  webhookRequest(1, {
    signature: { provider: 'stripe', valid: false, reason: 'signature mismatch' },
  }),
);
const [, , near] = checksOf(
  webhookRequest(1, { near_miss: { id: 'r', name: 'Refund', failed: ['method: expected GET'] } }),
);
const [unchecked] = checksOf(webhookRequest(1, { signature: null }));

describe('Dado o selo de verificação (app-check-chip)', () => {
  it.each([
    // INBOX-13: o provedor na válida, o motivo curto na inválida.
    ['válida', valid, 'ok', 'Stripe'],
    ['inválida', invalid, 'bad', 'Mismatch'],
    ['quase (near miss)', near, 'near', 'Near miss'],
    ['não verificada', unchecked, 'none', 'No sig check'],
  ] as [string, CheckResult, string, string][])(
    'deve mostrar o texto curto com o tom, e o título e o motivo no title, Quando a verificação está %s (mini)',
    async (_caso, result, tone, short) => {
      const { container } = await render(CheckChip, { inputs: { result } });

      // `container` é o elemento do componente (o host).
      const chip = container as HTMLElement;
      expect(chip.textContent?.trim()).toBe(short);
      expect(chip.classList).toContain(tone);
      expect(chip.querySelector('.detail')).toBeNull();
      expect(chip.getAttribute('title')).toBe(`${result.title}: ${result.detail}`);
      await expectNoAxeViolations(container);
    },
  );

  it('deve mostrar o nome da regra que respondeu no selo mini', async () => {
    const [, , answered] = checksOf(webhookRequest(1, { rule: { id: 'r', name: 'Pix pago' } }));
    const { container } = await render(CheckChip, { inputs: { result: answered } });

    expect(container.textContent?.trim()).toBe('Pix pago');
  });

  it('deve mostrar o título e o motivo no cartão Quando o tamanho é "card"', async () => {
    const { container } = await render(CheckChip, { inputs: { result: invalid, size: 'card' } });

    expect(screen.getByText('Signature invalid')).toBeTruthy();
    expect(screen.getByText('signature mismatch')).toBeTruthy();
    expect((container as HTMLElement).dataset['state']).toBe('invalid');
    await expectNoAxeViolations(container);
  });

  it('deve esconder o ícone do leitor de tela (o texto já diz o resultado)', async () => {
    const { container } = await render(CheckChip, { inputs: { result: valid } });

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  // INBOX-28: no selo da lista, o ícone diz a verificação (escudo, chaves, raio); o tom fica na cor
  // e no texto. O cartão do detalhe segue com o ícone do tom (o círculo do "ok").
  const firstShape = (container: Element) =>
    container.querySelector('svg path')?.getAttribute('d') ?? '';
  const results = checksOf(
    webhookRequest(1, {
      signature: { provider: 'stripe', valid: true, reason: null },
      schema: { valid: true, errors: [] },
      rule: { id: 'r', name: 'Pix' },
    }),
  );

  it.each([
    ['assinatura (escudo)', 0, 'M20 13c0 5'],
    ['schema (chaves)', 1, 'M8 3H7'],
    ['regra (raio)', 2, 'M4 14a1'],
  ] as const)('deve mostrar o ícone da %s no selo mini', async (_caso, index, shape) => {
    const { container } = await render(CheckChip, { inputs: { result: results[index] } });

    expect(firstShape(container)).toMatch(new RegExp(`^${shape}`));
  });

  it('deve manter o ícone do tom no cartão', async () => {
    const { container } = await render(CheckChip, { inputs: { result: valid, size: 'card' } });

    expect(container.querySelector('svg circle')).not.toBeNull();
  });
});
