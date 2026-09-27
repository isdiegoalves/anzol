import { rule } from '../../testing/rule-fixtures';
import { priorityPreview } from './priority-preview';
import { Rule, RuleRef } from './rule';

const ref = (r: Rule): RuleRef => ({ id: r.id ?? '', name: r.name });

/** Três regras salvas: prioridades 1, 5 e 9, nessa ordem de avaliação. */
const P1 = rule(1, { priority: 1 });
const P5 = rule(2, { priority: 5 });
const P9 = rule(3, { priority: 9 });
const SALVAS = [P1, P5, P9];

describe('Dado a prévia do rascunho com a prioridade das regras salvas (S8)', () => {
  // [caso, prioridade do rascunho, índice do rascunho na lista (null = nova), quem respondeu a
  // mensagem na época, quem responderia agora]
  it.each<[string, number, number | null, RuleRef | null | undefined, 'draft' | string]>([
    ['respondida pela resposta padrão', 5, null, null, 'draft'],
    ['fora da janela lida', 5, null, undefined, 'draft'],
    ['por regra de prioridade menor (vem antes)', 5, null, ref(P1), P1.name],
    ['por regra de prioridade maior (vem depois)', 5, null, ref(P9), 'draft'],
    [
      'por regra de prioridade igual e o rascunho novo (vai para o fim da lista)',
      5,
      null,
      ref(P5),
      P5.name,
    ],
    ['por regra de prioridade igual listada depois do rascunho em edição', 5, 0, ref(P5), 'draft'],
    ['pela própria regra em edição', 9, 1, ref(P5), 'draft'],
    [
      'pela regra que o rascunho passa a preceder ao baixar a prioridade',
      1,
      null,
      ref(P5),
      'draft',
    ],
    ['por regra que o rascunho deixa de preceder ao subir a prioridade', 9, 0, ref(P5), P5.name],
    ['por regra apagada desde então', 5, null, { id: 'apagada', name: 'Velha' }, 'draft'],
  ])(
    'deve atribuir a mensagem certa Quando foi respondida %s',
    (_caso, priority, index, answered, expected) => {
      const draft = { ...rule(9, { priority }), ...(index !== null && { id: SALVAS[index].id }) };
      const answeredBy = new Map(answered === undefined ? [] : [['m1', answered]]);

      const preview = priorityPreview(SALVAS, draft, index, ['m1'], answeredBy);

      const who = preview.draft === 1 ? 'draft' : preview.earlier[0]?.name;
      expect(who).toBe(expected);
    },
  );

  it('deve dar a mensagem ao rascunho Quando a regra que respondeu está desligada hoje', () => {
    const desligada = { ...P1, enabled: false };

    const preview = priorityPreview(
      [desligada, P5],
      rule(9),
      null,
      ['m1'],
      new Map([['m1', ref(P1)]]),
    );

    expect(preview).toEqual({ draft: 1, earlier: [] });
  });

  it('deve agrupar por regra anterior, da que mais responde para a que menos', () => {
    const answeredBy = new Map<string, RuleRef | null>([
      ['a', ref(P1)],
      ['b', ref(P5)],
      ['c', ref(P5)],
      ['d', null],
      ['e', ref(P9)],
    ]);

    const preview = priorityPreview(
      SALVAS,
      rule(9, { priority: 7 }),
      null,
      ['a', 'b', 'c', 'd', 'e'],
      answeredBy,
    );

    expect(preview).toEqual({
      draft: 2,
      earlier: [
        { id: P5.id, name: P5.name, count: 2 },
        { id: P1.id, name: P1.name, count: 1 },
      ],
    });
  });
});
