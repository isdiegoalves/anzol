import { clearTranslations, loadTranslations } from '@angular/localize';
import { token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { translations } from '../../locale/pt-BR';
import { CapturedRequest } from '../requests/webhook-request';
import { Rule } from '../rules/rule';
import { NO_FILTER, RequestFilter } from '../search/request-filter';
import { Token } from '../token/token';
import { CircuitInput, CircuitLabel, CircuitView, circuitOf } from './circuit-model';

/** A URL da demo: assinatura genérica no X-PagaFacil-Assinatura e schema 2020-12. */
const URL_DA_DEMO: Token = token({
  signature: { provider: 'generic', header: 'X-PagaFacil-Assinatura', algorithm: 'sha512' },
  schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
});

/** P1–P3 da demo, na ordem de avaliação (prioridades 1, 2 e 3). */
const P1 = rule(1, {
  id: 'p1',
  name: 'Assinatura inválida',
  priority: 1,
  match: { signature: 'invalid' },
  response: { status: 401 },
});
const P2 = rule(2, {
  id: 'p2',
  name: 'Estoque instável',
  priority: 2,
  match: { method: ['PUT'], path: { prefix: '/webhooks/estoque' } },
  response: { fault: 'connection_reset' },
});
const P3 = rule(3, {
  id: 'p3',
  name: 'Pedido inexistente',
  priority: 3,
  match: { method: ['DELETE'], path: { prefix: '/webhooks/pedidos' } },
  response: { status: 404 },
});
const REGRAS: Rule[] = [P3, P1, P2];

const valida = { provider: 'generic', valid: true, reason: null } as const;
const naoConfere = { provider: 'generic', valid: false, reason: 'signature mismatch' } as const;
const schemaOk = { valid: true, errors: [] };
const schemaRuim = { valid: false, errors: [{ path: '/dados', message: 'required' }] };

/** Válida, respondida pela padrão, com P1 como a mais próxima (a 10.ª linha antiga de R2). */
const PELA_PADRAO = webhookRequest(10, {
  ip: '192.168.107.1',
  url: 'http://localhost:8084/x/webhooks/pagamentos',
  signature: valida,
  schema: schemaOk,
  rule: null,
  near_miss: {
    id: 'p1',
    name: 'Assinatura inválida',
    failed: ['signature: expected invalid, got valid'],
  },
  response: { status: 200 },
});
/** A #7: assinatura inválida, 401 por P1. */
const DA_P1 = webhookRequest(7, {
  ip: '203.0.113.7',
  url: 'http://localhost:8084/x/webhooks/pagamentos',
  signature: naoConfere,
  schema: schemaOk,
  rule: { id: 'p1', name: 'Assinatura inválida' },
  near_miss: null,
  response: { status: 401 },
});
/** A #19: P2 derrubou a conexão (RST). */
const DA_P2 = webhookRequest(19, {
  method: 'PUT',
  url: 'http://localhost:8084/x/webhooks/estoque/sku_1219',
  signature: valida,
  schema: schemaOk,
  rule: { id: 'p2', name: 'Estoque instável' },
  response: { fault: 'connection_reset' },
});
const SCHEMA_RUIM = webhookRequest(15, {
  signature: valida,
  schema: schemaRuim,
  rule: null,
  response: { status: 200 },
});

function circuito(campos: Partial<CircuitInput> = {}): CircuitView {
  return circuitOf({
    token: URL_DA_DEMO,
    name: 'Pagamentos',
    rules: REGRAS,
    requests: [],
    selected: null,
    filter: NO_FILTER,
    ...campos,
  });
}

/** O texto de um rótulo como a tela o mostra: o glifo, o texto e o número do cartão. */
function texto(view: CircuitView, key: string): string | null {
  const label = view.labels.find((one) => one.key === key);
  return label ? escrito(label) : null;
}

function escrito(label: CircuitLabel): string {
  return [label.glyph?.text, label.text, label.badge].filter(Boolean).join(' ');
}

function rotulo(view: CircuitView, key: string): CircuitLabel {
  const label = view.labels.find((one) => one.key === key);
  if (!label) {
    throw new Error(`sem o rótulo ${key}: ${view.labels.map((one) => one.key).join(', ')}`);
  }
  return label;
}

const marcados = (view: CircuitView) => view.marks.filter((mark) => mark.on).map((m) => m.id);

describe('Dado o circuito da URL com P1, P2 e P3 (o desenho da demo)', () => {
  it('deve pôr as regras na ordem de avaliação, com "padrão" no fim, e os nós da demo', () => {
    const view = circuito();

    expect(view.nodes.map((node) => node.id)).toEqual([
      'sender',
      'signature',
      'schema',
      'decryption',
      'rule:p1',
      'rule:p2',
      'rule:p3',
      'default',
      'response',
      'resend',
    ]);
    expect(texto(view, 'rule:p1:name')).toBe('P1 Assinatura inválida');
    expect(texto(view, 'rule:p3:name')).toBe('P3 Pedido inexistente');
    expect(texto(view, 'default:name')).toBe('default');
    // Geometria da demo: escada em x = 860, y = 24, 48, 72 e 96.
    expect(view.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([
      24, 48, 72, 96,
    ]);
  });

  it('deve mostrar a configuração Quando nenhuma mensagem está aberta (CA-3)', () => {
    const view = circuito();

    expect(texto(view, 'sender:sub')).toBe('—');
    expect(texto(view, 'signature:sub')).toBe('X-PagaFacil-Assinatura');
    expect(texto(view, 'schema:sub')).toBe('JSON Schema');
    expect(texto(view, 'decryption:sub')).toBe('off');
    // Sem acertos, o que cada regra responde, em tinta fraca.
    expect(texto(view, 'rule:p1:ann')).toBe('401');
    expect(rotulo(view, 'rule:p1:ann').muted).toBe(true);
    expect(texto(view, 'rule:p2:ann')).toBe('TCP RST');
    expect(texto(view, 'default:ann')).toBe('200');
    expect(texto(view, 'response:data')).toBe('—');
    expect(texto(view, 'resend:sub')).toBe('Outbound');
    expect(view.route).toEqual([]);
    expect(marcados(view)).toEqual([]);
    expect(view.description).toBe('URL circuit Pagamentos with 10 nodes. No request open.');
  });

  it('deve contar os acertos das mensagens carregadas, com glifo e régua só na anomalia', () => {
    const view = circuito({ requests: [DA_P1, DA_P1, DA_P2, PELA_PADRAO, SCHEMA_RUIM] });

    expect(texto(view, 'rule:p1:ann')).toBe('✗ 401 · 2');
    expect(rotulo(view, 'rule:p1:ann')).toMatchObject({ rule: 'bad', muted: false });
    expect(texto(view, 'rule:p2:ann')).toBe('⚡ connection reset · 1');
    expect(rotulo(view, 'rule:p2:ann').rule).toBe('bad');
    expect(texto(view, 'rule:p3:ann')).toBe('404');
    // A padrão responde também a de schema inválido: o status segue neutro.
    expect(texto(view, 'default:ann')).toBe('200 · 2');
    expect(rotulo(view, 'default:ann').rule).toBeNull();
    // O schema inválido que nenhuma regra pegou fica anotado no nó Schema; a assinatura, em P1.
    expect(texto(view, 'schema:note')).toBe('✗ 1');
    expect(rotulo(view, 'schema:note').rule).toBe('bad');
    expect(texto(view, 'signature:note')).toBeNull();
    expect(texto(view, 'response:sub')).toBe('5 responses');
  });

  it('deve desenhar o caminho da mensagem aberta até a padrão, com ✓ por nó e status neutro (CA-1)', () => {
    const view = circuito({ requests: [PELA_PADRAO], selected: PELA_PADRAO });

    expect(view.route).toEqual(['rs', 'ss', 'sd', 'br', 's0', 's1', 's2', 'x3', 'c3', 'c2', 'out']);
    expect(marcados(view)).toEqual([
      'sender',
      'signature',
      'schema',
      'decryption',
      'rule:p1',
      'rule:p2',
      'rule:p3',
      'default',
      'response',
    ]);
    expect(texto(view, 'sender:sub')).toBe('192.168.107.1');
    expect(texto(view, 'signature:gl')).toBe('✓ valid · Generic');
    expect(texto(view, 'schema:gl')).toBe('✓ valid · 2020-12');
    expect(texto(view, 'response:data')).toBe('200 · default');
    expect(rotulo(view, 'response:data')).toMatchObject({ muted: false, rule: null });
    // Os números dos cartões do detalhe (① ② ③) nos nós correspondentes.
    expect(rotulo(view, 'signature:title').badge).toBe('①');
    expect(rotulo(view, 'schema:title').badge).toBe('②');
    expect(rotulo(view, 'response:title').badge).toBe('③');
    expect(rotulo(view, 'decryption:title').badge).toBeUndefined();
  });

  it('deve parar o caminho na regra que respondeu, com ✗ e régua na assinatura que não confere', () => {
    const view = circuito({ requests: [DA_P1], selected: DA_P1 });

    expect(view.route).toEqual(['rs', 'ss', 'sd', 'br', 'x0', 'c0', 'c1', 'out']);
    expect(marcados(view)).toEqual([
      'sender',
      'signature',
      'schema',
      'decryption',
      'rule:p1',
      'response',
    ]);
    expect(texto(view, 'signature:gl')).toBe('✗ invalid · Generic');
    expect(rotulo(view, 'signature:gl')).toMatchObject({ rule: 'bad', glyph: { tone: 'bad' } });
    // 401 de regra: tinta neutra, sem ✗ (VS-02/03).
    expect(texto(view, 'response:data')).toBe('401 · P1');
    expect(rotulo(view, 'response:data').rule).toBeNull();
    expect(view.description).toBe(
      'URL circuit Pagamentos with 10 nodes. Open request: POST /webhooks/pagamentos from 203.0.113.7; ' +
        'path: signature ✗ → schema ✓ → P1 ✓ → 401.',
    );
  });

  it('deve dizer a falha de rede com ⚡ e o 503 de propósito em tinta neutra', () => {
    const rst = circuito({ selected: DA_P2 });
    const p503 = rule(4, { id: 'p4', priority: 4, name: 'Fora do ar', response: { status: 503 } });
    const de503 = webhookRequest(4, {
      signature: valida,
      schema: schemaOk,
      rule: { id: 'p4', name: 'Fora do ar' },
      response: { status: 503 },
    });
    const fora = circuito({ rules: [...REGRAS, p503], selected: de503 });

    expect(rst.route).toEqual(['rs', 'ss', 'sd', 'br', 's0', 'x1', 'c1', 'out']);
    expect(texto(rst, 'response:data')).toBe('TCP RST · P2');
    expect(rst.description).toContain(
      'path: signature ✓ → schema ✓ → P1 ✗ → P2 ✓ → connection reset.',
    );
    expect(texto(fora, 'response:data')).toBe('503 · P4');
    expect(rotulo(fora, 'response:data').rule).toBeNull();
  });
});

describe('Dado a mensagem aberta com uma regra que quase casou (CA-2)', () => {
  it('deve pôr "◔ near · missing: signature invalid" em âmbar, com régua, acima de P1', () => {
    const view = circuito({ selected: PELA_PADRAO });

    const near = rotulo(view, 'near');
    expect(escrito(near)).toBe('◔ near · missing: signature invalid');
    expect(near).toMatchObject({ x: 872, y: 9, rule: 'near', glyph: { tone: 'near' } });
    expect(view.description).toContain('; near match: P1 Assinatura inválida.');
    expect(view.nodes.find((node) => node.id === 'rule:p1')?.label).toContain(
      'near · missing: signature invalid',
    );
  });

  it('deve ficar na linha de cima (y = 9) com uma regra só, sem cruzar a Resposta (y = 24 e 40)', () => {
    const view = circuito({ rules: [P1], selected: PELA_PADRAO });

    expect(rotulo(view, 'near').y).toBe(9);
    expect(view.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([48, 72]);
  });

  it('deve sumir Quando a mensagem aberta não tem near miss', () => {
    expect(texto(circuito({ selected: DA_P1 }), 'near')).toBeNull();
    expect(texto(circuito(), 'near')).toBeNull();
  });

  it('deve nomear a regra Quando a mais próxima não é a primeira da escada', () => {
    const view = circuito({
      selected: webhookRequest(5, {
        method: 'POST',
        signature: valida,
        schema: schemaOk,
        rule: null,
        near_miss: {
          id: 'p3',
          name: 'Pedido inexistente',
          failed: [
            'method: expected DELETE, got POST',
            'path: expected prefix "/webhooks/pedidos", got "/x"',
          ],
        },
        response: { status: 200 },
      }),
    });

    expect(texto(view, 'near')).toBe('◔ near P3 · missing: method DELETE +1');
  });

  it('deve dizer em pt-BR "◔ quase · faltou: assinatura inválida"', () => {
    loadTranslations(translations);
    try {
      const view = circuito({ selected: PELA_PADRAO });
      expect(texto(view, 'near')).toBe('◔ quase · faltou: assinatura inválida');
      expect(texto(view, 'signature:gl')).toBe('✓ válida · Genérico');
      expect(texto(view, 'schema:gl')).toBe('✓ válido · 2020-12');
      expect(texto(view, 'response:data')).toBe('200 · padrão');
      expect(texto(view, 'decryption:sub')).toBe('desligada');
      expect(view.description).toBe(
        'Circuito da URL Pagamentos com 10 nós. Mensagem selecionada: POST /webhooks/pagamentos de ' +
          '192.168.107.1; caminho: assinatura ✓ → schema ✓ → P1 ✗ → P2 ✗ → P3 ✗ → resposta padrão 200; ' +
          'quase casou: P1 Assinatura inválida.',
      );
    } finally {
      clearTranslations();
    }
  });
});

describe('Dado a URL sem regras (R1)', () => {
  const nova = token({ signature: null, schema: null });

  it('deve mostrar os 4 nós da demo e "sem regras" em tinta fraca', () => {
    const view = circuito({ token: nova, rules: [] });

    expect(view.nodes.map((node) => node.id)).toEqual([
      'sender',
      'signature',
      'schema',
      'response',
    ]);
    expect(texto(view, 'none')).toBe('no rules');
    expect(rotulo(view, 'none').muted).toBe(true);
    expect(texto(view, 'signature:sub')).toBe('off');
    expect(texto(view, 'schema:sub')).toBe('off');
    expect(texto(view, 'response:data')).toBe('default · 200');
  });

  it('deve ir direto do Schema à Resposta com a mensagem aberta', () => {
    const view = circuito({ rules: [], selected: PELA_PADRAO });

    expect(view.route).toEqual(['rs', 'ss', 'sr']);
    expect(texto(view, 'response:data')).toBe('200 · default');
    expect(view.description).toContain('path: signature ✓ → schema ✓ → default response 200.');
  });

  it('não deve desenhar a escada nem "sem regras" enquanto as regras não chegaram', () => {
    const view = circuito({ rules: null });

    expect(texto(view, 'none')).toBeNull();
    expect(view.nodes.some((node) => node.id.startsWith('rule:'))).toBe(false);
  });
});

describe('Dado o clique num nó (filtro "passou por")', () => {
  const filtroDe = (view: CircuitView, id: string) =>
    view.nodes.find((node) => node.id === id)?.filter ?? null;

  it.each([
    ['signature', { signature: 'invalid' }],
    ['schema', { schema: 'invalid' }],
    ['rule:p1', { outcome: { type: 'rule', rule: 'p1', name: 'Assinatura inválida' } }],
    ['default', { outcome: { type: 'default' } }],
  ] as const)('deve filtrar pelo nó %s', (id, esperado) => {
    expect(filtroDe(circuito(), id)).toEqual(esperado);
  });

  it('não deve ter filtro nos nós que mostram todas (Remetente, Resposta, Reenvio, Decifra desligada)', () => {
    const view = circuito();
    for (const id of ['sender', 'response', 'resend', 'decryption']) {
      expect(filtroDe(view, id)).toBeNull();
      expect(view.nodes.find((node) => node.id === id)?.label).toContain(
        'Enter shows all in the list.',
      );
    }
  });

  it('deve marcar o nó do filtro ativo (aria-pressed) e dizer o que o Enter faz', () => {
    const filter: RequestFilter = {
      ...NO_FILTER,
      outcome: { type: 'rule', rule: 'p1', name: 'Assinatura inválida' },
    };
    const view = circuito({ filter });
    const p1 = view.nodes.find((node) => node.id === 'rule:p1');

    expect(p1?.pressed).toBe(true);
    expect(view.nodes.find((node) => node.id === 'rule:p2')?.pressed).toBe(false);
    expect(view.nodes.find((node) => node.id === 'sender')?.pressed).toBeNull();
    expect(p1?.label).toBe(
      'Rule P1 Assinatura inválida: 401. Enter filters the list: answered by P1.',
    );
  });
});

describe('Dado muitas regras', () => {
  it('deve juntar as que não cabem numa linha "+N rules" e seguir o caminho por ela', () => {
    const muitas = Array.from({ length: 8 }, (_, i) =>
      rule(i + 1, { id: `r${i + 1}`, priority: i + 1, name: `Regra ${i + 1}` }),
    );
    const daSetima: CapturedRequest = webhookRequest(70, {
      signature: valida,
      schema: schemaOk,
      rule: { id: 'r7', name: 'Regra 7' },
      response: { status: 207 },
    });
    const view = circuito({ rules: muitas, selected: daSetima });
    const linhas = view.nodes.filter((node) => node.id.startsWith('rule:') || node.id === 'more');

    expect(linhas.map((node) => node.id)).toEqual([
      'rule:r1',
      'rule:r2',
      'rule:r3',
      'rule:r4',
      'more',
    ]);
    expect(texto(view, 'more:name')).toBe('+4 rules');
    expect(view.route).toContain('x4');
    expect(view.marks.filter((mark) => mark.x === 860)).toHaveLength(6);
  });
});
