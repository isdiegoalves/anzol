import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { TOKEN_ID, requestPage, webhookRequest } from '../../testing/fixtures';
import { RequestStore } from '../requests/request-store';
import { RequestSearch } from './request-search';

const searchUrl = `/token/${TOKEN_ID}/requests/search`;

describe('Dado a busca e os filtros rápidos da lista', () => {
  let fixture: ComponentFixture<RequestSearch>;
  let loader: HarnessLoader;
  let http: HttpTestingController;
  let store: RequestStore;

  const element = () => fixture.nativeElement as HTMLElement;
  const searches = () => http.match({ method: 'POST', url: searchUrl });
  const select = (label: string) => loader.getHarness(MatSelectHarness.with({ label }));
  const clearButton = () => loader.getHarness(MatButtonHarness.with({ text: 'Clear filters' }));

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [RequestSearch],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RequestStore);
    const loaded = store.load(TOKEN_ID);
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2), webhookRequest(3)]));
    await loaded;
    fixture = TestBed.createComponent(RequestSearch);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('deve buscar uma vez só, depois da pausa na digitação Quando o texto é digitado', async () => {
    const input = await loader.getHarness(MatInputHarness);

    await input.setValue('ped');
    await input.setValue('pedido');
    expect(searches()).toHaveLength(0);

    const [call] = await vi.waitFor(() => {
      const pending = searches();
      expect(pending).toHaveLength(1);
      return pending;
    });
    expect(call.request.body).toMatchObject({ text: 'pedido', match: {} });
    call.flush(requestPage([webhookRequest(2)], { total: 1 }));

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(element().querySelector('.count')?.textContent?.trim()).toBe('1 of 3 requests');
    });
  });

  it('deve buscar na hora com o match das regras Quando método, assinatura e schema são escolhidos', async () => {
    const method = await select('Method');
    await method.open();
    await method.clickOptions({ text: 'POST' });
    searches()[0].flush(requestPage([], { total: 0 }));
    await method.close();

    await (await select('Signature')).clickOptions({ text: 'Invalid' });
    searches()[0].flush(requestPage([], { total: 0 }));
    await (await select('Schema')).clickOptions({ text: 'Valid' });
    const [last] = searches();

    expect(last.request.body).toMatchObject({
      match: { method: ['POST'], signature: 'invalid', schema: 'valid' },
    });
    last.flush(requestPage([], { total: 0 }));
    await fixture.whenStable();
    expect(element().querySelector('.count')?.textContent?.trim()).toBe('0 of 3 requests');
  });

  it('deve oferecer em Signature e Schema as opções Any, Valid e Invalid', async () => {
    for (const label of ['Signature', 'Schema']) {
      const field = await select(label);
      await field.open();
      const options = await field.getOptions();
      expect(await Promise.all(options.map((option) => option.getText()))).toEqual([
        'Any',
        'Valid',
        'Invalid',
      ]);
      await field.close();
    }
  });

  it('deve voltar à lista completa, zerar os campos e sumir com o contador Quando "Clear filters" é clicado', async () => {
    expect(await (await clearButton()).isDisabled()).toBe(true);
    await (await select('Schema')).clickOptions({ text: 'Invalid' });
    searches()[0].flush(requestPage([], { total: 0 }));
    const input = await loader.getHarness(MatInputHarness);
    await input.setValue('abc');

    await (await clearButton()).click();
    http
      .expectOne(`/token/${TOKEN_ID}/requests?page=1`)
      .flush(requestPage([webhookRequest(1), webhookRequest(2), webhookRequest(3)]));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(searches()).toHaveLength(0);
    expect(store.filtering()).toBe(false);
    expect(store.requests()).toHaveLength(3);
    expect(await input.getValue()).toBe('');
    expect(await (await select('Schema')).getValueText()).toBe('Any');
    expect(element().querySelector('.count')).toBeNull();
  });
});
