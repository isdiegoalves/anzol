import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { isJsonBody, jsonErrorLine } from './rule-example';

/** Um helper da cola do template: o nome no botão e o trecho que entra no cursor. */
interface TemplateHelper {
  name: string;
  snippet: string;
  description: string;
}

/**
 * Cola dos helpers de template (Anexo B e C5), com um exemplo de cada. Em função: os textos saem
 * do `$localize` depois de a tradução carregar.
 */
function templateHelpers(): TemplateHelper[] {
  return [
    { name: 'request.method', snippet: '{{request.method}}', description: $localize`HTTP method` },
    {
      name: 'request.path',
      snippet: '{{request.path}}',
      description: $localize`Path after the URL's token`,
    },
    { name: 'request.url', snippet: '{{request.url}}', description: $localize`Full URL` },
    {
      name: 'request.query',
      snippet: '{{request.query.id}}',
      description: $localize`Query parameter "id"`,
    },
    {
      name: 'request.headers',
      snippet: '{{request.headers.authorization}}',
      description: $localize`Header, name in lowercase`,
    },
    { name: 'request.body', snippet: '{{request.body}}', description: $localize`Raw request body` },
    { name: 'seq', snippet: '{{seq}}', description: $localize`Sequence number of the request` },
    {
      name: 'jsonPath',
      snippet: "{{jsonPath request.body '$.id'}}",
      description: $localize`Value from the JSON body. Simple paths only ($.a.b[0]).`,
    },
    {
      name: 'hmac',
      snippet: '{{hmac request.body}}',
      description: $localize`HMAC of a value with the URL's signature secret (sha256, hex by default)`,
    },
    { name: 'now', snippet: '{{now}}', description: $localize`Current time, ISO-8601 UTC` },
    {
      name: 'now format',
      snippet: "{{now format='yyyy-MM-dd'}}",
      description: $localize`Current time, Java date pattern`,
    },
    {
      name: 'randomValue UUID',
      snippet: "{{randomValue type='UUID'}}",
      description: $localize`Random UUID`,
    },
    {
      name: 'randomValue',
      snippet: "{{randomValue type='ALPHANUMERIC' length=8}}",
      description: $localize`Random text: ALPHANUMERIC, NUMERIC or HEX (length 16 by default)`,
    },
    {
      name: 'math',
      snippet: "{{math seq '*' 10}}",
      description: $localize`Arithmetic: '+', '-', '*', '/'`,
    },
  ];
}

/**
 * Ajudas do corpo da resposta (WM-42, WM-46, E-10), abaixo do campo: "Format JSON" (sem template),
 * o aviso de JSON inválido (não impede de salvar), o Content-Type sugerido para corpo JSON (ou o
 * padrão da URL) e a cola de helpers, que insere no cursor do corpo.
 */
@Component({
  selector: 'app-rule-body-tools',
  imports: [MatButton],
  templateUrl: './rule-body-tools.html',
  styleUrl: './rule-body-tools.scss',
})
export class RuleBodyTools {
  readonly body = input('');
  readonly template = input(false);
  /** A resposta já tem Content-Type: nada a sugerir. */
  readonly hasContentType = input(false);
  /** Content type padrão da URL (Checks › Response), a alternativa ao JSON. */
  readonly defaultType = input<string | null>(null);
  /** A cola vem aberta na largura grande (RULES-23). */
  readonly helpersOpen = input(false);
  readonly disabled = input(false);

  /** O corpo formatado ("Format JSON"). */
  readonly formatted = output<string>();
  readonly addHeader = output<{ name: string; value: string }>();
  /** Trecho de helper para o cursor do corpo. */
  readonly insert = output<string>();

  protected readonly helpers = templateHelpers();
  protected readonly errorLine = computed(() =>
    this.template() ? null : jsonErrorLine(this.body()),
  );
  protected readonly canFormat = computed(() => !this.template() && isJsonBody(this.body(), false));
  protected readonly suggestJson = computed(
    () => !this.hasContentType() && isJsonBody(this.body(), this.template()),
  );
  protected readonly otherDefault = computed(() => {
    const type = this.defaultType();
    return type && !type.startsWith('application/json') ? type : null;
  });

  protected format(): void {
    this.formatted.emit(`${JSON.stringify(JSON.parse(this.body()), null, 2)}`);
  }

  protected insertLabel(helper: TemplateHelper): string {
    return $localize`Insert ${helper.name}:helper:`;
  }

  protected useDefaultLabel(type: string): string {
    return $localize`Use the URL's default content type (${type}:type:)`;
  }
}
