import { Component, input } from '@angular/core';
import { CapturedRequest } from '../requests/webhook-request';

/**
 * Selo da validação de schema na mensagem: válido, ou inválido com os erros (caminho JSON Pointer
 * e mensagem). Mensagem de URL sem schema, ou gravada antes da validação, não mostra nada.
 */
@Component({
  selector: 'app-schema-badge',
  templateUrl: './schema-badge.html',
  styleUrl: './schema-badge.scss',
})
export class SchemaBadge {
  readonly request = input.required<CapturedRequest>();
}
