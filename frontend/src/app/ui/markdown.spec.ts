import { parseInline, parseMarkdown } from './markdown';

describe('Dado o markdown simples do modelo', () => {
  it('deve separar parágrafos por linha em branco e manter a quebra dentro do parágrafo Quando o texto tem dois parágrafos', () => {
    expect(parseMarkdown('Primeira linha\nsegunda linha\n\nOutro parágrafo')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Primeira linha\nsegunda linha' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Outro parágrafo' }] },
    ]);
  });

  it('deve montar listas com e sem número, com a linha recuada no mesmo item Quando o texto tem listas', () => {
    expect(
      parseMarkdown(
        'Motivos:\n- assinatura **inválida**\n  continua\n* schema ok\n\n1. um\n2) dois',
      ),
    ).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Motivos:' }] },
      {
        kind: 'list',
        ordered: false,
        items: [
          [
            { kind: 'text', text: 'assinatura ' },
            { kind: 'strong', text: 'inválida' },
            { kind: 'text', text: '\ncontinua' },
          ],
          [{ kind: 'text', text: 'schema ok' }],
        ],
      },
      {
        kind: 'list',
        ordered: true,
        items: [[{ kind: 'text', text: 'um' }], [{ kind: 'text', text: 'dois' }]],
      },
    ]);
  });

  it('deve guardar o bloco de código como texto, sem interpretar o que há dentro Quando o texto tem ```', () => {
    expect(parseMarkdown('Veja:\n```json\n{"a": 1}\n- não é lista\n```\nfim')).toEqual([
      { kind: 'paragraph', content: [{ kind: 'text', text: 'Veja:' }] },
      { kind: 'code', text: '{"a": 1}\n- não é lista' },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'fim' }] },
    ]);
  });

  it('deve ir até o fim do texto Quando o bloco de código não fecha', () => {
    expect(parseMarkdown('```\nx\ny')).toEqual([{ kind: 'code', text: 'x\ny' }]);
  });

  it('deve virar título Quando a linha começa com #', () => {
    expect(parseMarkdown('## Por que 401\ntexto')).toEqual([
      { kind: 'heading', content: [{ kind: 'text', text: 'Por que 401' }] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'texto' }] },
    ]);
  });

  it('deve separar `código` e **negrito** do texto Quando a linha tem os dois', () => {
    expect(parseInline('Header `X-Signature` está **ausente**.')).toEqual([
      { kind: 'text', text: 'Header ' },
      { kind: 'code', text: 'X-Signature' },
      { kind: 'text', text: ' está ' },
      { kind: 'strong', text: 'ausente' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('deve manter tags HTML como texto comum Quando o modelo escreve HTML', () => {
    expect(parseMarkdown('<img src=x onerror="alert(1)"> <b>oi</b>')).toEqual([
      {
        kind: 'paragraph',
        content: [{ kind: 'text', text: '<img src=x onerror="alert(1)"> <b>oi</b>' }],
      },
    ]);
  });

  it('deve devolver nada Quando o texto é vazio', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
