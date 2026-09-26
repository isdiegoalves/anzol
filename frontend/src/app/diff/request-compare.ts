import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { localDate } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { CompareStore } from './compare-store';
import { FieldDiff } from './field-diff';
import { DiffRow, diffLines, onlyDifferences } from './line-diff';
import {
  FieldRow,
  bodyPair,
  compareHeaders,
  compareQuery,
  compareRequestLine,
} from './request-diff';

/**
 * Comparação de duas mensagens: método e URL, query, headers e corpo por linha. Carregada sob
 * demanda (`@defer` no inbox), junto com a biblioteca de diff.
 */
@Component({
  selector: 'app-request-compare',
  imports: [FieldDiff, MatButton, MatSlideToggle],
  templateUrl: './request-compare.html',
  styleUrl: './request-compare.scss',
})
export class RequestCompare {
  protected readonly compare = inject(CompareStore);

  readonly a = input.required<WebhookRequest>();
  readonly b = input.required<WebhookRequest>();

  protected readonly onlyDifferences = signal(false);
  protected readonly localDate = localDate;

  protected readonly requestLine = computed(() =>
    this.visible(compareRequestLine(this.a(), this.b())),
  );
  protected readonly query = computed(() =>
    this.visible(compareQuery(this.a().query, this.b().query)),
  );
  protected readonly headers = computed(() =>
    this.visible(compareHeaders(this.a().headers, this.b().headers)),
  );
  protected readonly body = computed(() => bodyPair(this.a().content, this.b().content));
  private readonly lines = computed(() => diffLines(this.body().a, this.body().b));
  protected readonly bodyRows = computed<DiffRow[]>(() =>
    this.onlyDifferences() ? onlyDifferences(this.lines()) : this.lines(),
  );
  protected readonly bodyEqual = computed(() =>
    this.lines().every((line) => line.kind === 'equal'),
  );

  private visible(rows: FieldRow[]): FieldRow[] {
    return this.onlyDifferences() ? rows.filter((row) => row.status !== 'equal') : rows;
  }
}
