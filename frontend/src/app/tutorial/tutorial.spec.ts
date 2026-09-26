import { Clipboard } from '@angular/cdk/clipboard';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { Preferences } from '../settings/preferences';
import { Tutorial } from './tutorial';

describe('Dado o tutorial com a URL do webhook', () => {
  const URL = 'http://localhost:4200/3dbd68f4-8890-4f56-affb-c7c9b297e666';

  const render = async () => {
    const fixture = TestBed.createComponent(Tutorial);
    fixture.componentRef.setInput('url', URL);
    await fixture.whenStable();
    return { fixture, loader: TestbedHarnessEnvironment.loader(fixture) };
  };

  afterEach(() => localStorage.clear());

  it('deve alternar hideTutorial Quando o × é clicado', async () => {
    const { fixture } = await render();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.close')
      ?.click();

    expect(TestBed.inject(Preferences).hideTutorial()).toBe(true);
  });

  it('deve copiar a URL Quando "Copy to clipboard" é clicado', async () => {
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const { loader } = await render();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Copy to clipboard' }))).click();

    expect(copy).toHaveBeenCalledWith(URL);
  });
});
