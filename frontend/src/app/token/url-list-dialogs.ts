import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, Injector, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { KnownUrls, NICKNAME_MAX } from './known-urls';

/** Largura dos diálogos da lista de URLs: 420 px, ou a tela menos 16 px de cada lado. */
const WIDTH = 'min(420px, calc(100vw - 32px))';

/**
 * "Rename this URL…" (B1): o apelido fica só neste navegador (`anzol.urls`); vazio apaga. Enter
 * salva.
 */
@Component({
  selector: 'app-url-nickname-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title i18n>Rename this URL</h2>
    <form (submit)="save($event)">
      <mat-dialog-content>
        <label class="field">
          <span class="label" i18n>Nickname</span>
          <input
            #box
            class="box"
            type="text"
            name="nickname"
            autocomplete="off"
            aria-describedby="nickname-hint"
            [attr.maxlength]="max"
            [value]="nickname()"
            (input)="nickname.set(box.value)"
          />
        </label>
        <p class="hint" id="nickname-hint" i18n>Only you see it, in this browser.</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="false" i18n>Cancel</button>
        <button mat-flat-button type="submit" i18n>Save nickname</button>
      </mat-dialog-actions>
    </form>
  `,
  styleUrl: './url-list-dialogs.scss',
})
export class UrlNicknameDialog {
  private readonly known = inject(KnownUrls);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly dialog = inject<MatDialogRef<UrlNicknameDialog, boolean>>(MatDialogRef);
  private readonly uuid = inject<string>(MAT_DIALOG_DATA);

  protected readonly max = NICKNAME_MAX;
  protected readonly nickname = signal(this.known.nicknameOf(this.uuid));

  protected save(event: Event): void {
    event.preventDefault();
    this.known.rename(this.uuid, this.nickname());
    void this.announcer.announce($localize`Nickname saved.`);
    this.dialog.close(true);
  }
}

/**
 * "Forget a URL…" (B1): uma caixa por URL conhecida. Esquecer tira da lista deste navegador e não
 * apaga nada no servidor.
 */
@Component({
  selector: 'app-forget-urls-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title i18n>Forget a URL</h2>
    <mat-dialog-content>
      <p class="hint" i18n>Forgetting does not delete the URL on the server.</p>
      <ul class="urls">
        @for (url of urls; track url.uuid) {
          <li>
            <label class="option">
              <input
                type="checkbox"
                [checked]="chosen().includes(url.uuid)"
                (change)="toggle(url.uuid)"
              />
              <span class="name">{{ url.name }}</span>
              <code>{{ url.id5 }}</code>
            </label>
          </li>
        } @empty {
          <li class="hint" i18n>This browser keeps no URL.</li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false" i18n>Cancel</button>
      <button mat-flat-button type="button" (click)="forget()" i18n>Forget</button>
    </mat-dialog-actions>
  `,
  styleUrl: './url-list-dialogs.scss',
})
export class ForgetUrlsDialog {
  private readonly known = inject(KnownUrls);
  private readonly dialog = inject<MatDialogRef<ForgetUrlsDialog, boolean>>(MatDialogRef);

  protected readonly urls = this.known.urls().map(({ uuid }) => ({
    uuid,
    name: this.known.nameOf(uuid),
    id5: uuid.slice(0, 5),
  }));
  protected readonly chosen = signal<readonly string[]>([]);

  protected toggle(uuid: string): void {
    this.chosen.update((chosen) =>
      chosen.includes(uuid) ? chosen.filter((other) => other !== uuid) : [...chosen, uuid],
    );
  }

  protected forget(): void {
    this.known.forget(this.chosen());
    this.dialog.close(this.chosen().length > 0);
  }
}

/** Abre "Rename this URL" para a URL dada. */
export async function renameUrl(injector: Injector, uuid: string): Promise<void> {
  const ref = injector.get(MatDialog).open<UrlNicknameDialog, string, boolean>(UrlNicknameDialog, {
    data: uuid,
    width: WIDTH,
    maxWidth: '100vw',
  });
  await firstValueFrom(ref.afterClosed());
}

/** Abre "Forget a URL". */
export async function forgetUrls(injector: Injector): Promise<void> {
  const ref = injector
    .get(MatDialog)
    .open<ForgetUrlsDialog, void, boolean>(ForgetUrlsDialog, { width: WIDTH, maxWidth: '100vw' });
  await firstValueFrom(ref.afterClosed());
}
