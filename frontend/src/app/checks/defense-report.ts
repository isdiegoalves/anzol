import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../ui/icon';
import {
  ConfigState,
  DefenseReport as Report,
  DefenseScenarioResult,
  familyName,
  layerName,
  scenarioTitle,
} from './defense-lab';

/** O relatório de uma rodada fechada: os números do servidor e o gabarito por cenário. */
@Component({
  selector: 'app-defense-report',
  imports: [Icon, RouterLink],
  templateUrl: './defense-report.html',
  styleUrl: './defense-report.scss',
})
export class DefenseReport {
  readonly report = input.required<Report>();
  readonly tokenId = input.required<string>();

  protected readonly title = scenarioTitle;
  protected readonly family = familyName;
  protected readonly layer = layerName;

  protected readonly allDetected = computed(
    () => this.report().detection.detected === this.report().detection.attacks,
  );

  /** "kept" com as duas mantidas; senão, cada uma com o seu estado. */
  protected readonly settings = computed(() => {
    const { signature, schema } = this.report().loosening;
    if (signature === 'kept' && schema === 'kept') {
      return $localize`kept`;
    }
    return $localize`signature ${configState(signature)}:signature: · schema ${configState(schema)}:schema:`;
  });

  protected wave2(row: DefenseScenarioResult): string {
    const { status, blocked, containable } = row.containment;
    if (!containable) {
      return $localize`Not containable (${status}:status:)`;
    }
    return blocked ? $localize`Blocked (${status}:status:)` : $localize`Passed (${status}:status:)`;
  }

  protected injection(row: DefenseScenarioResult): string {
    const result = row.injection;
    if (!result) {
      return '—';
    }
    return result.obeyed
      ? $localize`Obeyed (${result.signal ?? '?'}:signal:)`
      : $localize`Not obeyed`;
  }

  protected openLabel(wave: number, code: string, requestId: string): string {
    return $localize`Open the wave ${wave}:wave: request #${requestId.slice(0, 8)}:id: of ${code}:code: in the Inbox`;
  }

  protected falsePositiveLabel(requestId: string): string {
    return $localize`Open the legitimate request #${requestId.slice(0, 8)}:id: marked as attack`;
  }
}

function configState(state: ConfigState): string {
  const names: Record<ConfigState, string> = {
    kept: $localize`:URL setting state|:kept`,
    changed: $localize`:URL setting state|:changed`,
    removed: $localize`:URL setting state|:removed`,
  };
  return names[state] ?? state;
}
