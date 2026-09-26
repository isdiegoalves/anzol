import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { Scenario, ScenarioStore } from './scenario-store';

describe('Dado os cenários da URL aberta', () => {
  let http: HttpTestingController;
  let store: ScenarioStore;
  const url = `/token/${TOKEN_ID}/scenarios`;
  const retry: Scenario = { name: 'Retry', state: 'Started', states: ['Started', 'falhou-1'] };

  const loaded = async (scenarios: Scenario[] = [retry]) => {
    const done = store.load(TOKEN_ID);
    http.expectOne({ method: 'GET', url }).flush(scenarios);
    await done;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ScenarioStore);
  });

  afterEach(() => http.verify());

  it('deve guardar a lista do GET com o estado de cada cenário Quando carrega', async () => {
    await loaded();

    expect(store.scenarios()).toEqual([retry]);
  });

  it('deve enviar o estado no PUT do cenário, com o nome codificado, e reler a lista Quando define o estado', async () => {
    await loaded([{ ...retry, name: 'Retry 1/2' }]);

    const done = store.setState('Retry 1/2', 'falhou-1');
    const put = http.expectOne({ method: 'PUT', url: `${url}/Retry%201%2F2` });
    expect(put.request.body).toEqual({ state: 'falhou-1' });
    put.flush(null);
    await vi.waitFor(() => http.expectOne({ method: 'GET', url }).flush([retry]));
    await done;

    expect(store.scenarios()).toEqual([retry]);
  });

  it('deve apagar todos e reler a lista Quando reseta', async () => {
    await loaded([{ ...retry, state: 'falhou-1' }]);

    const done = store.resetAll();
    http.expectOne({ method: 'DELETE', url }).flush(null);
    await vi.waitFor(() => http.expectOne({ method: 'GET', url }).flush([retry]));
    await done;

    expect(store.scenarios()).toEqual([retry]);
  });

  it('deve repassar o erro e manter a lista Quando o PUT falha', async () => {
    await loaded();

    const done = store.setState('Retry', 'x');
    http
      .expectOne({ method: 'PUT', url: `${url}/Retry` })
      .flush({ state: ['The state is invalid.'] }, { status: 422, statusText: 'Unprocessable' });

    await expect(done).rejects.toMatchObject({ status: 422 });
    expect(store.scenarios()).toEqual([retry]);
  });

  it('deve recusar sem chamar a API Quando nenhuma URL foi carregada', async () => {
    await expect(store.resetAll()).rejects.toThrow('No URL loaded');
  });
});
