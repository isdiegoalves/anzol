import { clearTranslations } from '@angular/localize';
import { getTestBed } from '@angular/core/testing';
import { onTestFinished } from 'vitest';

// Cada teste começa sem o que outro deixou no jsdom: preferências e rascunhos guardados no
// navegador, a tradução carregada e o idioma do documento.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearTranslations();
  document.documentElement.lang = '';
  // O afterEach do Angular que reinicia o TestBed não roda quando um afterEach do arquivo lança (o
  // `http.verify` que acha um pedido aberto): sem isto, cada teste seguinte cai em "already instantiated".
  onTestFinished(() => {
    getTestBed().resetTestingModule();
  });
});
