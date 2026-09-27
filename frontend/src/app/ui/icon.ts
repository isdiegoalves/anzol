import { Component, computed, input } from '@angular/core';

type Shape =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const path = (d: string): Shape => ({ tag: 'path', d });
const circle = (cx: number, cy: number, r: number): Shape => ({ tag: 'circle', cx, cy, r });

/**
 * Ícones da tela em SVG inline (traço de 24 px, desenho do Lucide, licença ISC): o app roda
 * offline, sem fonte de ícones de CDN, e a `MatIcon` com ligaduras pediria uma fonte a mais.
 */
const ICONS = {
  // A marca Anzol: olhal no topo, haste, curva em J e a farpa na ponta (desenho próprio).
  hook: [circle(15, 4, 2), path('M15 6v9a5 5 0 0 1-10 0v-3'), path('m5 12 3 3')],
  inbox: [
    path('M22 12h-6l-2 3h-4l-2-3H2'),
    path(
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    ),
  ],
  rules: [
    path('M16 3h5v5'),
    path('M8 3H3v5'),
    path('M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3'),
    path('m15 9 6-6'),
  ],
  checks: [
    path(
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ),
    path('m9 12 2 2 4-4'),
  ],
  outbound: [
    path(
      'M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z',
    ),
    path('m21.85 2.15-10.94 10.94'),
  ],
  insights: [
    path('M3 3v16a2 2 0 0 0 2 2h16'),
    path('M18 17V9'),
    path('M13 17V5'),
    path('M8 17v-3'),
  ],
  plus: [path('M12 5v14M5 12h14')],
  settings: [path('M20 7h-9'), path('M14 17H5'), circle(17, 17, 3), circle(7, 7, 3)],
  help: [circle(12, 12, 10), path('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), path('M12 17h.01')],
  copy: [
    { tag: 'rect', x: 8, y: 8, width: 14, height: 14, rx: 2 },
    path('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'),
  ],
  lock: [
    { tag: 'rect', x: 3, y: 11, width: 18, height: 11, rx: 2 },
    path('M7 11V7a5 5 0 0 1 10 0v4'),
  ],
  search: [circle(11, 11, 8), path('m21 21-4.3-4.3')],
  ok: [circle(12, 12, 10), path('m9 12 2 2 4-4')],
  bad: [circle(12, 12, 10), path('m15 9-6 6'), path('m9 9 6 6')],
  near: [
    path('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
    path('M12 9v4'),
    path('M12 17h.01'),
  ],
  none: [circle(12, 12, 10), path('M8 12h8')],
  close: [path('M18 6 6 18'), path('m6 6 12 12')],
  up: [path('m18 15-6-6-6 6')],
  down: [path('m6 9 6 6 6-6')],
  back: [path('m12 19-7-7 7-7'), path('M19 12H5')],
  more: [circle(12, 5, 1), circle(12, 12, 1), circle(12, 19, 1)],
  trash: [
    path('M3 6h18'),
    path('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'),
    path('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
/** Todos os ícones, na ordem do mapa (o catálogo mostra cada um). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Ícone decorativo (`aria-hidden`): o nome acessível fica no texto ou no botão em volta. */
@Component({
  selector: 'app-icon',
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    @for (shape of shapes(); track $index) {
      @switch (shape.tag) {
        @case ('path') {
          <svg:path [attr.d]="shape.d" />
        }
        @case ('circle') {
          <svg:circle [attr.cx]="shape.cx" [attr.cy]="shape.cy" [attr.r]="shape.r" />
        }
        @case ('rect') {
          <svg:rect
            [attr.x]="shape.x"
            [attr.y]="shape.y"
            [attr.width]="shape.width"
            [attr.height]="shape.height"
            [attr.rx]="shape.rx"
          />
        }
      }
    }
  </svg>`,
  styles: ':host { display: inline-flex; flex: none; }',
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);

  protected readonly shapes = computed<readonly Shape[]>(() => ICONS[this.name()]);
}
