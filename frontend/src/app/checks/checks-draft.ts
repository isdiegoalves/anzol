import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { merge } from 'rxjs';
import { Token, TokenSettings } from '../token/token';
import { UrlLock } from '../token/url-lock';
import { ChangedElsewhere, ChecksStore, UnlockFailed } from './checks-store';
import { attentionText, updateError } from './url-settings';

export type SectionId = 'signature' | 'schema' | 'e2ee' | 'response' | 'privacy';

export interface ChangeLine {
  label: string;
  before: string;
  after: string;
  secret?: boolean;
}

export interface ChecksSection {
  readonly id: SectionId;
  readonly form: AbstractControl;
  changes(): ChangeLine[];
  /** Rótulos dos campos inválidos, na ordem da tela. */
  invalid(): string[];
  settings(): TokenSettings;
  /** `null` quando o cartão não mudou o CORS. */
  cors?(): boolean | null;
  showPending(focus: boolean): void;
  load(token: Token): void;
  /** Marca nos campos o que o servidor recusou (422) e devolve os rótulos deles. */
  refused?(error: unknown): string[];
  /** O rascunho do cartão para a aba, sem segredos. */
  sketch(): Record<string, unknown>;
  restore(sketch: Record<string, unknown>): void;
}

export interface SaveFailure {
  kind: 'network' | 'elsewhere' | 'server';
  text: string;
}

export interface StoredDraft {
  savedAt: number;
  sections: Partial<Record<SectionId, Record<string, unknown>>>;
}

export const CHECKS_DRAFT_KEY = (tokenId: string) => `anzol.checksDraft.${tokenId}`;

const SUMMARY_DELAY_MS = 1000;
const DRAFT_DELAY_MS = 300;

/**
 * Junta as alterações dos cartões de Verificações. "Save changes" é tudo ou nada: com campo
 * inválido em qualquer cartão nada é gravado; sem, sai um só `PUT /token/{id}` e, depois, o CORS.
 */
@Injectable({ providedIn: 'root' })
export class ChecksDraft {
  private readonly checks = inject(ChecksStore);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly urlLock = inject(UrlLock);

  private readonly sections = signal<readonly ChecksSection[]>([]);
  /** Os formulários não são signals: os `computed` leem este contador para se refazer. */
  private readonly tick = signal(0);
  readonly base = signal<Token | null>(null);
  readonly saving = signal(false);
  private readonly attempted = signal(false);
  private readonly refusedLabels = signal<readonly string[]>([]);
  readonly failure = signal<SaveFailure | null>(null);
  readonly offer = signal<StoredDraft | null>(null);

  readonly changes = computed(() => {
    this.tick();
    return this.sections().flatMap((section) => section.changes());
  });
  readonly dirty = computed(() => this.changes().length > 0);
  readonly dirtySections = computed(() => {
    this.tick();
    return this.sections()
      .filter((section) => section.changes().length > 0)
      .map(({ id }) => id);
  });
  private readonly invalid = computed(() => {
    this.tick();
    return this.sections().flatMap((section) => section.invalid());
  });
  readonly invalidSections = computed(() => {
    this.tick();
    return this.attempted()
      ? this.sections()
          .filter((section) => section.invalid().length > 0)
          .map(({ id }) => id)
      : [];
  });

  readonly preview = computed(() => summaryOf(this.changes()));
  /** O `preview` 1 s depois da última mudança: a região viva não fala a cada tecla. */
  readonly summary = signal('');
  readonly alert = computed(() => {
    const invalid = this.invalid();
    if (this.attempted() && invalid.length > 0) {
      return attentionText(invalid);
    }
    const refused = this.refusedLabels();
    return refused.length > 0 ? attentionText(refused) : '';
  });

  private summaryTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  /** Só esta visita apaga o rascunho que ela mesma escreveu. */
  private wrote = false;

  flush(): void {
    clearTimeout(this.summaryTimer);
    if (this.draftTimer !== undefined) {
      clearTimeout(this.draftTimer);
      this.writeDraft();
    }
  }

  start(token: Token): void {
    this.flush();
    this.base.set(token);
    this.sections.set([]);
    this.clearAttempt();
    this.failure.set(null);
    this.summary.set('');
    this.wrote = false;
    this.offer.set(readDraft(token.uuid));
  }

  /** Chame no construtor do cartão: usa `inject(DestroyRef)`. */
  register(section: ChecksSection): void {
    const destroyed = inject(DestroyRef);
    this.sections.update((list) => [...list, section]);
    merge(section.form.valueChanges, section.form.statusChanges)
      .pipe(takeUntilDestroyed(destroyed))
      .subscribe(() => this.touched());
    destroyed.onDestroy(() =>
      this.sections.update((list) => list.filter((other) => other !== section)),
    );
  }

  /** Devolve se a página pode ser deixada. `force` é o "Save anyway" de "changed elsewhere". */
  async save(force = false): Promise<boolean> {
    if (this.saving()) {
      return false;
    }
    this.failure.set(null);
    this.refusedLabels.set([]);
    if (this.invalid().length > 0) {
      this.attempted.set(true);
      this.showPending(this.sections().filter((section) => section.invalid().length > 0));
      return false;
    }
    const base = this.base();
    const dirty = this.sections().filter((section) => section.changes().length > 0);
    if (!base || dirty.length === 0) {
      return true;
    }
    const count = this.changes().length;
    const changes = Object.assign(
      {},
      ...dirty.map((section) => section.settings()),
    ) as TokenSettings;
    const cors = dirty.map((section) => section.cors?.() ?? null).find((v) => v !== null) ?? null;
    this.saving.set(true);
    try {
      this.loaded(await this.checks.save(changes, base, { cors, force }));
      void this.announcer.announce(
        count === 1 ? $localize`Saved. 1 change.` : $localize`Saved. ${count}:count: changes.`,
      );
      return true;
    } catch (error) {
      return this.failed(error, base, dirty);
    } finally {
      this.saving.set(false);
    }
  }

