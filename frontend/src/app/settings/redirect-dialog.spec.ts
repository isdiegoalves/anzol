import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { Preferences } from './preferences';
import { RedirectDialog } from './redirect-dialog';

describe('Dado o diálogo "Redirection Settings"', () => {
  afterEach(() => localStorage.clear());

  it('deve gravar URL, headers e método no localStorage Quando os campos mudam', async () => {
    const fixture = TestBed.createComponent(RedirectDialog);
    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await fixture.whenStable();

    await (
      await loader.getHarness(MatInputHarness.with({ placeholder: 'http://localhost' }))
    ).setValue('http://destino');
    await (
      await loader.getHarness(MatInputHarness.with({ placeholder: 'e.g. x-token,referer' }))
    ).setValue('x-token');
    const method = await loader.getHarness(MatSelectHarness);
    await method.open();
    await method.clickOptions({ text: 'PUT' });

    const preferences = TestBed.inject(Preferences);
    expect(preferences.redirectUrl()).toBe('http://destino');
    expect(preferences.redirectHeaders()).toBe('x-token');
    expect(preferences.redirectMethod()).toBe('PUT');
    expect(localStorage.getItem('redirectMethod')).toBe('"PUT"');
  });

  it('deve abrir com o que o app atual gravou Quando há preferências salvas', async () => {
    localStorage.setItem('redirectUrl', '"http://antigo"');
    localStorage.setItem('redirectContentType', '"application/json"');
    const fixture = TestBed.createComponent(RedirectDialog);
    const loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();

    const inputs = await loader.getAllHarnesses(MatInputHarness);

    expect(await Promise.all(inputs.map((input) => input.getValue()))).toEqual([
      'http://antigo',
      'application/json',
      '',
    ]);
  });
});
