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

/** Os cartões que gravam: o Health só lê. */
export type SectionId = 'signature' | 'schema' | 'response' | 'privacy';

/** Uma alteração pendente, como a barra e o diálogo de saída a mostram. */
export interface ChangeLine {
  label: string;
  before: string;
  after: string;
  /** Segredo: a tela diz só "set (not shown)". */
  secret?: boolean;
}

/** O que um cartão de Verificações entrega à barra de salvar. */
export interface ChecksSection {
  readonly id: SectionId;
  /** O formulário do cartão: toda mudança de valor ou de validade refaz o resumo. */
  readonly form: AbstractControl;
  /** As alterações contra o salvo; vazio quando o cartão está como o servidor o tem. */
  changes(): ChangeLine[];
  /** Rótulos dos campos inválidos, na ordem da tela. */
  invalid(): string[];
  /** A parte do cartão no `PUT /token/{id}`. */
  settings(): TokenSettings;
  /** O CORS pedido, quando o cartão o mudou; `null` sem mudança. */
  cors?(): boolean | null;
  /** Mostra os erros do cartão; com `focus`, leva o foco ao primeiro campo inválido. */
  showPending(focus: boolean): void;
  /** O cartão volta à URL dada (depois de salvar, de descartar e do Reload). */
  load(token: Token): void;
  /** Marca nos campos o que o servidor recusou (422) e devolve os rótulos deles. */
  refused?(error: unknown): string[];
  /** O rascunho do cartão para a memória da aba, **sem segredos**. */
  sketch(): Record<string, unknown>;
  restore(sketch: Record<string, unknown>): void;
}

/** O que impediu o salvar, com o que a barra oferece. */
export interface SaveFailure {
  /** `network`: "Try again"; `elsewhere`: "Reload" e "Save anyway"; `server`: só a frase. */
  kind: 'network' | 'elsewhere' | 'server';
  text: string;
}

/** Rascunho de Verificações guardado na aba. */
export interface StoredDraft {
  savedAt: number;
  sections: Partial<Record<SectionId, Record<string, unknown>>>;
}

/** Chave do rascunho na `sessionStorage` (guia da combinação, §4.1). */
export const CHECKS_DRAFT_KEY = (tokenId: string) => `anzol.checksDraft.${tokenId}`;

/** A pessoa parou de mexer: o resumo vai para a região viva (§4.3, "nada por tecla"). */
const SUMMARY_DELAY_MS = 1000;
const DRAFT_DELAY_MS = 300;

/**
 * O rascunho da página de Verificações (B3, UX-03): junta as alterações dos quatro cartões numa
 * barra só. "Save changes" é tudo ou nada: com campo inválido em qualquer cartão, nada é gravado;
 * sem, sai **um** `PUT /token/{id}` com a configuração inteira (o `ChecksStore` relê a URL e põe as
 * mudanças por cima) e, depois dele, o CORS. Guarda o rascunho na aba, sem segredos.
 */
@Injectable({ providedIn: 'root' })
export class ChecksDraft {
  private readonly checks = inject(ChecksStore);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly urlLock = inject(UrlLock);

  private readonly sections = signal<readonly ChecksSection[]>([]);
  /** Os formulários não são signals: cada mudança deles conta aqui. */
  private readonly tick = signal(0);
  /** A URL como a página a leu: o save confere se ela mudou lá fora. */
  readonly base = signal<Token | null>(null);
  readonly saving = signal(false);
  private readonly attempted = signal(false);
  /** Campos que o servidor recusou no último save (422). */
  private readonly refusedLabels = signal<readonly string[]>([]);
  readonly failure = signal<SaveFailure | null>(null);
  /** Rascunho de outra visita nesta aba, à espera de "Restore draft" ou "Discard draft". */
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
  /** Cartões com campo inválido depois de tentar salvar (o celular os abre). */
  readonly invalidSections = computed(() => {
    this.tick();
    return this.attempted()
      ? this.sections()
          .filter((section) => section.invalid().length > 0)
          .map(({ id }) => id)
      : [];
  });

  /** "2 unsaved changes: Tolerance, Default status code", na hora (o texto à vista). */
  readonly preview = computed(() => summaryOf(this.changes()));
  /** O mesmo resumo, 1 s depois da última mudança: o que a região viva diz. */
  readonly summary = signal('');
  /** "2 fields need attention: …" depois de tentar salvar (CHECKS-13), ou o que o servidor recusou. */
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
  /** Esta visita já escreveu rascunho: só então ela o apaga ao voltar ao salvo. */
  private wrote = false;

  /** A página saiu no meio da espera: o rascunho pendente sai agora. */
  flush(): void {
    clearTimeout(this.summaryTimer);
    if (this.draftTimer !== undefined) {
      clearTimeout(this.draftTimer);
      this.writeDraft();
    }
  }

  /** A página leu a URL do servidor: os cartões montam sobre ela. */
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

  /** Um cartão entra na barra; sai sozinho ao ser destruído. Chamado no construtor do cartão. */
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

  /**
   * "Save changes". Devolve se a página pode ser deixada: salvou (ou nada havia a salvar). `force`
   * é o "Save anyway" depois de "changed elsewhere".
   */
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

  /** "Discard": tudo volta ao salvo. `silent` é o descarte pelo diálogo de saída. */
  discard(silent = false): void {
    const base = this.base();
    if (base) {
      this.loaded(base);
    }
    if (!silent) {
      void this.announcer.announce($localize`Changes discarded.`);
    }
  }

  /** "Reload" depois de "changed elsewhere": a URL como está no servidor, sem as alterações. */
  async reload(): Promise<void> {
    const base = this.base();
    if (base) {
      this.loaded(await this.checks.reload(base.uuid));
    }
  }

  /** "Restore draft": o rascunho da aba volta como alteração não salva. */
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

  /** Um formulário mudou: refaz o resumo e agenda a região viva e o rascunho. */
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

  /** Os cartões voltam à URL dada, sem nada pendente. */
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
      // A URL foi salva com o segredo novo: a tela de destrancar diz isso e pede o segredo.
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

  /** Todos os erros à vista; o foco vai ao primeiro campo do primeiro cartão com erro. */
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

/** "1 unsaved change: Secret" / "3 unsaved changes: Signature provider, Secret, Default status code". */
export function summaryOf(changes: readonly ChangeLine[]): string {
  if (changes.length === 0) {
    return '';
  }
  const fields = changes.map(({ label }) => label).join(', ');
  return changes.length === 1
    ? $localize`1 unsaved change: ${fields}:fields:`
    : $localize`${changes.length}:count: unsaved changes: ${fields}:fields:`;
}

/** "Tolerance: 300 s → 600 s"; segredo nunca aparece: "Secret: set (not shown)". */
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
