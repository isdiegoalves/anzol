import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyLegacyHash } from './app/legacy-hash';
import { readSetting } from './app/settings/preferences';
import { LANGUAGE_KEY, languageOf, loadLocale } from './locale/locale';

applyLegacyHash(window.location, window.history);

// A tradução entra antes do bootstrap; se o chunk dela falhar, a tela abre em inglês.
loadLocale(languageOf(readSetting(LANGUAGE_KEY, null), navigator.languages))
  .catch((err) => console.error(err))
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
