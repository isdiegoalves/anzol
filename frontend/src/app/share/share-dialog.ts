import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Injector, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { apiDate } from '../outbound/outbound';
import { localDate } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import {
  DEFAULT_SHARE_EXPIRATION,
  SHARE_EXPIRATIONS,
  SHARE_EXPIRATION_LABELS,
  ShareLink,
} from './share';
import { ShareStore } from './share-store';

export interface ShareDialogData {
  request: WebhookRequest;
}

/** Abre o "Share read-only link…" da mensagem (chamado do detalhe, sob demanda). */
export function openShareDialog(injector: Injector, request: WebhookRequest): void {
  injector.get(MatDialog).open<ShareDialog, ShareDialogData>(ShareDialog, {
    data: { request },
    width: '600px',
  });
}

/**
 * "Share read-only link…": cria um link só-leitura da mensagem (validade e máscara dos valores
 * sensíveis), mostra-o para copiar e lista os links ativos da URL, com revogar.
 */
@Component({
  selector: 'app-share-dialog',
  imports: [
    ReactiveFormsModule,
    CdkCopyToClipboard,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatSelect,
    MatOption,
    MatSlideToggle,
    MatButton,
  ],
  templateUrl: './share-dialog.html',
  styleUrl: './share-dialog.scss',
})
export class ShareDialog {
  protected readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly store = inject(ShareStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly form = this.formBuilder.group({
    expires_in: [DEFAULT_SHARE_EXPIRATION],
    redact: [true],
  });
  protected readonly expirations = SHARE_EXPIRATIONS.map((value) => ({
    value,
    label: SHARE_EXPIRATION_LABELS[value],
  }));

  protected readonly creating = signal(false);
  /** O link recém-criado, para copiar. */
  protected readonly created = signal<ShareLink | null>(null);
  protected readonly links = signal<readonly ShareLink[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly tokenId = this.data.request.token_id;

  constructor() {
    void this.loadLinks();
  }

  protected async createLink(): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    this.error.set(null);
    try {
      const link = await this.store.create(
        this.tokenId,
        this.data.request.uuid,
        this.form.getRawValue(),
      );
      this.created.set(link);
      this.links.update((links) => [link, ...links.filter((l) => l.id !== link.id)]);
    } catch (error) {
      this.error.set(shareError('create the link', error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async revokeLink(link: ShareLink): Promise<void> {
    this.error.set(null);
    try {
      await this.store.revoke(this.tokenId, link.id);
      this.links.update((links) => links.filter((l) => l.id !== link.id));
      if (this.created()?.id === link.id) {
        this.created.set(null);
      }
      this.snackBar.open('Link revoked');
    } catch (error) {
      this.error.set(shareError('revoke the link', error));
    }
  }

  protected copied(): void {
    this.snackBar.open('Copied link');
  }

  /** Endereço completo do link, para abrir em outro navegador. */
  protected address(link: ShareLink): string {
    return `${this.origin}${link.url}`;
  }

  protected expires(link: ShareLink): string {
    return localDate(apiDate(link.expires_at));
  }

  /** O link é desta mensagem (a listagem traz os da URL inteira). */
  protected isThisRequest(link: ShareLink): boolean {
    return link.request_id === this.data.request.uuid;
  }

  private async loadLinks(): Promise<void> {
    try {
      this.links.set(await this.store.list(this.tokenId));
    } catch (error) {
      this.error.set(shareError('load the active links', error));
    } finally {
      this.loaded.set(true);
    }
  }
}

/**
 * As frases do 422 (`{"shares": ["A URL can have at most 50 active shared links."]}`, como os
 * outros erros de validação) ou a do `error`; senão só o status.
 */
function shareError(action: string, error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return `Could not ${action}.`;
  }
  const body = error.error as Record<string, unknown> | null;
  const messages =
    error.status === 422 && body
      ? Object.values(body).flat()
      : typeof body?.['error'] === 'string'
        ? [body['error']]
        : [];
  const detail = messages.length > 0 ? `: ${messages.join(' ')}` : '';
  return `Could not ${action} (${error.status})${detail}`;
}
