import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import {
  attention,
  changesBar,
  expectGet,
  expectPut,
  renderCard,
  saveButton,
} from '../../testing/checks';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { Preferences } from '../settings/preferences';
import { ResponseCard } from './response-card';

const SALVA = token({
  default_status: 202,
  default_content_type: 'application/json',
  timeout: 2,
  default_content: 'antes',
  retry_after: 30,
  auto_cleanup: 500,
  signature: { provider: 'github', secret: '••••1234' },
  schema: { type: 'object' },
});

const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const save = saveButton;
const card = () => screen.getByRole('region', { name: 'Response' });

describe('Dado o cartão "Response" de Checks', () => {
  afterEach(() => localStorage.clear());

  it('deve vir com a resposta salva e a limpeza marcada, e passar no axe', async () => {
    const { container } = await renderCard(ResponseCard, SALVA);

    expect(box('Default status code').value).toBe('202');
    expect(box('Content Type').value).toBe('application/json');
    expect(box('Response body').value).toBe('antes');
    expect(box('Retry-After').value).toBe('30');
    expect(
      (screen.getByRole('slider', { name: 'Timeout before response' }) as HTMLInputElement).value,
    ).toBe('2');
    const cleanup = screen.getByRole('radiogroup', { name: 'Auto cleanup' });
    expect(
      within(cleanup)
        .getAllByRole('radio')
        .map((r) => r.textContent?.trim()),
    ).toEqual(['Disabled', '500', '1000', '5000', '10000']);
    expect(within(cleanup).getByRole('radio', { name: '500' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByText(/^Keeps the 500 most recent requests/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('deve mandar a resposta com a assinatura e o schema salvos Quando "Save changes" é clicado', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    expect(changesBar()).toBeNull();

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '201');
    await userEvent.clear(box('Retry-After'));
    await userEvent.click(screen.getByRole('radio', { name: 'Disabled' }));
    expect(within(card()).getByText('Unsaved')).toBeTruthy();
    expect(changesBar()?.textContent).toContain(
      '3 unsaved changes: Default status code, Retry-After, Auto cleanup',
    );
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body).toEqual({
      default_status: '201',
      default_content_type: 'application/json',
      timeout: '2',
      default_content: 'antes',
      retry_after: null,
      auto_cleanup: null,
      signature: { provider: 'github', secret: '••••1234' },
      schema: { type: 'object' },
      e2ee: null,
    });
    put.flush({ ...SALVA, default_status: 201, retry_after: null, auto_cleanup: null });

    await vi.waitFor(() => expect(changesBar()).toBeNull());
    expect(within(card()).queryByText('Unsaved')).toBeNull();
    expect(box('Default status code').value).toBe('201');
  });

  it('deve mostrar o valor antigo e o novo de cada campo Quando "Review changes"', async () => {
    await renderCard(ResponseCard, SALVA);
    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '429');
    await userEvent.click(screen.getByRole('switch', { name: 'Enable CORS' }));

    const review = screen.getByRole('button', { name: 'Review changes' });
    expect(review.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(review);

    expect(review.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Changes to save' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Default status code: 202 → 429', 'CORS: off → on']);
  });

  it('deve voltar ao salvo e sumir com a barra Quando o valor volta ao que era', async () => {
    await renderCard(ResponseCard, SALVA);

    await userEvent.type(box('Response body'), '!');
    expect(changesBar()).not.toBeNull();
    await userEvent.type(box('Response body'), '{Backspace}');

    expect(changesBar()).toBeNull();
    expect(within(card()).queryByText('Unsaved')).toBeNull();
  });

  it.each([
    ['o Retry-After', 'textbox', 'Retry-After', 'amanhã', '1 field needs attention: Retry-After'],
  ] as const)(
    'deve dizer o que corrigir e focar o campo Quando %s é inválido',
    async (_c, role, name, valor, resumo) => {
      const { http } = await renderCard(ResponseCard, SALVA);
      const input = screen.getByRole(role, { name });

      await userEvent.clear(input);
      await userEvent.type(input, valor);
      expect(card().querySelector('app-card-foot .note')?.textContent?.trim()).toBe(
        'To save, fix: Retry-After',
      );
      await userEvent.click(save());

      expect(attention()).toBe(resumo);
      expect(document.activeElement).toBe(input);
      http.expectNone((sent) => sent.method === 'PUT');
    },
  );

  it('deve avisar que a URL mudou em outro lugar, sem sobrescrever, e recarregar pelo Reload', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '201');
    await userEvent.click(save());
    (await expectGet(http)).flush({ ...SALVA, default_status: 404 });

    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toContain(
      'This URL was changed elsewhere since you opened this page.',
    );
    expect(changesBar()?.contains(aviso)).toBe(true);
    http.expectNone((sent) => sent.method === 'PUT');
    expect(within(aviso).getByRole('button', { name: 'Save anyway' })).toBeTruthy();
    await userEvent.click(within(aviso).getByRole('button', { name: 'Reload' }));
    (await expectGet(http)).flush({ ...SALVA, default_status: 404 });
    await vi.waitFor(() => expect(box('Default status code').value).toBe('404'));
    expect(changesBar()).toBeNull();
  });

  it('deve gravar só o que mudou aqui por cima do que a outra aba gravou Quando "Save anyway"', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    const fora = { ...SALVA, default_content: 'mudou em outra aba' };

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '429');
    await userEvent.click(save());
    (await expectGet(http)).flush(fora);
    await userEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
    (await expectGet(http)).flush(fora);

    const put = await vi.waitFor(() => http.expectOne((sent) => sent.method === 'PUT'));
    expect(put.request.body).toMatchObject({
      default_status: '429',
      default_content: 'mudou em outra aba',
    });
    put.flush({ ...fora, default_status: 429 });
    await vi.waitFor(() => expect(changesBar()).toBeNull());
    expect(box('Response body').value).toBe('mudou em outra aba');
  });

  it('deve oferecer "Try again", manter o digitado e salvar de novo Quando a rede falha no Save', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    await userEvent.clear(box('Response body'));
    await userEvent.type(box('Response body'), 'depois');
    await userEvent.click(save());

    (await expectPut(http)).error(new ProgressEvent('error'));

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(changesBar()?.textContent).toContain(
      'Could not save. The server did not answer. Your changes are still here.',
    );
    expect(box('Response body').value).toBe('depois');
    await userEvent.click(retry);
    const put = await expectPut(http);
    expect(put.request.body.default_content).toBe('depois');
    put.flush({ ...SALVA, default_content: 'depois' });
    await vi.waitFor(() => expect(changesBar()).toBeNull());
  });

  it('deve pôr a frase do servidor no campo e dizer qual, sem "Try again", Quando o Save é recusado (422)', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '999');
    await userEvent.click(save());

    (await expectPut(http)).flush(
      { default_status: ['bad'] },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    await vi.waitFor(() =>
      expect(attention()).toBe('1 field needs attention: Default status code'),
    );
    expect(within(card()).getByText('bad')).toBeTruthy();
    expect(document.activeElement).toBe(box('Default status code'));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('deve marcar a alteração, sem chamar o servidor, e trocar o CORS só no "Save changes"', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.click(screen.getByRole('switch', { name: 'Enable CORS' }));

    http.expectNone(`/token/${TOKEN_ID}/cors/toggle`);
    expect(changesBar()?.textContent).toContain('1 unsaved change: CORS');
    await userEvent.click(save());
    const put = await expectPut(http);
    expect(put.request.body).toMatchObject({
      default_status: '202',
      signature: { provider: 'github', secret: '••••1234' },
    });
    http.expectNone(`/token/${TOKEN_ID}/cors/toggle`);
    put.flush(SALVA);
    const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`));
    expect(call.request.method).toBe('PUT');
    call.flush({ enabled: true });

    await vi.waitFor(() => expect(TestBed.inject(Preferences).token()?.cors).toBe(true));
    expect(changesBar()).toBeNull();
  });

  it('CHECKS-20: deve dizer quantas regras ligadas respondem antes, com link para Rules', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    http.expectOne(`/token/${TOKEN_ID}/rules`).flush([
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: true },
      { id: 'c', name: 'C', enabled: false },
    ]);

    const link = await screen.findByRole('link', { name: '2 rules answer first' });
    expect(link.getAttribute('href')).toBe(`/${TOKEN_ID}/rules`);
    expect(screen.getByText(/^When no rule matches/)).toBeTruthy();
  });

  it('CHECKS-20: deve dizer "1 rule answers first" no singular', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    http.expectOne(`/token/${TOKEN_ID}/rules`).flush([{ id: 'a', name: 'A' }]);

    expect(await screen.findByRole('link', { name: '1 rule answers first' })).toBeTruthy();
  });

  it('CHECKS-21: deve ter o atraso como slider de 0 a 10 s, com passo 1 e "N seconds" para o leitor de tela', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    const slider = screen.getByRole('slider', {
      name: 'Timeout before response',
    }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(['0', '10', '1']);
    expect(slider.getAttribute('aria-valuetext')).toBe('2 seconds');
    expect(screen.getByText('2 s')).toBeTruthy();

    slider.value = '5';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(slider.getAttribute('aria-valuetext')).toBe('5 seconds'));
    await userEvent.click(save());

    const put = await expectPut(http);
    expect(put.request.body.timeout).toBe('5');
    put.flush({ ...SALVA, timeout: 5 });
  });

  it('CHECKS-21: deve pôr o CORS numa linha com a explicação e o switch "Enable CORS"', async () => {
    const { container } = await renderCard(ResponseCard, SALVA);

    const row = container.querySelector('.cors-row') as HTMLElement;
    expect(row.textContent).toContain('Lets a browser page call this URL.');
    expect(row.textContent).not.toContain('Applies right away');
    expect(within(row).getByRole('switch', { name: 'Enable CORS' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Response body' }).getAttribute('rows')).toBe('2');
  });

  it('CHECKS-21: deve rotular o status como "Status", que cabe na coluna curta, com o nome acessível completo', async () => {
    await renderCard(ResponseCard, SALVA);

    const status = box('Default status code');
    const label = status.closest('mat-form-field')?.querySelector('mat-label');
    expect(label?.textContent?.trim()).toBe('Status');
  });
});
