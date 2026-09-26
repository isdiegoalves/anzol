import { Clipboard } from '@angular/cdk/clipboard';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TOKEN_ID, token, webhookRequest } from '../../testing/fixtures';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { RequestDetail } from './request-detail';

describe('Dado o detalhe de uma mensagem', () => {
  let fixture: ComponentFixture<RequestDetail>;
  let loader: HarnessLoader;

  const render = async (request: WebhookRequest) => {
    fixture = TestBed.createComponent(RequestDetail);
    fixture.componentRef.setInput('request', request);
    fixture.componentRef.setInput('token', token());
    fixture.componentRef.setInput('page', 2);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const rows = (element: HTMLElement, table: string) =>
    [...element.querySelectorAll(`table[aria-label="${table}"] tbody tr`)].map((row) =>
      [...row.querySelectorAll('td')]
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    );

  afterEach(() => localStorage.clear());

  it('deve mostrar URL, host, ID, headers e o permalink com a página Quando a mensagem é aberta', async () => {
    const request = webhookRequest(1, { headers: { accept: ['a', ''], host: ['h'] } });
    const element = await render(request);

    expect(rows(element, 'Request Details')).toContain(`ID ${request.uuid}`);
    expect(rows(element, 'Headers')).toEqual(['accept a, (empty)', 'host h']);
    expect(element.querySelector<HTMLAnchorElement>('a[href*="/#/"]')?.href).toBe(
      `${location.origin}/#/${TOKEN_ID}/${request.uuid}/2`,
    );
  });

  it('deve listar query e formulário com (empty) para valor vazio Quando a mensagem tem os dois', async () => {
    const element = await render(
      webhookRequest(1, { query: { x: '1', y: '', arr: ['a'] }, request: { f1: 'v1', f2: '' } }),
    );

    expect(rows(element, 'Query strings')).toEqual(['x 1', 'y (empty)', 'arr ["a"]']);
    expect(rows(element, 'Form values')).toEqual(['f1 v1', 'f2 (empty)']);
  });

  it.each([
    ['nulos', null, undefined],
    ['vazios', {}, {}],
  ])('deve mostrar (empty) Quando query e formulário são %s', async (_caso, query, form) => {
    const element = await render(webhookRequest(1, { query, request: form }));

    expect(rows(element, 'Query strings')).toEqual(['(empty)']);
    expect(rows(element, 'Form values')).toEqual(['(empty)']);
  });

  it('deve mostrar "(no body content)" Quando o corpo é vazio', async () => {
    const element = await render(webhookRequest(1, { content: '' }));

    expect(element.querySelector('.no-content')?.textContent).toBe('(no body content)');
    expect(element.querySelector('pre')).toBeNull();
  });

  it('deve formatar o JSON Quando "Format JSON/XML" está ligado', async () => {
    TestBed.inject(Preferences).formatJsonEnable.set(true);
    const element = await render(webhookRequest(1, { content: '{"a":1}' }));

    expect(element.querySelector('pre')?.textContent).toBe('{\n  "a": 1\n}');
  });

  it('deve mostrar o corpo cru Quando "Format JSON/XML" está desligado', async () => {
    const element = await render(webhookRequest(1, { content: '{"a":1}' }));

    expect(element.querySelector('pre')?.textContent).toBe('{"a":1}');
  });

  it('deve esconder as tabelas e manter o corpo Quando "Hide Details" está ligado', async () => {
    TestBed.inject(Preferences).hideDetails.set(true);
    const element = await render(webhookRequest(1));

    expect(element.querySelectorAll('table')).toHaveLength(0);
    expect(element.querySelector('pre')?.textContent).toBe('{"n":1}');
  });

  it('deve copiar o curl e avisar Quando "Copy As > curl" é escolhido', async () => {
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const open = vi.spyOn(TestBed.inject(MatSnackBar), 'open');
    const request = webhookRequest(1, { headers: {}, content: null });
    await render(request);

    const menu = await loader.getHarness(MatMenuHarness);
    await menu.clickItem({ text: 'curl' });

    expect(copy).toHaveBeenCalledWith(`curl -X 'POST' '${request.url}'`);
    expect(open).toHaveBeenCalledWith('Copied request as curl');
  });
});
