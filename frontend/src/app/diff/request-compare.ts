import {
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { CheckResult, pipelineOf } from '../pipeline/pipeline';
import { localDate } from '../request-detail/dates';
import { bodySummary, eventType } from '../requests/request-list';
import { WebhookRequest } from '../requests/webhook-request';
import { Viewport } from '../shell/viewport';
import { CheckChip } from '../ui/check-chip';
import { MethodBadge } from '../ui/method-badge';
import { CompareStore } from './compare-store';
import { FieldDiff } from './field-diff';
import { RequestLine } from './request-line';
import { DiffRow, diffLines, onlyDifferences, sideBySide } from './line-diff';
import { NOISE_HEADERS, OutcomeCause, explainOutcome } from './outcome';
import { FieldRow, bodyPair, compareHeaders, compareQuery, requestLine } from './request-diff';

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
  rule: 'Answer',
};

/**
 * Comparação de duas mensagens (página do Compare): as verificações lado a lado, o que explica o
 * desfecho (S9, só com sinais do servidor), o ruído por provedor e o resto; depois método e URL,
 * query, headers (A | B | Status) e o corpo por linha, lado a lado (unificado no compacto).
 */
@Component({
  selector: 'app-request-compare',
  imports: [
    CheckChip,
    FieldDiff,
    MatButton,
    MatSlideToggle,
    MethodBadge,
    NgTemplateOutlet,
    RequestLine,
  ],
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

  /** RULES-29: abre só com as diferenças (o switch mostra tudo). */
  protected readonly onlyDifferences = signal(true);
  protected readonly noiseHeaders: ReadonlySet<string> = new Set(NOISE_HEADERS);
  protected readonly localDate = localDate;
  protected readonly noDifferences = $localize`No differences`;
  protected readonly emptyValue = $localize`(empty)`;
  /** No compacto (e no médio) o corpo sai unificado: duas colunas não cabem. */
  protected readonly unified = computed(() =>
    ['compact', 'medium'].includes(this.viewport.windowClass()),
  );

  /** RULES-36: no compacto, A e B embaixo de cada verificação (três colunas não cabem). */
  protected readonly stacked = computed(() => this.viewport.windowClass() === 'compact');

  /** Os cartões A e B (RULES-28): caminho, id, tipo do evento e o desfecho. */
  protected readonly sides = computed(() =>
    [
      { tag: 'a', request: this.left() },
      { tag: 'b', request: this.right() },
    ].map(({ tag, request }) => {
      const flow = pipelineOf(request);
      const failed = [flow.signature, flow.schema].find((check) => check.tone === 'bad');
      return {
        tag,
        request,
        route: flow.route,
        event: bodySummary(request),
        outcome: (failed ?? flow.rule).title,
      };
    }),
  );

  protected readonly checks = computed<CheckRow[]>(() => {
    const [a, b] = [pipelineOf(this.left()), pipelineOf(this.right())];
    const withStatus = (result: CheckResult, request: WebhookRequest): CheckResult => {
      // RULES-30: "201 · Pagamento" no selo da regra, com o status gravado na mensagem (C3).
      const status = request.response?.fault ? $localize`Fault` : request.response?.status;
      return result.kind === 'rule' && request.rule && status !== undefined
        ? { ...result, detail: `${status} · ${result.detail}` }
        : result;
    };
    return (['signature', 'schema', 'rule'] as const).map((kind) => ({
      kind,
      label: CHECK_LABELS[kind],
      a: withStatus(a[kind], this.left()),
      b: withStatus(b[kind], this.right()),
      same: a[kind].state === b[kind].state && a[kind].detail === b[kind].detail,
    }));
  });

  /** "2 headers changed, 1 only in B · 3 body lines differ" (RULES-28), com tudo, não só o visível. */
  protected readonly summary = computed(() => {
    const rows = compareHeaders(this.left().headers, this.right().headers);
    const count = (status: FieldRow['status']) =>
      rows.filter((row) => row.status === status).length;
    const changed = count('different');
    const parts = [
      changed === 1 ? $localize`1 header changed` : $localize`${changed}:count: headers changed`,
    ];
    const [onlyA, onlyB] = [count('only-a'), count('only-b')];
    if (onlyA > 0) {
      parts.push($localize`${onlyA}:count: only in A`);
    }
    if (onlyB > 0) {
      parts.push($localize`${onlyB}:count: only in B`);
    }
    const lines = this.lines().filter((line) => line.kind !== 'equal').length;
    const body =
      lines === 1 ? $localize`1 body line differs` : $localize`${lines}:count: body lines differ`;
    return `${parts.join(', ')} · ${body}`;
  });

  protected readonly outcome = computed(() => explainOutcome(this.left(), this.right()));

  /** RULES-32: método, caminho sem o token e query, em chips. */
  protected readonly line = computed(() =>
    requestLine(this.left(), this.right()).map((part) => ({
      ...part,
      text: this.partText(part.kind, part.same ? part.a : `${part.a || '∅'} → ${part.b || '∅'}`),
    })),
  );
  protected readonly lineSame = computed(() => this.line().every((part) => part.same));
  /** RULES-33: o que o switch esconde nos headers, ou quantos há. */
  protected readonly headersNote = computed(() => {
    const all = compareHeaders(this.left().headers, this.right().headers);
    if (!this.onlyDifferences()) {
      return $localize`All ${all.length}:count: headers`;
    }
    const identical = all.filter((row) => row.status === 'equal').length;
    return identical === 1
      ? $localize`1 identical header hidden`
      : $localize`${identical}:count: identical headers hidden`;
  });
  /** RULES-34: o tipo do evento de cada lado nas colunas do corpo. */
  protected readonly bodyColumns = computed(() =>
    [this.left(), this.right()].map((request, index) => {
      const side = index === 0 ? 'A' : 'B';
      const type = eventType(request);
      return type ? `${side} · ${type}` : side;
    }),
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

  /** RULES-34: o botão das linhas iguais escondidas. */
  protected unchangedLabel(count: number): string {
    return count === 1
      ? $localize`1 unchanged line hidden. Show them`
      : $localize`${count}:count: unchanged lines hidden. Show them`;
  }

  private partText(kind: 'method' | 'path' | 'query', value: string): string {
    if (kind === 'method') {
      return $localize`Method ${value}:value:`;
    }
    if (kind === 'path') {
      return $localize`Path ${value}:value:`;
    }
    return value === '' ? $localize`No query` : $localize`Query ${value}:value:`;
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
