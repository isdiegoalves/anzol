import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { FormControl } from '@angular/forms';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { attention, expectPut, renderCard, saveButton } from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { E2eeKey, E2eePolicy } from '../token/token';
import { E2eeCard, signersValidator } from './e2ee-card';

const SIGNATARIO = { kty: 'EC', crv: 'P-256', kid: 'sig-1', x: 'xx', y: 'yy' };
const POLITICA: E2eePolicy = {
  path: '$.payload',
  required: true,
  audience: 'anzol-lab',
  bindings: {
    jti: '$.eventId',
    evt: '$.tipoEvento.nome',
    app: { path: '$.servico.nome', ignore_case: true },
  },
  max_age_seconds: 43200,
  trusted_signers: [SIGNATARIO],
};
const CHAVE: E2eeKey = {
  kid: 'enc-20261007-ab12',
  created_at: '2026-10-07 10:00:00',
  jwk: {
    kty: 'EC',
    crv: 'P-256',
    kid: 'enc-20261007-ab12',
    use: 'enc',
    alg: 'ECDH-ES',
    x: 'a',
    y: 'b',
  },
};
const PROTEGIDA = token({
  protected: true,
  signature: { provider: 'github', secret: '••••1234' },
  e2ee: null,
  e2ee_keys: [],
});

const card = () => screen.getByRole('region', { name: 'E2EE decryption' });
const note = () => card().querySelector('app-card-foot .note')?.textContent?.trim();
const toggle = () =>
  within(card()).getByRole('switch', { name: 'Decrypt an attribute of each request' });
const keys = () => within(card()).getByRole('region', { name: 'Encryption keys' });
const box = (name: string | RegExp) => within(card()).getByRole('textbox', { name });
const signers = () => screen.getByLabelText('Trusted signers') as HTMLTextAreaElement;
/** `userEvent.type` lê `{` e `[` como tecla; o JSON entra de uma vez. */
const paste = (field: HTMLTextAreaElement, text: string) =>
  fireEvent.input(field, { target: { value: text } });

async function fillPolicy() {
  await userEvent.click(toggle());
  await userEvent.type(box('Encrypted attribute'), '$.payload');
  await userEvent.type(box('Audience (aud)'), 'anzol-lab');
  await userEvent.type(box('jti'), '$.eventId');
  await userEvent.type(box('evt'), '$.tipoEvento.nome');
  await userEvent.type(box('app'), '$.servico.nome');
  await userEvent.click(within(card()).getByRole('checkbox', { name: 'Ignore case in app' }));
  paste(signers(), JSON.stringify([SIGNATARIO]));
}

