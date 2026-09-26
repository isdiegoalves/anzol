import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { Preferences } from './preferences';

/** "Redirection Settings": grava no localStorage a cada mudança, como o app atual. */
@Component({
  selector: 'app-redirect-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
    MatButton,
  ],
  templateUrl: './redirect-dialog.html',
  styleUrl: './redirect-dialog.scss',
})
export class RedirectDialog {
  private readonly preferences = inject(Preferences);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  protected readonly form = this.formBuilder.group({
    url: [this.preferences.redirectUrl() ?? ''],
    contentType: [this.preferences.redirectContentType() ?? ''],
    headers: [this.preferences.redirectHeaders() ?? ''],
    method: [this.preferences.redirectMethod() ?? ''],
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const { url, contentType, headers, method } = this.form.getRawValue();
      this.preferences.redirectUrl.set(url || null);
      this.preferences.redirectContentType.set(contentType);
      this.preferences.redirectHeaders.set(headers || null);
      this.preferences.redirectMethod.set(method);
    });
  }
}
