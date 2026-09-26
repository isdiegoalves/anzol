import { buscarMensagem, disparar, expect, listar, test, type Mensagem } from '../../support/contrato.js';
import { assinar, type Assinatura, type EventoRequestCreated } from '../../support/eventos.js';

// O `request` do evento leva o mesmo `seq` da mensagem gravada. O evento pode chegar fora da ordem
// de gravação (store e publish concorrentes); o `seq` não: é o da gravação.
test.describe('seq no evento request.created', () => {
  let assinaturas: Assinatura[] = [];

  test.afterEach(async () => {
    for (const a of assinaturas) await a.fechar();
    assinaturas = [];
  });

  async function abrir(tokenId: string): Promise<Assinatura> {
    const a = await assinar(tokenId);
    assinaturas.push(a);
    return a;
  }

  test('100 POSTs, 20 em paralelo: o seq de cada evento é o da listagem e o do GET', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const token = await tokens.criar();
    const canal = await abrir(token.uuid);
    const ids = await disparar(request, token.uuid, 100, { paralelas: 20, opcoes: { method: 'POST', data: 'rajada' } });

    const eventos: EventoRequestCreated[] = [];
    while (eventos.length < 100) eventos.push(await canal.proximo());
    const seqDoEvento = new Map(eventos.map((e) => [e.request.uuid, e.request.seq]));
    expect(new Set(seqDoEvento.keys())).toEqual(new Set(ids));

    const lista: Mensagem[] = (await listar(request, token.uuid, 'per_page=100')).data;
    expect(lista).toHaveLength(100);
    for (const m of lista) {
      expect(Number.isInteger(m.seq), `seq de ${m.uuid} na listagem: ${JSON.stringify(m.seq)}`).toBe(true);
      expect(seqDoEvento.get(m.uuid), `seq de ${m.uuid}: evento × listagem`).toBe(m.seq);
    }
    for (const id of ids.slice(0, 10)) {
      expect((await buscarMensagem(request, token.uuid, id)).seq, `seq de ${id}: GET × evento`).toBe(seqDoEvento.get(id));
    }
  });

  test('evento truncado também leva o seq (o cliente acha a mensagem por uuid e ordena por seq)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const canal = await abrir(token.uuid);
    const res = await request.post(`/${token.uuid}`, { data: Buffer.from('/'.repeat(600_000)), headers: { 'Content-Type': 'text/plain' } });
    const evento = await canal.proximo();
    expect(evento.truncated).toBe(true);
    const gravada = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(Number.isInteger(gravada.seq), `seq gravado: ${JSON.stringify(gravada.seq)}`).toBe(true);
    expect(evento.request.seq).toBe(gravada.seq);
  });
});
