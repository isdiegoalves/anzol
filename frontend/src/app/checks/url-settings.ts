import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { JsonSchema, Token, TokenSettings } from '../token/token';

/**
 * A configuração salva da URL no formato do `PUT /token/{id}`. O `PUT` volta ao padrão todo campo
 * ausente (menos `signature.secret` e `read_secret`), então cada cartão de Checks manda isto com
 * a sua parte trocada (CA-11): salvar o schema não pode apagar a assinatura nem a resposta.
 * O segredo da assinatura vai mascarado, como o servidor o devolve: o servidor reconhece a máscara
 * e mantém o salvo. `read_secret` não vai: ausente mantém o atual.
 */
export function savedSettings(token: Token): TokenSettings {
  return {
    default_status: String(token.default_status),
    default_content_type: token.default_content_type,
    timeout: String(token.timeout),
    default_content: token.default_content,
    retry_after: token.retry_after == null ? null : String(token.retry_after),
    auto_cleanup: token.auto_cleanup ?? null,
    signature: token.signature ?? null,
    schema: token.schema ?? null,
  };
}

/** Corpo do `PUT` de um cartão: a configuração salva com as mudanças dele por cima. */
export function withChanges(token: Token, changes: TokenSettings): TokenSettings {
  return { ...savedSettings(token), ...changes };
}

/** Ligar a limpeza automática, ou reduzir o limite, faz o servidor cortar as mais antigas. */
export function cutsRequests(before: Token, after: Token): boolean {
  const limit = after.auto_cleanup ?? null;
  const previous = before.auto_cleanup ?? null;
  return limit !== null && (previous === null || limit < previous);
}

/** Mensagens do 422 de um campo (`{"schema": [...]}`); vazio para qualquer outro erro. */
export function fieldErrors(error: unknown, ...fields: string[]): readonly string[] {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const body = (error.error ?? {}) as Record<string, unknown>;
    return fields.flatMap((field) => {
      const messages = body[field];
      return Array.isArray(messages) ? messages.map(String) : [];
    });
  }
  return [];
}

/** Erro do `PUT` como o app atual o dizia: os 422 juntos, ou o status HTTP. */
export function updateError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const messages = Object.values((error.error ?? {}) as Record<string, string[]>).flat();
    return $localize`Error updating token: ${messages.join(', ')}`;
  }
  const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
  return $localize`Error updating token (${status})`;
}

/** O schema salvo, ou o sugerido, indentado para editar à mão. */
export function schemaText(schema: JsonSchema | null | undefined): string {
  return schema ? JSON.stringify(schema, null, 2) : '';
}

/** Vazio desliga a validação; senão, precisa ser um objeto JSON (o servidor compila o resto). */
export function schemaValidator(control: AbstractControl<string>): ValidationErrors | null {
  const text = control.value.trim();
  if (text === '') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { json: $localize`Invalid JSON: ${(error as Error).message}` };
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? null
    : { json: $localize`The schema must be a JSON object.` };
}

/** Valor do campo do schema para o `PUT`: vazio é `null` (desliga). */
export function schemaOf(text: string): JsonSchema | null {
  return text.trim() === '' ? null : (JSON.parse(text) as JsonSchema);
}

/** Campo pendente de um formulário: o controle, o nome no formulário e o rótulo na tela. */
export type PendingField = readonly [control: AbstractControl, name: string, label: string];

/**
 * "To save, fill in: Signature header, Secret; fix: Retry-After"; vazio quando nada falta. Os
 * obrigatórios vazios vão em "fill in", os preenchidos errado em "fix".
 */
export function pendingSummary(fields: readonly PendingField[]): string {
  const problems = fields.filter(([control]) => control.invalid);
  const missing = problems.filter(([control]) => control.hasError('required'));
  const invalid = problems.filter(([control]) => !control.hasError('required'));
  const parts = [
    ...(missing.length > 0
      ? [$localize`fill in: ${missing.map(([, , label]) => label).join(', ')}`]
      : []),
    ...(invalid.length > 0
      ? [$localize`fix: ${invalid.map(([, , label]) => label).join(', ')}`]
      : []),
  ];
  return parts.length > 0 ? $localize`To save, ${parts.join('; ')}` : '';
}

/** Rótulo de cada campo do `PUT` na tela, para a frase de "changed elsewhere". */
const FIELD_LABELS: Record<keyof TokenSettings, string> = {
  default_status: $localize`default status code`,
  default_content_type: $localize`content type`,
  timeout: 'timeout',
  default_content: $localize`response body`,
  retry_after: 'Retry-After',
  auto_cleanup: $localize`auto cleanup`,
  signature: 'signature',
  schema: 'schema',
  read_secret: $localize`privacy`,
};

/**
 * Campos que o cartão manda (`changes`) e que mudaram no servidor (`fresh`) desde que o cartão leu a
 * URL (`base`). O segredo de leitura não volta na API: compara-se o `protected`.
 */
export function changedFields(
  base: Token,
  fresh: Token,
  changes: TokenSettings,
): (keyof TokenSettings)[] {
  const before = savedSettings(base);
  const now = savedSettings(fresh);
  return (Object.keys(changes) as (keyof TokenSettings)[]).filter((field) =>
    field === 'read_secret'
      ? (base.protected ?? false) !== (fresh.protected ?? false)
      : JSON.stringify(before[field] ?? null) !== JSON.stringify(now[field] ?? null),
  );
}

/** "The schema changed elsewhere since this page read it. Reload to see it before saving." */
export function changedElsewhereText(fields: readonly string[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field as keyof TokenSettings] ?? field);
  const list =
    labels.length > 1
      ? $localize`${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
      : labels[0];
  return $localize`The ${list} changed elsewhere since this page read it. Reload to see it before saving.`;
}

/** O aviso do cartão para o erro do `save`: "changed elsewhere" (com Reload) ou o erro do `PUT`. */
export function saveErrorNotice(error: unknown): { text: string; error: true; reload: boolean } {
  if (error instanceof Error && 'fields' in error && Array.isArray(error.fields)) {
    return { text: changedElsewhereText(error.fields as string[]), error: true, reload: true };
  }
  if (error instanceof Error && error.name === 'UnlockFailed') {
    const status =
      'status' in error && error.status !== null ? String(error.status) : $localize`unknown`;
    return {
      text: $localize`The URL was saved, but this page could not unlock it with the new secret (${status}:status:). Unlock it with the new secret to keep working.`,
      error: true,
      reload: false,
    };
  }
  return { text: updateError(error), error: true, reload: false };
}

/** Rótulos dos campos pendentes, na ordem da tela (o alerta depois de tentar salvar). */
export function pendingLabels(fields: readonly PendingField[]): string[] {
  return fields.filter(([control]) => control.invalid).map(([, , label]) => label);
}

/** "2 fields need attention: Signature header, Secret" (CHECKS-13, protótipo C). */
export function attentionText(labels: readonly string[]): string {
  const list = labels.join(', ');
  return labels.length === 1
    ? $localize`1 field needs attention: ${list}:fields:`
    : $localize`${labels.length}:count: fields need attention: ${list}:fields:`;
}
