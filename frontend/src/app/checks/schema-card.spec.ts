import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { expectPut, renderCard } from '../../testing/checks';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { SchemaCard } from './schema-card';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const SCHEMA = { type: 'object', required: ['id'] };
const RECENTES = `/token/${TOKEN_ID}/requests?page=1&sorting=newest`;

const field = () => screen.getByRole('textbox', { name: 'JSON Schema' }) as HTMLTextAreaElement;
const save = () => screen.getByRole('button', { name: 'Save schema' });

describe('Dado o cartão "Schema validation" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve vir com o schema salvo, indentado e numerado, e passar no axe', async () => {
    const { container, http } = await renderCard(
      SchemaCard,
      token({ schema: SCHEMA, signature: { provider: 'github', secret: '••••1234' } }),
    );
    http.expectOne(RECENTES).flush(requestPage([]));

    expect(field().value).toBe(JSON.stringify(SCHEMA, null, 2));
    expect(container.querySelector('.gutter')?.textContent).toBe('1\n2\n3\n4\n5\n6');
    expect(screen.getByText('On')).toBeTruthy();
    await vi.waitFor(() =>
      expect(screen.getByText('No request with a JSON body yet.')).toBeTruthy(),
    );
    await expectNoAxeViolations(container);
  });

  it('deve dizer "Invalid JSON", focar o campo e não salvar Quando o texto não é JSON', async () => {
    const { http } = await renderCard(SchemaCard, token());
    http.expectOne(RECENTES).flush(requestPage([]));

    await userEvent.type(field(), '{{"type": ');
    await userEvent.tab();
    expect(screen.getByText(/^Invalid JSON: /)).toBeTruthy();
    expect(screen.getByRole('status').textContent?.trim()).toBe('To save, fix: JSON Schema');
    await userEvent.click(save());

    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      '1 field needs attention: JSON Schema',
    );
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-invalid')).toBe('true');
    http.expectNone((sent) => sent.method === 'PUT');
  });

  it('deve salvar o schema com a assinatura e a resposta salvas no mesmo PUT (CA-11)', async () => {
    const assinatura = { provider: 'github' as const, secret: '••••1234' };
    const { http } = await renderCard(
      SchemaCard,
      token({ signature: assinatura, default_status: 202, default_content: 'resposta' }),
    );
    http.expectOne(RECENTES).flush(requestPage([]));

    await userEvent.click(field());
    await userEvent.paste(JSON.stringify(SCHEMA));
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({
      schema: SCHEMA,
      signature: assinatura,
      default_status: '202',
      default_content: 'resposta',
    });
    put.flush(token({ schema: SCHEMA }));
    await vi.waitFor(() => expect(screen.getByRole('status').textContent?.trim()).toBe('Saved.'));
  });

  it('deve mostrar o erro do servidor no campo Quando o PUT recusa o schema (422)', async () => {
    const { http } = await renderCard(SchemaCard, token({ schema: SCHEMA }));
    http.expectOne(RECENTES).flush(requestPage([]));

    await userEvent.clear(field());
    await userEvent.click(field());
    await userEvent.paste('{"$ref": "https://exemplo.com/s.json"}');
    await userEvent.click(save());
    (await expectPut(http)).flush(
      { schema: ['The schema is invalid: $ref is not internal.'] },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(() =>
      expect(screen.getByText('The schema is invalid: $ref is not internal.')).toBeTruthy(),
    );
    expect(screen.getByRole('status').textContent?.trim()).toBe('To save, fix: JSON Schema');
  });

  it('deve esvaziar e mandar schema nulo Quando "Clear schema" é salvo', async () => {
    const { http } = await renderCard(SchemaCard, token({ schema: SCHEMA }));
    http.expectOne(RECENTES).flush(requestPage([]));

    await userEvent.click(screen.getByRole('button', { name: 'Clear schema' }));
    expect(field().value).toBe('');
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body.schema).toBeNull();
    put.flush(token());
  });

  it('deve trazer o schema inferido da mensagem, sem salvar, Quando a página vem de "Create schema from this request"', async () => {
    const pedido = webhookRequest(7, { content: '{"id": 7, "tags": ["a"]}' });
    const { http } = await renderCard(SchemaCard, token(), {
      inputs: { schemaFrom: pedido.uuid },
    });
    http.expectOne(RECENTES).flush(requestPage([]));
    http.expectOne(`/token/${TOKEN_ID}/request/${pedido.uuid}`).flush(pedido);

    await vi.waitFor(() =>
      expect(JSON.parse(field().value)).toEqual({
        $schema: DRAFT,
        type: 'object',
        properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'tags'],
      }),
    );
    expect(screen.getByText(/^Inferred from request 00000000\./)).toBeTruthy();
    expect(screen.getByText('Unsaved')).toBeTruthy();
    http.expectNone((sent) => sent.method === 'PUT');
  });

  it('deve ignorar ?schema-from= que não é um UUID, sem chamar o servidor (path traversal)', async () => {
    const { http } = await renderCard(SchemaCard, token(), {
      inputs: { schemaFrom: '../../../share/abc' },
    });
    http.expectOne(RECENTES).flush(requestPage([]));

    await new Promise((resolve) => setTimeout(resolve));
    http.expectNone(() => true);
    expect(screen.queryByText(/^Inferred from request/)).toBeNull();
    expect(screen.queryByText('Could not load that request.')).toBeNull();
  });

  it('deve gerar da mensagem JSON escolhida Quando "Generate schema" é clicado', async () => {
    const { http } = await renderCard(SchemaCard, token());
    http
      .expectOne(RECENTES)
      .flush(
        requestPage([
          webhookRequest(1, { content: 'nome=Ana' }),
          webhookRequest(2, { content: '{"ok": true}' }),
        ]),
      );

    const source = await screen.findByRole('combobox', { name: 'Generate from a message' });
    expect(source.textContent).toContain(`#${webhookRequest(2).uuid.slice(0, 5)}`);
    await userEvent.click(source);
    expect(
      (await screen.findAllByRole('option')).map((o) => o.textContent?.trim().slice(0, 6)),
    ).toEqual([`#${webhookRequest(2).uuid.slice(0, 5)}`]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Generate schema' }));

    expect(JSON.parse(field().value)).toMatchObject({ properties: { ok: { type: 'boolean' } } });
  });

  it('CHECKS-15: deve dizer "· valid" ou "· invalid", limitar a textarea a 12 linhas e rolar os números junto', async () => {
    const { http, container } = await renderCard(SchemaCard, token({ schema: SCHEMA }));
    http.expectOne(RECENTES).flush(requestPage([]));

    const meta = () => container.querySelector('.editor-head .hint')?.textContent?.trim();
    expect(meta()).toMatch(/^\d+ B of 64 KB · valid$/);
    expect(field().rows).toBe(12);
    const gutter = container.querySelector('.gutter') as HTMLElement;
    field().scrollTop = 40;
    field().dispatchEvent(new Event('scroll'));
    expect(gutter.scrollTop).toBe(field().scrollTop);

    await userEvent.clear(field());
    await userEvent.type(field(), '{{"type": ');
    expect(meta()).toMatch(/· invalid$/);
  });

  it.each([
    ['2020-12', 'https://json-schema.org/draft/2020-12/schema', 'On · 2020-12'],
    ['2019-09', 'https://json-schema.org/draft/2019-09/schema#', 'On · 2019-09'],
    ['draft-07', 'http://json-schema.org/draft-07/schema#', 'On · draft-07'],
    ['sem $schema', null, 'On'],
  ])(
    'CHECKS-14: deve mostrar o dialeto no chip Quando o schema é %s',
    async (_c, dialect, chip) => {
      const schema = dialect ? { $schema: dialect, type: 'object' } : { type: 'object' };
      const { http, container } = await renderCard(SchemaCard, token({ schema }));
      http.expectOne(RECENTES).flush(requestPage([]));

      expect(container.querySelector('.card-head .state.on')?.textContent?.trim()).toBe(chip);
    },
  );

  it('CHECKS-16: deve mostrar o tipo do evento na opção e o painel com o nome sem repetição', async () => {
    const { http, container } = await renderCard(SchemaCard, token());
    http
      .expectOne(RECENTES)
      .flush(
        requestPage([
          webhookRequest(1, { content: '{"type":"payment_intent.succeeded","id":"evt_1"}' }),
          webhookRequest(2, { content: '[1,2]' }),
        ]),
      );

    const panel = await vi.waitFor(() => container.querySelector('.generate.panel') as HTMLElement);
    expect(panel.querySelectorAll('mat-label')).toHaveLength(0);
    const source = await within(panel).findByRole('combobox', { name: /^Generate from a message/ });
    expect(source.textContent).toContain(
      `#${webhookRequest(1).uuid.slice(0, 5)} payment_intent.succeeded`,
    );
    expect(panel.textContent).toContain(
      'Pick a JSON request; the schema is inferred from its body.',
    );
    expect(panel.textContent).not.toContain('Ctrl+Z');
    expect(
      within(panel).getByRole('button', { name: 'Generate schema' }).querySelector('app-icon'),
    ).toBeTruthy();
  });
});
