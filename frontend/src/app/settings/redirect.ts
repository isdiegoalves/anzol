import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from './preferences';

export interface RedirectSettings {
  url: string;
  method: string | null;
  contentType: string | null;
  /** Lista separada por vírgula dos headers da mensagem que seguem junto. */
  headers: string | null;
}

export interface RedirectCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * Monta o reenvio pelo navegador como o app atual: o caminho depois do UUID e a query string da
 * mensagem vão para a URL de destino; o método vazio usa o da mensagem.
 */
export function buildRedirect(request: WebhookRequest, settings: RedirectSettings): RedirectCall {
  const source = new URL(request.url);
  const path = /\/[A-Za-z0-9-]+(\/.*)/.exec(source.pathname)?.[1] ?? '';
  const headers: Record<string, string> = { 'Content-Type': settings.contentType || 'text/plain' };
  for (const name of (settings.headers ?? '').split(',').filter((header) => header !== '')) {
    if (Object.hasOwn(request.headers, name)) {
      headers[name] = request.headers[name].join(',');
    }
  }
  return {
    method: settings.method || request.method,
    url: settings.url + path + source.search,
    headers,
    body: request.content,
  };
}

/** Reenvia uma mensagem para a URL configurada no diálogo "Redirection Settings" (via XHR). */
@Injectable({ providedIn: 'root' })
export class Redirector {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly preferences = inject(Preferences);

  async redirect(request: WebhookRequest): Promise<void> {
    const url = this.preferences.redirectUrl();
    if (!url) {
      return;
    }
    const call = buildRedirect(request, {
      url,
      method: this.preferences.redirectMethod(),
      contentType: this.preferences.redirectContentType(),
      headers: this.preferences.redirectHeaders(),
    });
    try {
      const response = await firstValueFrom(
        this.http.request(call.method, call.url, {
          body: call.body,
          headers: call.headers,
          observe: 'response',
          responseType: 'text',
        }),
      );
      this.snackBar.open(
        `Redirected request to ${call.url}. Status: ${response.statusText}`,
        undefined,
        { duration: 1000 },
      );
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.statusText : String(error);
      this.snackBar.open(`Error redirecting request to ${call.url}. Status: ${status}`, undefined, {
        duration: 5000,
      });
    }
  }
}
