import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatSlideToggleHarness } from '@angular/material/slide-toggle/testing';
import { OptionsBar } from './options-bar';
import { Preferences } from './preferences';

describe('Dado a barra de opções acima do detalhe', () => {
  afterEach(() => localStorage.clear());

  it.each([
    ['Format JSON/XML', 'formatJsonEnable'],
    ['Hide Details', 'hideDetails'],
  ] as const)('deve ligar a preferência Quando "%s" é ligado', async (label, chave) => {
    const fixture = TestBed.createComponent(OptionsBar);
    const loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();

    await (await loader.getHarness(MatSlideToggleHarness.with({ label }))).toggle();

    expect(TestBed.inject(Preferences)[chave]()).toBe(true);
  });
});
