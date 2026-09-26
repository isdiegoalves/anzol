import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { WebhookRequest } from '../requests/webhook-request';
import {
  BodyMatcher,
  RULE_DEFAULT_PRIORITY,
  RULE_DEFAULT_STATUS,
  Rule,
  ValueMatcher,
} from './rule';
import { RuleEditor, RuleEditorData } from './rule-editor';
import { RuleStore } from './rule-store';

/** Acima disto (em bytes UTF-8), o corpo que não é JSON fica sem condição. */
const BODY_EQUALS_MAX_BYTES = 10 * 1024;
const NAME_MAX_LENGTH = 100;

/**
 * Regra que casa a mensagem (Anexo C): método, caminho exato, cada parâmetro da query igual e o
 * corpo (JSON igual, ou texto igual até 10 KiB); sem headers. Responde 200 com corpo vazio.
 */
export function ruleFromRequest(request: WebhookRequest): Rule {
  const path = pathAfterToken(request.url, request.token_id);
  return {
    name: `${request.method} ${path}`.slice(0, NAME_MAX_LENGTH),
    enabled: true,
    priority: RULE_DEFAULT_PRIORITY,
    match: {
      method: [request.method],
      path: { equals: path },
      query: queryConditions(request.query),
      headers: {},
      body: bodyConditions(request.content ?? ''),
    },
    response: { status: RULE_DEFAULT_STATUS, headers: {}, body: '' },
  };
}

/**
 * O caminho que as condições enxergam (como o servidor o tira da `url` gravada): depois do
 * token, sem a query, com `%XX` decodificado (`+` fica) e `/` quando vazio.
 */
export function pathAfterToken(url: string, tokenId: string): string {
  const scheme = url.indexOf('://');
  const afterScheme = scheme < 0 ? url : url.slice(scheme + 3);
  const slash = afterScheme.indexOf('/');
  const raw = (slash < 0 ? '' : afterScheme.slice(slash)).split('?')[0];
  const afterToken = raw.startsWith(`/${tokenId}`) ? raw.slice(tokenId.length + 1) : raw;
  let path = afterToken;
  try {
    path = decodeURIComponent(afterToken);
  } catch {
    // Escape inválido: o servidor também deixa o caminho como chegou.
  }
  return path || '/';
}

/** Valor que não é texto (`a[]=1`, `o[k]=v`) é comparado como o JSON dele, como no servidor. */
function queryConditions(query: WebhookRequest['query']): Record<string, ValueMatcher> {
  return Object.fromEntries(
    Object.entries(query ?? {}).map(([name, value]) => [
      name,
      { equals: typeof value === 'string' ? value : JSON.stringify(value) },
    ]),
  );
}

function bodyConditions(content: string): BodyMatcher[] {
  try {
    const json: unknown = JSON.parse(content);
    // Texto JSON (`"x"`) vai como o texto do JSON: o servidor lê texto como o JSON que ele contém.
    return [{ equalToJson: typeof json === 'string' ? content : json }];
  } catch {
    return new TextEncoder().encode(content).length <= BODY_EQUALS_MAX_BYTES
      ? [{ equals: content }]
      : [];
  }
}

/**
 * "Create rule from this request": carregado sob demanda pelo detalhe da mensagem. Carrega as
 * regras da URL (o `PUT` substitui a lista inteira) e abre o editor com a regra pré-preenchida;
 * salvar a acrescenta no fim da lista.
 */
@Injectable({ providedIn: 'root' })
export class RuleFromRequest {
  private readonly store = inject(RuleStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  async open(request: WebhookRequest): Promise<void> {
    const tokenId = request.token_id;
    try {
      await this.store.load(tokenId);
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 'unknown';
      this.snackBar.open(`Could not load the rules (${status}).`);
      return;
    }
    this.dialog
      .open<RuleEditor, RuleEditorData, boolean>(RuleEditor, {
        data: { index: null, draft: ruleFromRequest(request), example: request },
        width: '960px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.snackBar
            .open('Rule saved', 'View rules')
            .onAction()
            .subscribe(() => void this.router.navigate(['/', tokenId, 'rules']));
        }
      });
  }
}
