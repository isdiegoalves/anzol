import { Page } from '@playwright/test';

/**
 * Grava o localStorage da origem da tela antes de abri-la. Passa por um arquivo estático da
 * mesma origem para não disparar o bootstrap da SPA (que gravaria os padrões por cima).
 */
export async function seedStorage(page: Page, values: Record<string, string>): Promise<void> {
  await page.goto('/favicon.ico');
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, values);
}

export function readStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => ({ ...localStorage }));
}
