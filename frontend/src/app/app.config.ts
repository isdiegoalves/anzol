import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash: `/{uuid}` é a URL que recebe webhooks e não pode ser rota da SPA.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    provideHttpClient(),
    // Avisos como o bootstrap-notify do app atual: embaixo, por 1 s.
    { provide: MAT_SNACK_BAR_DEFAULT_OPTIONS, useValue: { duration: 1000 } },
  ],
};
