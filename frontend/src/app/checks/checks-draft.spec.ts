import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Token, TokenSettings } from '../token/token';
import { UrlLock } from '../token/url-lock';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { CHECKS_DRAFT_KEY, ChangeLine, ChecksDraft, ChecksSection } from './checks-draft';
import { ChangedElsewhere, ChecksStore, UnlockFailed } from './checks-store';

function fakeSection(id: ChecksSection['id'], label: string, saved = '200') {
  const form = new FormControl(saved, { nonNullable: true, validators: Validators.required });
  let base = saved;
  const calls = { pending: [] as boolean[], loaded: [] as Token[], restored: [] as unknown[] };
  const section: ChecksSection = {
    id,
    form,
    changes: (): ChangeLine[] =>
      form.value === base ? [] : [{ label, before: base, after: form.value }],
    invalid: () => (form.invalid ? [label] : []),
    settings: (): TokenSettings => ({ default_status: form.value }),
    showPending: (focus) => calls.pending.push(focus),
    load: (loaded) => {
      calls.loaded.push(loaded);
      base = String(loaded.default_status);
      form.reset(base);
    },
    sketch: () => ({ value: form.value }),
    restore: (sketch) => {
      calls.restored.push(sketch);
      form.setValue(String((sketch as { value: string }).value));
    },
  };
  return { section, form, calls };
}

