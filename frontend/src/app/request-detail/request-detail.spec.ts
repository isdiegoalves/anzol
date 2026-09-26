import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { CompareStore } from '../diff/compare-store';
import { OutboundActions } from '../outbound/outbound-actions';
import { SignatureResult, WebhookRequest } from '../requests/webhook-request';
import { RuleFromRequest } from '../rules/rule-from-request';
import { ShareDialog } from '../share/share-dialog';
import { Token } from '../token/token';
import { TokenActions } from '../token/token-actions';
import { Preferences } from '../settings/preferences';
import { RequestDetail } from './request-detail';

describe('Dado o detalhe de uma mensagem', () => {
  let fixture: ComponentFixture<RequestDetail>;
  let loader: HarnessLoader;

  const render = async (request: WebhookRequest, url: Token = token()) => {
    fixture = TestBed.createComponent(RequestDetail);
    fixture.componentRef.setInput('request', request);
    fixture.componentRef.setInput('token', url);
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
    expect(open).toHaveBeenCalledWith('Copied request as curl', undefined, { duration: 1000 });
  });

  it('deve copiar o corpo cru e avisar Quando "Copy payload" é clicado, mesmo com o JSON formatado na tela', async () => {
    TestBed.inject(Preferences).formatJsonEnable.set(true);
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    await render(webhookRequest(1, { content: '{"a":1}' }));

    const button = await loader.getHarness(MatButtonHarness.with({ text: 'Copy payload' }));
    await button.click();

    expect(copy).toHaveBeenCalledWith('{"a":1}');
    expect(open).toHaveBeenCalledWith('Copied payload', undefined, { duration: 1000 });
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

  describe('Dado a linha do header de assinatura na tabela Headers', () => {
    interface Highlighted {
      state: string[];
      text: string | undefined;
    }
    const highlighted = (element: HTMLElement): Highlighted[] =>
      [...element.querySelectorAll('table[aria-label="Headers"] tbody tr.signature')].map(
        (row) => ({
          state: [...row.classList].filter((name) => name !== 'signature'),
          text: [...row.querySelectorAll('.name, code, .verdict')]
            .map((part) => part.textContent?.trim())
            .join(' '),
        }),
      );

    it.each<[string, SignatureResult, Record<string, string[]>, Highlighted[]]>([
      [
        'válida pela GitHub',
        { provider: 'github', valid: true, reason: null },
        { 'x-hub-signature-256': ['sha256=abc'] },
        [
          {
            state: ['valid'],
            text: 'x-hub-signature-256 sha256=abc ✓ Signature valid — HMAC-SHA256 of the raw body matched',
          },
        ],
      ],
      [
        'inválida pela Stripe (HMAC diferente)',
        { provider: 'stripe', valid: false, reason: 'signature mismatch' },
        { 'stripe-signature': ['t=1,v1=ab'] },
        [
          {
            state: ['invalid'],
            text: 'stripe-signature t=1,v1=ab ✕ Signature invalid — HMAC-SHA256 of "{t}.{raw body}" did not match (signature mismatch)',
          },
        ],
      ],
      [
        'inválida pelo Slack (fora da tolerância), com as duas linhas',
        { provider: 'slack', valid: false, reason: 'timestamp outside tolerance (412 s)' },
        { 'x-slack-request-timestamp': ['1'], 'x-slack-signature': ['v0=ab'] },
        [
          {
            state: ['invalid'],
            text: 'x-slack-request-timestamp 1 ✕ Timestamp signed with the body',
          },
          {
            state: ['invalid'],
            text: 'x-slack-signature v0=ab ✕ Signature invalid — HMAC-SHA256 of "v0:{timestamp}:{raw body}" matched, but timestamp outside tolerance (412 s)',
          },
        ],
      ],
      [
        'inválida pela Shopify (header malformado)',
        { provider: 'shopify', valid: false, reason: 'malformed header' },
        { 'x-shopify-hmac-sha256': ['%%'] },
        [
          {
            state: ['invalid'],
            text: 'x-shopify-hmac-sha256 %% ✕ Signature invalid — malformed header',
          },
        ],
      ],
    ])(
      'deve realçar a linha com o veredito e o que foi conferido Quando a assinatura é %s',
      async (_caso, signature, headers, linhas) => {
        const element = await render(
          webhookRequest(1, { signature, headers: { accept: ['*/*'], ...headers } }),
        );

        expect(highlighted(element)).toEqual(linhas);
        expect(rows(element, 'Headers')).toContain('accept */*');
      },
    );

    it('deve pôr no topo a linha "(not received)" com o header esperado Quando a assinatura veio sem o header', async () => {
      const element = await render(
        webhookRequest(1, {
          signature: {
            provider: 'github',
            valid: false,
            reason: 'header X-Hub-Signature-256 absent',
          },
        }),
      );

      expect(highlighted(element)).toEqual([
        {
          state: ['absent'],
          text: 'x-hub-signature-256 (not received) ⊘ Signature absent — the GitHub check expects the X-Hub-Signature-256 header',
        },
      ]);
      expect(rows(element, 'Headers')[0]).toMatch(/^x-hub-signature-256 \(not received\)/);
      expect(rows(element, 'Headers')).toHaveLength(2);
    });

    it('deve realçar o header configurado no genérico, com o algoritmo da URL, Quando a assinatura confere', async () => {
      const element = await render(
        webhookRequest(1, {
          signature: { provider: 'generic', valid: true, reason: null },
          headers: { 'x-signature': ['sha512=ab'] },
        }),
        token({
          signature: {
            provider: 'generic',
            secret: '••••1234',
            header: 'X-Signature',
            algorithm: 'sha512',
          },
        }),
      );

      expect(highlighted(element)).toEqual([
        {
          state: ['valid'],
          text: 'x-signature sha512=ab ✓ Signature valid — HMAC-SHA512 of the raw body matched',
        },
      ]);
    });

    it.each([
      ['o header do genérico mudou', { provider: 'generic' as const, header: 'X-Outro' }],
      ['a URL passou a verificar a GitHub', { provider: 'github' as const }],
      ['a URL deixou de verificar', null],
    ])(
      'não deve realçar linha nenhuma, só o selo, Quando a configuração mudou depois da chegada (%s)',
      async (_caso, atual) => {
        const element = await render(
          webhookRequest(1, {
            signature: { provider: 'generic', valid: true, reason: null },
            headers: { 'x-signature': ['ab'] },
          }),
          token({ signature: atual && { ...atual, secret: '••••1234' } }),
        );

        expect(highlighted(element)).toEqual([]);
        expect(element.querySelector('app-signature-badge')?.textContent?.trim()).toBe(
          'Signature valid — Generic',
        );
      },
    );

    it.each([
      ['nula (URL sem verificação)', { signature: null }],
      ['ausente (mensagem gravada antes da verificação)', {}],
    ])('não deve realçar linha nenhuma Quando a assinatura é %s', async (_caso, campos) => {
      const element = await render(
        webhookRequest(1, { ...campos, headers: { 'x-hub-signature-256': ['sha256=ab'] } }),
      );

      expect(highlighted(element)).toEqual([]);
      expect(rows(element, 'Headers')).toEqual(['x-hub-signature-256 sha256=ab']);
    });
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

  it.each([
    ['Replay…', 'replay'],
    ['Send as new…', 'send'],
  ] as const)(
    'deve abrir o diálogo de saída com a mensagem Quando "%s" é clicado',
    async (text, action) => {
      const actions = { replay: vi.fn(), send: vi.fn() };
      TestBed.configureTestingModule({
        providers: [{ provide: OutboundActions, useValue: actions }],
      });
      const request = webhookRequest(5);
      await render(request);

      await (await loader.getHarness(MatButtonHarness.with({ text }))).click();

      await vi.waitFor(() => expect(actions[action]).toHaveBeenCalledWith(request));
    },
  );

  it('deve abrir o diálogo do link só-leitura com a mensagem Quando "Share read-only link…" é clicado', async () => {
    const request = webhookRequest(6);
    await render(request);
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({} as never);

    await (
      await loader.getHarness(MatButtonHarness.with({ text: 'Share read-only link…' }))
    ).click();

    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        ShareDialog,
        expect.objectContaining({ data: { request } }),
      ),
    );
  });

  describe('Dado o "Explain"', () => {
    const explainUrl = (request: WebhookRequest) =>
      `/token/${TOKEN_ID}/request/${request.uuid}/explain`;
    const explainButton = () =>
      loader.getHarness(MatButtonHarness.with({ text: /^(Explain|Hide explanation)$/ }));
    let http: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('deve abrir o painel e mostrar o diagnóstico da mensagem Quando "Explain" é clicado', async () => {
      const request = webhookRequest(6);
      const element = await render(request);
      expect(element.querySelector('app-explain-panel')).toBeNull();

      await (await explainButton()).click();

      const call = await vi.waitFor(() =>
        http.expectOne({ method: 'POST', url: explainUrl(request) }),
      );
      expect(call.request.body).toEqual({ lang: navigator.language });
      call.flush({ explanation: 'Assinatura **válida**.', facts: {} });
      await vi.waitFor(() =>
        expect(element.querySelector('app-explain-panel strong')?.textContent).toBe('válida'),
      );
      expect(await (await explainButton()).getText()).toBe('Hide explanation');
    });

    it('deve fechar o painel Quando "Hide explanation" é clicado ou outra mensagem é aberta', async () => {
      const request = webhookRequest(6);
      const element = await render(request);
      await (await explainButton()).click();
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush({ explanation: 'x' });
      await vi.waitFor(() => expect(element.querySelector('app-explain-panel')).not.toBeNull());

      await (await explainButton()).click();
      await vi.waitFor(() => expect(element.querySelector('app-explain-panel')).toBeNull());

      await (await explainButton()).click();
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush({ explanation: 'x' });
      await vi.waitFor(() => expect(element.querySelector('app-explain-panel')).not.toBeNull());
      fixture.componentRef.setInput('request', webhookRequest(7));
      await fixture.whenStable();
      expect(element.querySelector('app-explain-panel')).toBeNull();
      expect(await (await explainButton()).getText()).toBe('Explain');
    });

    it('deve desabilitar o "Explain" com a dica de configuração Quando a IA está desligada (503)', async () => {
      const request = webhookRequest(6);
      const element = await render(request);
      await (await explainButton()).click();
      (await vi.waitFor(() => http.expectOne(explainUrl(request)))).flush(
        { error: 'AI is not configured' },
        { status: 503, statusText: 'Service Unavailable' },
      );

      await vi.waitFor(() =>
        expect(element.querySelector('.ai-off')?.textContent?.trim()).toBe(
          'Set WEBHOOK_AI_* to enable',
        ),
      );
      await (await explainButton()).click();
      await vi.waitFor(() => expect(element.querySelector('app-explain-panel')).toBeNull());
      expect(await (await explainButton()).isDisabled()).toBe(true);
    });
  });
});
