import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID } from '../../testing/fixtures';
import { RuleStatusStore } from './rule-status-store';

describe('Dado o status das regras que responderam (INBOX-13/18)', () => {
  let http: HttpTestingController;
  let store: RuleStatusStore;
  const url = `/token/${TOKEN_ID}/rules`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(RuleStatusStore);
  });

  afterEach(() => http.verify());

  it('deve ler as regras da URL uma vez e dar o status de cada uma (200 sem status)', async () => {
    const ensured = store.ensure(TOKEN_ID, ['r1', 'r2']);
    http.expectOne(url).flush([
      { id: 'r1', name: 'Pix', response: { status: 201 } },
      { id: 'r2', name: 'Padrão', response: {} },
    ]);
    await ensured;

    expect(store.statusOf('r1')).toBe(201);
    expect(store.statusOf('r2')).toBe(200);
    await store.ensure(TOKEN_ID, ['r1']);
    http.expectNone(url);
  });

  it('não deve pedir nada Quando nenhuma mensagem foi respondida por regra', async () => {
    await store.ensure(TOKEN_ID, []);

    http.expectNone(url);
  });

  it('não deve pedir de novo a regra que não existe mais, e deve pedir a que é nova', async () => {
    const first = store.ensure(TOKEN_ID, ['apagada']);
    http.expectOne(url).flush([]);
    await first;

    await store.ensure(TOKEN_ID, ['apagada']);
    http.expectNone(url);
    expect(store.statusOf('apagada')).toBeUndefined();

    const again = store.ensure(TOKEN_ID, ['nova']);
    http.expectOne(url).flush([{ id: 'nova', name: 'Nova', response: { status: 202 } }]);
    await again;
    expect(store.statusOf('nova')).toBe(202);
  });
});
