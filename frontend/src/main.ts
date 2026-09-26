import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyLegacyHash } from './app/legacy-hash';

applyLegacyHash(window.location, window.history);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
