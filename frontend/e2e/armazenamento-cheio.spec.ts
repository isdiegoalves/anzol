import { Page } from '@playwright/test';
import { escutarAnuncios, expectUmAnuncio } from './support/anuncios';
import { expect, test } from './support/fixtures';
import { estadoAoVivo } from './support/shell';
import { seedStorage } from './support/storage';

// O servidor diz pelo stream (`event: storage`) quando o armazenamento enche e quando volta a gravar. O Redis cheio
// não se provoca pela tela nem pela API: o teste entrega o evento ao `EventSource` que a tela abriu, como o servidor
// faria.

interface Estado {
  full: boolean;
  since: string;
}

type ComStreams = Window & { streamsAbertos: EventSource[] };

/** Guarda os `EventSource` que a tela abrir, para o teste falar por eles. */
async function guardarStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const abertos: EventSource[] = [];
    const Original = window.EventSource;
    (window as unknown as ComStreams).streamsAbertos = abertos;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        abertos.push(this);
      }
    };
  });
}

async function servidorDiz(page: Page, estado: Estado): Promise<void> {
  await page.evaluate((data) => {
    for (const stream of (window as unknown as ComStreams).streamsAbertos) {
      stream.dispatchEvent(new MessageEvent('storage', { data: JSON.stringify(data) }));
    }
  }, estado);
}

const faixa = (page: Page, nome: string) => page.getByRole('group', { name: nome, exact: true });

test.describe('Dado o servidor com o armazenamento cheio', () => {
  test.beforeEach(async ({ page }) => {
    await escutarAnuncios(page);
    await guardarStreams(page);
  });

  test('deve dizer numa faixa, abaixo do cabeçalho da URL, desde quando está cheio, e depois que voltou a gravar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(estadoAoVivo(page)).toContainText('Live');
    const armazenamento = page
      .getByRole('region', { name: 'This URL' })
      .getByRole('group', { name: 'Storage', exact: true });
    await expect(armazenamento).toHaveText('');

    await servidorDiz(page, { full: true, since: '2026-10-13 13:17:22' });

    await expect(armazenamento).toHaveText(
      /^Storage is full since \d{1,2}:\d{2}.*: new requests are being refused\.$/,
    );
    await expect(armazenamento).toBeVisible();
    await expect(armazenamento.getByRole('button')).toHaveCount(0);
    await expectUmAnuncio(
      page,
      /^Storage is full since .*: new requests are being refused\.$/,
      /^Storage$/,
    );

    await servidorDiz(page, { full: false, since: '2026-10-13 13:20:00' });

    await expect(armazenamento).toHaveText('Storing again.');
    await expect(armazenamento).toHaveText('', { timeout: 8_000 });
  });

  test('deve dizer as duas frases em português Quando a tela está em pt-BR', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { language: '"pt-BR"' });
    await page.goto(`/#/${tokenId}`);
    await expect(estadoAoVivo(page)).toContainText('Ao vivo');

    await servidorDiz(page, { full: true, since: '2026-10-13 13:17:22' });

    await expect(faixa(page, 'Armazenamento')).toHaveText(
      /^O armazenamento está cheio desde \d{1,2}:\d{2}: requisições novas estão sendo recusadas\.$/,
    );

    await servidorDiz(page, { full: false, since: '2026-10-13 13:20:00' });

    await expect(faixa(page, 'Armazenamento')).toHaveText('Voltou a gravar.');
  });
});
