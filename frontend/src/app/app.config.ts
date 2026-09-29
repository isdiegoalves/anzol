import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { connectionInterceptor } from './realtime/connection-store';
import { urlLockInterceptor } from './token/url-lock';
import { urlMissingInterceptor } from './token/url-missing';

// Sem `MAT_SNACK_BAR_DEFAULT_OPTIONS` aqui: importar o token traria o snackbar e o `Overlay` para o
// pacote inicial (docs/padroes-angular.md §7). Cada `open()` diz a própria duração.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash: `/{uuid}` é a URL que recebe webhooks e não pode ser rota da SPA.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    // 401 de URL protegida em qualquer chamada troca a tela pela de desbloqueio.
    provideHttpClient(
      withInterceptors([connectionInterceptor, urlLockInterceptor, urlMissingInterceptor]),
    ),
  ],
};
