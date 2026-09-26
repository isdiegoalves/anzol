import { REPLAY_TARGETS_KEY, rememberTarget, rememberedTarget } from './replay-target';

const OUTRA = '11111111-2222-4333-8444-555555555555';
const ESTA = '3dbd68f4-8890-4f56-affb-c7c9b297e666';

describe('Dado o destino de replay lembrado por URL de webhook', () => {
  afterEach(() => localStorage.clear());

  it('deve voltar vazio Quando a URL nunca fez replay', () => {
    expect(rememberedTarget(ESTA)).toBe('');
  });

  it('deve devolver o último destino desta URL, sem trocar o da outra, Quando cada uma lembra o seu', () => {
    rememberTarget(OUTRA, 'http://outra:1/');
    rememberTarget(ESTA, 'http://localhost:3000/a');
    rememberTarget(ESTA, 'http://localhost:3000/b');

    expect(rememberedTarget(ESTA)).toBe('http://localhost:3000/b');
    expect(rememberedTarget(OUTRA)).toBe('http://outra:1/');
    expect(JSON.parse(localStorage.getItem(REPLAY_TARGETS_KEY) ?? '')).toEqual({
      [OUTRA]: 'http://outra:1/',
      [ESTA]: 'http://localhost:3000/b',
    });
  });

  it('deve voltar vazio Quando o valor gravado não é JSON', () => {
    localStorage.setItem(REPLAY_TARGETS_KEY, '{quebrado');

    expect(rememberedTarget(ESTA)).toBe('');
  });
});
