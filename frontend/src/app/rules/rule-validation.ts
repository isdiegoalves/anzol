import { AbstractControl, FormArray, FormGroup } from '@angular/forms';
import { DELAY_MAX_MS, DRIBBLE_MAX_CHUNKS } from './rule';
import { EditorTab } from './rule-tabs';

/** Campo inválido do editor, na ordem da tela: onde está (aba, ou o cabeçalho) e como se chama. */
export interface InvalidField {
  /** `null` = cabeçalho do editor (nome e prioridade), fora das abas. */
  tab: EditorTab | null;
  /** "Path", "Status (100–599)", "Header 1 name (required)". */
  label: string;
}

interface Section {
  tab: EditorTab | null;
  label: string;
  range?: string;
}

/** Nome e aba de cada campo do formulário; `range` é o que o campo aceita, dito no resumo. */
function sections(): Record<string, Section> {
  const ms = $localize`0–${DELAY_MAX_MS}:max: ms`;
  return {
    name: { tab: null, label: $localize`Name` },
    priority: { tab: null, label: $localize`Priority`, range: $localize`at least 1` },
    methods: { tab: 'match', label: $localize`Methods` },
    pathMode: { tab: 'match', label: $localize`Path match` },
    path: { tab: 'match', label: $localize`Path` },
    signature: { tab: 'match', label: $localize`Signature` },
    schema: { tab: 'match', label: $localize`Schema` },
    status: { tab: 'response', label: $localize`Status`, range: '100–599' },
    responseBody: { tab: 'response', label: $localize`Response body` },
    template: { tab: 'response', label: $localize`Template` },
    delayType: { tab: 'response', label: $localize`Delay` },
    delayFixed: { tab: 'response', label: $localize`Delay (ms)`, range: ms },
    delayMin: { tab: 'response', label: $localize`Delay min (ms)`, range: ms },
    delayMax: { tab: 'response', label: $localize`Delay max (ms)`, range: ms },
    delayMedian: { tab: 'response', label: $localize`Delay median (ms)`, range: ms },
    delaySigma: { tab: 'response', label: $localize`Sigma`, range: $localize`at least 0` },
    dribble: { tab: 'response', label: $localize`Dribble` },
    dribbleChunks: {
      tab: 'response',
      label: $localize`Chunks`,
      range: `1–${DRIBBLE_MAX_CHUNKS}`,
    },
    dribbleDuration: { tab: 'response', label: $localize`Dribble duration (ms)`, range: ms },
    fault: { tab: 'response', label: $localize`Fault` },
    scenarioName: { tab: 'scenario', label: $localize`Scenario name` },
    requiredState: { tab: 'scenario', label: $localize`Required state` },
    newState: { tab: 'scenario', label: $localize`New state` },
  };
}

/** Nome de um campo de uma linha (n a partir de 1), o mesmo nome acessível do campo na tela. */
function rowLabel(list: string, n: number, field: string): { tab: EditorTab; label: string } {
  const labels: Record<string, Record<string, string>> = {
    query: {
      name: $localize`Query ${n}:number: name`,
      value: $localize`Query ${n}:number: value`,
    },
    headers: {
      name: $localize`Header ${n}:number: name`,
      value: $localize`Header ${n}:number: value`,
    },
    body: {
      value: $localize`Body ${n}:number: value`,
      path: $localize`Body ${n}:number: path`,
      equals: $localize`Body ${n}:number: equals`,
    },
    responseHeaders: {
      name: $localize`Response header ${n}:number: name`,
      value: $localize`Response header ${n}:number: value`,
    },
  };
  return {
    tab: list === 'responseHeaders' ? 'response' : 'match',
    label: labels[list]?.[field] ?? labels[list]?.['value'] ?? list,
  };
}

/** Por que o campo é inválido, em poucas palavras; o erro do servidor vai como veio. */
function reason(control: AbstractControl, range: string | undefined): string | null {
  const errors = control.errors ?? {};
  if (typeof errors['server'] === 'string') {
    return errors['server'];
  }
  if (errors['required']) {
    return $localize`required`;
  }
  if (errors['json']) {
    return $localize`invalid JSON`;
  }
  if (errors['maxlength']) {
    return $localize`up to 100 characters`;
  }
  if (errors['belowMin']) {
    return $localize`at least the min`;
  }
  return range ?? null;
}

function describe(label: string, why: string | null): string {
  return why ? `${label} (${why})` : label;
}

/**
 * Os campos inválidos do formulário do editor, na ordem em que aparecem (cabeçalho, Match,
 * Response, Scenario). Campo desabilitado não conta, como na validade do formulário.
 */
export function invalidFields(form: FormGroup): InvalidField[] {
  const known = sections();
  const found: InvalidField[] = [];
  for (const [key, control] of Object.entries(form.controls)) {
    if (!control.invalid) {
      continue;
    }
    if (control instanceof FormArray) {
      control.controls.forEach((row, index) => {
        for (const [field, cell] of Object.entries((row as FormGroup).controls)) {
          if (cell.invalid) {
            const { tab, label } = rowLabel(key, index + 1, field);
            found.push({ tab, label: describe(label, reason(cell, undefined)) });
          }
        }
      });
      continue;
    }
    const section = known[key] ?? { tab: null, label: key };
    found.push({
      tab: section.tab,
      label: describe(section.label, reason(control, section.range)),
    });
  }
  const order: (EditorTab | null)[] = [null, 'match', 'response', 'scenario', 'test'];
  return found.sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab));
}
