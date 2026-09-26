import { applyLegacyHash, normalizeLegacyHash } from './legacy-hash';

const TOKEN = '3dbd68f4-8890-4f56-affb-c7c9b297e666';
const REQUEST = '0691864a-71ef-4de5-953b-518660fe6287';

describe('Dado um link do app antigo com prefixo #!', () => {
  it.each([
    ['token', `#!/${TOKEN}`, `#/${TOKEN}`],
    ['mensagem com página', `#!/${TOKEN}/${REQUEST}/1`, `#/${TOKEN}/${REQUEST}/1`],
    ['raiz', '#!/', '#/'],
    ['sem barra depois do !', `#!${TOKEN}`, `#/${TOKEN}`],
  ])('deve trocar #! por #/ Quando o hash é de %s', (_caso, hash, esperado) => {
    expect(normalizeLegacyHash(hash)).toBe(esperado);
  });

  it.each([
    ['vazio', ''],
    ['já no formato novo', `#/${TOKEN}`],
    ['só #', '#'],
  ])('não deve reescrever Quando o hash é %s', (_caso, hash) => {
    expect(normalizeLegacyHash(hash)).toBeNull();
  });
});

describe('Dado a barra de endereço antes do bootstrap', () => {
  it('deve substituir a entrada do histórico mantendo caminho e query Quando o hash tem #!', () => {
    const history = { state: { id: 1 }, replaceState: vi.fn() } as unknown as History;
    const location = {
      hash: `#!/${TOKEN}/${REQUEST}/2`,
      pathname: '/',
      search: '?x=1',
    } as Location;

    applyLegacyHash(location, history);

    expect(history.replaceState).toHaveBeenCalledWith(
      { id: 1 },
      '',
      `/?x=1#/${TOKEN}/${REQUEST}/2`,
    );
  });

  it('não deve tocar no histórico Quando o hash já é #/', () => {
    const history = { state: null, replaceState: vi.fn() } as unknown as History;
    const location = { hash: `#/${TOKEN}`, pathname: '/', search: '' } as Location;

    applyLegacyHash(location, history);

    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
