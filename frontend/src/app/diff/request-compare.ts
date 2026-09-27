import {
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { CheckResult, pipelineOf } from '../pipeline/pipeline';
import { localDate } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { Viewport } from '../shell/viewport';
import { CheckChip } from '../ui/check-chip';
import { MethodBadge } from '../ui/method-badge';
import { CompareStore } from './compare-store';
import { FieldDiff } from './field-diff';
import { DiffRow, diffLines, onlyDifferences, sideBySide } from './line-diff';
import { NOISE_HEADERS, OutcomeCause, explainOutcome } from './outcome';
import {
  FieldRow,
  bodyPair,
  compareHeaders,
  compareQuery,
  compareRequestLine,
} from './request-diff';

/** Uma linha da tabela "Checks": o mesmo selo nos dois lados. */
interface CheckRow {
  kind: CheckResult['kind'];
  label: string;
  a: CheckResult;
  b: CheckResult;
  same: boolean;
}

const CHECK_LABELS: Record<CheckResult['kind'], string> = {
  signature: 'Signature',
  schema: 'Schema',
  rule: 'Rule',
};

/**
 * Comparação de duas mensagens (página do Compare): as verificações lado a lado, o que explica o
 * desfecho (S9, só com sinais do servidor), o ruído por provedor e o resto; depois método e URL,
 * query, headers (A | B | Status) e o corpo por linha, lado a lado (unificado no compacto).
 */
@Component({
  selector: 'app-request-compare',
  imports: [CheckChip, FieldDiff, MatButton, MatSlideToggle, MethodBadge],
  templateUrl: './request-compare.html',
  styleUrl: './request-compare.scss',
})
export class RequestCompare {
  protected readonly compare = inject(CompareStore);
  private readonly viewport = inject(Viewport);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly a = input.required<WebhookRequest>();
  readonly b = input.required<WebhookRequest>();

  /**
   * "Swap A and B" troca na tela no mesmo evento do clique, antes da rota nova chegar; quando ela
   * chega (A e B já trocados), volta ao normal.
   */
  private readonly swapped = linkedSignal({
    source: () => `${this.a().uuid}/${this.b().uuid}`,
    computation: () => false,
  });
  /** A e B como a tela mostra agora. */
  protected readonly left = computed(() => (this.swapped() ? this.b() : this.a()));
  protected readonly right = computed(() => (this.swapped() ? this.a() : this.b()));

  protected readonly onlyDifferences = signal(false);
  protected readonly noiseHeaders: ReadonlySet<string> = new Set(NOISE_HEADERS);
  protected readonly localDate = localDate;
  /** No compacto (e no médio) o corpo sai unificado: duas colunas não cabem. */
  protected readonly unified = computed(() =>
    ['compact', 'medium'].includes(this.viewport.windowClass()),
  );

  protected readonly routeA = computed(() => pipelineOf(this.left()).route);
  protected readonly routeB = computed(() => pipelineOf(this.right()).route);

  protected readonly checks = computed<CheckRow[]>(() => {
    const [a, b] = [pipelineOf(this.left()), pipelineOf(this.right())];
    return (['signature', 'schema', 'rule'] as const).map((kind) => ({
      kind,
      label: CHECK_LABELS[kind],
      a: a[kind],
      b: b[kind],
      same: a[kind].state === b[kind].state && a[kind].detail === b[kind].detail,
    }));
  });

  protected readonly outcome = computed(() => explainOutcome(this.left(), this.right()));

  protected readonly requestLine = computed(() =>
    this.visible(compareRequestLine(this.left(), this.right())),
  );
  protected readonly query = computed(() =>
    this.visible(compareQuery(this.left().query, this.right().query)),
  );
  protected readonly headers = computed(() =>
    this.visible(compareHeaders(this.left().headers, this.right().headers)),
  );
  protected readonly body = computed(() => bodyPair(this.left().content, this.right().content));
  private readonly lines = computed(() => diffLines(this.body().a, this.body().b));
  protected readonly bodyRows = computed<DiffRow[]>(() =>
    this.onlyDifferences() ? onlyDifferences(this.lines()) : this.lines(),
  );
  protected readonly sideRows = computed(() => sideBySide(this.bodyRows()));
  protected readonly bodyEqual = computed(() =>
    this.lines().every((line) => line.kind === 'equal'),
  );

  /**
   * Redesenha na hora: o interruptor mostra o novo estado no mesmo evento do clique (sem esperar o
   * próximo ciclo), para quem lê o `aria-checked` logo depois, como leitores de tela e o E2E.
   */
  protected showOnlyDifferences(checked: boolean): void {
    this.onlyDifferences.set(checked);
    this.changeDetector.detectChanges();
  }

  protected swap(): void {
    this.swapped.update((swapped) => !swapped);
    this.changeDetector.detectChanges();
    this.compare.swap();
  }

  protected causeText(cause: OutcomeCause): string {
    const check = CHECK_LABELS[cause.check];
    const where = cause.where === cause.check ? check : `${check} ${cause.where}`;
    return `${where}: A ${cause.a} → B ${cause.b}`;
  }

  private visible(rows: FieldRow[]): FieldRow[] {
    return this.onlyDifferences() ? rows.filter((row) => row.status !== 'equal') : rows;
  }
}
