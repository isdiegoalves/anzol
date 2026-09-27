import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { Icon } from '../ui/icon';

let nextHeaderId = 0;

/**
 * Cabeçalho do editor de regra (C, RULES-13): o nome inline, "Unsaved changes", a prioridade, o
 * Enabled, "Delete rule", Discard e Save, sempre à vista no topo. Os controles são os do formulário
 * do editor; na visão JSON, só o título e as ações. Abaixo de 1200 px (`compact`, F8): "Back to
 * list", o nome, Save e o ⋮ "More actions" (Duplicate, Delete, Discard), com prioridade e Enabled
 * num "Details" recolhido.
 */
@Component({
  selector: 'app-rule-editor-header',
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatSlideToggle,
    MatButton,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    NgTemplateOutlet,
    Icon,
  ],
  templateUrl: './rule-editor-header.html',
  styleUrl: './rule-editor-header.scss',
})
export class RuleEditorHeader {
  readonly title = input.required<string>();
  readonly name = input.required<FormControl<string>>();
  readonly priority = input.required<FormControl<number>>();
  readonly enabled = input.required<FormControl<boolean>>();
  /** Visão Form: nome, prioridade e Enabled editáveis aqui; na JSON, só o título. */
  readonly fields = input(true);
  readonly nameError = input('');
  readonly priorityError = input('');
  readonly unsaved = input(false);
  /** Regra salva: "Delete rule" e "Duplicate rule". */
  readonly canDelete = input(false);
  /** O `PUT` está em curso; o Save continua habilitado (WM-12) e diz que está ocupado. */
  readonly saving = input(false);
  /** Folha de tela cheia abaixo de 1200 px (F8). */
  readonly compact = input(false);

  readonly deleteRule = output<void>();
  readonly duplicateRule = output<void>();
  readonly discard = output<void>();
  readonly save = output<void>();

  protected readonly errorId = `rule-name-error-${nextHeaderId++}`;

  /** "Details (Priority 2 · Enabled)": o que está recolhido, dito no resumo. */
  protected detailsSummary(): string {
    const priority = this.priority().value;
    return this.enabled().value
      ? $localize`Details (Priority ${priority}:priority: · Enabled)`
      : $localize`Details (Priority ${priority}:priority: · Off)`;
  }
}
