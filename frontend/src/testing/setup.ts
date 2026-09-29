import { clearTranslations } from '@angular/localize';

// Cada teste começa sem o que outro deixou no jsdom: preferências e rascunhos guardados no
// navegador, a tradução carregada e o idioma do documento.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearTranslations();
  document.documentElement.lang = '';
});
