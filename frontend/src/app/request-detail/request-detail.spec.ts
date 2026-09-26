import { Clipboard } from '@angular/cdk/clipboard';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { WebhookRequest } from '../requests/webhook-request';
import { RuleFromRequest } from '../rules/rule-from-request';
import { TokenActions } from '../token/token-actions';
import { Preferences } from '../settings/preferences';
import { RequestDetail } from './request-detail';

describe('Dado o detalhe de uma mensagem', () => {
  let fixture: ComponentFixture<RequestDetail>;
  let loader: HarnessLoader;

  const render = async (request: WebhookRequest) => {
    fixture = TestBed.createComponent(RequestDetail);
    fixture.componentRef.setInput('request', request);
    fixture.componentRef.setInput('token', token());
    fixture.componentRef.setInput('page', 2);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const rows = (element: HTMLElement, table: string) =>
    [...element.querySelectorAll(`table[aria-label="${table}"] tbody tr`)].map((row) =>
      [...row.querySelectorAll('td')]
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    );

  afterEach(() => localStorage.clear());

  it('deve mostrar URL, host, ID, headers e o permalink com a página Quando a mensagem é aberta', async () => {
    const request = webhookRequest(1, { headers: { accept: ['a', ''], host: ['h'] } });
    const element = await render(request);

    expect(rows(element, 'Request Details')).toContain(`ID ${request.uuid}`);
    expect(rows(element, 'Headers')).toEqual(['accept a, (empty)', 'host h']);
    expect(element.querySelector<HTMLAnchorElement>('a[href*="/#/"]')?.href).toBe(
      `${location.origin}/#/${TOKEN_ID}/${request.uuid}/2`,
    );
  });

  it('deve listar query e formulário com (empty) para valor vazio Quando a mensagem tem os dois', async () => {
    const element = await render(
      webhookRequest(1, { query: { x: '1', y: '', arr: ['a'] }, request: { f1: 'v1', f2: '' } }),
    );

    expect(rows(element, 'Query strings')).toEqual(['x 1', 'y (empty)', 'arr ["a"]']);
    expect(rows(element, 'Form values')).toEqual(['f1 v1', 'f2 (empty)']);
  });

  it.each([
    ['nulos', null, undefined],
    ['vazios', {}, {}],
  ])('deve mostrar (empty) Quando query e formulário são %s', async (_caso, query, form) => {
    const element = await render(webhookRequest(1, { query, request: form }));

    expect(rows(element, 'Query strings')).toEqual(['(empty)']);
    expect(rows(element, 'Form values')).toEqual(['(empty)']);
  });

  it('deve mostrar "(no body content)" Quando o corpo é vazio', async () => {
    const element = await render(webhookRequest(1, { content: '' }));

    expect(element.querySelector('.no-content')?.textContent).toBe('(no body content)');
    expect(element.querySelector('pre')).toBeNull();
  });

  it('deve formatar o JSON Quando "Format JSON/XML" está ligado', async () => {
    TestBed.inject(Preferences).formatJsonEnable.set(true);
    const element = await render(webhookRequest(1, { content: '{"a":1}' }));

    expect(element.querySelector('pre')?.textContent).toBe('{\n  "a": 1\n}');
  });

  it('deve mostrar o corpo cru Quando "Format JSON/XML" está desligado', async () => {
    const element = await render(webhookRequest(1, { content: '{"a":1}' }));

    expect(element.querySelector('pre')?.textContent).toBe('{"a":1}');
  });

  it('deve esconder as tabelas e manter o corpo Quando "Hide Details" está ligado', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    const element = await render(webhookRequest(1));

    expect(element.querySelectorAll('table')).toHaveLength(0);
    expect(element.querySelector('pre')?.textContent).toBe('{"n":1}');
  });

  it('deve copiar o curl e avisar Quando "Copy As > curl" é escolhido', async () => {
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const request = webhookRequest(1, { headers: {}, content: null });
    await render(request);

    const menu = await loader.getHarness(MatMenuHarness);
    await menu.clickItem({ text: 'curl' });

    expect(copy).toHaveBeenCalledWith(`curl -X 'POST' '${request.url}'`);
    expect(open).toHaveBeenCalledWith('Copied request as curl');
  });

  it('deve copiar o corpo cru e avisar Quando "Copy payload" é clicado, mesmo com o JSON formatado na tela', async () => {
    TestBed.inject(Preferences).formatJsonEnable.set(true);
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    await render(webhookRequest(1, { content: '{"a":1}' }));

    const button = await loader.getHarness(MatButtonHarness.with({ text: 'Copy payload' }));
    await button.click();

    expect(copy).toHaveBeenCalledWith('{"a":1}');
    expect(open).toHaveBeenCalledWith('Copied payload');
  });

  it('deve manter "Copy payload" Quando "Hide Details" está ligado', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    await render(webhookRequest(1));

    expect(
      await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Copy payload' })),
    ).toHaveLength(1);
  });

  it('não deve mostrar "Copy payload" Quando o corpo é vazio', async () => {
    await render(webhookRequest(1, { content: '' }));

    expect(
      await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Copy payload' })),
    ).toHaveLength(0);
  });

  it('deve mostrar o selo da regra acima dos detalhes, mesmo com "Hide Details", Quando a mensagem foi respondida por regra', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    const element = await render(webhookRequest(1, { rule: { id: 'r1', name: 'Pix pago' } }));

    expect(element.querySelector('app-rule-badge')?.textContent).toContain(
      'Answered by rule Pix pago',
    );
  });

  it('deve mostrar o selo de assinatura junto do selo da regra, mesmo com "Hide Details", Quando a mensagem tem assinatura inválida', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    const element = await render(
      webhookRequest(1, {
        rule: { id: 'r1', name: 'Recusa' },
        signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
      }),
    );

    expect(element.querySelector('app-signature-badge')?.textContent?.trim()).toBe(
      'Signature invalid — signature mismatch',
    );
    expect(element.querySelector('app-rule-badge')?.textContent).toContain(
      'Answered by rule Recusa',
    );
  });

  it.each([
    ['com o corpo e os detalhes', {}, false],
    ['sem corpo e com "Hide Details"', { content: '' }, true],
  ])(
    'deve abrir o editor de regra a partir da mensagem Quando "Create rule from this request" é clicado %s',
    async (_caso, overrides, hideDetails) => {
      const open = vi.fn().mockResolvedValue(undefined);
      TestBed.configureTestingModule({
        providers: [{ provide: RuleFromRequest, useValue: { open } }],
      });
      TestBed.inject(Preferences).hideDetails.set(hideDetails);
      const request = webhookRequest(3, overrides);
      await render(request);

      const button = await loader.getHarness(
        MatButtonHarness.with({ text: 'Create rule from this request' }),
      );
      await button.click();

      await vi.waitFor(() => expect(open).toHaveBeenCalledWith(request));
    },
  );

  it('deve mostrar o selo de schema com os erros, mesmo com "Hide Details", Quando o corpo não segue o schema', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    const element = await render(
      webhookRequest(1, {
        schema: { valid: false, errors: [{ path: '/id', message: 'must be integer' }] },
      }),
    );

    const badge = element.querySelector('app-schema-badge');
    expect(badge?.querySelector('p')?.textContent).toBe('Schema invalid');
    expect(badge?.querySelector('li')?.textContent?.trim()).toBe('/id must be integer');
  });

  it('deve abrir o Edit URL com o schema da mensagem Quando "Create schema from this request" é clicado', async () => {
    const createSchemaFrom = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: TokenActions, useValue: { createSchemaFrom } }],
    });
    const request = webhookRequest(3, { content: '{"id": 7}' });
    await render(request);

    const button = await loader.getHarness(
      MatButtonHarness.with({ text: 'Create schema from this request' }),
    );
    await button.click();

    await vi.waitFor(() => expect(createSchemaFrom).toHaveBeenCalledWith(request));
  });

  it.each([
    ['vazio', ''],
    ['nulo', null],
    ['um formulário', 'nome=Ana'],
    ['JSON malformado', '{"id": '],
  ])(
    'não deve oferecer "Create schema from this request" Quando o corpo é %s',
    async (_caso, content) => {
      await render(webhookRequest(1, { content }));

      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ text: 'Create schema from this request' }),
        ),
      ).toHaveLength(0);
    },
  );

  it('deve pôr a lista em modo de escolha com a aberta como A Quando "Compare with…" é clicado', async () => {
    const request = webhookRequest(4);
    await render(request);

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Compare with…' }))).click();

    expect(TestBed.inject(CompareStore).picking()).toEqual(request);
  });
});
