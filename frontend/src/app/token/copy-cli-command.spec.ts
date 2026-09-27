import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { injectCopyCliCommand } from './copy-cli-command';

describe('Dado o "Copy CLI command"', () => {
  afterEach(() => localStorage.clear());

  it('deve copiar o `anzol listen` da URL aberta e dizer que copiou', () => {
    TestBed.inject(Preferences).token.set(token());
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);

    const copied = TestBed.runInInjectionContext(injectCopyCliCommand)();

    expect(copy).toHaveBeenCalledWith(
      `anzol listen --server ${location.origin} --forward http://localhost:3000 --token ${TOKEN_ID}`,
    );
    expect(copied).toBe(true);
  });

  it('não deve copiar nada Quando não há URL aberta', () => {
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy');

    expect(TestBed.runInInjectionContext(injectCopyCliCommand)()).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });
});
