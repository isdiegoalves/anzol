import { clearTranslations, loadTranslations } from '@angular/localize';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { render } from '@testing-library/angular';
import { rule } from '../../testing/rule-fixtures';
import { translations } from '../../locale/pt-BR';
import { ImportRulesDialog } from './import-rules-dialog';
import { diffRules } from './rule-diff';

describe('Dado o diálogo "Import rules" (WM-19)', () => {
  const show = (saved: ReturnType<typeof rule>[], incoming: ReturnType<typeof rule>[]) =>
    render(ImportRulesDialog, {
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: { saved, incoming, diff: diffRules(saved, incoming) },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });
  const counts = () => document.querySelector('.counts')?.textContent?.trim();

  /** 1 igual, 1 alterada, 1 apagada, 1 nova. */
  const umDeCada = () =>
    show(
      [rule(1), rule(2), rule(3)],
      [rule(1), rule(2, { name: 'Outra' }), { ...rule(9), id: undefined }],
    );
  /** 2 iguais, 2 alteradas, 2 apagadas, 2 novas. */
  const doisDeCada = () =>
    show(
      [rule(1), rule(2), rule(3), rule(4), rule(5), rule(6)],
      [
        rule(1),
        rule(2),
        rule(3, { name: 'Três' }),
        rule(4, { name: 'Quatro' }),
        { ...rule(8), id: undefined },
        { ...rule(9), id: undefined },
      ],
    );

  it('deve contar as quatro partes em inglês', async () => {
    await umDeCada();
    expect(counts()).toBe('1 unchanged · 1 changed · 1 removed · 1 new');
  });

  // M9: cada parte com o seu plural, e não "1 alteradas · 1 novas".
  describe('Dado a tela em pt-BR', () => {
    beforeEach(() => loadTranslations(translations));
    afterEach(() => clearTranslations());

    it('deve pôr cada parte no singular Quando a contagem é 1', async () => {
      await umDeCada();
      expect(counts()).toBe('1 igual · 1 alterada · 1 apagada · 1 nova');
    });

    it('deve pôr cada parte no plural Quando a contagem passa de 1', async () => {
      await doisDeCada();
      expect(counts()).toBe('2 iguais · 2 alteradas · 2 apagadas · 2 novas');
    });
  });
});
