import { WebhookRequest } from '../requests/webhook-request';
import { Token } from '../token/token';

export const COPY_FORMATS = ['curl', 'HAR'] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

export function convertRequest(request: WebhookRequest, format: CopyFormat, token: Token): string {
  return format === 'curl' ? toCurl(request) : toHar(request, token);
}

/**
 * Mesmo comando do app atual, mas seguro para colar no terminal: quem envia o webhook controla
 * método, URL, headers e corpo, e o app atual os punha entre aspas simples sem escape (um `'`
 * fechava a aspa e injetava comando). Método, URL e headers usam aspas simples POSIX; o corpo
 * segue em `$'...'` com `\` e `'` escapados.
 */
export function toCurl(request: WebhookRequest): string {
  let curl = `curl -X ${shellQuote(request.method)} ${shellQuote(request.url)}`;
  for (const [name, values] of Object.entries(request.headers)) {
    curl += ` -H ${shellQuote(`${name}: ${values.join(',')}`)}`;
  }
  if (request.content) {
    curl += ` -d $'${request.content.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return curl;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * HAR 1.2 com a mensagem e a resposta configurada na URL. O `mimeType` usa o content-type da
 * mensagem (ou `application/json` sem ele): o app atual tinha a condição invertida e lançava erro
 * em mensagem sem content-type.
 */
export function toHar(request: WebhookRequest, token: Token): string {
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'Anzol', version: '1.0' },
      entries: [
        {
          startedDateTime: request.created_at,
          request: {
            method: request.method,
            url: request.url,
            headers: Object.entries(request.headers).map(([name, values]) => ({
              name,
              value: values[0],
            })),
            bodySize: request.content ? request.content.length : 0,
            postData: {
              mimeType: request.headers['content-type']?.[0] || 'application/json',
              text: request.content ?? '',
            },
          },
          response: {
            status: token.default_status,
            httpVersion: 'HTTP/1.1',
            headers: [{ name: 'Content-Type', value: token.default_content_type }],
            content: {
              size: token.default_content.length,
              text: token.default_content,
              mimeType: token.default_content_type,
            },
          },
        },
      ],
    },
  });
}
