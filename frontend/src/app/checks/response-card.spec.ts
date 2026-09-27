import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { expectGet, expectPut, renderCard } from '../../testing/checks';
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
const save = () => screen.getByRole('button', { name: 'Save response' });

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

  it('deve mandar a resposta com a assinatura e o schema salvos (CA-11) Quando Save response é clicado', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '201');
    await userEvent.clear(box('Retry-After'));
    await userEvent.click(screen.getByRole('radio', { name: 'Disabled' }));
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
    });
    put.flush({ ...SALVA, default_status: 201, retry_after: null, auto_cleanup: null });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent?.trim()).toBe('Saved.'));

    // Editar de novo tira o "Saved." velho: ele só vale para o que foi salvo.
    await userEvent.type(box('Response body'), '!');
    expect(screen.queryByText('Saved.')).toBeNull();
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
      await userEvent.click(save());

      expect(screen.getByRole('alert').textContent?.trim()).toBe(resumo);
      expect(document.activeElement).toBe(input);
      http.expectNone((sent) => sent.method === 'PUT');
    },
  );

  it('deve avisar "changed elsewhere", sem sobrescrever, e recarregar pelo Reload Quando o status mudou lá fora', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.clear(box('Default status code'));
    await userEvent.type(box('Default status code'), '201');
    await userEvent.click(save());
    (await expectGet(http)).flush({ ...SALVA, default_status: 404 });

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/changed elsewhere/),
    );
    http.expectNone((sent) => sent.method === 'PUT');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    (await expectGet(http)).flush({ ...SALVA, default_status: 404 });
    await vi.waitFor(() => expect(box('Default status code').value).toBe('404'));
  });

  it('deve oferecer "Retry", manter o digitado e salvar de novo Quando a rede falha no Save (E10)', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    await userEvent.clear(box('Response body'));
    await userEvent.type(box('Response body'), 'depois');
    await userEvent.click(save());

    (await expectPut(http)).error(new ProgressEvent('error'));

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(box('Response body').value).toBe('depois');
    await userEvent.click(retry);
    const put = await expectPut(http);
    expect(put.request.body.default_content).toBe('depois');
    put.flush({ ...SALVA, default_content: 'depois' });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved.'));
  });

  it('não deve oferecer "Retry" Quando o servidor recusa o Save (422)', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);
    await userEvent.click(save());

    (await expectPut(http)).flush(
      { default_status: ['bad'] },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/bad/));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('deve ligar o CORS na hora, sem Save, Quando o switch é clicado', async () => {
    const { http } = await renderCard(ResponseCard, SALVA);

    await userEvent.click(screen.getByRole('switch', { name: 'Enable CORS' }));

    const call = await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}/cors/toggle`));
    expect(call.request.method).toBe('PUT');
    call.flush({ enabled: true });
    await vi.waitFor(() => expect(TestBed.inject(Preferences).token()?.cors).toBe(true));
    http.expectNone(`/token/${TOKEN_ID}`);
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
    expect(row.textContent).toContain('Lets a browser page call this URL. Applies right away.');
    expect(within(row).getByRole('switch', { name: 'Enable CORS' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Response body' }).getAttribute('rows')).toBe('2');
  });
});
