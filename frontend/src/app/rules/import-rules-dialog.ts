import { Component, Injector, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { firstValueFrom } from 'rxjs';
import { Rule } from './rule';
import { RULES_MAX, RulesDiff, diffRules } from './rule-diff';

export type ImportMode = 'replace' | 'merge';

interface ImportData {
  saved: readonly Rule[];
  incoming: readonly Rule[];
  diff: RulesDiff;
}

/**
 * "Import rules" (WM-19, E-07): antes de gravar, o que o arquivo muda nas regras salvas, por id
 * (iguais, alteradas com os campos, apagadas, novas) e a escolha entre substituir tudo e mesclar
 * (as salvas ficam, as de id novo entram), dentro do teto de 100 regras.
 */
@Component({
  selector: 'app-import-rules-dialog',
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatRadioButton,
    MatRadioGroup,
  ],
  templateUrl: './import-rules-dialog.html',
  styleUrl: './import-rules-dialog.scss',
})
export class ImportRulesDialog {
  private readonly data = inject<ImportData>(MAT_DIALOG_DATA);

  protected readonly incoming = this.data.incoming.length;
  protected readonly saved = this.data.saved.length;
  protected readonly diff = this.data.diff;
  /** O "Merge" passaria do teto de regras: fica desabilitado, com o motivo à vista. */
  protected readonly tooMany = this.saved + this.diff.added.length > RULES_MAX;
  protected readonly mode = signal<ImportMode>('replace');
  protected readonly groups = [
    {
      id: 'changed',
      rules: this.diff.changed.map(({ rule, fields }) => `${nameOf(rule)} — ${fields.join('; ')}`),
    },
    { id: 'removed', rules: this.diff.removed.map(nameOf) },
    { id: 'added', rules: this.diff.added.map(nameOf) },
    { id: 'unchanged', rules: this.diff.unchanged.map(nameOf) },
  ].filter(({ rules }) => rules.length > 0);
}

function nameOf(rule: Rule): string {
  return typeof rule?.name === 'string' && rule.name !== '' ? rule.name : '—';
}

/**
 * Mostra a diferença e devolve a escolha (`null` = Cancel, Esc ou fora do diálogo). Nada é
 * gravado aqui: quem grava é a página, com Desfazer.
 */
export async function chooseImport(
  injector: Injector,
  saved: readonly Rule[],
  incoming: readonly Rule[],
): Promise<ImportMode | null> {
  const ref = injector
    .get(MatDialog)
    .open<ImportRulesDialog, ImportData, ImportMode>(ImportRulesDialog, {
      data: { saved, incoming, diff: diffRules(saved, incoming) },
      autoFocus: '.safe',
      width: 'min(560px, calc(100vw - 32px))',
      maxWidth: '100vw',
    });
  return (await firstValueFrom(ref.afterClosed())) ?? null;
}
