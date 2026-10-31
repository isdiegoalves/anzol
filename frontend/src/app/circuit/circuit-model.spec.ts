import { clearTranslations, loadTranslations } from '@angular/localize';
import { token, webhookRequest } from '../../testing/fixtures';
import { rule } from '../../testing/rule-fixtures';
import { translations } from '../../locale/pt-BR';
import { CapturedRequest } from '../requests/webhook-request';
import { Rule } from '../rules/rule';
import { NO_FILTER, RequestFilter } from '../search/request-filter';
import { Token } from '../token/token';
import { CircuitInput, CircuitLabel, CircuitView, circuitOf, flowWidth } from './circuit-model';

/** A URL de exemplo: assinatura genérica no X-PagaFacil-Assinatura e schema 2020-12. */
const URL_DA_DEMO: Token = token({
  signature: { provider: 'generic', header: 'X-PagaFacil-Assinatura', algorithm: 'sha512' },
  schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
});

/** P1–P3 de exemplo, na ordem de avaliação (prioridades 1, 2 e 3). */
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

describe('Dado o circuito da URL com P1, P2 e P3', () => {
  it('deve pôr as regras na ordem de avaliação, com "padrão" no fim, e os nós do Remetente ao Reenvio', () => {
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
    // Escada em x = 860, y = 24, 48, 72 e 96.
    expect(view.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([
      24, 48, 72, 96,
    ]);
  });

  it('deve mostrar a configuração Quando nenhuma mensagem está aberta', () => {
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

  it('deve desenhar o caminho da mensagem aberta até a padrão, com ✓ por nó e status neutro', () => {
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

describe('Dado a mensagem aberta com uma regra que quase casou', () => {
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

  it('deve ficar junto da P1 (y = 9) com uma regra só, com a escada começando em y = 24', () => {
    const uma = circuito({ rules: [P1], selected: PELA_PADRAO });
    const duas = circuito({ rules: [P1, P3], selected: PELA_PADRAO });

    expect(rotulo(uma, 'near').y).toBe(9);
    expect(uma.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([24, 48]);
    expect(duas.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([24, 48, 72]);
    // O caminho pela padrão de uma regra só: entra em P1, desce à padrão e sobe ao coletor (y = 60).
    expect(uma.route).toEqual(['rs', 'ss', 'sd', 'br', 's0', 'x1', 'c1', 'out']);
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

  it('deve mostrar os 4 nós da URL sem regras, com "sem regras" em tinta fraca', () => {
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
  const muitas = Array.from({ length: 8 }, (_, i) =>
    rule(i + 1, { id: `r${i + 1}`, priority: i + 1, name: `Regra ${i + 1}` }),
  );

  it('deve juntar as que não cabem numa linha "+N rules" e seguir o caminho por ela', () => {
    const daSetima: CapturedRequest = webhookRequest(70, {
      signature: valida,
      schema: schemaOk,
      rule: { id: 'r7', name: 'Regra 7' },
      response: { status: 207 },
    });
    const view = circuito({ rules: muitas, selected: daSetima });
    const linhas = view.nodes.filter((node) => node.id.startsWith('rule:') || node.id === 'more');

    expect(linhas.map((node) => node.id)).toEqual(['rule:r1', 'rule:r2', 'more']);
    expect(texto(view, 'more:name')).toBe('+6 rules');
    expect(view.route).toContain('x2');
    expect(view.marks.filter((mark) => mark.x === 860).map((mark) => mark.y)).toEqual([
      24, 48, 72, 96,
    ]);
  });

  const no = (view: CircuitView, id: string) => view.nodes.find((node) => node.id === id);
  const lidas = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      webhookRequest(80 + i, { rule: { id: `r${i + 3}`, name: `Regra ${i + 3}` } }),
    );

  it('deve dizer na linha "+N rules" a regra escondida que respondeu à mensagem aberta, no lugar da contagem', () => {
    const daSetima: CapturedRequest = webhookRequest(70, {
      signature: valida,
      schema: schemaOk,
      rule: { id: 'r7', name: 'Regra 7' },
      response: { status: 503 },
    });
    const view = circuito({ rules: muitas, requests: [...lidas(3), daSetima], selected: daSetima });

    expect(texto(view, 'more:ann')).toBe('P7 Regra 7 · 503');
    // Em tinta: nem fraca, nem com o fio de anomalia ou de "quase".
    expect(rotulo(view, 'more:ann')).toMatchObject({ muted: false, rule: null });
    expect(no(view, 'more')?.label).toBe(
      '+6 rules, among them P7 Regra 7, which answered: 503. Enter opens Filters.',
    );
    expect(no(view, 'more')?.opens).toBe('filters');
    // A frase e a Resposta dizem o mesmo.
    expect(texto(view, 'response:data')).toBe('503 · P7');
    expect(view.description).toContain('P7 ✓ → 503.');
  });

  it('deve dizer na linha "+N rules" a falha de rede da regra escondida que respondeu', () => {
    const daQuinta: CapturedRequest = webhookRequest(71, {
      rule: { id: 'r5', name: 'Regra 5' },
      response: { fault: 'connection_reset' },
    });
    const view = circuito({ rules: muitas, selected: daQuinta });

    expect(texto(view, 'more:ann')).toBe('P5 Regra 5 · TCP RST');
  });

  it('deve dizer na linha "+N rules" a regra escondida que quase casou, em âmbar', () => {
    const quaseSexta: CapturedRequest = webhookRequest(72, {
      signature: valida,
      schema: schemaOk,
      rule: null,
      near_miss: { id: 'r6', name: 'Regra 6', failed: ['method: expected DELETE, got POST'] },
      response: { status: 200 },
    });
    const view = circuito({ rules: muitas, requests: lidas(3), selected: quaseSexta });

    expect(texto(view, 'more:ann')).toBe('◔ P6 Regra 6');
    expect(rotulo(view, 'more:ann')).toMatchObject({ rule: 'near', glyph: { tone: 'near' } });
    expect(no(view, 'more')?.label).toBe(
      '+6 rules, among them P6 Regra 6, which almost matched: near P6 · missing: method DELETE. Enter opens Filters.',
    );
  });

  it('deve dizer em pt-BR "+6 regras, entre elas P7 Regra 7, que respondeu: 503"', () => {
    loadTranslations(translations);
    try {
      const daSetima: CapturedRequest = webhookRequest(70, {
        rule: { id: 'r7', name: 'Regra 7' },
        response: { status: 503 },
      });
      const view = circuito({ rules: muitas, selected: daSetima });

      expect(no(view, 'more')?.label).toBe(
        '+6 regras, entre elas P7 Regra 7, que respondeu: 503. Enter abre os Filtros.',
      );
    } finally {
      clearTranslations();
    }
  });

  it('deve contar as mensagens das escondidas Quando a aberta não passou por elas, e abrir os Filtros pelo Enter', () => {
    const view = circuito({ rules: muitas, requests: lidas(3), selected: PELA_PADRAO });

    expect(texto(view, 'more:ann')).toBe('3');
    expect(no(view, 'more')?.label).toBe('+6 rules: 3. Enter opens Filters.');
    expect(no(view, 'more')?.opens).toBe('filters');
    expect(no(view, 'rule:r1')?.opens).toBeUndefined();
  });

  it('deve dar a todo nó um alvo de 24 × 24 px ou mais na tela, também com o palco encolhido (WCAG 2.5.8)', () => {
    for (const scale of [1, 10 / 11]) {
      for (const rules of [REGRAS, [P1], muitas, []]) {
        for (const node of circuito({ rules, selected: PELA_PADRAO, scale }).nodes) {
          expect(Math.min(node.w, node.h) * scale, `${node.id} a ${scale}`).toBeGreaterThanOrEqual(
            24,
          );
        }
      }
    }
    // A escada se abre para isso; o resto do desenho não muda.
    expect(
      circuito({ scale: 10 / 11 })
        .marks.filter((mark) => mark.x === 860)
        .map((mark) => mark.y),
    ).toEqual([24, 50.4, 76.8, 103.2]);
  });
});

describe('Dado as falhas de rede que a regra pode injetar', () => {
  it.each([
    ['hang', 'Hang', '⚡ hang · 1', 'Hang · P2', 'hang'],
    [
      'stall_after_headers',
      'Stall',
      '⚡ stall after headers · 1',
      'Stall · P2',
      'stall after headers',
    ],
    ['truncated_body', 'Truncated', '⚡ truncated body · 1', 'Truncated · P2', 'truncated body'],
    [
      'empty_response',
      'Empty response',
      '⚡ empty response · 1',
      'Empty response · P2',
      'empty response',
    ],
  ] as const)(
    'deve nomear %s na escada, na Resposta e na frase',
    (fault, curto, contado, resposta, frase) => {
      const falha = rule(2, { ...P2, response: { fault } });
      const dela = webhookRequest(19, { ...DA_P2, response: { fault } });
      const sem = circuito({ rules: [P1, falha, P3] });
      const com = circuito({ rules: [P1, falha, P3], requests: [dela], selected: dela });

      expect(texto(sem, 'rule:p2:ann')).toBe(curto);
      expect(texto(com, 'rule:p2:ann')).toBe(contado);
      expect(texto(com, 'response:data')).toBe(resposta);
      expect(com.description).toContain(`P2 ✓ → ${frase}.`);
      // O id cru da falha ("stall_after_headers") não chega à tela.
      expect(com.description).not.toContain('after_headers');
      expect(com.description).not.toContain('truncated_body');
    },
  );
});

describe('Dado a mensagem gravada antes das regras', () => {
  it('deve ir direto da Decifra à Resposta, sem passar pela escada nem dizer "P1 ✗"', () => {
    const antiga = webhookRequest(3, {
      signature: valida,
      schema: schemaOk,
      rule: null,
      near_miss: null,
      response: { status: 200 },
    });
    const view = circuito({ selected: antiga });

    expect(view.route).toEqual(['rs', 'ss', 'sd', 'skip', 'out']);
    expect(view.edges.find((edge) => edge.id === 'skip')?.d).toBe('M640,60 H1060');
    expect(marcados(view)).toEqual(['sender', 'signature', 'schema', 'decryption', 'response']);
    expect(view.description).toContain('path: signature ✓ → schema ✓ → default response 200.');
    expect(view.description).not.toContain('P1 ✗');
    expect(texto(view, 'response:data')).toBe('200 · default');
    // Sem mensagem assim aberta, a aresta não existe.
    expect(circuito({ selected: PELA_PADRAO }).edges.some((edge) => edge.id === 'skip')).toBe(
      false,
    );
  });
});

describe('Dado a regra que respondeu e saiu da escada (desligada ou apagada)', () => {
  const desligada = rule(9, {
    id: 'p9',
    name: 'Assinatura antiga com um nome bem comprido',
    priority: 0,
    enabled: false,
    match: { signature: 'invalid' },
    response: { status: 401 },
  });
  const daDesligada = webhookRequest(9, {
    signature: naoConfere,
    schema: schemaOk,
    rule: { id: 'p9', name: 'Assinatura antiga com um nome bem comprido' },
    response: { status: 401 },
  });

  it('deve dizer o mesmo nome no desenho e na frase, e contar a anomalia no nó', () => {
    const view = circuito({
      rules: [...REGRAS, desligada],
      requests: [daDesligada],
      selected: daDesligada,
    });

    expect(texto(view, 'response:data')).toBe('401 · Assinatura antiga com um nome bem comprido');
    expect(view.description).toContain(
      'path: signature ✗ → schema ✓ → Assinatura antiga com um nome bem comprido ✓ → 401.',
    );
    // A regra não está na escada para levar o ✗: ele fica no nó Assinatura.
    expect(texto(view, 'signature:note')).toBe('✗ 1');
  });
});

describe('Dado as regras que não puderam ser lidas', () => {
  it('deve dizer "rules unavailable" em tinta fraca, sem "no rules" nem anotação de anomalia', () => {
    const view = circuito({
      rules: null,
      rulesUnavailable: true,
      requests: [DA_P1, SCHEMA_RUIM],
      selected: DA_P1,
    });

    expect(texto(view, 'unavailable')).toBe('rules unavailable');
    expect(rotulo(view, 'unavailable').muted).toBe(true);
    expect(texto(view, 'none')).toBeNull();
    expect(texto(view, 'signature:note')).toBeNull();
    expect(texto(view, 'schema:note')).toBeNull();
    // O resultado da mensagem aberta continua: ele não depende das regras.
    expect(texto(view, 'signature:gl')).toBe('✗ invalid · Generic');
  });
});

describe('Dado o caminho da mensagem aberta em saltos, para o pulso', () => {
  it('deve dar os 5 saltos da escada até a padrão, subindo o coletor de baixo para cima, e o salto em que cada aresta acende', () => {
    const view = circuito({ selected: PELA_PADRAO });

    expect(view.hops).toEqual([
      'M80,60 H280',
      'M280,60 H460',
      'M460,60 H640',
      'M640,60 H686 Q690,60 690,56 V16 Q690,12 694,12 H856 Q860,12 860,16 V24 V48 V72 V96',
      'M860,96 H1060 V72 V60 H1140',
    ]);
    expect(view.lit).toEqual({
      rs: 1,
      ss: 2,
      sd: 3,
      br: 4,
      s0: 4,
      s1: 4,
      s2: 4,
      x3: 5,
      c3: 5,
      c2: 5,
      out: 5,
    });
  });

  it('deve descer o coletor Quando a regra que respondeu fica acima da linha principal', () => {
    const view = circuito({ selected: DA_P1 });

    expect(view.hops.at(-1)).toBe('M860,24 H1060 V48 V60 H1140');
    expect(view.hops).toHaveLength(5);
  });

  it('deve ir em 3 saltos do Remetente à Resposta na URL sem regras (R1), e direto pelo atalho na gravada antes delas', () => {
    expect(circuito({ rules: [], selected: PELA_PADRAO }).hops).toEqual([
      'M80,60 H280',
      'M280,60 H460',
      'M460,60 H1140',
    ]);
    const antiga = webhookRequest(3, { rule: null, near_miss: null, response: { status: 200 } });
    expect(circuito({ selected: antiga }).hops.slice(3)).toEqual([
      'M640,60 H1060',
      'M1060,60 H1140',
    ]);
    expect(circuito().hops).toEqual([]);
  });

  it('deve dizer em que salto cada coisa da mensagem aparece: o IP no Remetente, o ✓ em cada nó, o "quase" na escada, a resposta no fim', () => {
    const view = circuito({ selected: PELA_PADRAO });
    const aparece = (key: string) => rotulo(view, key).reveal;

    expect(aparece('sender:sub')).toBe(0);
    expect(aparece('signature:gl')).toBe(1);
    expect(aparece('schema:gl')).toBe(2);
    expect(aparece('near')).toBe(4);
    expect(aparece('response:data')).toBe(5);
    expect(rotulo(view, 'response:title').reveal).toBeUndefined();
    expect(view.marks.find((mark) => mark.id === 'response')?.reveal).toBe(5);
    expect(rotulo(circuito({ rules: [], selected: PELA_PADRAO }), 'response:data').reveal).toBe(3);
    // Sem mensagem aberta, nada espera o pulso.
    expect(circuito().labels.some((label) => label.reveal !== undefined)).toBe(false);
  });

  it('deve separar o número das contagens, para o contador rolar até ele', () => {
    const view = circuito({ requests: [PELA_PADRAO, DA_P1, DA_P1, SCHEMA_RUIM] });

    expect(rotulo(view, 'rule:p1:ann').count).toEqual({ value: 2, before: '401 · ', after: '' });
    expect(rotulo(view, 'default:ann').count).toEqual({ value: 2, before: '200 · ', after: '' });
    expect(rotulo(view, 'schema:note').count).toEqual({ value: 1, before: '', after: '' });
    expect(rotulo(view, 'response:sub')).toMatchObject({
      text: '4 responses',
      count: { value: 4, before: '', after: ' responses' },
    });
    // Sem acerto, a linha diz só o status, sem contador.
    expect(rotulo(view, 'rule:p3:ann').count).toBeUndefined();
  });

  it('deve mostrar o medidor "N/s" ao lado do Remetente no modo fluxo, também no nome do nó', () => {
    const view = circuito({ meter: 13 });

    expect(rotulo(view, 'sender:meter')).toMatchObject({
      text: '13/s',
      x: 116,
      y: 40,
      count: { value: 13, before: '', after: '/s' },
    });
    expect(view.nodes[0].label).toContain('13/s');
    expect(circuito().labels.some((label) => label.key === 'sender:meter')).toBe(false);
  });

  it('deve engrossar a aresta de 1 a 3 px pelas chegadas, em escala de log, em quartos de pixel', () => {
    expect([0, 1, 15, 255, 10_000].map(flowWidth)).toEqual([1, 1.25, 2, 3, 3]);
  });
});
