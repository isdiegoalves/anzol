import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { EventGrouping } from '../requests/event-grouping';
import { FilterChips, ValueTarget } from '../search/filter-chips';
import { ValueActions } from './value-actions';

describe('Dado um valor da requisição aberta que vira filtro', () => {
  const show = async (target: ValueTarget, label: string) => {
    const view = await render(
      `<app-value [target]="target" [label]="label">{{ text }}</app-value>`,
      {
        imports: [ValueActions],
        componentProperties: { target, label, text: target.value },
        providers: [provideHttpClient(), provideHttpClientTesting()],
      },
    );
    const filter = vi.spyOn(TestBed.inject(FilterChips), 'filterByValue').mockReturnValue();
    return { ...view, filter };
  };
  const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
  const header: ValueTarget = { kind: 'header', name: 'X-Loja-Event-Id', value: 'evt_1' };

  it('deve dizer o valor e o que ele faz no nome, e abrir o menu com o primeiro item em foco', async () => {
    const { container } = await show(header, 'X-Loja-Event-Id');
    const value = screen.getByRole('button', { name: 'X-Loja-Event-Id: evt_1. Value actions' });
    await expectNoAxeViolations(container);

    await userEvent.click(value);

    expect(screen.getByRole('menu', { name: 'Value actions' })).toBeTruthy();
    expect(items()).toEqual([
      'Filter by this value',
      'Copy value',
      'Copy path',
      'Group by this field',
    ]);
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent?.trim()).toBe('Filter by this value'),
    );
  });

  it('deve filtrar pelo valor, e excluir só no método', async () => {
    const { filter } = await show({ kind: 'method', name: '', value: 'POST' }, 'Method');

    await userEvent.click(screen.getByRole('button', { name: 'Method: POST. Value actions' }));
    expect(items()).toEqual(['Filter by this value', 'Exclude this value', 'Copy value']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Exclude this value' }));

    expect(filter).toHaveBeenCalledWith({ kind: 'method', name: '', value: 'POST' }, true);
  });

  it('não deve oferecer o filtro num valor com mais de 200 caracteres; copiar continua', async () => {
    const long = 'v'.repeat(201);
    await show({ kind: 'query', name: 'nota', value: long }, 'nota');
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();

    await userEvent.click(screen.getByRole('button', { name: `nota: ${long}. Value actions` }));
    expect(items()).toEqual(['Copy value']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy value' }));

    expect(copy).toHaveBeenCalledWith(long);
    expect(announce).toHaveBeenCalledWith('Value copied.');
  });

  it('deve copiar o caminho e agrupar pelo campo', async () => {
    await show(header, 'X-Loja-Event-Id');
    const copy = vi.spyOn(TestBed.inject(Clipboard), 'copy').mockReturnValue(true);
    const choose = vi.spyOn(TestBed.inject(EventGrouping), 'choose').mockReturnValue();
    const value = screen.getByRole('button', { name: /Value actions$/ });

    await userEvent.click(value);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    await userEvent.click(value);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Group by this field' }));

    expect(copy).toHaveBeenCalledWith('X-Loja-Event-Id');
    expect(choose).toHaveBeenCalledWith('x-loja-event-id');
  });
});
