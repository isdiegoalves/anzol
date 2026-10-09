import {
  CapturedRequest,
  SignatureState,
  absentHeader,
  signatureState,
} from '../requests/webhook-request';
import { signatureProviderLabel, SignatureProvider, Token } from '../token/token';

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
 * linha é realçada e fica só o selo. `null` quando a URL não verificava a mensagem. Sem a URL (link
 * compartilhado), o genérico também fica só com o selo.
 */
export function signatureCheck(
  request: CapturedRequest,
  token: Token | null,
): SignatureCheck | null {
  const signature = request.signature;
  if (!signature) {
    return null;
  }
  const state = signatureState(signature);
  const provider = signature.provider;
  const label = signatureProviderLabel(provider);
  const absent = absentHeader(signature);
  const missing = absent
    ? {
        name: headerKey(absent),
        note: `${ICONS.absent} ${$localize`Signature absent — the ${label}:provider: check expects the ${absent}:header: header`}`,
      }
    : null;
  const config = token?.signature?.provider === provider ? token.signature : null;
  // No genérico ausente, o único header lido é o que faltou: nenhuma linha da mensagem é dele.
  const generic = config?.header && !absent ? [headerKey(config.header)] : [];
  const names = provider === 'generic' ? generic : PROVIDER_HEADERS[provider];
  const verdict = `${ICONS[state]} ${verdictOf(state, signature.reason, formulaOf(provider, config?.algorithm))}`;
  const rows = new Map<string, string>();
  for (const name of names.filter((present) => Object.hasOwn(request.headers, present))) {
    rows.set(
      name,
      name === 'x-slack-request-timestamp'
        ? `${ICONS[state]} ${$localize`Timestamp signed with the body`}`
        : verdict,
    );
  }
  return { state, rows, missing };
}

/** O que a URL calculou para conferir, como na tabela de provedores do Edit URL. */
function formulaOf(provider: SignatureProvider, algorithm = 'sha256'): string {
  switch (provider) {
    case 'stripe':
      return $localize`HMAC-SHA256 of "{t}.{raw body}"`;
    case 'slack':
      return $localize`HMAC-SHA256 of "v0:{timestamp}:{raw body}"`;
    case 'generic':
      return $localize`HMAC-${algorithm.toUpperCase()}:algorithm: of the raw body`;
    default:
      return $localize`HMAC-SHA256 of the raw body`;
  }
}

/** Frase da linha, com o motivo do servidor na língua da tela e o original entre parênteses. */
function verdictOf(state: SignatureState, reason: string | null, formula: string): string {
  if (reason === null) {
    return $localize`Signature valid — ${formula}:formula: matched`;
  }
  if (reason === MISMATCH) {
    return $localize`Signature invalid — ${formula}:formula: did not match (signature mismatch): different secret on each side, or the body was altered on the way.`;
  }
  if (TIMESTAMP.test(reason)) {
    return $localize`Signature invalid — ${formula}:formula: matched, but ${signatureReasonText(reason)}:reason:`;
  }
  return $localize`Signature ${stateText(state)}:state: — ${signatureReasonText(reason)}:reason:`;
}

function stateText(state: SignatureState): string {
  const names: Record<SignatureState, string> = {
    valid: $localize`:signature state|:valid`,
    invalid: $localize`:signature state|:invalid`,
    absent: $localize`:signature state|:absent`,
  };
  return names[state];
}

const MISMATCH = 'signature mismatch';
const MALFORMED = 'malformed header';
const ABSENT = /^header (\S+) absent$/;
const TIMESTAMP = /^timestamp outside tolerance \((\d+) s\)$/;
/** O motivo agrupado do `/stats` e de Métricas, sem os segundos de cada mensagem. */
const TIMESTAMP_WITHOUT_DETAIL = 'timestamp outside tolerance';

/**
 * O motivo da assinatura como a tela o diz: uma frase na língua da tela, com o original do servidor
 * entre parênteses (em inglês, o cabeçalho que faltou fica só com a frase do servidor, que já diz
 * tudo). Motivo desconhecido fica como veio.
 */
export function signatureReasonText(reason: string): string {
  if (reason === MISMATCH) {
    return $localize`:signature reason from the server|:the HMAC did not match (signature mismatch)`;
  }
  if (reason === MALFORMED) {
    return $localize`:signature reason from the server|:the header is not in the expected format (malformed header)`;
  }
  const header = ABSENT.exec(reason)?.[1];
  if (header) {
    // O nome do cabeçalho entra uma vez só na mensagem: o original vai entre parênteses aqui, e só
    // quando a tradução difere dele (em inglês, a frase é a do servidor).
    const text = $localize`:signature reason from the server|:header ${header}:header: absent`;
    return text === reason ? reason : `${text} (${reason})`;
  }
  if (reason === TIMESTAMP_WITHOUT_DETAIL) {
    return $localize`:signature reason from the server|:the timestamp is outside the tolerance (timestamp outside tolerance)`;
  }
  const seconds = TIMESTAMP.exec(reason)?.[1];
  if (seconds) {
    return $localize`:signature reason from the server|:the timestamp is ${seconds}:seconds: s from now, outside the tolerance (timestamp outside tolerance)`;
  }
  return reason;
}

/**
 * Quem corrige a assinatura que falhou e o que fazer: o segredo daqui, o provedor (ou o remetente,
 * no genérico), o formato configurado, a tolerância. Sem a URL (link só-leitura), a tolerância sai
 * sem o número.
 */
export function signatureAdvice(request: CapturedRequest, token: Token | null): string[] {
  const signature = request.signature;
  if (!signature || signature.valid || signature.reason === null) {
    return [];
  }
  const { provider, reason } = signature;
  const generic = provider === 'generic';
  const label = signatureProviderLabel(provider);
  if (reason === MISMATCH) {
    return [
      generic
        ? $localize`Check that the HMAC secret here is the sender's; if it is, something on the way altered the body.`
        : $localize`Check that the HMAC secret here is the same as ${label}:provider:'s; if it is, something on the way altered the body.`,
    ];
  }
  if (reason === MALFORMED) {
    return [
      generic
        ? $localize`Compare the Prefix and the Encoding (hex/base64) in Checks › Signature with the header that arrived, in the Headers tab. If the sender is off the agreed format (no prefix, for example), the sender fixes it; if the sender's format is the agreed one, adjust the Prefix and the Encoding here.`
        : $localize`The header does not follow ${label}:provider:'s format: confirm the sender is ${label}:provider:, or use Generic.`,
    ];
  }
  if (absentHeader(signature) !== null) {
    return [
      generic
        ? $localize`The sender did not sign, or the header configured here is another.`
        : $localize`${label}:provider: did not sign (no secret set there).`,
    ];
  }
  if (TIMESTAMP.test(reason)) {
    const tolerance =
      token?.signature?.provider === provider ? token.signature.toleranceSeconds : undefined;
    return [
      tolerance === undefined
        ? $localize`The timestamp is above the tolerance set here: late redelivery or a wrong clock; or raise the tolerance.`
        : $localize`The timestamp is above the ${tolerance}:seconds: s tolerance: late redelivery or a wrong clock; or raise the tolerance.`,
    ];
  }
  return [];
}
