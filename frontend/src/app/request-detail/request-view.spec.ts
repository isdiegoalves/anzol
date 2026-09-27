import { Clipboard } from '@angular/cdk/clipboard';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { translations } from '../../locale/pt-BR';
import { CapturedRequest, SignatureResult } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Viewport, WindowClass } from '../shell/viewport';
import { Token } from '../token/token';
import { RequestView, sizeText } from './request-view';

describe('Dado a visualização de uma mensagem (detalhe e link só-leitura)', () => {
  /** Janela larga por padrão; o jsdom não tem `matchMedia`. */
  const windowClass = signal<WindowClass>('large');
  const show = (
    request: CapturedRequest,
    url: Token | null = token(),
    readonly = false,
    pretty = false,
  ) =>
    render(RequestView, {
      inputs: { request, token: url, readonly },
      providers: [provideRouter([]), { provide: Viewport, useValue: { windowClass } }],
      configureTestBed: (testBed) => testBed.inject(Preferences).formatJsonEnable.set(pretty),
    });

  /** Linhas de uma tabela: as células (cabeçalho da linha e valor) separadas por espaço. */
  const rows = (name: string) =>
    [...screen.getByRole('table', { name }).querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('th, td')]
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    );

  const openTab = async (name: RegExp) => {
    await userEvent.click(screen.getByRole('tab', { name }));
  };

  afterEach(() => {
    localStorage.clear();
    windowClass.set('large');
  });

  it('deve mostrar método e rota e a linha de metadados (URL, host, data, tamanho, seq, ID), e passar no axe', async () => {
    const request = {
      ...webhookRequest(1, {
        method: 'PUT',
        url: 'http://localhost:8084/3dbd68f4-8890-4f56-affb-c7c9b297e666/pedidos/7?x=1',
        content: '{"a":1}',
      }),
      seq: 179,
    };
    const { container, fixture } = await show(request);
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('/pedidos/7?x=1');
    expect(container.querySelector('app-method-badge')?.textContent).toBe('PUT');
    // INBOX-17 (trava 3): a tabela vira a linha do protótipo C, com tudo o que ela tinha à vista.
    expect(screen.queryByRole('table', { name: 'Request Details' })).toBeNull();
    const meta = screen.getByRole('group', { name: 'Request metadata' });
    expect(within(meta).getByRole('link', { name: request.url }).getAttribute('href')).toBe(
      request.url,
    );
    expect(within(meta).getByRole('link', { name: 'whois' })).toBeTruthy();
    const text = meta.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('192.168.0.1');
    expect(text).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM) · .+ ago/);
    // Cada campo é uma palavra no texto (o leitor de tela e a busca por texto não os colam).
    expect(text).toMatch(/ ago 7 B seq 179 id [0-9a-f-]{36}/);
    expect(text).toContain(request.uuid);
    await userEvent.click(within(meta).getByRole('button', { name: 'Copy request ID' }));
    expect(copy).toHaveBeenCalledWith(request.uuid);
    await expectNoAxeViolations(container);
  });

  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
  ])('deve dizer o tamanho do corpo de %i bytes como %s', (bytes, text) => {
    expect(sizeText(bytes, 'en')).toBe(text);
  });

  it('deve mostrar as abas Body, Headers (n), Query (n) e Form (n), com o Body aberto', async () => {
    await show(
      webhookRequest(1, {
        headers: { accept: ['a', ''], host: ['h'] },
        query: { x: '1', y: '', arr: ['a'] },
        request: { f1: 'v1', f2: '' },
      }),
    );

    // INBOX-21: a aba Body diz o tamanho do corpo antes do clique.
    expect(
      screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Body · 7 B', 'Headers (2)', 'Query (3)', 'Form (2)']);
    expect(screen.getByRole('tab', { name: /^Body\b/ }).getAttribute('aria-selected')).toBe('true');

    await openTab(/Headers/);
    expect(rows('Headers')).toEqual(['accept a, (empty)', 'host h']);
    await openTab(/Query/);
    expect(rows('Query strings')).toEqual(['x 1', 'y (empty)', 'arr ["a"]']);
    await openTab(/Form/);
    expect(rows('Form values')).toEqual(['f1 v1', 'f2 (empty)']);
  });

  // INBOX-33: no celular, as quatro abas numa faixa que rola, sem as setas de paginação do Material,
  // com o teclado das abas (setas, Home, End) e o painel ligado à aba aberta.
  it('deve mostrar as quatro abas numa faixa própria, com o teclado das abas, Quando a janela é compacta', async () => {
    windowClass.set('compact');
    const { container } = await show(
      webhookRequest(1, {
        headers: { accept: ['a'], host: ['h'] },
        query: { x: '1' },
        request: { f1: 'v1' },
      }),
    );

    expect(container.querySelector('mat-tab-group')).toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Body · 7 B',
      'Headers (2)',
      'Query (1)',
      'Form (1)',
    ]);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id);

    tabs[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(rows('Headers')).toEqual(['accept a', 'host h']);
    await userEvent.keyboard('{End}');
    expect(rows('Form values')).toEqual(['f1 v1']);
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id);
    await expectNoAxeViolations(container);
  });

  // INBOX-26: as abas vazias no padrão dos estados vazios.
  it('deve explicar a aba vazia Quando não há query nem formulário', async () => {
    await show(webhookRequest(1, { query: null, request: null }));

    await openTab(/Query/);
    expect(screen.getByText('No query string')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Query strings' })).toBeNull();
    await openTab(/Form/);
    expect(screen.getByText('No form values')).toBeTruthy();
  });

  describe('Dado o corpo', () => {
    it('deve mostrar o JSON formatado, sem mudar número maior que 2^53, Quando o Pretty está ligado', async () => {
      const { container } = await show(
        webhookRequest(1, { content: '{"a":12345678901234567890}' }),
        token(),
        false,
        true,
      );

      expect(container.querySelector('pre')?.textContent).toBe('{  "a": 12345678901234567890}');
      expect(container.querySelectorAll('pre .line')).toHaveLength(3);
    });

    it('deve mostrar o corpo como chegou e gravar a escolha Quando o Pretty é desligado', async () => {
      const { container } = await show(
        webhookRequest(1, { content: '{"a":1}' }),
        token(),
        false,
        true,
      );

      await userEvent.click(screen.getByRole('switch', { name: 'Pretty' }));

      expect(container.querySelector('pre')?.textContent).toBe('{"a":1}');
      expect(localStorage.getItem('formatJsonEnable')).toBe('false');
    });

    // INBOX-21/26: "empty" na aba e o estado vazio no lugar do bloco de código.
    it('deve dizer que não há corpo, com o método, Quando o corpo é vazio', async () => {
      const { container } = await show(
        webhookRequest(1, { method: 'GET', content: '', schema: { valid: false, errors: [] } }),
      );

      expect(screen.getByRole('tab', { name: /^Body\b/ }).textContent).toContain('empty');
      expect(screen.getByText('No body content')).toBeTruthy();
      expect(screen.getByText(/^A GET with an empty body\./).textContent).toContain(
        'The schema check records it as “body is not JSON”.',
      );
      expect(container.querySelector('app-code-view')).toBeNull();
    });

    it('deve formatar e realçar XML pelo highlight.js sob demanda Quando o Pretty está ligado', async () => {
      const { container } = await show(
        webhookRequest(1, { content: '<a><b>1</b><c/></a>' }),
        token(),
        false,
        true,
      );

      await vi.waitFor(() =>
        expect(container.querySelector('pre.xml')?.textContent).toBe(
          '<a>\n  <b>1</b>\n  <c/>\n</a>',
        ),
      );
      expect(container.querySelector('pre.xml .hljs-name')).not.toBeNull();
    });

    it('deve pôr cada erro de schema na linha do JSON Pointer', async () => {
      const { container } = await show(
        webhookRequest(1, {
          content: '{"id":"7","itens":[]}',
          schema: {
            valid: false,
            errors: [
              { path: '/id', message: 'must be integer' },
              { path: '', message: 'must have required property total' },
            ],
          },
        }),
        token(),
        false,
        true,
      );

      const marked = [...container.querySelectorAll('pre .line.marked')].map((line) =>
        line.textContent?.trim(),
      );
      expect(marked).toEqual(['{', '"id": "7",']);
      expect([...container.querySelectorAll('pre .mark')].map((mark) => mark.textContent)).toEqual([
        '(root) must have required property total',
        '/id must be integer',
      ]);
    });
  });

  describe('Dado os cartões "Checks on this request"', () => {
    const cards = () =>
      within(screen.getByRole('group', { name: 'Checks on this request' }))
        .getAllByText(/^(Signature|Schema|Answered|No rule|Default)/)
        .map((title) => title.textContent);

    it('deve mostrar assinatura, schema e regra no mesmo componente dos selos', async () => {
      await show(
        webhookRequest(1, {
          signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
          schema: { valid: true, errors: [] },
          rule: { id: 'r1', name: 'Pix pago' },
        }),
      );

      expect(cards()).toEqual(['Signature invalid', 'Schema valid', 'Answered by rule']);
      expect(screen.getByText('Pix pago')).toBeTruthy();
    });

    it('deve abrir a aba Headers pelo cartão da assinatura e o Body pelo do schema', async () => {
      await show(
        webhookRequest(1, {
          signature: { provider: 'github', valid: true, reason: null },
          schema: { valid: true, errors: [] },
        }),
      );

      await userEvent.click(screen.getByRole('button', { name: /^Signature valid/ }));
      expect(screen.getByRole('tab', { name: /Headers/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
      await userEvent.click(screen.getByRole('button', { name: /^Schema valid/ }));
      expect(screen.getByRole('tab', { name: /^Body\b/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    // INBOX-18, C3: o status gravado na mensagem no título; uma condição só vai direto no cartão.
    it('deve dizer o status gravado da regra que respondeu no título do cartão', async () => {
      await show(webhookRequest(1, { rule: { id: 'r1', name: 'Pix' }, response: { status: 201 } }));

      expect(cards()).toContain('Answered by rule · 201');
    });

    // WM-10: o nome da regra no cartão leva a ela, com a mensagem para voltar.
    it('deve fazer do nome da regra que respondeu um link para ela, com a mensagem de origem', async () => {
      const request = webhookRequest(1, { rule: { id: 'r1', name: 'Pix' } });
      const { container } = await show(request);

      const link = screen.getByRole('link', { name: 'Pix' });
      expect(link.getAttribute('href')).toBe(
        `/${request.token_id}/rules/r1?from-request=${request.uuid}`,
      );
      await expectNoAxeViolations(container);
    });

    it('deve fazer do nome da mais próxima um link, e do "Default response" um link para Checks', async () => {
      const near = webhookRequest(1, {
        near_miss: { id: 'r2', name: 'Só GET', failed: ['method: expected GET, got POST'] },
      });
      const { rerender } = await show(near);
      expect(screen.getByRole('link', { name: 'Só GET' }).getAttribute('href')).toContain(
        `/rules/r2?from-request=${near.uuid}`,
      );
      // Quem respondeu foi a resposta padrão: ela também é link, no cartão do near miss.
      expect(screen.getByRole('link', { name: 'Default response' }).getAttribute('href')).toBe(
        `/${near.token_id}/checks?section=response`,
      );

      await rerender({
        inputs: { request: webhookRequest(2, { rule: null, near_miss: null }) },
        partialUpdate: true,
      });
      expect(screen.getByRole('link', { name: 'Default response' }).getAttribute('href')).toBe(
        `/${near.token_id}/checks?section=response`,
      );
    });

    it('não deve ter link no cartão da regra em modo só-leitura, mesmo com o token', async () => {
      await show(webhookRequest(1, { rule: { id: 'r1', name: 'Pix' } }), null, true);

      expect(screen.queryByRole('link', { name: 'Pix' })).toBeNull();
    });

    it('não deve ter link no cartão da regra na página do link só-leitura', async () => {
      await show(
        webhookRequest(1, { rule: { id: 'r1', name: 'Pix' }, token_id: undefined }),
        null,
        true,
      );

      expect(screen.queryByRole('link', { name: 'Pix' })).toBeNull();
    });

    it('deve pôr a condição no cartão, sem "Why? (n)", Quando só uma falhou', async () => {
      await show(
        webhookRequest(1, {
          near_miss: { id: 'r2', name: 'Só GET', failed: ['method: expected GET, got POST'] },
        }),
      );

      expect(document.querySelector('[data-kind="rule"] .detail')?.textContent).toBe(
        'Closest: Só GET · method: expected GET, got POST',
      );
      expect(screen.queryByRole('button', { name: /^Why\?/ })).toBeNull();
    });

    it('deve mostrar as condições que falharam com "Why? (n)" Quando nenhuma regra casou', async () => {
      await show(
        webhookRequest(1, {
          near_miss: {
            id: 'r2',
            name: 'Só GET',
            failed: ['method: expected GET, got POST', 'header x-a: absent'],
          },
        }),
      );
      expect(screen.queryByText('method: expected GET, got POST')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Why? (2)' }));

      expect(screen.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
        'method: expected GET, got POST',
        'header x-a: absent',
      ]);
      // Em inglês nada muda: sem "Show original" e sem title.
      expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull();
      expect(screen.getAllByRole('listitem').some((item) => item.hasAttribute('title'))).toBe(
        false,
      );
    });

    // WM-05: as frases do servidor na língua da tela, com o original no title e em "Ver original".
    describe('Dado a tela em pt-BR', () => {
      beforeEach(() => loadTranslations(translations));
      afterEach(() => clearTranslations());

      it('deve traduzir as condições do "Por quê?" e mostrar o original sob pedido', async () => {
        const { container } = await show(
          webhookRequest(1, {
            near_miss: {
              id: 'r2',
              name: 'Só GET',
              failed: ['method: expected GET, got POST', 'frobnicate: unknown'],
            },
          }),
        );
        await userEvent.click(screen.getByRole('button', { name: 'Por quê? (2)' }));
        const items = () => screen.getAllByRole('listitem');

        expect(items().map((item) => item.textContent?.trim())).toEqual([
          'método: esperava GET, veio POST',
          'frobnicate: unknown',
        ]);
        expect(items()[0].getAttribute('title')).toBe('Original: method: expected GET, got POST');
        expect(items()[1].hasAttribute('title')).toBe(false);

        const original = screen.getByRole('button', { name: 'Ver original' });
        expect(original.getAttribute('aria-pressed')).toBe('false');
        await userEvent.click(original);

        expect(original.getAttribute('aria-pressed')).toBe('true');
        expect(items()[0].textContent?.trim()).toBe('method: expected GET, got POST');
        await expectNoAxeViolations(container);
      });

      it('deve traduzir a condição do cartão Quando só uma falhou', async () => {
        await show(
          webhookRequest(1, {
            near_miss: { id: 'r2', name: 'Só GET', failed: ['header x-a: absent'] },
          }),
        );
        expect(screen.getByText(/cabeçalho x-a: ausente/)).toBeTruthy();
      });
    });
  });

  // INBOX-23: os erros de schema avisados acima do corpo, com o link para o schema da URL.
  it('deve avisar acima do corpo quantos erros de schema estão marcados, com "Open schema"', async () => {
    const { container } = await show(
      webhookRequest(1, {
        content: '{"id":"x","nome":1}',
        schema: {
          valid: false,
          errors: [
            { path: '/id', message: 'must be integer' },
            { path: '/nome', message: 'must be string' },
          ],
        },
      }),
    );

    const note = container.querySelector('.schema-note') as HTMLElement;
    // Sem espaço antes: a busca por texto do E2E ancora no começo ("^2 schema errors…").
    expect(note.textContent?.startsWith('2 schema errors')).toBe(true);
    expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '2 schema errors marked below · Open schema',
    );
    expect(within(note).getByRole('link', { name: 'Open schema' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/checks?section=schema`,
    );
  });

  describe('Dado a linha do header de assinatura na aba Headers', () => {
    const noted = (container: Element) =>
      [...container.querySelectorAll('app-kv-table tr.noted')].map((row) => ({
        tone: [...row.classList].filter((name) => name !== 'noted'),
        name: row.querySelector('th')?.textContent?.trim(),
        parts: [...row.querySelectorAll('code')].map((part) => part.textContent),
        note: row.querySelector('.note')?.textContent,
      }));

    it.each<[string, SignatureResult, Record<string, string[]>, ReturnType<typeof noted>]>([
      [
        'válida pela GitHub',
        { provider: 'github', valid: true, reason: null },
        { 'x-hub-signature-256': ['sha256=abc'] },
        [
          {
            tone: ['ok'],
            name: 'x-hub-signature-256',
            parts: ['sha256=abc'],
            note: '✓ Signature valid — HMAC-SHA256 of the raw body matched',
          },
        ],
      ],
      [
        'inválida pela Stripe, com o valor em partes',
        { provider: 'stripe', valid: false, reason: 'signature mismatch' },
        { 'stripe-signature': ['t=1,v1=ab'] },
        [
          {
            tone: ['bad'],
            name: 'stripe-signature',
            parts: ['t=1', 'v1=ab'],
            note: '✕ Signature invalid — HMAC-SHA256 of "{t}.{raw body}" did not match (signature mismatch)',
          },
        ],
      ],
    ])(
      'deve realçar a linha com o veredito Quando a assinatura é %s',
      async (_caso, signature, headers, linhas) => {
        const { container } = await show(
          webhookRequest(1, { signature, headers: { accept: ['*/*'], ...headers } }),
        );

        await openTab(/Headers/);

        expect(noted(container)).toEqual(linhas);
        expect(rows('Headers')).toContain('accept */*');
        await expectNoAxeViolations(container);
      },
    );

    // INBOX-24: o cabeçalho das colunas, o título da nota e o link para Checks › Signature.
    it('deve ter "Name" e "Value (as recorded)" e dar título e link à nota da assinatura', async () => {
      const { container } = await show(
        webhookRequest(1, {
          signature: { provider: 'github', valid: true, reason: null },
          headers: { 'x-hub-signature-256': ['sha256=abc'] },
        }),
      );

      await openTab(/Headers/);

      const table = screen.getByRole('table', { name: 'Headers' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent?.trim()),
      ).toEqual(['Name', 'Value (as recorded)']);
      const row = container.querySelector('tr.noted') as HTMLElement;
      expect(row.querySelector('.note-title')?.textContent).toBe('Verified signature header');
      expect(
        within(row)
          .getByRole('link', { name: 'How GitHub signatures are checked' })
          .getAttribute('href'),
      ).toBe(`/${TOKEN_ID}/checks?section=signature`);
      await expectNoAxeViolations(container);
    });

    it('deve pôr no topo a linha "(not received)" Quando a assinatura veio sem o header', async () => {
      const { container } = await show(
        webhookRequest(1, {
          signature: {
            provider: 'github',
            valid: false,
            reason: 'header X-Hub-Signature-256 absent',
          },
        }),
      );

      await openTab(/Headers/);

      expect(rows('Headers')[0]).toMatch(
        /^x-hub-signature-256 \(not received\) ?Expected header missing ?⊘ Signature absent/,
      );
      expect(noted(container)).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'Headers (2)' })).toBeTruthy();
    });
  });

  describe('Dado o modo só-leitura (página do link, sem token_id e com [redacted] na url)', () => {
    const shared = (): CapturedRequest => {
      const request: CapturedRequest = {
        ...webhookRequest(1, {
          url: 'http://localhost:8084/[redacted]/pedidos?x=1',
          signature: { provider: 'github', valid: false, reason: 'signature mismatch' },
          near_miss: { id: 'r', name: 'Só GET', failed: ['method: expected GET, got POST'] },
        }),
      };
      delete request.token_id;
      return request;
    };

    it('deve tirar a rota da url com [redacted], não ter botão nenhum e mostrar as condições abertas', async () => {
      const { container } = await show(shared(), null, true);

      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('/pedidos?x=1');
      expect(screen.queryAllByRole('button')).toEqual([]);
      // Uma condição só: a frase vai no cartão da regra (INBOX-18).
      expect(document.querySelector('[data-kind="rule"] .detail')?.textContent).toBe(
        'Closest: Só GET · method: expected GET, got POST',
      );
      expect(screen.getByText('Signature invalid')).toBeTruthy();
      await expectNoAxeViolations(container);
    });
  });
});
