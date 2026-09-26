import { UUID, expect, test, tokenInUrl } from './support/fixtures';

// Checklist 4 e 5.

test.describe('Dado o diálogo "Create New URL" (checklist 4)', () => {
  test('deve criar a URL com status, content-type, timeout e corpo Quando Create é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const original = await tokens.create();
    await page.goto(`/#/${original}`);

    await page.getByRole('button', { name: 'New' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New URL' });
    await dialog.getByLabel('Default status code').fill('404');
    await dialog.getByLabel('Content Type').fill('application/json');
    await dialog.getByLabel('Timeout before response').fill('1');
    await dialog.getByLabel('Response body').fill('{"x":1}');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('New URL created')).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(original));
    await expect(page).toHaveURL(new RegExp(`#/${UUID.source}$`));
    const novo = tokenInUrl(page);
    tokens.track(novo);
    const webhook = await request.post(`/${novo}`);
    expect(webhook.status()).toBe(404);
    expect(webhook.headers()['content-type']).toContain('application/json');
    expect(await webhook.text()).toBe('{"x":1}');
    expect(
      ((await (await request.get(`/token/${novo}`)).json()) as { timeout: number }).timeout,
    ).toBe(1);
  });

  test.describe('Dado um timeout fora da validação do servidor (0–10)', () => {
    for (const timeout of ['11', '-1']) {
      test(`não deve criar e deve dizer o que corrigir Quando o timeout é ${timeout}`, async ({
        page,
        tokens,
      }) => {
        await page.goto(`/#/${await tokens.create()}`);

        await page.getByRole('button', { name: 'New' }).click();
        const dialog = page.getByRole('dialog', { name: 'Create New URL' });
        await dialog.getByLabel('Timeout before response').fill(timeout);
        await dialog.getByLabel('Default status code').click();
        await dialog.getByRole('button', { name: 'Create' }).click();

        await expect(dialog.locator('#token-form-pending')).toHaveText(
          'To save, fix: Timeout before response',
        );
        await expect(dialog.getByLabel('Timeout before response')).toBeFocused();
        await expect(
          dialog.getByText('The timeout must be an integer between 0 and 10.'),
        ).toBeVisible();
      });
    }
  });
});

test.describe('Dado o diálogo "Edit URL" (checklist 5)', () => {
  test('deve vir preenchido e gravar os campos editados Quando Edit é clicado', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      default_status: '202',
      default_content: 'antes',
      timeout: '2',
    });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${tokenId}$`),
    );

    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit URL' });
    await expect(dialog.getByLabel('Default status code')).toHaveValue('202');
    await expect(dialog.getByLabel('Timeout before response')).toHaveValue('2');
    await expect(dialog.getByLabel('Response body')).toHaveValue('antes');
    await dialog.getByLabel('Default status code').fill('201');
    await dialog.getByLabel('Response body').fill('depois');
    await dialog.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByText('URL updated!')).toBeVisible();
    const token = (await (await request.get(`/token/${tokenId}`)).json()) as Record<
      string,
      unknown
    >;
    expect(token).toMatchObject({ default_status: 201, default_content: 'depois', timeout: 2 });
    expect(page.url()).toContain(tokenId);
  });
});