describe('Dado o cartão "E2EE decryption" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve vir desligado, sem campos e sem chave, e passar no axe Quando a URL não decifra', async () => {
    const { container } = await renderCard(E2eeCard, PROTEGIDA);

    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(within(card()).getByText('Off')).toBeTruthy();
    expect(within(card()).queryByRole('textbox', { name: 'Encrypted attribute' })).toBeNull();
    expect(
      within(card()).getByText('No key yet: generate one and give its public key to the sender.'),
    ).toBeTruthy();
    expect(within(card()).getByRole('link', { name: 'Public JWKS' }).getAttribute('href')).toBe(
      `${location.origin}/token/${TOKEN_ID}/jwks.json`,
    );
    await expectNoAxeViolations(container);
  });

  it('deve dizer o que falta e não salvar Quando a decifra é ligada sem a política', async () => {
    const { container, http } = await renderCard(E2eeCard, PROTEGIDA);

    await userEvent.click(toggle());

    expect(note()).toBe(
      'To save, fill in: Encrypted attribute, Audience (aud), jti, evt, app, Trusted signers',
    );
    await expectNoAxeViolations(container);
    await userEvent.click(saveButton());

    expect(attention()).toBe(
      '6 fields need attention: Encrypted attribute, Audience (aud), jti, evt, app, Trusted signers',
    );
    expect(document.activeElement).toBe(box('Encrypted attribute'));
    http.expectNone((sent) => sent.method === 'PUT');
  });

  it('deve mandar a política no PUT com o resto da URL salva Quando os campos são preenchidos', async () => {
    const { http } = await renderCard(E2eeCard, PROTEGIDA);

    await fillPolicy();
    await userEvent.click(saveButton());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({
      signature: { provider: 'github', secret: '••••1234' },
      e2ee: POLITICA,
    });
    put.flush({ ...PROTEGIDA, e2ee: POLITICA });
    await vi.waitFor(() => expect(within(card()).getByText('On · $.payload')).toBeTruthy());
    expect(within(card()).queryByText('Unsaved')).toBeNull();
  });

  it('deve vir com a política salva, a caixa ignorada só no app, e desligar com "Turn off"', async () => {
    const { http } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee: POLITICA });

    expect(box('Encrypted attribute')).toHaveProperty('value', '$.payload');
    expect(box('jti')).toHaveProperty('value', '$.eventId');
    const ignored = within(card())
      .getAllByRole('checkbox')
      .map((checkbox) => [
        checkbox.getAttribute('aria-label'),
        (checkbox as HTMLInputElement).checked,
      ]);
    expect(ignored).toEqual([
      ['Ignore case in jti', false],
      ['Ignore case in evt', false],
      ['Ignore case in app', true],
    ]);
    expect(JSON.parse(signers().value)).toEqual([SIGNATARIO]);

    await userEvent.click(within(card()).getByRole('button', { name: 'Turn off' }));
    expect(within(card()).getByText(/^Saving turns decryption off\./)).toBeTruthy();
    await userEvent.click(saveButton());

    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({ e2ee: null });
  });

  it('deve dizer os três passos no topo, na ordem do remetente, e pôr as chaves de cifra antes do interruptor', async () => {
    const { container } = await renderCard(E2eeCard, PROTEGIDA);

    const passos = within(card()).getByRole('list', { name: 'How decryption works' });
    expect(
      within(passos)
        .getAllByRole('listitem')
        .map((passo) => passo.querySelector('strong')?.textContent?.trim()),
    ).toEqual([
      'The sender encrypts to this URL',
      'The sender signs what it encrypts',
      'This URL decrypts on arrival',
    ]);
    expect(passos.textContent).toContain('an invalid or missing HMAC blocks decryption');
    expect(passos.compareDocumentPosition(keys()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      keys().compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it.each([
    ['sem chave de cifra', [], true],
    ['com uma chave de cifra', [CHAVE], false],
  ])(
    'deve avisar o que acontece sem chave, e que o salvar continua, Quando a decifra é ligada %s',
    async (_caso, chaves, avisa) => {
      const { container } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee_keys: chaves });

      expect(within(card()).queryByText(/^Without an encryption key/)).toBeNull();
      await userEvent.click(toggle());

      const aviso = within(card()).queryByText(/^Without an encryption key/);
      expect(aviso !== null).toBe(avisa);
      if (aviso) {
        expect(aviso.textContent?.replace(/\s+/g, ' ').trim()).toBe(
          'Without an encryption key, every request that gets past the HMAC, the envelope and the JWE header is recorded as Unknown encryption key. You can save anyway; generate a key above.',
        );
      }
      await expectNoAxeViolations(container);
    },
  );

  it('deve dizer o que é cada vínculo e onde achar a audiência na dica, sem placeholder que pareça valor', async () => {
    const { container } = await renderCard(E2eeCard, PROTEGIDA);
    await userEvent.click(toggle());
    const description = (field: HTMLElement) =>
      (field.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .join(' ');

    const vinculos = within(card()).getByRole('group', {
      name: 'Bindings to the envelope (the body outside the JWE)',
    });
    expect(vinculos.textContent).toContain('ask the sender where the event id');
    expect(
      ['jti', 'evt', 'app'].map((claim) =>
        description(within(vinculos).getByRole('textbox', { name: claim })),
      ),
    ).toEqual([
      'event id · e.g. $.eventId',
      'event type · e.g. $.tipoEvento.nome',
      'service name · e.g. $.servico.nome',
    ]);
    expect(description(box('Audience (aud)'))).toBe(
      'Agree on it with the sender, who puts this value in the aud claim. In the lab it is anzol-lab.',
    );
    expect(description(box('Encrypted attribute'))).toBe(
      'JSONPath of the body field that arrives as a JWE · e.g. $.payload',
    );
    for (const name of ['Encrypted attribute', 'Audience (aud)', 'jti', 'evt', 'app']) {
      expect(box(name).getAttribute('placeholder')).toBeNull();
    }
    await expectNoAxeViolations(container);
  });

  it('deve avisar que o servidor recusa sem segredo de leitura Quando a URL está aberta', async () => {
    const { container } = await renderCard(E2eeCard, { ...PROTEGIDA, protected: false });

    await userEvent.click(toggle());

    const aviso = within(card()).getByText(/^This URL has no read secret/);
    expect(within(aviso).getByRole('link', { name: 'Privacy' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve recusar signatários que não são uma lista JSON', async () => {
    await renderCard(E2eeCard, PROTEGIDA);
    await userEvent.click(toggle());

    paste(signers(), '{"kty": "EC"}');
    fireEvent.blur(signers());

    expect(screen.getByText('Paste a JSON array of public JWKs: [{"kty": "EC", …}].')).toBeTruthy();
    expect(signers().getAttribute('aria-invalid')).toBe('true');
    expect(signersValidator(new FormControl('[', { nonNullable: true }))).toEqual({
      json: expect.stringMatching(/^Invalid JSON: /),
    });
  });

  it('deve marcar no campo o que o servidor recusou e dizer a recusa geral no cartão (422)', async () => {
    const { http } = await renderCard(E2eeCard, PROTEGIDA);
    await fillPolicy();
    await userEvent.click(saveButton());

    (await expectPut(http)).flush(
      {
        'e2ee.bindings.app.path': ['The e2ee.bindings.app.path is not a valid JSONPath.'],
        'e2ee.trusted_signers.0': ['The key must not contain d.'],
        e2ee: ['The e2ee requires a read secret on this URL (read_secret).'],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(() =>
      expect(attention()).toBe('3 fields need attention: app, Trusted signers, E2EE decryption'),
    );
    expect(screen.getByText('The e2ee.bindings.app.path is not a valid JSONPath.')).toBeTruthy();
    expect(screen.getByText('The key must not contain d.')).toBeTruthy();
    // A recusa geral fica no cartão; quem a anuncia é o alerta da barra.
    expect(within(card()).getByText(/^The e2ee requires a read secret/).tagName).toBe('P');
  });

  it('deve dizer a recusa e o que fazer Quando o salvar que desliga a decifra e remove o segredo leva 422 em read_secret', async () => {
    const { http } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee: POLITICA });

    await userEvent.click(within(card()).getByRole('button', { name: 'Turn off' }));
    expect(within(card()).getByText(/^Saving turns decryption off\./).textContent).toContain(
      'the read secret stays required until they are deleted.',
    );
    await userEvent.click(saveButton());
    (await expectPut(http)).flush(
      {
        read_secret: [
          'The read secret cannot be removed while this URL has decrypted requests; delete them first.',
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    await vi.waitFor(() =>
      expect(
        within(card())
          .getByText(/^The server refused/)
          .textContent?.trim(),
      ).toBe(
        'The server refused: this URL has decrypted requests. Delete them before removing the secret, or keep the secret.',
      ),
    );
  });

  describe('Dado as regras de falha da decifra', () => {
    const regras = `/token/${TOKEN_ID}/rules`;
    const adicionar = () => within(card()).getByRole('button', { name: 'Add failure rules' });
    const resultado = () =>
      within(card())
        .getByRole('region', { name: 'Failure responses' })
        .querySelector('[role=status]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();

    it('não deve oferecer o botão Quando a decifra não está salva', async () => {
      await renderCard(E2eeCard, PROTEGIDA);
      await userEvent.click(toggle());

      expect(within(card()).queryByRole('button', { name: 'Add failure rules' })).toBeNull();
    });

    it('deve explicar o que acontece sem regra e criar as duas da decifra no começo da lista, uma vez só', async () => {
      const { container, http } = await renderCard(E2eeCard, {
        ...PROTEGIDA,
        e2ee: POLITICA,
        signature: null,
      });
      const minha = {
        id: 'r1',
        name: 'Minha',
        priority: 1,
        match: { method: ['POST'] },
        response: { status: 201 },
      };

      const secao = within(card()).getByRole('region', { name: 'Failure responses' });
      expect(secao.textContent).toContain(
        "Without a rule, a request whose decryption fails gets this URL's default response, and the sender never finds out.",
      );
      expect(secao.textContent).not.toContain('401');
      await expectNoAxeViolations(container);
      await userEvent.click(adicionar());

      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: regras }))).flush([minha]);
      const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: regras }));
      expect(put.request.body).toEqual([
        {
          name: 'decryption: unknown_kid → 500',
          priority: 2,
          match: { decryption: 'unknown_kid' },
          response: { status: 500 },
        },
        {
          name: 'decryption: invalid → 400',
          priority: 3,
          match: { decryption: 'invalid' },
          response: { status: 400 },
        },
        minha,
      ]);
      put.flush(put.request.body);
      await vi.waitFor(() =>
        expect(resultado()).toBe(
          'Added 2 rules: decryption: unknown_kid → 500, decryption: invalid → 400. See them in Rules.',
        ),
      );
      expect(within(card()).getByRole('link', { name: 'Rules' }).getAttribute('href')).toContain(
        `/${TOKEN_ID}/rules`,
      );
    });

    it('deve acrescentar só a que falta, e as do HMAC Quando a URL verifica assinatura', async () => {
      const { http } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee: POLITICA });
      const existente = {
        id: 'r1',
        name: 'Chave sumida',
        priority: 1,
        match: { method: [], path: null, decryption: 'unknown_kid' },
        response: { status: 503 },
      };

      expect(
        within(card()).getByRole('region', { name: 'Failure responses' }).textContent,
      ).toContain('and 401 when the HMAC signature is invalid or missing');
      await userEvent.click(adicionar());
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: regras }))).flush([existente]);

      const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: regras }));
      expect((put.request.body as { name: string }[]).map((regra) => regra.name)).toEqual([
        'signature: invalid → 401',
        'signature: absent → 401',
        'decryption: invalid → 400',
        'Chave sumida',
      ]);
    });

    it('não deve gravar nada Quando a URL já tem todas', async () => {
      const { http } = await renderCard(E2eeCard, {
        ...PROTEGIDA,
        e2ee: POLITICA,
        signature: null,
      });

      await userEvent.click(adicionar());
      (await vi.waitFor(() => http.expectOne({ method: 'GET', url: regras }))).flush([
        { id: 'a', name: 'x', match: { decryption: 'unknown_kid' }, response: { status: 500 } },
        { id: 'b', name: 'y', match: { decryption: 'invalid' }, response: { status: 422 } },
      ]);

      await vi.waitFor(() =>
        expect(resultado()).toBe(
          'This URL already has a rule for each failure; nothing was added.',
        ),
      );
      http.expectNone({ method: 'PUT', url: regras });
    });
  });

  describe('Dado as chaves de cifra', () => {
    it('deve gerar a chave com o kid digitado e mostrá-la na lista', async () => {
      const { http } = await renderCard(E2eeCard, PROTEGIDA);

      await userEvent.type(box('Key ID (kid)'), CHAVE.kid);
      await userEvent.click(within(card()).getByRole('button', { name: 'Generate key' }));

      const post = http.expectOne(`/token/${TOKEN_ID}/keys`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ kid: CHAVE.kid });
      post.flush(CHAVE, { status: 201, statusText: 'Created' });

      const item = await vi.waitFor(() => within(keys()).getByRole('listitem'));
      expect(item.textContent).toContain(CHAVE.kid);
      expect(item.textContent).toMatch(/created Oct 7, 2026/);
      expect(TestBed.inject(Preferences).token()?.e2ee_keys).toEqual([CHAVE]);
      expect(box('Key ID (kid)')).toHaveProperty('value', '');
    });

    it('deve deixar o servidor escolher o kid Quando o campo fica vazio, e mostrar a recusa do kid', async () => {
      const { http } = await renderCard(E2eeCard, PROTEGIDA);

      await userEvent.click(within(card()).getByRole('button', { name: 'Generate key' }));

      const post = http.expectOne(`/token/${TOKEN_ID}/keys`);
      expect(post.request.body).toEqual({});
      post.flush(
        { kid: ['The kid is already in use on this URL.'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
      await vi.waitFor(() =>
        expect(within(card()).getByRole('alert').textContent).toBe(
          'The kid is already in use on this URL.',
        ),
      );
    });

    it('deve desligar o "Generate key" com o motivo Quando a URL já tem duas chaves', async () => {
      const { container, http } = await renderCard(E2eeCard, {
        ...PROTEGIDA,
        e2ee_keys: [CHAVE, { ...CHAVE, kid: 'enc-2' }],
      });

      const gerar = within(card()).getByRole('button', { name: 'Generate key' });
      expect(gerar.getAttribute('aria-disabled')).toBe('true');
      const motivo = document.getElementById(gerar.getAttribute('aria-describedby') ?? '');
      expect(motivo?.textContent?.trim()).toBe(
        'This URL already has 2 keys. Delete the old one before generating another.',
      );
      await userEvent.click(gerar);
      http.expectNone(`/token/${TOKEN_ID}/keys`);
      await expectNoAxeViolations(container);
    });

    it('deve copiar a JWK pública', async () => {
      const { fixture } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee_keys: [CHAVE] });
      const copy = vi
        .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
        .mockReturnValue(true);

      await userEvent.click(
        within(card()).getByRole('button', { name: `Copy public key ${CHAVE.kid}` }),
      );

      expect(JSON.parse(copy.mock.calls[0][0])).toEqual(CHAVE.jwk);
    });

    it.each([
      ['com a decifra ligada e uma chave só', { e2ee: POLITICA, e2ee_keys: [CHAVE] }, true],
      [
        'com a decifra ligada e duas chaves',
        { e2ee: POLITICA, e2ee_keys: [CHAVE, { ...CHAVE, kid: 'enc-2' }] },
        false,
      ],
      ['com a decifra desligada', { e2ee: null, e2ee_keys: [CHAVE] }, false],
    ])(
      'deve dizer o que fica ao apagar a chave e avisar só da última Quando a URL está %s',
      async (_caso, url, avisa) => {
        const { fixture } = await renderCard(E2eeCard, { ...PROTEGIDA, ...url });
        const page = TestbedHarnessEnvironment.documentRootLoader(fixture);

        await userEvent.click(
          within(card()).getByRole('button', { name: `Delete key ${CHAVE.kid}` }),
        );

        const dialogo = await vi.waitFor(() => page.getHarness(MatDialogHarness));
        const texto = (await dialogo.getContentText()).replace(/\s+/g, ' ');
        expect(texto).toContain(
          'Requests already decrypted keep their stored value. Old backups of the volume still have the private key.',
        );
        expect(texto).toContain('The private key is removed from this URL.');
        expect(texto).not.toContain("can't be recovered");
        expect(texto.includes("This is the URL's only encryption key")).toBe(avisa);
        await (await dialogo.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).click();
      },
    );

    it.each([
      ['Cancel', false],
      ['Delete key', true],
    ])(
      'deve perguntar no diálogo do app antes de apagar e, com "%s", apagar = %s',
      async (botao, apaga) => {
        const { fixture, http } = await renderCard(E2eeCard, { ...PROTEGIDA, e2ee_keys: [CHAVE] });
        const page = TestbedHarnessEnvironment.documentRootLoader(fixture);

        await userEvent.click(
          within(card()).getByRole('button', { name: `Delete key ${CHAVE.kid}` }),
        );

        const dialogo = await vi.waitFor(() => page.getHarness(MatDialogHarness));
        expect(await dialogo.getTitleText()).toBe(`Delete key ${CHAVE.kid}?`);
        await (await dialogo.getHarness(MatButtonHarness.with({ text: botao }))).click();

        if (apaga) {
          const apagar = await vi.waitFor(() =>
            http.expectOne(`/token/${TOKEN_ID}/keys/${CHAVE.kid}`),
          );
          expect(apagar.request.method).toBe('DELETE');
          apagar.flush(null, { status: 204, statusText: 'No Content' });
          await vi.waitFor(() => expect(within(keys()).queryByRole('listitem')).toBeNull());
        } else {
          await vi.waitFor(async () =>
            expect(await page.getHarnessOrNull(MatDialogHarness)).toBeNull(),
          );
          http.expectNone(`/token/${TOKEN_ID}/keys/${CHAVE.kid}`);
          expect(within(keys()).getByRole('listitem')).toBeTruthy();
        }
      },
    );
  });
});