describe('Dado o rascunho de Verificações (uma barra de salvar)', () => {
  const SALVA = token({
    default_status: 200,
    signature: { provider: 'github', secret: '••••1234' },
  });
  let save: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  let announce: ReturnType<typeof vi.fn>;
  let draft: ChecksDraft;

  beforeEach(() => {
    vi.useFakeTimers();
    save = vi.fn().mockResolvedValue(token({ default_status: 429 }));
    reload = vi.fn().mockResolvedValue(token({ default_status: 503 }));
    announce = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        ChecksDraft,
        { provide: ChecksStore, useValue: { save, reload } },
        { provide: LiveAnnouncer, useValue: { announce } },
      ],
    });
    draft = TestBed.inject(ChecksDraft);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  const start = (...sections: ChecksSection[]) => {
    draft.start(SALVA);
    TestBed.runInInjectionContext(() => sections.forEach((section) => draft.register(section)));
  };

  it('deve contar as alterações de todos os cartões e dizer o resumo 1 s depois da última', () => {
    const resposta = fakeSection('response', 'Default status code');
    const schema = fakeSection('schema', 'JSON Schema', '');
    start(resposta.section, schema.section);
    expect(draft.dirty()).toBe(false);
    expect(draft.summary()).toBe('');

    resposta.form.setValue('429');
    expect(draft.dirty()).toBe(true);
    expect(draft.preview()).toBe('1 unsaved change: Default status code');
    expect(draft.summary()).toBe('');
    vi.advanceTimersByTime(600);
    schema.form.setValue('{}');
    vi.advanceTimersByTime(999);
    expect(draft.summary()).toBe('');
    vi.advanceTimersByTime(1);

    expect(draft.summary()).toBe('2 unsaved changes: Default status code, JSON Schema');
    expect(draft.dirtySections()).toEqual(['response', 'schema']);
  });

  it('deve mandar tudo num save só, recarregar os cartões e anunciar uma vez', async () => {
    const resposta = fakeSection('response', 'Default status code');
    const outro = fakeSection('schema', 'JSON Schema', 'x');
    start(resposta.section, outro.section);
    resposta.form.setValue('429');

    await expect(draft.save()).resolves.toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ default_status: '429' }, SALVA, {
      cors: null,
      force: false,
    });
    expect(resposta.calls.loaded).toHaveLength(1);
    expect(outro.calls.loaded).toHaveLength(1);
    expect(draft.dirty()).toBe(false);
    expect(draft.base()?.default_status).toBe(429);
    expect(announce.mock.calls).toEqual([['Saved. 1 change.', ANNOUNCEMENT_MS]]);
  });

  it('não deve gravar nada e deve apontar o primeiro campo Quando qualquer cartão tem campo inválido', async () => {
    const primeiro = fakeSection('signature', 'Secret');
    const segundo = fakeSection('response', 'Default status code');
    const terceiro = fakeSection('privacy', 'Confirm secret');
    start(primeiro.section, segundo.section, terceiro.section);
    primeiro.form.setValue('ok');
    segundo.form.setValue('');
    terceiro.form.setValue('');

    await expect(draft.save()).resolves.toBe(false);

    expect(save).not.toHaveBeenCalled();
    expect(draft.alert()).toBe('2 fields need attention: Default status code, Confirm secret');
    expect(primeiro.calls.pending).toEqual([]);
    expect(segundo.calls.pending).toEqual([true]);
    expect(terceiro.calls.pending).toEqual([false]);

    segundo.form.setValue('200');
    terceiro.form.setValue('x');
    expect(draft.alert()).toBe('');
  });

  it('deve voltar tudo ao salvo e anunciar Quando "Discard"', () => {
    const resposta = fakeSection('response', 'Default status code');
    start(resposta.section);
    resposta.form.setValue('503');
    vi.advanceTimersByTime(1000);

    draft.discard();

    expect(resposta.form.value).toBe('200');
    expect(draft.dirty()).toBe(false);
    expect(draft.summary()).toBe('');
    expect(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID))).toBeNull();
    expect(announce.mock.calls).toEqual([['Changes discarded.', ANNOUNCEMENT_MS]]);
  });

  it('deve oferecer "Reload" e "Save anyway" Quando a URL mudou em outro lugar', async () => {
    const resposta = fakeSection('response', 'Default status code');
    start(resposta.section);
    resposta.form.setValue('429');
    save.mockRejectedValueOnce(new ChangedElsewhere(['default_status']));

    await expect(draft.save()).resolves.toBe(false);
    expect(draft.failure()).toEqual({
      kind: 'elsewhere',
      text: 'This URL was changed elsewhere since you opened this page.',
    });
    expect(draft.dirty()).toBe(true);

    await draft.save(true);
    expect(save).toHaveBeenLastCalledWith({ default_status: '429' }, SALVA, {
      cors: null,
      force: true,
    });
    expect(draft.failure()).toBeNull();

    resposta.form.setValue('500');
    save.mockRejectedValueOnce(new ChangedElsewhere(['default_status']));
    await draft.save();
    await draft.reload();
    expect(reload).toHaveBeenCalledWith(TOKEN_ID);
    expect(resposta.form.value).toBe('503');
    expect(draft.failure()).toBeNull();
    expect(draft.dirty()).toBe(false);
  });

  it('deve manter as alterações e oferecer "Try again" Quando o servidor não responde', async () => {
    const resposta = fakeSection('response', 'Default status code');
    start(resposta.section);
    resposta.form.setValue('429');
    save.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await expect(draft.save()).resolves.toBe(false);

    expect(draft.failure()).toEqual({
      kind: 'network',
      text: 'Could not save. The server did not answer. Your changes are still here.',
    });
    expect(resposta.form.value).toBe('429');
    expect(resposta.calls.loaded).toEqual([]);
  });

  it('deve dizer os campos que o servidor recusou (422), sem recarregar os cartões', async () => {
    const resposta = fakeSection('response', 'Default status code');
    resposta.section.refused = (error) =>
      error instanceof HttpErrorResponse && error.status === 422 ? ['Default status code'] : [];
    start(resposta.section);
    resposta.form.setValue('999');
    save.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 422, error: { default_status: ['x'] } }),
    );

    await expect(draft.save()).resolves.toBe(false);

    expect(draft.alert()).toBe('1 field needs attention: Default status code');
    expect(resposta.calls.pending).toEqual([true]);
    expect(resposta.calls.loaded).toEqual([]);
    expect(draft.dirty()).toBe(true);
  });

  it('deve trancar a URL com a frase do segredo novo Quando o PUT passa e o destrancar falha', async () => {
    const privacidade = fakeSection('privacy', 'Secret to view');
    start(privacidade.section);
    privacidade.form.setValue('segredo-novo');
    save.mockRejectedValueOnce(new UnlockFailed(429));

    await expect(draft.save()).resolves.toBe(true);

    const lock = TestBed.inject(UrlLock);
    expect(lock.tokenId()).toBe(TOKEN_ID);
    expect(lock.notice()).toBe('Saved. Type the new secret to open this URL.');
  });

  describe('Dado o rascunho na memória da aba', () => {
    it('deve guardar o rascunho sem segredos e limpar ao salvar', async () => {
      const resposta = fakeSection('response', 'Default status code');
      start(resposta.section);

      resposta.form.setValue('429');
      vi.advanceTimersByTime(300);

      const stored = JSON.parse(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID)) ?? '{}') as {
        savedAt: number;
        sections: Record<string, unknown>;
      };
      expect(stored.sections).toEqual({ response: { value: '429' } });
      expect(typeof stored.savedAt).toBe('number');

      await draft.save();
      expect(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID))).toBeNull();
    });

    it('deve oferecer o rascunho da aba ao abrir e restaurar como alteração não salva', () => {
      sessionStorage.setItem(
        CHECKS_DRAFT_KEY(TOKEN_ID),
        JSON.stringify({ savedAt: 1790512142000, sections: { response: { value: '503' } } }),
      );
      const resposta = fakeSection('response', 'Default status code');
      start(resposta.section);

      expect(draft.offer()?.savedAt).toBe(1790512142000);
      // Montar os cartões mexe nos formulários: o rascunho guardado não some por isso.
      resposta.form.setValue('200');
      vi.advanceTimersByTime(300);
      expect(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID))).not.toBeNull();

      draft.restoreDraft();

      expect(resposta.calls.restored).toEqual([{ value: '503' }]);
      expect(draft.offer()).toBeNull();
      expect(draft.dirty()).toBe(true);
      expect(announce).toHaveBeenCalledWith('Draft restored.', ANNOUNCEMENT_MS);
    });

    it('deve apagar o rascunho guardado Quando "Discard draft"', () => {
      sessionStorage.setItem(
        CHECKS_DRAFT_KEY(TOKEN_ID),
        JSON.stringify({ savedAt: 1, sections: { response: { value: '503' } } }),
      );
      start(fakeSection('response', 'Default status code').section);

      draft.discardDraft();

      expect(draft.offer()).toBeNull();
      expect(sessionStorage.getItem(CHECKS_DRAFT_KEY(TOKEN_ID))).toBeNull();
    });
  });
});
