import { token, webhookRequest } from '../../testing/fixtures';
import { convertRequest, toCurl, toHar } from './copy-as';

describe('Dado uma mensagem copiada como curl', () => {
  it('deve montar método, URL, headers e corpo no formato do app atual Quando o corpo é JSON', () => {
    const request = webhookRequest(1, {
      method: 'PUT',
      url: 'http://h/x?a=1',
      headers: { 'content-type': ['application/json'], accept: ['a', 'b'] },
      content: '{"a":1}',
    });

    expect(toCurl(request)).toBe(
      `curl -X 'PUT' 'http://h/x?a=1' -H 'content-type: application/json' -H 'accept: a,b' -d $'{"a":1}'`,
    );
  });

  it("deve escapar aspas simples e barras invertidas Quando o corpo tem ' e \\", () => {
    const request = webhookRequest(1, { headers: {}, content: "it's \\n" });

    expect(toCurl(request)).toBe(`curl -X 'POST' '${request.url}' -d $'it\\'s \\\\n'`);
  });

  it.each([
    ['nulo', null],
    ['vazio', ''],
  ])('não deve incluir -d Quando o corpo é %s', (_caso, content) => {
    expect(toCurl(webhookRequest(1, { headers: {}, content }))).toBe(
      `curl -X 'POST' 'http://localhost:8084/${webhookRequest(1).token_id}'`,
    );
  });
});

describe('Dado uma mensagem copiada como HAR', () => {
  it('deve levar a mensagem e a resposta configurada na URL Quando a URL tem resposta própria', () => {
    const har = JSON.parse(
      toHar(webhookRequest(1), token({ default_status: 404, default_content: 'nope' })),
    );

    expect(har.log.entries[0].request).toEqual({
      method: 'POST',
      url: webhookRequest(1).url,
      headers: [{ name: 'content-type', value: 'application/json' }],
      bodySize: 7,
      postData: { mimeType: 'application/json', text: '{"n":1}' },
    });
    expect(har.log.entries[0].response.status).toBe(404);
    expect(har.log.entries[0].response.content).toEqual({
      size: 4,
      text: 'nope',
      mimeType: 'text/plain',
    });
  });

  it.each([
    ['com content-type', { 'content-type': ['text/xml'] }, 'text/xml'],
    ['sem content-type', {}, 'application/json'],
    ['com content-type vazio', { 'content-type': [''] }, 'application/json'],
  ])('deve usar o mimeType certo Quando a mensagem vem %s', (_caso, headers, esperado) => {
    const har = JSON.parse(toHar(webhookRequest(1, { headers }), token()));

    expect(har.log.entries[0].request.postData.mimeType).toBe(esperado);
  });

  it('deve escolher o conversor pelo formato Quando convertRequest recebe HAR', () => {
    expect(convertRequest(webhookRequest(1), 'HAR', token())).toBe(
      toHar(webhookRequest(1), token()),
    );
  });
});
