import { TestBed } from '@angular/core/testing';
import { token } from '../../testing/fixtures';
import { Preferences, readSetting } from './preferences';

/** localStorage exatamente como o app atual (AngularJS) grava. */
const GRAVADO_PELO_APP_ATUAL = {
  token: JSON.stringify(token()),
  redirectEnable: 'true',
  redirectUrl: '"http://destino"',
  redirectContentType: '"application/json"',
  redirectHeaders: '"x-token,referer"',
  redirectMethod: '"POST"',
  formatJsonEnable: 'true',
  autoNavEnable: 'true',
  hideTutorial: 'true',
  unread: '["a","b"]',
};

describe('Dado o localStorage preenchido pelo app atual', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(GRAVADO_PELO_APP_ATUAL)) {
      localStorage.setItem(key, value);
    }
  });

  afterEach(() => localStorage.clear());

  it('deve abrir com as mesmas preferências Quando o app novo inicia', () => {
    const preferences = TestBed.inject(Preferences);

    expect(preferences.token()).toEqual(token());
    expect(preferences.redirectEnable()).toBe(true);
    expect(preferences.redirectUrl()).toBe('http://destino');
    expect(preferences.redirectContentType()).toBe('application/json');
    expect(preferences.redirectHeaders()).toBe('x-token,referer');
    expect(preferences.redirectMethod()).toBe('POST');
    expect(preferences.formatJsonEnable()).toBe(true);
    expect(preferences.autoNavEnable()).toBe(true);
    expect(preferences.hideTutorial()).toBe(true);
    expect(preferences.unread()).toEqual(['a', 'b']);
  });

  it('deve gravar de volta nas mesmas chaves e em JSON Quando as preferências mudam', () => {
    const preferences = TestBed.inject(Preferences);

    preferences.formatJsonEnable.set(false);
    preferences.redirectMethod.set('');
    preferences.unread.set([]);

    expect({ ...localStorage }).toEqual({
      ...GRAVADO_PELO_APP_ATUAL,
      formatJsonEnable: 'false',
      redirectMethod: '""',
      unread: '[]',
    });
  });
});

describe('Dado o localStorage vazio (primeiro acesso)', () => {
  afterEach(() => localStorage.clear());

  it('deve usar os padrões do app atual Quando nenhuma chave existe', () => {
    const preferences = TestBed.inject(Preferences);

    expect(preferences.token()).toBeNull();
    expect(preferences.redirectContentType()).toBe('text/plain');
    expect(preferences.redirectMethod()).toBe('');
    expect(preferences.redirectUrl()).toBeNull();
    expect(preferences.unread()).toEqual([]);
  });
});

describe('Dado a leitura de uma chave', () => {
  afterEach(() => localStorage.clear());

  it.each([
    ['ausente', null, 'padrão'],
    ['vazia', '', 'padrão'],
    ['com "undefined"', 'undefined', 'padrão'],
    ['malformada', '{x', 'padrão'],
    ['com "null"', 'null', null],
    ['com JSON', '"valor"', 'valor'],
  ])(
    'deve devolver o valor do getSetting antigo Quando a chave está %s',
    (_caso, gravado, esperado) => {
      if (gravado !== null) {
        localStorage.setItem('chave', gravado);
      }

      expect(readSetting('chave', 'padrão')).toBe(esperado);
    },
  );
});
