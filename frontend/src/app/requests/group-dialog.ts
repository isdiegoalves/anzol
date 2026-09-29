import { Component, Injector, computed, inject, signal } from '@angular/core';
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
import { NO_GROUPING } from './event-grouping';
import { EventKey, KeyCandidate, eventCount, isBodyKey, isEventKey } from './event-key';
import { WebhookRequest } from './webhook-request';

export interface GroupDialogData {
  requests: readonly WebhookRequest[];
  candidates: readonly KeyCandidate[];
  current: EventKey | null;
}

export type GroupChoice = EventKey | typeof NO_GROUPING;

/** Chave que não é cabeçalho nem JSONPath: um `alert`, e o diálogo fica aberto. */
@Component({
  selector: 'app-group-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  template: `
    <h2 mat-dialog-title i18n>Group by event</h2>
    <form (submit)="group($event)">
      <mat-dialog-content>
        <p class="lead" i18n>Requests with the same value in this field are shown together.</p>
        <div class="options" role="radiogroup" aria-label="Event key" i18n-aria-label>
          @for (candidate of data.candidates; track candidate.key) {
            <label class="option">
              <input
                type="radio"
                name="event-key"
                [checked]="picked() === candidate.key"
                (change)="picked.set(candidate.key)"
              />
              <span>{{ candidateLabel(candidate) }}</span>
            </label>
          }
          <label class="option">
            <input
              type="radio"
              name="event-key"
              [checked]="picked() === other"
              (change)="picked.set(other)"
            />
            <span i18n>Another header or body path</span>
          </label>
          <input
            #field
            class="field"
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-label="Header name or JSONPath"
            i18n-aria-label
            placeholder="x-event-id or $.id"
            i18n-placeholder
            [value]="typed()"
            (focus)="picked.set(other)"
            (input)="typed.set(field.value); picked.set(other); invalid.set(false)"
          />
          <label class="option">
            <input
              type="radio"
              name="event-key"
              [checked]="picked() === off"
              (change)="picked.set(off)"
            />
            <span i18n>Do not group</span>
          </label>
        </div>
        <div role="alert" class="error">
          @if (invalid()) {
            <span i18n>This is not a header name or a JSONPath like $.id.</span>
          }
        </div>
        <p class="preview">{{ preview() }}</p>
        <p class="hint" i18n>Kept only in this browser.</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" [mat-dialog-close]="undefined" i18n>Cancel</button>
        <button mat-flat-button type="submit" i18n="action|Groups the list by the chosen key">
          Group
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .lead,
    .preview,
    .hint {
      margin: 0 0 12px;
    }

    .hint,
    .preview {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }

    .options {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }

    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      cursor: pointer;

      span {
        min-width: 0;
        overflow-wrap: anywhere;
      }
    }

    input[type='radio'] {
      width: 20px;
      height: 20px;
      margin: 0;
      accent-color: var(--mat-sys-primary);
    }

    .field {
      box-sizing: border-box;
      max-width: calc(100% - 28px);
      height: 40px;
      margin-left: 28px;
      padding: 0 12px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: var(--mat-sys-corner-extra-small);
      background: transparent;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-large);
      font-family: var(--app-code-family);
    }

    .error {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class GroupDialog {
  protected readonly data = inject<GroupDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject<MatDialogRef<GroupDialog, GroupChoice>>(MatDialogRef);

  protected readonly other = '\u0000other';
  protected readonly off = NO_GROUPING;
  private readonly known = this.data.candidates.some((c) => c.key === this.data.current);
  protected readonly picked = signal<string>(
    this.data.current === null
      ? (this.data.candidates[0]?.key ?? this.other)
      : this.known
        ? this.data.current
        : this.other,
  );
  protected readonly typed = signal(
    this.data.current !== null && !this.known ? this.data.current : '',
  );
  protected readonly invalid = signal(false);

  private readonly choice = computed((): GroupChoice | null => {
    const picked = this.picked();
    if (picked !== this.other) {
      return picked;
    }
    const typed = this.typed().trim();
    return isEventKey(typed) ? typed : null;
  });

  protected readonly preview = computed(() => {
    const choice = this.choice();
    if (choice === null || choice === NO_GROUPING) {
      return '';
    }
    const events = eventCount(this.data.requests, choice);
    const loaded = this.data.requests.length;
    if (events === 0) {
      return $localize`No loaded request has this field.`;
    }
    return events === 1
      ? $localize`The ${loaded}:loaded: loaded requests become 1 event.`
      : $localize`The ${loaded}:loaded: loaded requests become ${events}:events: events.`;
  });

  protected candidateLabel({ key, values, example }: KeyCandidate): string {
    const loaded = this.data.requests.length;
    return isBodyKey(key)
      ? $localize`Body ${key}:key: — e.g. ${example}:example: · ${values}:values: values in ${loaded}:loaded:`
      : $localize`Header ${key}:key: — e.g. ${example}:example: · ${values}:values: values in ${loaded}:loaded:`;
  }

  protected group(event: Event): void {
    event.preventDefault();
    const choice = this.choice();
    if (choice === null) {
      this.invalid.set(true);
      return;
    }
    this.dialog.close(choice);
  }
}

/** `undefined` é "Cancel". */
export async function openGroupDialog(
  injector: Injector,
  data: GroupDialogData,
): Promise<GroupChoice | undefined> {
  const ref = injector.get(MatDialog).open<GroupDialog, GroupDialogData, GroupChoice>(GroupDialog, {
    data,
    width: 'min(480px, calc(100vw - 32px))',
  });
  return firstValueFrom(ref.afterClosed());
}
