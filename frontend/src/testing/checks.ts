import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, Type, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RenderComponentOptions, render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { NgComponentOutlet } from '@angular/common';
import { ChangesBar } from '../app/checks/changes-bar';
import { ChecksDraft } from '../app/checks/checks-draft';
import { Preferences } from '../app/settings/preferences';
import { Token } from '../app/token/token';
import { TOKEN_ID } from './fixtures';

/** O `render` monta o `CardHost` sem entradas: o cartão chega por aqui. */
let card: { component: Type<unknown>; inputs: Record<string, unknown> } | null = null;

@Component({
  imports: [ChangesBar, NgComponentOutlet],
  template: `
    <ng-container [ngComponentOutlet]="shown.component" [ngComponentOutletInputs]="shown.inputs" />
    <app-changes-bar />
  `,
})
class CardHost {
  protected readonly shown = card!;

  constructor() {
    inject(ChecksDraft).start(inject(Preferences).token()!);
  }
}

/** Um cartão de Checks com a URL já carregada, a barra de salvar e a API falsa. */
export async function renderCard<T>(
  component: Type<T>,
  url: Token,
  options: RenderComponentOptions<T> = {},
) {
  card = { component, inputs: (options.inputs ?? {}) as Record<string, unknown> };
  const result = await render(CardHost, {
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

export const changesBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

export const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

export const saveChanges = () => userEvent.click(saveButton());

export const discardChanges = () =>
  userEvent.click(screen.getByRole('button', { name: 'Discard' }));

export const attention = () => screen.getByRole('alert').textContent?.trim();

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
