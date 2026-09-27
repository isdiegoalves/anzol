import { Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import {
  AUTO_CLEANUP_LIMITS,
  AutoCleanup,
  Token,
  TokenSettings,
  retryAfterValidator,
} from './token';

export interface TokenDialogData {
  /** `null` quando a URL aberta não foi encontrada (mostra o aviso, como no app atual). */
  token: Token | null;
  /**
   * Cria na API. `true` fecha o diálogo com os campos enviados; `false` (erro, já avisado por quem
   * chamou) o mantém aberto, com o que foi digitado.
   */
  save: (settings: TokenSettings) => Promise<boolean>;
}

const INTEGER = /^[+-]?\d+$/;
/** Tamanho do segredo de leitura que o servidor aceita. */
const READ_SECRET_MIN = 8;
const READ_SECRET_MAX = 256;
/** Valor do segmentado "Auto cleanup": `off` desliga (vai `null`). */
type CleanupOption = 'off' | `${AutoCleanup}`;

/**
 * Diálogo "Create New URL", curto (C §2.10, S2): Create com os padrões, a resposta em "Customize
 * response" recolhido e a proteção por segredo. Assinatura, schema e o resto moram em Checks. A
 * validação é a do servidor (`timeout` 0–10, `retry_after` em segundos ou data HTTP, `auto_cleanup`
 * só com os limites aceitos); o Create nunca fica desabilitado e diz o que falta (S12).
 */
@Component({
  selector: 'app-token-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatSlideToggle,
  ],
  templateUrl: './token-dialog.html',
  styleUrl: './token-dialog.scss',
})
export class TokenDialog {
  protected readonly data = inject<TokenDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TokenDialog, TokenSettings>>(MatDialogRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly form = this.formBuilder.group({
    default_status: ['', Validators.pattern(INTEGER)],
    default_content_type: [''],
    timeout: [
      0 as number | null,
      [Validators.pattern(INTEGER), Validators.min(0), Validators.max(10)],
    ],
    default_content: [''],
    retry_after: ['', retryAfterValidator],
    auto_cleanup: ['off' as CleanupOption],
    privacy: this.formBuilder.group({
      required: [false],
      read_secret: [
        '',
        [
          Validators.required,
          Validators.minLength(READ_SECRET_MIN),
          Validators.maxLength(READ_SECRET_MAX),
        ],
      ],
      read_secret_confirm: [''],
    }),
  });
  protected readonly limits = AUTO_CLEANUP_LIMITS.map(String);
  /** "Customize response" aberto. */
  protected readonly customizing = signal(false);
  protected readonly saving = signal(false);
  /** Tentou criar com pendência: o resumo do que falta aparece e acompanha o preenchimento. */
  protected readonly attempted = signal(false);

  constructor() {
    const privacy = this.form.controls.privacy.controls;
    privacy.read_secret_confirm.addValidators((confirm) =>
      confirm.value === privacy.read_secret.value ? null : { mismatch: true },
    );
    privacy.required.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.syncPrivacy());
    privacy.read_secret.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => privacy.read_secret_confirm.updateValueAndValidity());
    this.syncPrivacy();
  }

  protected cleanupLimit(): string | null {
    const value = this.form.controls.auto_cleanup.value;
    return value === 'off' ? null : value;
  }

  /**
   * Campos de texto vão só preenchidos, como o `serializeArray` filtrado do app atual.
   * `retry_after` e `auto_cleanup` vão sempre (`null` quando vazios). `read_secret` só com a
   * proteção ligada; sem ele, a URL nasce aberta.
   */
  protected async createUrl(): Promise<void> {
    if (this.saving()) {
      return;
    }
    if (this.form.invalid) {
      this.showPending();
      return;
    }
    const { retry_after, auto_cleanup, privacy, ...fields } = this.form.getRawValue();
    const settings: TokenSettings = {};
    for (const [name, value] of Object.entries(fields)) {
      if (value !== null && value !== '') {
        settings[name as keyof typeof fields] = String(value);
      }
    }
    const sent: TokenSettings = {
      ...settings,
      retry_after: retry_after || null,
      auto_cleanup: auto_cleanup === 'off' ? null : (Number(auto_cleanup) as AutoCleanup),
      ...(privacy.required && { read_secret: privacy.read_secret }),
    };
    this.saving.set(true);
    const created = await this.data.save(sent);
    this.saving.set(false);
    if (created) {
      this.dialogRef.close(sent);
    }
  }

  /**
   * Depois de tentar criar: "2 fields need attention: Secret to view, Confirm secret", como os
   * cartões de Checks (CHECKS-13); vazio quando nada falta.
   */
  protected attention(): string {
    const labels = this.fields()
      .filter(([control]) => control.invalid)
      .map(([, , label]) => label);
    const list = labels.join(', ');
    if (labels.length === 0) {
      return '';
    }
    return labels.length === 1
      ? $localize`1 field needs attention: ${list}:fields:`
      : $localize`${labels.length}:count: fields need attention: ${list}:fields:`;
  }

  /**
   * Clicar com pendência: todos os erros à vista, o resumo e o foco no primeiro campo (abrindo o
   * "Customize response" se o campo estiver lá dentro).
   */
  private showPending(): void {
    this.attempted.set(true);
    this.form.markAllAsTouched();
    const first = this.fields().find(([control]) => control.invalid);
    if (!first) {
      return;
    }
    if (first[3]) {
      this.customizing.set(true);
    }
    // O campo recolhido só existe depois de o "Customize response" abrir.
    setTimeout(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(`[formControlName="${first[1]}"]`)
        ?.focus(),
    );
  }

  /** Campos que podem ficar pendentes, na ordem da tela: controle, nome, rótulo, recolhido. */
  private fields(): [AbstractControl, string, string, boolean][] {
    const c = this.form.controls;
    return [
      [c.default_status, 'default_status', $localize`Default status code`, true],
      [c.timeout, 'timeout', $localize`Timeout before response`, true],
      [c.retry_after, 'retry_after', 'Retry-After', true],
      [c.privacy.controls.read_secret, 'read_secret', $localize`Secret to view`, false],
      [
        c.privacy.controls.read_secret_confirm,
        'read_secret_confirm',
        $localize`Confirm secret`,
        false,
      ],
    ];
  }

  /** Com a proteção desligada, os campos do segredo saem da validação. */
  private syncPrivacy(): void {
    const c = this.form.controls.privacy.controls;
    for (const control of [c.read_secret, c.read_secret_confirm]) {
      if (c.required.value) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }
}
