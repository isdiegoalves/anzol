import { Component, computed, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { fromNow } from '../request-detail/dates';
import { WebhookRequest } from '../requests/webhook-request';
import { closestFirst } from './against-history';
import { HISTORY_TEST_WINDOW, HistoryTest } from './rule';
import { examplePath } from './rule-example';

/** Tamanho do trecho do corpo em cada mensagem do resultado (WM-22). */
const SNIPPET_LENGTH = 80;

/** O que a linha de uma mensagem mostra (com a mensagem lida da janela recente). */
interface Described {
  /** "POST /pedidos · 2 minutes ago", o nome do link. */
  label: string;
  snippet: string | null;
  /** "answered 201 by Antiga at the time"; `null` sem regra na época. */
  answered: string | null;
}

/**
 * Aba Test do editor (C, RULES-20; WM-22): quantas das mensagens mais recentes a regra casaria,
 * como está no editor, e duas colunas — as que casariam e as que não (das mais próximas às mais
 * longes). Cada mensagem é um link "{method} {path} · {time}" com o trecho do corpo e quem a
 * respondeu na época, e abre ao lado, dentro de Regras (`openRequest`). O resultado fica quando a
 * regra muda: "Out of date" diz que as condições mudaram desde ele. A prévia com prioridade (S8)
 * entra por projeção, logo abaixo do contador.
 */
@Component({
  selector: 'app-history-test-panel',
  imports: [MatButton, NgTemplateOutlet],
  templateUrl: './history-test-panel.html',
  styleUrl: './history-test-panel.scss',
})
export class HistoryTestPanel {
  readonly result = input.required<HistoryTest>();
  readonly tokenId = input.required<string>();
  /** As mensagens recentes (a janela do teste), para descrever cada uma. */
  readonly requests = input<ReadonlyMap<string, WebhookRequest>>(new Map());
  readonly canTest = input(true);
  /** Um teste está rodando: "Testing…" ocupado. */
  readonly testing = input(false);
  /** As condições mudaram depois deste resultado (o rerun vem em seguida). */
  readonly outOfDate = input(false);
  /** O "Preview response" está buscando as respostas (C4). */
  readonly rendering = input(false);
  readonly testAgain = output<void>();
  readonly previewResponse = output<void>();
  readonly openRequest = output<string>();

  protected readonly window = HISTORY_TEST_WINDOW;
  /** Dica do "Preview response" desabilitado (o botão desabilitado não recebe foco nem hover). */
  protected readonly nothingMatches = $localize`Nothing would match yet`;
  protected readonly closest = signal(true);
  protected readonly misses = computed(() =>
    this.closest() ? closestFirst(this.result().misses) : this.result().misses,
  );
  /** Nomes acessíveis com valor: `$localize` no TS (o `aria-label` interpolado não vira atributo). */
  protected readonly openLabel = (uuid: string) => $localize`Open request ${uuid}:uuid:`;

  protected describe(uuid: string): Described | null {
    const request = this.requests().get(uuid);
    if (!request) {
      return null;
    }
    const content = request.content ?? '';
    const status = request.response?.status;
    const rule = request.rule?.name;
    let answered: string | null = null;
    if (rule) {
      answered =
        status === undefined || status === null
          ? $localize`answered by ${rule}:rule: at the time`
          : $localize`answered ${status}:status: by ${rule}:rule: at the time`;
    }
    return {
      label: `${request.method} ${examplePath(request)} · ${fromNow(request.created_at)}`,
      snippet:
        content === ''
          ? null
          : content.length > SNIPPET_LENGTH
            ? `${content.slice(0, SNIPPET_LENGTH)}…`
            : content,
      answered,
    };
  }

  protected link(uuid: string, page: number): string {
    return `#/${this.tokenId()}/${uuid}/${page}`;
  }

  /** O clique abre a mensagem ao lado; o link continua valendo para abrir em outra aba. */
  protected open(event: MouseEvent, uuid: string): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.openRequest.emit(uuid);
  }
}
