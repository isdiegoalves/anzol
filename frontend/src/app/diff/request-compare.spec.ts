import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { CompareStore } from './compare-store';
import { BODY_LIMIT } from './request-diff';
import { RequestCompare } from './request-compare';

const A = webhookRequest(1, {
  method: 'POST',
  headers: { 'Content-Type': ['application/json'], 'X-Retry': ['1'], 'X-Only-A': ['a'] },
  content: '{"id":42,"status":"pending","itens":[1]}',
});
const B = webhookRequest(2, {
  method: 'POST',
  headers: { 'content-type': ['application/json'], 'x-retry': ['2'] },
  content: '{"itens":[1],"status":"paid","id":42}',
});

describe('Dado a comparação de duas mensagens', () => {
  let fixture: ComponentFixture<RequestCompare>;

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = (label: string) =>
    [...element().querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()),
    );
  const bodyLines = () =>
    [...element().querySelectorAll('table[aria-label="Body"] tr')].map((row) =>
      [row.className, row.textContent?.replace(/\s+/g, ' ').trim()].join(' | '),
    );
  const render = async (a: WebhookRequest, b: WebhookRequest) => {
    fixture.componentRef.setInput('a', a);
    fixture.componentRef.setInput('b', b);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(RequestCompare);
    await render(A, B);
  });

  it('deve mostrar no cabeçalho id curto e data das duas', () => {
    expect(element().querySelector('.id-a')?.textContent).toBe(`#${A.uuid.substring(0, 5)}`);
    expect(element().querySelector('.id-b')?.textContent).toBe(`#${B.uuid.substring(0, 5)}`);
    expect(element().querySelector('.heading')?.textContent).toMatch(/[A-Z][a-z]{2} \d+, \d{4}/);
  });

  it('deve casar headers sem diferenciar maiúsculas e marcar diferente e ausente', () => {
    expect(rows('Headers')).toEqual([
      ['Content-Type', 'application/json', 'application/json', 'same'],
      ['X-Only-A', 'a', '', 'only in A'],
      ['X-Retry', '1', '2', 'changed'],
    ]);
  });

  it('deve comparar o JSON com as chaves em ordem e marcar só a linha que mudou', () => {
    expect(element().textContent).toContain('JSON bodies, formatted with sorted keys.');
    expect(bodyLines().filter((line) => !line.startsWith('equal'))).toEqual([
      'removed | 6 - "status": "pending"',
      'added | 6 + "status": "paid"',
    ]);
  });

  it('deve esconder o que é igual Quando "Only differences" é ligado', async () => {
    const loader = TestbedHarnessEnvironment.loader(fixture);

    await (await loader.getHarness(MatSlideToggleHarness)).toggle();

    expect(rows('Headers').map((row) => row[0])).toEqual(['X-Only-A', 'X-Retry']);
    expect(rows('Request')).toEqual([['No differences']]);
    expect(bodyLines()).toEqual([
      'skipped | ⋯ 5 unchanged lines',
      'removed | 6 - "status": "pending"',
      'added | 6 + "status": "paid"',
      'skipped | ⋯ 1 unchanged line',
    ]);
  });

  it('deve trocar A e B e fechar pelo CompareStore Quando os botões são clicados', async () => {
    const compare = TestBed.inject(CompareStore);
    const swap = vi.spyOn(compare, 'swap');
    const close = vi.spyOn(compare, 'close');
    const loader = TestbedHarnessEnvironment.loader(fixture);

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Swap A and B' }))).click();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Close' }))).click();

    expect(swap).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('deve comparar texto por linha Quando um dos corpos não é JSON', async () => {
    await render(
      webhookRequest(1, { content: 'a=1\nb=2' }),
      webhookRequest(2, { content: 'a=1\nb=3' }),
    );

    expect(element().textContent).not.toContain('sorted keys');
    expect(bodyLines()).toEqual(['equal | 11 a=1', 'removed | 2 - b=2', 'added | 2 + b=3']);
  });

  it('deve avisar e comparar só o primeiro 1 MB Quando um corpo passa do limite', async () => {
    await render(
      webhookRequest(1, { content: 'x'.repeat(BODY_LIMIT + 1) }),
      webhookRequest(2, { content: 'y' }),
    );

    expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Body larger than 1 MB: comparing only the first 1 MB of each request.',
    );
  });
});
