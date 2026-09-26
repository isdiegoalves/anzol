import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { retryAfterValidator } from './retry-after';
import { Token, TokenSettings } from './token';

export interface TokenDialogData {
  mode: 'create' | 'edit';
  /** `null` quando a URL não foi encontrada (mostra o aviso, como no app atual). */
  token: Token | null;
}

const INTEGER = /^[+-]?\d+$/;

/**
 * Diálogos "Create New URL" e "Edit URL", com a validação do servidor (`timeout` 0–10,
 * `retry_after` em segundos ou data HTTP).
 */
@Component({
  selector: 'app-token-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    MatButton,
  ],
  templateUrl: './token-dialog.html',
  styleUrl: './token-dialog.scss',
})
export class TokenDialog {
  protected readonly data = inject<TokenDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TokenDialog, TokenSettings>>(MatDialogRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  private readonly editing = this.data.mode === 'edit' ? this.data.token : null;
  protected readonly form = this.formBuilder.group({
    default_status: [
      this.editing ? String(this.editing.default_status) : '',
      Validators.pattern(INTEGER),
    ],
    default_content_type: [this.editing?.default_content_type ?? ''],
    timeout: [
      this.editing ? this.editing.timeout : (0 as number | null),
      [Validators.pattern(INTEGER), Validators.min(0), Validators.max(10)],
    ],
    default_content: [this.editing?.default_content ?? ''],
    retry_after: [String(this.editing?.retry_after ?? ''), retryAfterValidator],
  });

  /**
   * Campos de texto vão só preenchidos, como o `serializeArray` filtrado do app atual. O
   * `retry_after` vai sempre (`null` quando vazio): no `PUT`, campo ausente volta ao padrão.
   */
  protected saveSettings(): void {
    if (this.form.invalid) {
      return;
    }
    const { retry_after, ...fields } = this.form.getRawValue();
    const settings: TokenSettings = {};
    for (const [name, value] of Object.entries(fields)) {
      if (value !== null && value !== '') {
        settings[name as keyof typeof fields] = String(value);
      }
    }
    this.dialogRef.close({ ...settings, retry_after: retry_after || null });
  }
}
