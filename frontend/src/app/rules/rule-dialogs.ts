import { Component, Injector, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

/** O que o diálogo de confirmação diz: a pergunta, o que muda e o verbo do botão que confirma. */
export interface ConfirmData {
  title: string;
  message: string;
  confirm: string;
  /** Botão que só volta atrás ("Cancel", "Keep editing"); é o foco inicial e o Enter. */
  cancel: string;
}

/**
 * Confirmação das ações de Regras que perdem trabalho (WM-37, E-04): nomeia o que muda, e o foco
 * entra no botão seguro. No celular, os botões ocupam a largura, o que confirma embaixo.
 */
@Component({
  selector: 'app-rule-confirm',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="actions">
      <button mat-flat-button type="button" class="safe" [mat-dialog-close]="false">
        {{ data.cancel }}
      </button>
      <button mat-button type="button" [mat-dialog-close]="true">{{ data.confirm }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    @media (width < 600px) {
      .actions {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }
    }
  `,
})
export class RuleConfirm {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

/** Largura dos diálogos de Regras: 420 px, ou a tela menos 16 px de cada lado. */
export const DIALOG_WIDTH = 'min(420px, calc(100vw - 32px))';

/** Abre a confirmação e diz se o usuário confirmou (Esc, fora do diálogo e o botão seguro = não). */
export async function confirmAction(injector: Injector, data: ConfirmData): Promise<boolean> {
  const ref = injector.get(MatDialog).open<RuleConfirm, ConfirmData, boolean>(RuleConfirm, {
    data,
    // O foco entra no botão seguro (e o Enter o aciona), não no primeiro da ordem.
    autoFocus: '.safe',
    width: DIALOG_WIDTH,
    maxWidth: '100vw',
  });
  return (await firstValueFrom(ref.afterClosed())) === true;
}

/** "Discard changes?" do editor com alterações não salvas (E-04): "Keep editing" é o padrão. */
export function confirmDiscard(injector: Injector, name: string): Promise<boolean> {
  return confirmAction(injector, {
    title: $localize`Discard changes?`,
    message: $localize`"${name}:name:" has unsaved changes.`,
    confirm: $localize`Discard`,
    cancel: $localize`Keep editing`,
  });
}
