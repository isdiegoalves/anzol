import { Component, signal } from '@angular/core';
import { webhookRequestExamples } from './examples';
import { checksOf } from '../pipeline/pipeline';
import { CheckChip } from '../ui/check-chip';
import { CodeView } from '../ui/code-view';
import { CopyField } from '../ui/copy-field';
import { EmptyState } from '../ui/empty-state';
import { KvTable } from '../ui/kv-table';
import { LiveState, LiveStatus } from '../ui/live-status';
import { MethodBadge } from '../ui/method-badge';
import { Pane } from '../ui/pane';
import { Split } from '../ui/split';
import { StatusCode } from '../ui/status-code';

/**
 * Catálogo de `ui/` (`#/_catalog`, só em desenvolvimento: o build de produção troca as rotas dele
 * por nenhuma, `fileReplacements` do `angular.json`). Cada componente em todos os estados, no claro
 * e no escuro lado a lado (o `color-scheme` de cada coluna escolhe o lado do `light-dark()`).
 */
@Component({
  selector: 'app-catalog',
  imports: [
    CheckChip,
    CodeView,
    CopyField,
    EmptyState,
    KvTable,
    LiveStatus,
    MethodBadge,
    Pane,
    Split,
    StatusCode,
  ],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class Catalog {
  protected readonly schemes = ['light', 'dark'] as const;
  protected readonly checks = webhookRequestExamples().map((request) => checksOf(request));
  protected readonly methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  protected readonly statuses = [200, 302, 404, 422, 503];
  protected readonly liveStates: LiveState[] = ['live', 'connecting', 'reconnecting', 'offline'];
  protected readonly headers = [
    { name: 'content-type', value: 'application/json' },
    { name: 'stripe-signature', value: 't=1790438525,v1=5257a869e7ec…' },
    { name: 'x-empty', value: '' },
  ];
  protected readonly notes = new Map([
    [
      'stripe-signature',
      { tone: 'bad' as const, text: '✕ Signature invalid — signature mismatch' },
    ],
  ]);
  protected readonly body =
    '{"id":"evt_1","data":{"amount":"4990","currency":"brl"},"livemode":false}';
  protected readonly marks = [{ pointer: '/data/amount', message: 'must be integer' }];
  protected readonly splitWidth = signal(280);
}
