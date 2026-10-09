import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { validationPhrase } from '../pipeline/server-phrases';
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
    e2ee: token.e2ee ?? null,
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

/**
 * Mensagens do 422 de um campo (`{"schema": [...]}`), na língua da tela quando a frase é conhecida;
 * vazio para qualquer outro erro.
 */
export function fieldErrors(error: unknown, ...fields: string[]): readonly string[] {
  return serverMessages(error, ...fields).map((message) => validationPhrase(message).text);
}

/** Mensagens do 422 de um campo como o servidor as mandou; vazio para qualquer outro erro. */
export function serverMessages(error: unknown, ...fields: string[]): readonly string[] {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const body = (error.error ?? {}) as Record<string, unknown>;
    return fields.flatMap((field) => {
      const messages = body[field];
      return Array.isArray(messages) ? messages.map(String) : [];
    });
  }
  return [];
}

/** As chaves do 422 (`e2ee.bindings.app.path`, `e2ee.trusted_signers.0`…); vazio para outro erro. */
export function errorKeys(error: unknown): string[] {
  return error instanceof HttpErrorResponse && error.status === 422
    ? Object.keys((error.error ?? {}) as Record<string, unknown>)
    : [];
}

/** A recusa (422 em `read_secret`) de remover o segredo enquanto há requisição decifrada gravada. */
export function decryptedRefusal(): string {
  return $localize`The server refused: this URL has decrypted requests. Delete them before removing the secret, or keep the secret.`;
}

/** A recusa (422 em `e2ee`) de remover o segredo com a decifra ligada. */
export function decryptionOnRefusal(): string {
  return $localize`The server refused: decryption is on. Turn it off and delete any decrypted requests before removing the secret, or keep the secret.`;
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

/**
 * Campos que mudaram no servidor (`fresh`) desde que a página leu a URL (`base`). O segredo de
 * leitura não volta na API: compara-se o `protected`.
 */
export function changedElsewhere(base: Token, fresh: Token): string[] {
  const before = savedSettings(base);
  const now = savedSettings(fresh);
  const fields = (Object.keys(now) as (keyof TokenSettings)[]).filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(now[field] ?? null),
  );
  return [
    ...fields,
    ...((base.protected ?? false) !== (fresh.protected ?? false) ? ['read_secret'] : []),
    ...((base.cors ?? false) !== (fresh.cors ?? false) ? ['cors'] : []),
  ];
}

export function changeOf(
  label: string,
  before: string,
  after: string,
): { label: string; before: string; after: string }[] {
  const shown = (value: string) => (value === '' ? $localize`empty` : value);
  return before === after ? [] : [{ label, before: shown(before), after: shown(after) }];
}

export function secretChange(
  label: string,
  typed: string,
): { label: string; before: string; after: string; secret: true }[] {
  return typed === '' ? [] : [{ label, before: '', after: '', secret: true }];
}

export function onOff(value: boolean): string {
  return value ? $localize`:switch state:on` : $localize`:switch state:off`;
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
