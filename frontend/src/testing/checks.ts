import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RenderComponentOptions, render } from '@testing-library/angular';
import { Preferences } from '../app/settings/preferences';
import { Token } from '../app/token/token';
import { TOKEN_ID } from './fixtures';

/** Um cartão de Checks com a URL já carregada e a API falsa (`HttpTestingController`). */
export async function renderCard<T>(
  component: Type<T>,
  url: Token,
  options: RenderComponentOptions<T> = {},
) {
  const result = await render(component, {
    ...options,
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      ...(options.providers ?? []),
    ],
    configureTestBed: (testBed) => testBed.inject(Preferences).token.set(url),
  });
  return { ...result, http: TestBed.inject(HttpTestingController) };
}

/** A releitura `GET /token/{id}` que o Save faz antes do `PUT`. */
export function expectGet(http: HttpTestingController): Promise<TestRequest> {
  return vi.waitFor(() =>
    http.expectOne((sent) => sent.method === 'GET' && sent.url === `/token/${TOKEN_ID}`),
  );
}

/**
 * O `PUT /token/{id}` que o Save mandou. A releitura de antes do `PUT` responde a URL como a tela a
 * tem (nada mudou em outro lugar).
 */
export function expectPut(http: HttpTestingController): Promise<TestRequest> {
  return vi.waitFor(() => {
    for (const read of http.match(
      (sent) => sent.method === 'GET' && sent.url === `/token/${TOKEN_ID}`,
    )) {
      read.flush(TestBed.inject(Preferences).token());
    }
    return http.expectOne((sent) => sent.method === 'PUT' && sent.url === `/token/${TOKEN_ID}`);
  });
}
