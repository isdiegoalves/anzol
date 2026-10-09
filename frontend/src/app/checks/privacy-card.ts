import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { RequestStore } from '../requests/request-store';
import { Token, TokenSettings } from '../token/token';
import { TokenStore } from '../token/token-store';
import { Icon } from '../ui/icon';
import { CardFold } from './card-fold';
import { CardFoot } from './card-foot';
import { ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import {
  PendingField,
  changeOf,
  decryptedRefusal,
  decryptionOnRefusal,
  fieldErrors,
  onOff,
  pendingLabels,
  pendingSummary,
  secretChange,
  serverMessages,
} from './url-settings';

/** Tamanho do segredo de leitura que o servidor aceita. */
const READ_SECRET_MIN = 8;
const READ_SECRET_MAX = 256;
/** O 422 em `e2ee` que recusa a decifra numa URL sem segredo de leitura. */
const E2EE_NEEDS_SECRET = /^The e2ee requires a read secret/;

/**
 * Checks › Privacy, portada da seção do antigo Edit URL (item 12): "Require a secret to view this
 * URL" com o segredo e a confirmação. Na URL já protegida, em branco mantém o segredo atual;
 * desligar tira a proteção (`read_secret: null`). Segredo novo destranca esta tela ao salvar.
 */
@Component({
  selector: 'app-privacy-card',
  imports: [
    Icon,
    ReactiveFormsModule,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSlideToggle,
    CardFoot,
  ],
  templateUrl: './privacy-card.html',
  styleUrls: ['./card.scss'],
  host: { role: 'region', 'aria-labelledby': 'privacy-title' },
  hostDirectives: [{ directive: CardFold, inputs: ['fold'] }],
})
export class PrivacyCard implements ChecksSection {
  private readonly tokens = inject(TokenStore);
  private readonly requests = inject(RequestStore);
  private readonly draft = inject(ChecksDraft);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  readonly id = 'privacy';
  /** A URL salva já exige segredo: campo em branco mantém o atual. */
  protected readonly wasProtected = signal(
    (this.draft.base() ?? this.tokens.token())?.protected === true,
  );
  /**
   * A URL decifra, tem chave de cifra ou a lista dela já tem requisição com decifra: o servidor
   * recusa remover o segredo com a decifra ligada ou com valor decifrado gravado.
   */
  protected readonly decrypts = computed(() => {
    const token = this.tokens.token();
    return (
      token?.e2ee != null ||
      (token?.e2ee_keys?.length ?? 0) > 0 ||
      (this.requests.tokenId() === token?.uuid &&
        this.requests.requests().some((request) => request.decryption))
    );
  });
  /** O 422 de remover o segredo (decifra ligada ou requisição decifrada), com a frase do servidor. */
  protected readonly refusal = signal<{ text: string; original: string } | null>(null);
  readonly form = this.formBuilder.group({
    required: [this.wasProtected()],
    read_secret: [''],
    read_secret_confirm: [''],
  });

  constructor() {
    const c = this.form.controls;
    c.read_secret_confirm.addValidators((confirm) =>
      confirm.value === c.read_secret.value ? null : { mismatch: true },
    );
    c.required.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.sync());
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.refusal.set(null));
    c.read_secret.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => c.read_secret_confirm.updateValueAndValidity());
    this.sync();
    this.draft.register(this);
  }

  protected secretLabel(): string {
    return this.wasProtected() ? $localize`New secret` : $localize`Secret to view`;
  }

  protected originalTitle(original: string): string {
    return $localize`Original: ${original}:phrase:`;
  }

  protected unsaved(): boolean {
    return this.draft.dirtySections().includes(this.id);
  }

  /** Com o `alert` da barra à vista, o resumo daqui se cala para não repetir. */
  protected pending(): string {
    return this.draft.alert() ? '' : pendingSummary(this.fields());
  }

  changes(): ChangeLine[] {
    const { required, read_secret } = this.form.getRawValue();
    return [
      ...changeOf(
        $localize`Require a secret to view this URL`,
        onOff(this.wasProtected()),
        onOff(required),
      ),
      ...(required ? secretChange(this.secretLabel(), read_secret) : []),
    ];
  }

  invalid(): string[] {
    return pendingLabels(this.fields());
  }

  protects(): boolean {
    return this.form.controls.required.value;
  }

  /**
   * `read_secret` só vai quando muda: segredo novo, ou `null` para tirar a proteção. Ausente mantém
   * o atual no `PUT`.
   */
  settings(): TokenSettings {
    const { required, read_secret } = this.form.getRawValue();
    if (required && read_secret !== '') {
      return { read_secret };
    }
    return !required && this.wasProtected() ? { read_secret: null } : {};
  }

  showPending(focus: boolean): void {
    this.form.markAllAsTouched();
    const first = this.fields().find(([control]) => control.invalid);
    if (focus && first) {
      this.host.nativeElement
        .querySelector<HTMLElement>(`[formControlName="${first[1]}"]`)
        ?.focus();
    }
  }

  load(token: Token): void {
    this.wasProtected.set(token.protected === true);
    this.form.reset({ required: this.wasProtected(), read_secret: '', read_secret_confirm: '' });
    this.refusal.set(null);
    this.sync();
  }

  refused(error: unknown): string[] {
    if (!this.form.controls.required.value) {
      const decrypting = serverMessages(error, 'e2ee').find((m) => E2EE_NEEDS_SECRET.test(m));
      const [decrypted] = serverMessages(error, 'read_secret');
      if (decrypting !== undefined) {
        this.refusal.set({ text: decryptionOnRefusal(), original: decrypting });
      } else if (decrypted !== undefined) {
        this.refusal.set({ text: decryptedRefusal(), original: decrypted });
      } else {
        return [];
      }
      return [$localize`Require a secret to view this URL`];
    }
    const messages = fieldErrors(error, 'read_secret');
    if (messages.length === 0) {
      return [];
    }
    const control = this.form.controls.read_secret;
    control.setErrors({ server: messages.join(' ') });
    control.markAsTouched();
    return [this.secretLabel()];
  }

  sketch(): Record<string, unknown> {
    return { required: this.form.controls.required.value };
  }

  restore(sketch: Record<string, unknown>): void {
    const control = this.form.controls.required;
    control.setValue(sketch['required'] === true);
    control.markAsDirty();
  }

  /**
   * Com a proteção desligada, os campos do segredo saem da validação. O segredo é obrigatório só
   * para quem ainda não tem um.
   */
  private sync(): void {
    const c = this.form.controls;
    c.read_secret.setValidators([
      ...(this.wasProtected() ? [] : [Validators.required]),
      Validators.minLength(READ_SECRET_MIN),
      Validators.maxLength(READ_SECRET_MAX),
    ]);
    for (const control of [c.read_secret, c.read_secret_confirm]) {
      if (c.required.value) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    c.read_secret.updateValueAndValidity({ emitEvent: false });
    c.read_secret_confirm.updateValueAndValidity({ emitEvent: false });
  }

  private fields(): readonly PendingField[] {
    const c = this.form.controls;
    return [
      [c.read_secret, 'read_secret', this.secretLabel()],
      [c.read_secret_confirm, 'read_secret_confirm', $localize`Confirm secret`],
    ];
  }
}
