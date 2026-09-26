import {
  SignatureState,
  WebhookRequest,
  absentHeader,
  signatureState,
} from '../requests/webhook-request';
import { SIGNATURE_PROVIDER_LABELS, SignatureProvider, Token } from '../token/token';

/** O que a tabela de headers mostra do resultado da assinatura gravado na mensagem. */
export interface SignatureCheck {
  state: SignatureState;
  /** Headers da mensagem (nome como na tabela) que a verificação leu, com a frase de cada linha. */
  rows: ReadonlyMap<string, string>;
  /** Header esperado que não veio: vira a linha sintética "(not received)" no topo. */
  missing: { name: string; note: string } | null;
}

/** Headers que cada provedor lê; o genérico lê o que a URL configurou. */
const PROVIDER_HEADERS: Record<Exclude<SignatureProvider, 'generic'>, readonly string[]> = {
  stripe: ['stripe-signature'],
  github: ['x-hub-signature-256'],
  shopify: ['x-shopify-hmac-sha256'],
  slack: ['x-slack-signature', 'x-slack-request-timestamp'],
};

const ICONS: Record<SignatureState, string> = { valid: '✓', invalid: '✕', absent: '⊘' };

/** A tabela mostra o nome como o servidor grava: minúsculo, `_` virando `-`. */
function headerKey(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

/**
 * Liga o veredito gravado na chegada às linhas da tabela de headers. No genérico o header vem da
 * configuração atual da URL: se ela mudou depois da chegada (o header não está na mensagem), nenhuma
 * linha é realçada e fica só o selo. `null` quando a URL não verificava a mensagem.
 */
export function signatureCheck(request: WebhookRequest, token: Token): SignatureCheck | null {
  const signature = request.signature;
  if (!signature) {
    return null;
  }
  const state = signatureState(signature);
  const provider = signature.provider;
  const label = SIGNATURE_PROVIDER_LABELS[provider];
  const absent = absentHeader(signature);
  const missing = absent
    ? {
        name: headerKey(absent),
        note: `${ICONS.absent} Signature absent — the ${label} check expects the ${absent} header`,
      }
    : null;
  const config = token.signature?.provider === provider ? token.signature : null;
  // No genérico ausente, o único header lido é o que faltou: nenhuma linha da mensagem é dele.
  const generic = config?.header && !absent ? [headerKey(config.header)] : [];
  const names = provider === 'generic' ? generic : PROVIDER_HEADERS[provider];
  const verdict = `${ICONS[state]} ${verdictOf(state, signature.reason, formulaOf(provider, config?.algorithm))}`;
  const rows = new Map<string, string>();
  for (const name of names.filter((present) => Object.hasOwn(request.headers, present))) {
    rows.set(
      name,
      name === 'x-slack-request-timestamp'
        ? `${ICONS[state]} Timestamp signed with the body`
        : verdict,
    );
  }
  return { state, rows, missing };
}

/** O que a URL calculou para conferir, como na tabela de provedores do Edit URL. */
function formulaOf(provider: SignatureProvider, algorithm = 'sha256'): string {
  switch (provider) {
    case 'stripe':
      return 'HMAC-SHA256 of "{t}.{raw body}"';
    case 'slack':
      return 'HMAC-SHA256 of "v0:{timestamp}:{raw body}"';
    case 'generic':
      return `HMAC-${algorithm.toUpperCase()} of the raw body`;
    default:
      return 'HMAC-SHA256 of the raw body';
  }
}

/** Frase da linha; o motivo do servidor aparece como veio. */
function verdictOf(state: SignatureState, reason: string | null, formula: string): string {
  if (reason === null) {
    return `Signature valid — ${formula} matched`;
  }
  if (reason === 'signature mismatch') {
    return `Signature invalid — ${formula} did not match (signature mismatch)`;
  }
  if (reason.startsWith('timestamp outside tolerance')) {
    return `Signature invalid — ${formula} matched, but ${reason}`;
  }
  return `Signature ${state} — ${reason}`;
}