  discard(silent = false): void {
    const base = this.base();
    if (base) {
      this.loaded(base);
    }
    if (!silent) {
      void this.announcer.announce($localize`Changes discarded.`);
    }
  }

  async reload(): Promise<void> {
    const base = this.base();
    if (base) {
      this.loaded(await this.checks.reload(base.uuid));
    }
  }

  restoreDraft(): void {
    const draft = this.offer();
    if (!draft) {
      return;
    }
    this.offer.set(null);
    for (const section of this.sections()) {
      const sketch = draft.sections[section.id];
      if (sketch) {
        section.restore(sketch);
      }
    }
    this.touched();
    void this.announcer.announce($localize`Draft restored.`);
  }

  discardDraft(): void {
    this.offer.set(null);
    this.clearDraft();
  }

  private touched(): void {
    this.tick.update((n) => n + 1);
    if (this.attempted() && this.invalid().length === 0) {
      this.attempted.set(false);
    }
    if (this.refusedLabels().length > 0 && this.invalid().length === 0) {
      this.refusedLabels.set([]);
    }
    const dirty = this.dirty();
    clearTimeout(this.summaryTimer);
    if (dirty) {
      this.summaryTimer = setTimeout(() => this.summary.set(this.preview()), SUMMARY_DELAY_MS);
    } else {
      this.summary.set('');
    }
    // O rascunho de outra visita espera a escolha: montar os cartões não o apaga.
    if (dirty) {
      this.offer.set(null);
    }
    if (dirty || this.wrote) {
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => this.writeDraft(), DRAFT_DELAY_MS);
    }
  }

  private loaded(token: Token): void {
    this.base.set(token);
    for (const section of this.sections()) {
      section.load(token);
    }
    this.clearAttempt();
    this.failure.set(null);
    this.tick.update((n) => n + 1);
    clearTimeout(this.summaryTimer);
    this.summary.set('');
    this.clearDraft();
  }

  private failed(error: unknown, base: Token, dirty: readonly ChecksSection[]): boolean {
    if (error instanceof UnlockFailed) {
      // Salvou, mas o segredo novo trancou a URL: a tela de destrancar pede o segredo.
      this.clearDraft();
      this.urlLock.lock(base.uuid, $localize`Saved. Type the new secret to open this URL.`);
      return true;
    }
    if (error instanceof ChangedElsewhere) {
      this.failure.set({
        kind: 'elsewhere',
        text: $localize`This URL was changed elsewhere since you opened this page.`,
      });
      return false;
    }
    if (error instanceof HttpErrorResponse && error.status === 0) {
      this.failure.set({
        kind: 'network',
        text: $localize`Could not save. The server did not answer. Your changes are still here.`,
      });
      return false;
    }
    const refused = dirty.map((section) => ({ section, labels: section.refused?.(error) ?? [] }));
    const labels = refused.flatMap((entry) => entry.labels);
    if (labels.length > 0) {
      this.refusedLabels.set(labels);
      this.showPending(refused.filter((entry) => entry.labels.length > 0).map((e) => e.section));
    } else {
      this.failure.set({ kind: 'server', text: updateError(error) });
    }
    this.tick.update((n) => n + 1);
    return false;
  }

  private showPending(sections: readonly ChecksSection[]): void {
    sections.forEach((section, index) => section.showPending(index === 0));
  }

  private clearAttempt(): void {
    this.attempted.set(false);
    this.refusedLabels.set([]);
  }

  private writeDraft(): void {
    this.draftTimer = undefined;
    const tokenId = this.base()?.uuid;
    if (!tokenId) {
      return;
    }
    if (!this.dirty()) {
      this.clearDraft();
      return;
    }
    const sections = Object.fromEntries(
      this.sections()
        .filter((section) => section.changes().length > 0)
        .map((section) => [section.id, section.sketch()]),
    );
    try {
      const draft: StoredDraft = { savedAt: Date.now(), sections };
      sessionStorage.setItem(CHECKS_DRAFT_KEY(tokenId), JSON.stringify(draft));
      this.wrote = true;
    } catch {
      // Sem espaço ou sem storage: fica sem rascunho.
    }
  }

  private clearDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    this.wrote = false;
    const tokenId = this.base()?.uuid;
    try {
      if (tokenId) {
        sessionStorage.removeItem(CHECKS_DRAFT_KEY(tokenId));
      }
    } catch {
      // Nada a limpar.
    }
  }
}

export function summaryOf(changes: readonly ChangeLine[]): string {
  if (changes.length === 0) {
    return '';
  }
  const fields = changes.map(({ label }) => label).join(', ');
  return changes.length === 1
    ? $localize`1 unsaved change: ${fields}:fields:`
    : $localize`${changes.length}:count: unsaved changes: ${fields}:fields:`;
}

export function changeText(change: ChangeLine): string {
  return change.secret
    ? $localize`${change.label}:field:: set (not shown)`
    : $localize`${change.label}:field:: ${change.before}:old: → ${change.after}:new:`;
}

function readDraft(tokenId: string): StoredDraft | null {
  try {
    const text = sessionStorage.getItem(CHECKS_DRAFT_KEY(tokenId));
    const draft = text ? (JSON.parse(text) as Partial<StoredDraft>) : null;
    return draft && typeof draft.savedAt === 'number' && typeof draft.sections === 'object'
      ? (draft as StoredDraft)
      : null;
  } catch {
    return null;
  }
}
