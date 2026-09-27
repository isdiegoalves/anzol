// Tradução pt-BR da tela, carregada em runtime pelo `loadLocale` (docs/padroes-angular.md, § i18n).
// Chaves: os ids de `messages.json`, gerado por `npx ng extract-i18n`; o comentário é o texto
// em inglês. Placeholders ({$…}) e ICU iguais aos da fonte; o locale.spec.ts confere.
export const translations: Record<string, string> = {
  // Set WEBHOOK_AI_* to enable
  '6919457226990862417': 'Defina WEBHOOK_AI_* para ligar',
  // Asking the local model… The first call can take up to ~30 s while the model loads.
  '7864755981149570932':
    'Consultando o modelo local… A primeira chamada pode levar até ~30 s enquanto o modelo carrega.',
  // The AI call failed (unknown).
  '2216355350989627843': 'A chamada à IA falhou (desconhecido).',
  // AI is not configured on this server. {$PH}.
  '1545994642428997207': 'A IA não está configurada neste servidor. {$PH}.',
  // The local model did not answer{$PH}
  '5706520732481627001': 'O modelo local não respondeu{$PH}',
  // Check that it is running and reachable from the server, then try again.
  '5046249593838366627': 'Confira se ele está rodando e acessível pelo servidor e tente de novo.',
  // The request was not accepted.
  '1204857461936110997': 'A requisição não foi aceita.',
  // This URL or request no longer exists ({$PH}).
  '6606804964959613089': 'Esta URL ou requisição não existe mais ({$PH}).',
  // The AI call failed ({$PH}).
  '7494064391763817238': 'A chamada à IA falhou ({$PH}).',
  // in a moment
  '2853946369276465147': 'em instantes',
  // in {$PH} s
  '2559345085855496740': 'em {$PH} s',
  // after {$PH}
  '7584456735862130927': 'depois de {$PH}',
  // Too many AI calls for this URL (up to 10 per minute, one at a time). Try again {$PH}.
  '5181484920451887627':
    'Chamadas demais à IA nesta URL (até 10 por minuto, uma de cada vez). Tente de novo {$PH}.',
  // {$START_TAG_APP_ICON}{$CLOSE_TAG_APP_ICON}Anzol
  '106404287535044299': '{$START_TAG_APP_ICON}{$CLOSE_TAG_APP_ICON}Anzol',
  // Checks
  '86770805401291669': 'Verificações',
  //  What this URL verifies on every request, how healthy that is, and how it answers.
  '7459366193988024844':
    ' O que esta URL confere em cada requisição, como isso anda e como ela responde. ',
  // On this page
  '3666056139586507823': 'Nesta página',
  // Loading this URL…
  '1091211545215261325': 'Carregando esta URL…',
  // URL updated!
  '702595232551336019': 'URL atualizada!',
  // Could not reach the server. Your changes are kept.
  '4266131453207504592': 'Não foi possível falar com o servidor. Suas alterações continuam aqui.',
  // Retry
  '7934833136974560675': 'Tentar de novo',
  // CORS enabled.
  '3618104030922081592': 'CORS ligado.',
  // CORS disabled.
  '469266493583734169': 'CORS desligado.',
  // Could not toggle CORS.
  '3959730088680902960': 'Não foi possível alternar o CORS.',
  // Health
  '2041675390931385838': 'Saúde',
  // Refresh
  '1102717806459547726': 'Atualizar',
  // Window (last requests)
  '2134983675996971664': 'Janela (últimas requisições)',
  // No requests yet: the numbers appear as requests arrive.
  '3233095098443468999': 'Nenhuma requisição ainda: os números aparecem conforme elas chegam.',
  //  From the result recorded on each of the last {$INTERPOLATION} requests (of {$INTERPOLATION_1} kept).
  '9179246051898249262':
    ' Pelo resultado gravado em cada uma das últimas {$INTERPOLATION} requisições (de {$INTERPOLATION_1} guardadas). ',
  // {$INTERPOLATION} of {$INTERPOLATION_1} valid
  '4702613162202801190': '{$INTERPOLATION} de {$INTERPOLATION_1} válidas',
  // not checked in this window
  '4229639872448924579': 'não verificadas nesta janela',
  // {$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$INTERPOLATION} valid
  '443654800196707711': '{$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$INTERPOLATION} válidas',
  // {$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$INTERPOLATION} invalid
  '5610687243505618203': '{$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$INTERPOLATION} inválidas',
  // {$INTERPOLATION} not checked
  '994463048896196371': '{$INTERPOLATION} não verificadas',
  // Loading…
  '2369742814572661392': 'Carregando…',
  // (root)
  '5267671911622079393': '(raiz)',
  // {$valid} valid, {$invalid} invalid
  '3721271038538548419': '{$valid} válidas, {$invalid} inválidas',
  // Signature
  '2445188258613609179': 'Assinatura',
  // Why invalid
  '7274662611058601317': 'Por que inválidas',
  // Schema
  '1721827980245086554': 'Schema',
  // Failing paths
  '5223810502569098939': 'Caminhos com erro',
  // Could not load the numbers ({$PH}).
  '8821127302127518762': 'Não foi possível carregar os números ({$PH}).',
  // Privacy
  '8440128775129354214': 'Privacidade',
  // Protected
  '4776304093333411035': 'Protegida',
  // Open
  '7593555694782789615': 'Aberta',
  // Unsaved
  '3506804875657080331': 'Não salvo',
  // Require a secret to view this URL
  '6624167479080191469': 'Exigir um segredo para ver esta URL',
  //  Requests, rules and history open only with the secret. Sending webhooks to the URL keeps working without it.
  '6007131563666258209':
    ' Requisições, regras e histórico só abrem com o segredo. Mandar webhooks para a URL continua funcionando sem ele. ',
  // Changing the secret revokes existing read-only links.
  '3652478329784382583': 'Trocar o segredo revoga os links só-leitura existentes.',
  //  This URL is protected. Leave the fields blank to keep the current secret.
  '9203153322838064727':
    ' Esta URL é protegida. Deixe os campos em branco para manter o segredo atual. ',
  // 8 to 256 characters
  '8252071314521761697': 'De 8 a 256 caracteres',
  // The secret must have 8 to 256 characters.
  '6941653480005557323': 'O segredo precisa ter de 8 a 256 caracteres.',
  // Confirm secret
  '1185216263758586139': 'Confirme o segredo',
  // The secrets do not match.
  '8661255126898122827': 'Os segredos não conferem.',
  //  Saving removes the secret: anyone with the URL will see its requests.
  '1638842964716429031': ' Salvar remove o segredo: quem tiver a URL vai ver as requisições dela. ',
  // Save privacy
  '5382937105591612751': 'Salvar privacidade',
  // Discard
  '3823219296477075982': 'Descartar',
  // New secret
  '7702420551206203313': 'Novo segredo',
  // Secret to view
  '8726240724963767305': 'Segredo para ver',
  // Saved.
  '3319622416410005872': 'Salvo.',
  // Response
  '6552449600024516046': 'Resposta',
  // What this URL answers when no rule matches.
  '1874398810904103126': 'O que esta URL responde quando nenhuma regra casa.',
  // Default status code
  '9027737825562981193': 'Status padrão',
  // The default status must be an integer.
  '7737832829626808308': 'O status padrão precisa ser um número inteiro.',
  // Content Type
  '2742981785472097021': 'Content-Type',
  // text/plain
  '529433916853561199': 'text/plain',
  // Response body
  '6904637365292840921': 'Corpo da resposta',
  // Timeout before response
  '6123728028512498233': 'Espera antes de responder',
  // Seconds, 0 to 10
  '7422460794063771372': 'Segundos, de 0 a 10',
  // The timeout must be an integer between 0 and 10.
  '4994309984804411886': 'A espera precisa ser um número inteiro de 0 a 10.',
  // Retry-After
  '6340462620175900175': 'Retry-After',
  // Seconds or HTTP-date; useful with 429, 503 or 3xx. Off when empty.
  '9084058922678641455': 'Segundos ou data HTTP; útil com 429, 503 ou 3xx. Desligado quando vazio.',
  // The retry after must be a number of seconds or an HTTP date.
  '6597161126433336325': 'O Retry-After precisa ser um número de segundos ou uma data HTTP.',
  // Auto cleanup
  '4604718804205885308': 'Limpeza automática',
  // Disabled
  '5769292297914455214': 'Desligada',
  // {$START_BLOCK_IF} Keeps the {$INTERPOLATION} most recent requests; the oldest goes when a new one arrives. The URL never stops receiving. {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} No per-URL limit: the server's global limit applies. {$CLOSE_BLOCK_ELSE}
  '3410954529136217230':
    '{$START_BLOCK_IF} Guarda as {$INTERPOLATION} requisições mais recentes; a mais antiga sai quando chega uma nova. A URL nunca deixa de receber. {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} Sem limite por URL: vale o limite geral do servidor. {$CLOSE_BLOCK_ELSE}',
  // Enable CORS
  '6497827724854597414': 'Ligar CORS',
  //  Adds CORS headers so a browser page can call this URL. Applies right away.
  '4822507525201581243':
    ' Adiciona os cabeçalhos de CORS para que uma página no navegador possa chamar esta URL. Vale na hora. ',
  // Save response
  '8605570611578081197': 'Salvar resposta',
  // Reload
  '7967484035994732534': 'Recarregar',
  // Schema validation
  '2706296271281532374': 'Validação de schema',
  // On
  '8990769651805334695': 'Ligada',
  // Off
  '3500458863157551898': 'Desligada',
  //  Clear schema
  '4016244105915317530': ' Limpar schema ',
  // JSON Schema
  '5517579276909761595': 'JSON Schema',
  // {$INTERPOLATION} of 64 KB
  '9094564059744122409': '{$INTERPOLATION} de 64 KB',
  //  Validates the JSON body of each request; leave empty to turn off
  '5849679101981511442': ' Valida o corpo JSON de cada requisição; deixe vazio para desligar ',
  // Generate from a message
  '4937042507750664347': 'Gerar a partir de uma mensagem',
  //  Generate schema
  '6686833977001829353': ' Gerar schema ',
  // No request with a JSON body yet.
  '662249624956915255': 'Nenhuma requisição com corpo JSON ainda.',
  // Loading requests…
  '2288182186106794766': 'Carregando requisições…',
  //  The schema is inferred from the body of a recent JSON request. Every key present becomes required; integers become integer. Review before saving.
  '3931320358708761429':
    ' O schema é inferido do corpo de uma requisição JSON recente. Toda chave presente vira obrigatória; inteiros viram integer. Revise antes de salvar. ',
  // Dialect 2020-12, or 2019-09 / draft-07 by {$START_TAG_CODE}$schema{$CLOSE_TAG_CODE}.
  '7333366267350857834':
    'Dialeto 2020-12, ou 2019-09 / draft-07 por {$START_TAG_CODE}$schema{$CLOSE_TAG_CODE}.',
  // Only internal {$START_TAG_CODE}$ref{$CLOSE_TAG_CODE} ({$START_TAG_CODE}#/$defs/…{$CLOSE_TAG_CODE}); nothing is fetched.
  '1091048941618470914':
    'Só {$START_TAG_CODE}$ref{$CLOSE_TAG_CODE} internos ({$START_TAG_CODE}#/$defs/…{$CLOSE_TAG_CODE}); nada é baixado.',
  //  Validates the body as JSON whatever the Content-Type. Up to 20 errors are kept per request.
  '2426371204384257795':
    ' Valida o corpo como JSON seja qual for o Content-Type. Até 20 erros são guardados por requisição. ',
  // Changing the schema doesn't re-check requests already received.
  '5878384991294022278': 'Trocar o schema não reverifica as requisições já recebidas.',
  // Save schema
  '2486420749108538599': 'Salvar schema',
  // Could not load that request.
  '9031212530448938333': 'Não foi possível carregar essa requisição.',
  // That request has no JSON body to infer from.
  '3030287054716825001': 'Essa requisição não tem corpo JSON para inferir.',
  // Inferred from request {$PH}. Every key present became required; review it and save.
  '6245757403017767167':
    'Inferido da requisição {$PH}. Toda chave presente virou obrigatória; revise e salve.',
  // Signature verification
  '7193287630765550739': 'Verificação de assinatura',
  // On · {$INTERPOLATION}
  '6612773454912047663': 'Ligada · {$INTERPOLATION}',
  // How signature verification works
  '8606264208311895569': 'Como funciona a verificação de assinatura',
  // The provider signs
  '3053490193114126061': 'O provedor assina',
  // It computes an HMAC of the raw body (Stripe and Slack add a timestamp) with a secret that only you and it know.
  '957634838647189615':
    'Ele calcula um HMAC do corpo bruto (Stripe e Slack acrescentam um timestamp) com um segredo que só você e ele conhecem.',
  // The signature rides in a header
  '4845830344106385160': 'A assinatura vem num cabeçalho',
  // Each provider has its own header name and format. The table below shows where to look.
  '5201594692578618795':
    'Cada provedor tem o próprio nome e formato de cabeçalho. A tabela abaixo mostra onde olhar.',
  // This URL checks it on arrival
  '3868263935956017737': 'Esta URL confere na chegada',
  // Same formula, same secret, over the exact bytes received. Each request is marked Valid, or Invalid with the reason.
  '2201855392011790586':
    'Mesma fórmula, mesmo segredo, sobre os bytes exatos recebidos. Cada requisição fica marcada como válida, ou inválida com o motivo.',
  // Provider
  '8232773653071363045': 'Provedor',
  // Where the signature arrives
  '1619338358756037594': 'Onde a assinatura chega',
  // What is signed
  '8754270350789182797': 'O que é assinado',
  // Secret to paste
  '6659641419127491801': 'Segredo a colar',
  // Signature provider
  '8860720410155604863': 'Provedor da assinatura',
  // Saved
  '6333335057236774263': 'Salvo',
  //  Saving turns signature verification off. Requests already received keep the result they got on arrival.
  '2620361476002268199':
    ' Salvar desliga a verificação de assinatura. As requisições já recebidas mantêm o resultado que tiveram na chegada. ',
  //  The saved {$INTERPOLATION} secret is not reused for {$INTERPOLATION_1}: paste the {$INTERPOLATION_1} secret.
  '690424501516206812':
    ' O segredo salvo do {$INTERPOLATION} não é reaproveitado para o {$INTERPOLATION_1}: cole o segredo do {$INTERPOLATION_1}. ',
  // Anatomy of a {$INTERPOLATION} signature
  '5449939660123036620': 'Anatomia de uma assinatura {$INTERPOLATION}',
  //  Where to find the secret: {$INTERPOLATION}. The HMAC key is the UTF-8 bytes of the whole secret.
  '6184710892939123078':
    ' Onde achar o segredo: {$INTERPOLATION}. A chave do HMAC são os bytes UTF-8 do segredo inteiro. ',
  // * required
  '5909961776431665131': '* obrigatório',
  // Signature header
  '3249687517550773966': 'Cabeçalho da assinatura',
  // X-Signature
  '655701864299506757': 'X-Signature',
  // The header your provider sends the signature in.
  '4084604314076436851': 'O cabeçalho em que o provedor manda a assinatura.',
  // The header is required.
  '2781161697243012979': 'O cabeçalho é obrigatório.',
  // Secret
  '7896650584449704588': 'Segredo',
  // Leave blank to keep the current secret
  '1920165940832819589': 'Deixe em branco para manter o segredo atual',
  // The secret is required, up to 256 characters.
  '4344811737802546370': 'O segredo é obrigatório, até 256 caracteres.',
  // Prefix
  '2942230580917375982': 'Prefixo',
  // sha256=
  '560190666025180780': 'sha256=',
  // Optional, before the signature
  '7790051270470282422': 'Opcional, antes da assinatura',
  // Algorithm
  '4824444844546691624': 'Algoritmo',
  // Encoding
  '5223235322022344945': 'Codificação',
  // Hex
  '4769484304409254296': 'Hex',
  // Base64
  '9006998869158092634': 'Base64',
  // Timestamp tolerance (seconds)
  '8845571227674163852': 'Tolerância do timestamp (segundos)',
  // Older signed timestamps are rejected
  '7501903237452422786': 'Timestamps assinados mais antigos são recusados',
  // An integer between 1 and 86400.
  '2158922591797595494': 'Um número inteiro de 1 a 86400.',
  // Save signature
  '4196863552407318610': 'Salvar assinatura',
  // Send a signed test
  '3245840457560393248': 'Mandar um teste assinado',
  // Endpoint signing secret, whole (whsec_…)
  '5375332049105949884': 'Signing secret do endpoint, inteiro (whsec_…)',
  // Raw body, HMAC-SHA256, hex
  '8590066677204087437': 'Corpo bruto, HMAC-SHA256, hex',
  // The webhook's secret
  '47867689568526211': 'O secret do webhook',
  // Raw body, HMAC-SHA256, base64
  '2339284717760115149': 'Corpo bruto, HMAC-SHA256, base64',
  // The app's client secret
  '6542656792500449511': 'O client secret do app',
  // The app's signing secret
  '1910276609759970770': 'O signing secret do app',
  // The header you name
  '6831527637071037893': 'O cabeçalho que você indicar',
  // Raw body, HMAC-SHA1/256/512, hex or base64
  '235420540102747188': 'Corpo bruto, HMAC-SHA1/256/512, hex ou base64',
  // Any secret, up to 256 characters
  '9019065453748117756': 'Qualquer segredo, até 256 caracteres',
  // t: when Stripe signed, checked against the timestamp tolerance.
  '6392401123443390854': 't: quando o Stripe assinou, conferido contra a tolerância do timestamp.',
  // v1: the HMAC of t, a dot and the raw body.
  '1867648009797475452': 'v1: o HMAC de t, um ponto e o corpo bruto.',
  // sha256=: fixed prefix, then the HMAC of the raw body.
  '6637498136775363537': 'sha256=: prefixo fixo, depois o HMAC do corpo bruto.',
  // The whole value is the HMAC of the raw body, in base64.
  '311528976752498754': 'O valor inteiro é o HMAC do corpo bruto, em base64.',
  // v0=: version prefix, then the HMAC of "v0:", the timestamp, ":" and the raw body.
  '192443924792443647':
    'v0=: prefixo de versão, depois o HMAC de "v0:", do timestamp, de ":" e do corpo bruto.',
  // The timestamp header is checked against the timestamp tolerance.
  '6572799542561357857': 'O cabeçalho de timestamp é conferido contra a tolerância do timestamp.',
  // The prefix, if any, comes before the HMAC of the raw body in the encoding you choose.
  '7920986406005690081':
    'O prefixo, se houver, vem antes do HMAC do corpo bruto, na codificação que você escolher.',
  // None
  '6252070156626006029': 'Nenhum',
  // Requests are not checked
  '173793797808874548': 'As requisições não são verificadas',
  // Expected header: {$PH}
  '583162730550848496': 'Cabeçalho esperado: {$PH}',
  // Error updating token: {$PH}
  '5516319995848382192': 'Erro ao atualizar a URL: {$PH}',
  // Error updating token ({$PH})
  '8778369436665178386': 'Erro ao atualizar a URL ({$PH})',
  // Invalid JSON: {$PH}
  '2877214073430167764': 'JSON inválido: {$PH}',
  // The schema must be a JSON object.
  '8421392673362345166': 'O schema precisa ser um objeto JSON.',
  // fill in: {$PH}
  '7698739596209759935': 'preencha: {$PH}',
  // fix: {$PH}
  '7977999795707128636': 'corrija: {$PH}',
  // To save, {$PH}
  '6187175927533917757': 'Para salvar, {$PH}',
  // default status code
  '4438831085305413877': 'status padrão',
  // content type
  '5324455352510248299': 'content-type',
  // response body
  '7544729738209008223': 'corpo da resposta',
  // auto cleanup
  '708975333276531887': 'limpeza automática',
  // privacy
  '1204490431511805708': 'privacidade',
  // {$PH} and {$PH_1}
  '5033601776243148314': '{$PH} e {$PH_1}',
  // The {$PH} changed elsewhere since this page read it. Reload to see it before saving.
  '5228449922962488381':
    'Mudou em outro lugar desde que esta página leu a URL: {$PH}. Recarregue para ver antes de salvar.',
  // unknown
  '4097761430561209267': 'desconhecido',
  // The URL was saved, but this page could not unlock it with the new secret ({$status}). Unlock it with the new secret to keep working.
  '6652188843367116863':
    'A URL foi salva, mas esta página não conseguiu destrancá-la com o segredo novo ({$status}). Destranque-a com o segredo novo para continuar.',
  // Compare
  '2572999724448976084': 'Comparar',
  // Resize list and comparison
  '3856815953527229917': 'Redimensionar lista e comparação',
  // Request list
  '15212477353048134': 'Lista de requisições',
  // One of these requests is gone
  '557626220119457341': 'Uma dessas requisições sumiu',
  // It may have been deleted or cut by auto cleanup.
  '2796858137804922317': 'Ela pode ter sido apagada ou cortada pela limpeza automática.',
  // Back to the Inbox
  '1893751157296264967': 'Voltar para a Entrada',
  //  Could not load the requests to compare ({$INTERPOLATION}). Try again later.
  '6117950470657668546':
    ' Não foi possível carregar as requisições para comparar ({$INTERPOLATION}). Tente de novo mais tarde. ',
  // Loading comparison…
  '3807791837410938976': 'Carregando a comparação…',
  // same
  '3759984489428864895': 'igual',
  // changed
  '1790106018092279624': 'mudou',
  // only in A
  '4117917317240034051': 'só na A',
  // only in B
  '8656459452816879901': 'só na B',
  // Name
  '8953033926734869941': 'Nome',
  // A
  '2405286474181510887': 'A',
  // B
  '2021928621838842498': 'B',
  // Status
  '5611592591303869712': 'Status',
  // · changes every event
  '6788836596279146541': '· muda a cada evento',
  // Compare requests
  '3940054498322194388': 'Comparar requisições',
  // Only differences
  '7920698600920424181': 'Só as diferenças',
  // Swap A and B
  '8304663083403285224': 'Trocar A e B',
  // Close
  '7819314041543176992': 'Fechar',
  // Check
  '9041078670559726454': 'Verificação',
  // A · #{$INTERPOLATION}
  '3262879677051471024': 'A · #{$INTERPOLATION}',
  // B · #{$INTERPOLATION}
  '8885631539604473064': 'B · #{$INTERPOLATION}',
  //  {$ICU} the outcome
  '5249381234972735720': ' {$ICU} o desfecho ',
  // {VAR_PLURAL, plural, =1 {1 change explains} other {{INTERPOLATION} changes explain}}
  '3020333410881892659':
    '{VAR_PLURAL, plural, =1 {1 mudança explica} other {{INTERPOLATION} mudanças explicam}}',
  // Signature, schema and rules recorded the same result for both.
  '3587918106035694825': 'Assinatura, schema e regras gravaram o mesmo resultado nas duas.',
  //  Only what the server recorded: schema error paths, the rule conditions that failed and the signature reason.
  '6436888347208938224':
    ' Só o que o servidor gravou: os caminhos de erro do schema, as condições da regra que falharam e o motivo da assinatura. ',
  //  {$ICU} on every delivery
  '526138209295085137': ' {$ICU} a cada entrega ',
  // {VAR_PLURAL, plural, =1 {1 difference changes} other {{INTERPOLATION} differences change}}
  '7285387297710654749':
    '{VAR_PLURAL, plural, =1 {1 diferença muda} other {{INTERPOLATION} diferenças mudam}}',
  //  {$ICU}
  '8856905278208146821': ' {$ICU} ',
  // {VAR_PLURAL, plural, =1 {1 other difference} other {{INTERPOLATION} other differences}}
  '4347585172986798238':
    '{VAR_PLURAL, plural, =1 {1 outra diferença} other {{INTERPOLATION} outras diferenças}}',
  // Request
  '6170082236603228916': 'Requisição',
  // Query
  '4109205891084963566': 'Query',
  // Headers
  '6215186523080321': 'Cabeçalhos',
  // Body
  '1157630416437993334': 'Corpo',
  //  Body larger than 1 MB: comparing only the first 1 MB of each request.
  '144904939831071111': ' Corpo maior que 1 MB: comparando só o primeiro 1 MB de cada requisição. ',
  // JSON bodies, formatted with sorted keys.
  '7931526384003443015': 'Corpos JSON, formatados com as chaves em ordem.',
  // No differences
  '2062900783506435231': 'Nenhuma diferença',
  //  ⋯ {$ICU}
  '889073287300681516': ' ⋯ {$ICU} ',
  // {VAR_PLURAL, plural, =1 {1 unchanged line} other {{INTERPOLATION} unchanged lines}}
  '6484985239131178835':
    '{VAR_PLURAL, plural, =1 {1 linha igual} other {{INTERPOLATION} linhas iguais}}',
  // (empty)
  '6137649443564269922': '(vazio)',
  // 1 header changed
  '1140143385049406339': '1 header mudou',
  // {$count} headers changed
  '134294534637953691': '{$count} headers mudaram',
  // {$count} only in A
  '5422991404718192476': '{$count} só na A',
  // {$count} only in B
  '4454745045518893008': '{$count} só na B',
  // 1 body line differs
  '6100497610627702383': '1 linha do corpo difere',
  // {$count} body lines differ
  '3312264567861571169': '{$count} linhas do corpo diferem',
  // Delete all requests?
  '1483027337041318683': 'Apagar todas as requisições?',
  //  The {$ICU} of this URL will be deleted. This can't be undone.
  '6552914742506932441': ' Isto apaga {$ICU} desta URL e não dá para desfazer. ',
  // {VAR_PLURAL, plural, =1 {1 request} other {{INTERPOLATION} requests}}
  '763449991655190659':
    '{VAR_PLURAL, plural, =1 {1 requisição} other {{INTERPOLATION} requisições}}',
  // Cancel
  '2159130950882492111': 'Cancelar',
  // Delete all
  '7885093155548767595': 'Apagar todas',
  // Inbox
  '799485662157076328': 'Entrada',
  // Resize list and detail
  '3564657009456372725': 'Redimensionar lista e detalhe',
  // Request detail
  '8657335803784897027': 'Detalhe da requisição',
  // Open each new request as it arrives
  '2394242285062767175': 'Abrir cada requisição nova assim que chega',
  // Follow new
  '627815422387065776': 'Seguir novas',
  // Delete all requests
  '9124335329556182572': 'Apagar todas as requisições',
  // Back to requests
  '4161463875721849613': 'Voltar para as requisições',
  // Requests not found - invalid ID
  '582157911944558273': 'Requisições não encontradas: ID inválido',
  // Request received · {$method} {$route}
  '2886253525048467023': 'Requisição recebida · {$method} {$route}',
  // View
  '2509141182388535183': 'Ver',
  // 1 new request arrived
  '8601911208272056454': '1 requisição nova chegou',
  // {$count} new requests arrived
  '8292387230824372572': '{$count} requisições novas chegaram',
  // peak {$INTERPOLATION}
  '7771802040576367067': 'pico {$INTERPOLATION}',
  // {$hour} UTC: 1 request
  '2744556763315132070': '{$hour} UTC: 1 requisição',
  // {$hour} UTC: {$count} requests
  '5607127967257180856': '{$hour} UTC: {$count} requisições',
  // Insights
  '48442969542452939': 'Métricas',
  //  How this URL is doing, counted by the server over the most recent requests it keeps. Latency and errors of the whole instance are in Grafana.
  '8581740785382508905':
    ' Como esta URL está indo, contado pelo servidor sobre as requisições mais recentes que ele guarda. Latência e erros da instância inteira ficam no Grafana. ',
  //  Refresh
  '2172902003676402663': ' Atualizar ',
  // Open in Grafana
  '3909182396758621657': 'Abrir no Grafana',
  // Summary
  '4739818603756173797': 'Resumo',
  // Requests
  '2398407606701767789': 'Requisições',
  // of the last {$INTERPOLATION} kept
  '4244338787514857588': 'das últimas {$INTERPOLATION} guardadas',
  // {$INTERPOLATION} of these requests
  '5474134307332322819': '{$INTERPOLATION} destas requisições',
  //  The {$INTERPOLATION} most recent of the {$INTERPOLATION_1} requests this URL keeps, from {$INTERPOLATION_2} to {$INTERPOLATION_3} UTC.
  '1808402613355783098':
    ' As {$INTERPOLATION} mais recentes das {$INTERPOLATION_1} requisições que esta URL guarda, de {$INTERPOLATION_2} a {$INTERPOLATION_3} UTC. ',
  // Methods:
  '3388416697125145396': 'Métodos:',
  // No requests yet
  '1449645803904783050': 'Nenhuma requisição ainda',
  // Send a request to this URL and its numbers show up here.
  '2524390348568148473': 'Mande uma requisição para esta URL e os números dela aparecem aqui.',
  // Requests per hour
  '1853040955264579548': 'Requisições por hora',
  // Data table
  '8269518462221334396': 'Tabela de dados',
  // Hourly data
  '7800763927527128894': 'Dados por hora',
  // Requests per hour data
  '1916612874706188972': 'Dados das requisições por hora',
  // Hour (UTC)
  '8983830793696805020': 'Hora (UTC)',
  // Methods
  '563272627948836175': 'Métodos',
  // Signature failure reasons
  '5703917518480704784': 'Motivos das falhas de assinatura',
  // Reason
  '4775550080689015987': 'Motivo',
  // Schema error paths
  '3040179171345644925': 'Caminhos com erro de schema',
  // Path
  '8911059720204770105': 'Caminho',
  // Rules
  '4645345687322304891': 'Regras',
  // Who answered
  '6662424401291639738': 'Quem respondeu',
  // Answered by
  '6717755805798873217': 'Respondida por',
  // Share
  '7419704019640008953': 'Parcela',
  // Bar
  '6587679027921703718': 'Barra',
  // Near misses
  '7753383578255871160': 'Quase acertos',
  // Closest rule when none matched
  '5614787940017710801': 'Regra mais próxima quando nenhuma casou',
  // Counting the requests…
  '3233388020981412175': 'Contando as requisições…',
  // Answered by a rule
  '6016054459596084746': 'Respondidas por uma regra',
  // Default response
  '5676674766709950111': 'Resposta padrão',
  // Signature valid
  '2354205031940592367': 'Assinatura válida',
  // Signature invalid or absent
  '9024167236275460571': 'Assinatura inválida ou ausente',
  // Schema invalid
  '5650197339480402310': 'Schema inválido',
  // This URL no longer exists ({$PH}).
  '4267996398114262867': 'Esta URL não existe mais ({$PH}).',
  // Could not load the numbers of this URL ({$PH}).
  '3564961113209123599': 'Não foi possível carregar os números desta URL ({$PH}).',
  // Valid
  '2831497907036176442': 'Válida',
  // Invalid
  '4136129438009397007': 'Inválida',
  // Absent
  '4220907960737038478': 'Ausente',
  // Not checked
  '9200874308594552657': 'Não verificada',
  // Requests per hour: no requests
  '8648078979539326856': 'Requisições por hora: nenhuma requisição',
  // Requests per hour, 1 hour from {$from} to {$to} UTC; peak {$peak} at {$peakHour} UTC
  '3780459167367922169':
    'Requisições por hora, 1 hora, de {$from} a {$to} UTC; pico de {$peak} às {$peakHour} UTC',
  // Requests per hour, {$count} hours from {$from} to {$to} UTC; peak {$peak} at {$peakHour} UTC
  '7154938622917980390':
    'Requisições por hora, {$count} horas, de {$from} a {$to} UTC; pico de {$peak} às {$peakHour} UTC',
  // Your URL is ready
  '6958916196237326012': 'Sua URL está pronta',
  // Hide this panel while the URL has requests
  '776911038843722187': 'Esconder este painel enquanto a URL tiver requisições',
  //  The URL {$INTERPOLATION} doesn't exist anymore, so this new one was created. A URL expires after a period without use (7 days by default) or when someone deletes it.
  '6266008912956111437':
    ' A URL {$INTERPOLATION} não existe mais, então esta nova foi criada. Uma URL expira depois de um tempo sem uso (7 dias, por padrão) ou quando alguém a apaga. ',
  //  Requests sent to this URL show up here instantly, without reloading the page.
  '7746033190483067356':
    ' As requisições mandadas para esta URL aparecem aqui na hora, sem recarregar a página. ',
  // Copy URL
  '2184619916211262318': 'Copiar URL',
  // Open in new tab
  '6371588679924903737': 'Abrir em nova aba',
  //  Send a test request
  '7298625416707604356': ' Mandar uma requisição de teste ',
  // cURL
  '2407559330889624744': 'cURL',
  // From a terminal:
  '3869671902374295963': 'Pelo terminal:',
  // From a provider
  '5769206116143497861': 'De um provedor',
  // Paste the URL where the provider asks for the webhook address:
  '7294871109442091946': 'Cole a URL onde o provedor pede o endereço do webhook:',
  // Stripe
  '5189242243699855362': 'Stripe',
  // Developers › Webhooks › Add endpoint, as the endpoint URL.
  '286836028075652852': 'Developers › Webhooks › Add endpoint, como a URL do endpoint.',
  // GitHub
  '1534029177398918729': 'GitHub',
  //  Repository › Settings › Webhooks › Add webhook, as the Payload URL, with content type application/json.
  '1275196673143946595':
    ' Repositório › Settings › Webhooks › Add webhook, como Payload URL, com o content type application/json. ',
  // Shopify
  '849944404940753372': 'Shopify',
  // Settings › Notifications › Webhooks › Create webhook.
  '5896916650548236975': 'Settings › Notifications › Webhooks › Create webhook.',
  // Slack
  '7130095836143532477': 'Slack',
  //  Your app › Event Subscriptions › Request URL. Slack first sends a url_verification challenge; a rule can answer it.
  '3978854613926181779':
    ' Seu app › Event Subscriptions › Request URL. O Slack manda primeiro um desafio url_verification; uma regra pode respondê-lo. ',
  //  To verify their signatures, choose the provider and its secret in {$START_LINK}Checks{$CLOSE_LINK}.
  '2120942806003190118':
    ' Para verificar as assinaturas deles, escolha o provedor e o segredo em {$START_LINK}Verificações{$CLOSE_LINK}. ',
  // CLI
  '3880922231014648112': 'CLI',
  // Forward each request to your app while it runs on your machine:
  '1090406345667948782':
    'Encaminhe cada requisição para o seu app enquanto ele roda na sua máquina:',
  // What this URL can do
  '8523756288859245828': 'O que esta URL sabe fazer',
  // Answer your way
  '538539335477124837': 'Responder do seu jeito',
  // Choose the status, body, delay or fault for each request.
  '5437382525220253627': 'Escolha o status, o corpo, o atraso ou a falha de cada requisição.',
  // Check signature and schema
  '8963859255589757480': 'Conferir assinatura e schema',
  // Verify each request as it arrives.
  '6458240187642199055': 'Confira cada requisição na chegada.',
  // Resend to your app
  '5421575596412529255': 'Reenviar para o seu app',
  // Replay a request or send a new one.
  '74882804406295429': 'Reenvie uma requisição ou mande uma nova.',
  // What is a webhook?
  '352406610025407906': 'O que é um webhook?',
  //  A webhook is an HTTP request that a service sends to your URL when something happens, like an approved payment or a push to a repository. This URL captures those requests so you can see, check and answer them.
  '4038354471836751154':
    ' Um webhook é uma requisição HTTP que um serviço manda para a sua URL quando algo acontece, como um pagamento aprovado ou um push num repositório. Esta URL captura essas requisições para você ver, conferir e responder. ',
  // Sent. The URL answered {$status}; the request shows up in the list.
  '1976632029174090970': 'Enviada. A URL respondeu {$status}; a requisição aparece na lista.',
  // Could not send the test request. Check that the server is running and try again.
  '992123233688343029':
    'Não foi possível mandar a requisição de teste. Confira se o servidor está rodando e tente de novo.',
  // Forward from this browser (legacy)
  '8326407502356428266': 'Encaminhar deste navegador (legado)',
  //  Sends requests to another URL with an XHR from this browser, as the old Redirect did. The target must allow the call (CORS). Prefer Replay: the server sends it, with no CORS.
  '417687800573390249':
    ' Manda as requisições para outra URL com um XHR deste navegador, como o antigo Redirect. O destino precisa permitir a chamada (CORS). Prefira o Reenvio: quem manda é o servidor, sem CORS. ',
  // Redirect incoming requests to another URL via XHR
  '7176278684155559271': 'Redirecionar as requisições que chegam para outra URL via XHR',
  // Auto redirect
  '6041589091067527089': 'Redirecionar automaticamente',
  // Settings...
  '73372031987210492': 'Configurações...',
  //  Redirect Now
  '4091182518678529503': ' Redirecionar agora ',
  // {$START_BLOCK_IF} To {$INTERPOLATION}. Auto redirect forwards each new request while the Inbox is open. {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} Set the target in Settings... first. {$CLOSE_BLOCK_ELSE}
  '398175555240744248':
    '{$START_BLOCK_IF} Para {$INTERPOLATION}. O redirecionamento automático encaminha cada requisição nova enquanto a Entrada está aberta. {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} Defina o destino em Configurações... primeiro. {$CLOSE_BLOCK_ELSE}',
  // An http:// or https:// URL of up to 2048 characters.
  '175596795480685845': 'Uma URL http:// ou https:// de até 2048 caracteres.',
  // A whole number of seconds from {$PH} to {$PH_1}.
  '5467183237088986772': 'Um número inteiro de segundos, de {$PH} a {$PH_1}.',
  // Outbound
  '7205455315796592956': 'Saída',
  //  Replays of received requests and new sends, made by the server and recorded here. 30 sends per minute per URL.
  '5078016477839828998':
    ' Reenvios de requisições recebidas e envios novos, feitos pelo servidor e gravados aqui. 30 envios por minuto por URL. ',
  // History
  '186236568870281953': 'Histórico',
  // last 50 sent by the server, newest first
  '5025742512486566690': 'os últimos 50 mandados pelo servidor, do mais novo para o mais antigo',
  // Outbound history
  '3130007560143918363': 'Histórico de saída',
  // Target
  '4854396465510517671': 'Destino',
  // Time
  '8497528947328199741': 'Hora',
  // Replay
  '1225203534534338921': 'Reenvio',
  // Send
  '6490688569532630280': 'Envio',
  // {$INTERPOLATION} ms
  '7181536990766699085': '{$INTERPOLATION} ms',
  //  Nothing sent yet. Replay a request or send a new one.
  '7214903707257876270': ' Nada enviado ainda. Reenvie uma requisição ou mande uma nova. ',
  // New request
  '5079845697309250748': 'Nova requisição',
  // Kind of request
  '6204880661937902988': 'Tipo de requisição',
  // Replay
  '7602321393344758918': 'Reenviar',
  // Send
  '8909919426486565827': 'Enviar',
  // Outbound detail
  '1927033373433956308': 'Detalhe da saída',
  // Could not load the outbound history ({$PH}).
  '6361434880449118285': 'Não foi possível carregar o histórico de saída ({$PH}).',
  // Sent to {$INTERPOLATION}
  '7211375425009983382': 'Enviada para {$INTERPOLATION}',
  // Nothing reached the target, so there is no response.
  '8367072816890592301': 'Nada chegou ao destino, então não há resposta.',
  // Response headers
  '2382279394038645925': 'Cabeçalhos da resposta',
  // (none)
  '1961496988675941063': '(nenhum)',
  // Truncated: only the first 64 KB of the body is shown.
  '9143694446143187297': 'Cortado: só o primeiro 64 KB do corpo aparece.',
  // (no body content)
  '6657822247840547624': '(sem corpo)',
  // Sent headers
  '1976452198769794416': 'Cabeçalhos enviados',
  // Blocked
  '9081463435738465430': 'Bloqueado',
  // The server does not send to private, loopback or link-local addresses. For a target on your machine or network, start the server with WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true. Link-local (cloud metadata), multicast and 0.0.0.0 stay blocked.
  '2165560999562533130':
    'O servidor não manda para endereços privados, de loopback ou link-local. Para um destino na sua máquina ou rede, suba o servidor com WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true. Link-local (metadados de nuvem), multicast e 0.0.0.0 continuam bloqueados.',
  // DNS lookup failed
  '4373110240384910796': 'Falha na consulta DNS',
  // Check the host name of the target URL.
  '2800780815474659104': 'Confira o nome do host da URL de destino.',
  // Connection failed
  '4448321183127826742': 'Falha na conexão',
  // Check that the target is up and listening on that host and port.
  '8406462744267911565': 'Confira se o destino está no ar e escutando nesse host e porta.',
  // Timed out
  '7338109302174993209': 'Tempo esgotado',
  // The target did not answer within the timeout. Raise it (up to 30 s) or check the target.
  '3060413081699516437':
    'O destino não respondeu dentro do tempo limite. Aumente-o (até 30 s) ou confira o destino.',
  // TLS error
  '4107084505263915352': 'Erro de TLS',
  // The target's certificate or TLS setup was refused.
  '676864179676413486': 'O certificado ou a configuração TLS do destino foi recusado.',
  // Invalid URL
  '5763031177401499381': 'URL inválida',
  // Use an http:// or https:// URL of up to 2048 characters.
  '4229215127236417438': 'Use uma URL http:// ou https:// de até 2048 caracteres.',
  // Could not send the request.
  '5273255257742075075': 'Não foi possível mandar a requisição.',
  // Too many sends from this URL (30 per minute). {$PH}
  '7343086023059243503': 'Envios demais desta URL (30 por minuto). {$PH}',
  // Invalid request: {$PH}
  '6375371096123094075': 'Requisição inválida: {$PH}',
  // Invalid request (422).
  '1523062539860724005': 'Requisição inválida (422).',
  // Could not send the request ({$PH}).
  '2496121540233617795': 'Não foi possível mandar a requisição ({$PH}).',
  // Try again in {$PH} s.
  '6716485049858169476': 'Tente de novo em {$PH} s.',
  // Try again in a minute.
  '7400045174812226312': 'Tente de novo em um minuto.',
  // {$count} days
  '4007560768149428011': '{$count} dias',
  // Replay request
  '2154379236049810566': 'Reenviar requisição',
  //  The server sends a received request again (method, headers and body as received) to the target and records the answer below.
  '5321057605054159399':
    ' O servidor manda de novo uma requisição recebida (método, cabeçalhos e corpo como chegaram) para o destino e grava a resposta abaixo.\n',
  // No request to replay yet: send one to this URL first.
  '4241869674120211654':
    'Nenhuma requisição para reenviar ainda: mande uma para esta URL primeiro.',
  // Request to replay
  '6616065411331496250': 'Requisição a reenviar',
  //  The {$INTERPOLATION} signature in this request is older than the tolerance ({$INTERPOLATION_1} s): the receiver will likely reject the replay. It was signed {$INTERPOLATION_2} ago.
  '1168151816784834819':
    ' A assinatura {$INTERPOLATION} desta requisição é mais antiga que a tolerância ({$INTERPOLATION_1} s): o destino provavelmente vai recusar o reenvio. Ela foi assinada há {$INTERPOLATION_2}. ',
  //  Send as new with a fresh signature
  '4517896460686144570': ' Mandar como nova, com assinatura nova ',
  // Signs the same method, headers and body again as {$INTERPOLATION}.
  '8738633476067540079': 'Assina de novo o mesmo método, cabeçalhos e corpo como {$INTERPOLATION}.',
  //  To send it with a fresh signature, set up the signature in {$START_LINK}Checks{$CLOSE_LINK}.
  '97076677503859347':
    ' Para mandar com uma assinatura nova, configure a assinatura em {$START_LINK}Verificações{$CLOSE_LINK}. ',
  // Target URL
  '2628791643775383047': 'URL de destino',
  // http://localhost:3000/webhook
  '2126386429776005289': 'http://localhost:3000/webhook',
  // Remembered for this webhook URL
  '1459231644562504105': 'Lembrada para esta URL de webhook',
  // Keep path
  '6000711797189847398': 'Manter o caminho',
  // {$START_BLOCK_IF} Appends {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} to the target {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} The request has no path or query to append {$CLOSE_BLOCK_ELSE}
  '6980006274384158389':
    '{$START_BLOCK_IF} Acrescenta {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} ao destino {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} A requisição não tem caminho nem query para acrescentar {$CLOSE_BLOCK_ELSE}',
  // Timeout (s)
  '3923887161250817705': 'Tempo limite (s)',
  // Sending…
  '7606672167560356784': 'Enviando…',
  // Send request
  '736940570258467336': 'Mandar requisição',
  // The server sends this request to the target and records the answer below.
  '8905588064976035738':
    'O servidor manda esta requisição para o destino e grava a resposta abaixo.',
  // Method
  '8864288285279476751': 'Método',
  // URL
  '2375260419993138758': 'URL',
  // A header name, without spaces or colons.
  '444856146080413966': 'Um nome de cabeçalho, sem espaços nem dois-pontos.',
  // Value
  '6555318547274416232': 'Valor',
  // Add header
  '2179697481488400528': 'Adicionar cabeçalho',
  // Sign with this URL's signature
  '2846310330944913846': 'Assinar com a assinatura desta URL',
  // {$START_BLOCK_IF} Signs the body as {$INTERPOLATION} does; the secret stays on the server {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE}{$START_TAG_SPAN}This URL has no signature configured. Set one up in {$START_LINK}Checks{$CLOSE_LINK} to sign.{$CLOSE_TAG_SPAN}{$CLOSE_BLOCK_ELSE}
  '1043217784425152263':
    '{$START_BLOCK_IF} Assina o corpo como o {$INTERPOLATION} assina; o segredo fica no servidor {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE}{$START_TAG_SPAN}Esta URL não tem assinatura configurada. Configure uma em {$START_LINK}Verificações{$CLOSE_LINK} para assinar.{$CLOSE_TAG_SPAN}{$CLOSE_BLOCK_ELSE}',
  // Header {$number} name
  '8867882780734398358': 'Cabeçalho {$number}: nome',
  // Header {$number} value
  '4818086904062901746': 'Cabeçalho {$number}: valor',
  // Remove header {$number}
  '5481101719703585816': 'Remover o cabeçalho {$number}',
  // Signature not checked
  '8086870880132752734': 'Assinatura não verificada',
  // Received before signature checks
  '6994060993358423028': 'Recebida antes da verificação de assinatura',
  // This URL did not verify signatures
  '6681545142694176643': 'Esta URL não verificava assinaturas',
  // No sig check
  '1452553253655993268': 'Assin. não verificada',
  // {$provider} · signed {$age} s before arrival
  '7349423146264372879': '{$provider} · assinada {$age} s antes da chegada',
  // Signature absent
  '72442362552594738': 'Sem assinatura',
  // No signature
  '8999642303165983441': 'Sem assinatura',
  // Signature invalid
  '76465393282813109': 'Assinatura inválida',
  // Stale timestamp
  '8763408669913941457': 'Timestamp velho',
  // Mismatch
  '416100071486197374': 'Não confere',
  // Schema not checked
  '4721988887675549777': 'Schema não verificado',
  // Received before schema checks
  '5954772629795460019': 'Recebida antes da validação de schema',
  // This URL did not validate a schema
  '1483233087671679475': 'Esta URL não validava schema',
  // No schema
  '2979028920132715625': 'Sem schema',
  // Schema valid
  '7523410928276947334': 'Schema válido',
  // Body matches the schema
  '5053804502712579661': 'O corpo casa com o schema',
  // Body matches the schema · {$dialect}
  '6840631379395488212': 'O corpo segue o schema · {$dialect}',
  //  (+{$count} more)
  '8644129603938562559': ' (+{$count} outros)',
  // Body does not match the schema
  '2481944308641860792': 'O corpo não casa com o schema',
  // Not JSON
  '779390171048412717': 'Não é JSON',
  // 1 schema error
  '631248410066292885': '1 erro de schema',
  // {$count} schema errors
  '7486164292966200940': '{$count} erros de schema',
  // Answered by rule
  '2958936185065128502': 'Respondida por regra',
  // Answered by rule · {$status}
  '9088845257789269247': 'Respondida por regra · {$status}',
  // No rule matched
  '5200969779460711724': 'Nenhuma regra casou',
  // Closest: {$rule} · {$condition}
  '2994867950786199670': 'Mais perto: {$rule} · {$condition}',
  // Closest: {$rule} ({$count} conditions failed)
  '445548468782510116': 'Mais perto: {$rule} ({$count} condições falharam)',
  // Near miss
  '9202118846510819044': 'Quase acerto',
  // Received before rules
  '2479848593142434231': 'Recebida antes das regras',
  // No rule answered
  '2294482763688392758': 'Nenhuma regra respondeu',
  // Default
  '5607669932062416162': 'Padrão',
  // Timestamp signed with the body
  '5284952865465031727': 'Timestamp assinado junto com o corpo',
  // HMAC-SHA256 of "{t}.{raw body}"
  '5486514171305893593': 'HMAC-SHA256 de "{t}.{corpo bruto}"',
  // HMAC-SHA256 of "v0:{timestamp}:{raw body}"
  '2104609890280920664': 'HMAC-SHA256 de "v0:{timestamp}:{corpo bruto}"',
  // HMAC-{$algorithm} of the raw body
  '8420722841458093211': 'HMAC-{$algorithm} do corpo bruto',
  // HMAC-SHA256 of the raw body
  '8606252083433065721': 'HMAC-SHA256 do corpo bruto',
  // Signature valid — {$formula} matched
  '7745991131581196387': 'Assinatura válida — o {$formula} bateu',
  // Signature invalid — {$formula} did not match (signature mismatch)
  '109936488826144296': 'Assinatura inválida — o {$formula} não bateu (signature mismatch)',
  // Signature invalid — {$formula} matched, but {$reason}
  '9200910835768230509': 'Assinatura inválida — o {$formula} bateu, mas {$reason}',
  // Signature {$state} — {$reason}
  '150094202595422510': 'Assinatura {$state} — {$reason}',
  // Explanation
  '3235573132965089379': 'Explicação',
  // Explain
  '4996995639236033897': 'Explicar',
  // Written by the local model; check the facts before acting on them.
  '3258553765580616039': 'Escrito pelo modelo local; confira os fatos antes de agir.',
  // Try again
  '6650633628037596693': 'Tentar de novo',
  // Newer
  '8314700931837210100': 'Mais nova',
  // Newer (K)
  '8929474271861824015': 'Mais nova (K)',
  // Older
  '7473676707373218484': 'Mais antiga',
  // Older (J)
  '2010692186707874341': 'Mais antiga (J)',
  // More
  '5937251202465808296': 'Mais',
  // Permalink, Raw content
  '3672300871929116043': 'Link permanente, conteúdo bruto',
  // Send as new…
  '7130825112248571070': 'Mandar como nova…',
  //  Compare with…
  '5731842205788585435': ' Comparar com… ',
  //  Create schema from this request
  '3050372262779981936': ' Criar schema a partir desta requisição ',
  //  Share read-only link…
  '4627804049049897994': ' Compartilhar link só-leitura… ',
  // Permalink
  '2390582664692406528': 'Link permanente',
  // Raw content
  '3723644126381088769': 'Conteúdo bruto',
  // Delete request
  '2212258879276588888': 'Apagar requisição',
  // Request actions
  '5248427223647753150': 'Ações da requisição',
  // Replay…
  '8675553612970232351': 'Reenviar…',
  // Compare with…
  '5187370181515015220': 'Comparar com…',
  // Create rule from this request
  '4819705089003049508': 'Criar regra a partir desta requisição',
  // Create rule
  '5830995200961336312': 'Criar regra',
  // Create schema from this request
  '8719459080795725470': 'Criar schema a partir desta requisição',
  // Create schema
  '7492676639710188677': 'Criar schema',
  // Copy payload
  '324655176291010387': 'Copiar payload',
  // Copy As
  '6540883201841879405': 'Copiar como',
  // Share read-only link…
  '7056354008020030259': 'Compartilhar link só-leitura…',
  // Ask the local model why signature, schema and rules gave this result
  '4209809529690937932':
    'Perguntar ao modelo local por que assinatura, schema e regras deram este resultado',
  // Hide explanation
  '2380217756304706466': 'Esconder a explicação',
  // Explain
  '5922533565893373062': 'Explicar',
  // Request deleted
  '7911214812003933414': 'Requisição apagada',
  // Undo
  '5775346636203685655': 'Desfazer',
  // Copied payload
  '1866256676598500016': 'Payload copiado',
  // Copied request as {$format}
  '8558510828715744209': 'Requisição copiada como {$format}',
  // Request metadata
  '3858711441550962202': 'Metadados da requisição',
  // whois
  '624450861476020640': 'whois',
  // seq {$INTERPOLATION}
  '5546473895597574498': 'seq {$INTERPOLATION}',
  // id
  '3625859417927520024': 'id',
  // Copy request ID
  '5610553773809638119': 'Copiar o ID da requisição',
  // Checks on this request
  '5193673240667591740': 'Verificações desta requisição',
  //  Why? ({$INTERPOLATION})
  '5117036332461132495': ' Por quê? ({$INTERPOLATION}) ',
  // Formats valid JSON and XML bodies; off shows the body exactly as it arrived
  '9201086295740782316':
    'Formata corpos JSON e XML válidos; desligado, mostra o corpo exatamente como chegou',
  // Pretty
  '2602198438310504962': 'Formatado',
  // No body content
  '911147064956157771': 'Sem corpo',
  // Open schema
  '2546084952125981783': 'Abrir o schema',
  // Request body
  '6732843978314953948': 'Corpo da requisição',
  // Headers ({$INTERPOLATION})
  '8549348703116332280': 'Cabeçalhos ({$INTERPOLATION})',
  // No headers.
  '1860184812596458168': 'Sem cabeçalhos.',
  // Query ({$INTERPOLATION})
  '593668899509113301': 'Query ({$INTERPOLATION})',
  // Query strings
  '6780509634548819431': 'Query string',
  // No query string
  '4133497478706925850': 'Sem query string',
  // Parameters after ? in the URL appear here.
  '6328876829288703': 'Os parâmetros depois do ? na URL aparecem aqui.',
  // Form ({$INTERPOLATION})
  '7304771475900020108': 'Formulário ({$INTERPOLATION})',
  // Form values
  '2362395621208028574': 'Campos do formulário',
  // No form values
  '1005962049366257741': 'Sem campos de formulário',
  // application/x-www-form-urlencoded and multipart/form-data bodies appear here.
  '7249477555815672854':
    'Corpos application/x-www-form-urlencoded e multipart/form-data aparecem aqui.',
  // Conditions of {$rule} that failed
  '4108680511513605373': 'Condições de {$rule} que falharam',
  // How {$provider} signatures are checked
  '737535544950548874': 'Como as assinaturas da {$provider} são verificadas',
  // Expected header missing
  '2634815491241139025': 'O header esperado não veio',
  // Verified signature header
  '5712554145310947269': 'Header de assinatura verificado',
  // Signature header that failed
  '7132097022712850256': 'Header de assinatura que falhou',
  // empty
  '273835844989646128': 'vazio',
  // A {$method} with an empty body.
  '8147108938803901483': 'Um {$method} com o corpo vazio.',
  // The schema check records it as “body is not JSON”.
  '6171544939703367597': 'A verificação de schema grava “body is not JSON”.',
  // 1 schema error marked below
  '3671450292753098891': '1 erro de schema marcado abaixo',
  // {$count} schema errors marked below
  '9096323329082120149': '{$count} erros de schema marcados abaixo',
  // Value (as recorded)
  '8620213625102478787': 'Valor (como chegou)',
  // Choose a request to compare with #{$INTERPOLATION}
  '7859832298764837459': 'Escolha uma requisição para comparar com a #{$INTERPOLATION}',
  // {$START_TAG_STRONG}Compare mode.{$CLOSE_TAG_STRONG} Click a request to make it {$START_TAG_STRONG}B{$CLOSE_TAG_STRONG}. Press {$START_TAG_KBD}Esc{$CLOSE_TAG_KBD} to leave.
  '5983805913245337057':
    '{$START_TAG_STRONG}Modo de comparação.{$CLOSE_TAG_STRONG} Clique numa requisição para ela ser a {$START_TAG_STRONG}B{$CLOSE_TAG_STRONG}. Aperte {$START_TAG_KBD}Esc{$CLOSE_TAG_KBD} para sair. ',
  // {$INTERPOLATION}–{$INTERPOLATION_1} of {$INTERPOLATION_2}
  '142759852506198943': '{$INTERPOLATION}–{$INTERPOLATION_1} de {$INTERPOLATION_2}',
  //  Previous page
  '6239996843795186926': ' Página anterior ',
  //  Next page
  '5199198986727525993': ' Próxima página ',
  // {VAR_PLURAL, plural, =1 {1 new request} other {{INTERPOLATION} new requests}}
  '2738823000442264367':
    '{VAR_PLURAL, plural, =1 {1 requisição nova} other {{INTERPOLATION} requisições novas}}',
  // Requests ({$INTERPOLATION})
  '6985457637811548682': 'Requisições ({$INTERPOLATION})',
  // {VAR_PLURAL, plural, =1 {1 unread} other {{INTERPOLATION} unread}}
  '1848626050946308520': '{VAR_PLURAL, plural, =1 {1 não lida} other {{INTERPOLATION} não lidas}}',
  // Waiting for first request...
  '6098775451672579267': 'Esperando a primeira requisição...',
  // No requests match these filters
  '4967883454131782336': 'Nenhuma requisição casa com estes filtros',
  // New requests that match will appear here live.
  '153307474085686822': 'As requisições novas que casarem aparecem aqui ao vivo.',
  // Clear filters
  '6559246822757089203': 'Limpar filtros',
  // NEW
  '1147828071904789728': 'NOVA',
  // Delete
  '7022070615528435141': 'Apagar',
  // 1 request
  '5460014314878732908': '1 requisição',
  // {$count} requests
  '6147271671367032360': '{$count} requisições',
  // {$count} · newest first
  '6035936701993604722': '{$count} · mais novas primeiro',
  // {$count} · oldest first
  '2188654793312603120': '{$count} · mais antigas primeiro',
  // Delete request {$uuid}
  '3157148606438158546': 'Apagar a requisição {$uuid}',
  // Auto cleanup keeps the {$limit} most recent requests
  '8310868561287074437': 'A limpeza automática guarda as {$limit} requisições mais recentes',
  // Sorted newest first. Change order
  '6929323867588234142': 'Mais novas primeiro. Trocar a ordem',
  // Sorted oldest first. Change order
  '7247208851153160942': 'Mais antigas primeiro. Trocar a ordem',
  // from {$ip}
  '1068133721354916856': 'de {$ip}',
  // unread
  '2933800072904145816': 'não lida',
  // compared as A
  '1240661843342288427': 'comparada como A',
  // compared as B
  '7506030455509189164': 'comparada como B',
  // History test
  '4613187588784711544': 'Teste contra o histórico',
  // Test against history
  '8757397461687997049': 'Testar contra o histórico',
  // No recorded requests to test against.
  '2187455510077358653': 'Nenhuma requisição gravada para testar.',
  // {$START_TAG_STRONG}{$INTERPOLATION} of {$INTERPOLATION_1}{$CLOSE_TAG_STRONG} recorded {$ICU} would match.
  '4240998920968705930':
    '{$START_TAG_STRONG}{$INTERPOLATION} de {$INTERPOLATION_1}{$CLOSE_TAG_STRONG} {$ICU}. ',
  // {VAR_PLURAL, plural, =1 {request} other {requests}}
  '8230506787034350305':
    '{VAR_PLURAL, plural, =1 {requisição gravada casaria} other {requisições gravadas casariam}}',
  // Only the {$INTERPOLATION} most recent requests were tested.
  '6289177450660401926': 'Só as {$INTERPOLATION} requisições mais recentes foram testadas.',
  // Would not match ({$INTERPOLATION})
  '7537023677815855960': 'Não casariam ({$INTERPOLATION})',
  // Open the request in a new tab
  '1403890484979816069': 'Abrir a requisição em nova aba',
  // Open request {$uuid}
  '1549963127344206416': 'Abrir a requisição {$uuid}',
  // Editor view
  '437546908340999973': 'Visão do editor',
  // Form
  '6907807228975360219': 'Formulário',
  // JSON
  '2742664813202759813': 'JSON',
  // In plain words:
  '4996286689602167385': 'Em palavras:',
  //  The rules changed elsewhere since this page read them, so nothing was saved. Reload the rules, then save again: your changes stay in the editor.
  '7694925179236514276':
    ' As regras mudaram em outro lugar desde que esta página as leu, então nada foi salvo. Recarregue as regras e salve de novo: suas alterações continuam no editor. ',
  //  This rule no longer exists in the list; Save adds it as a new rule.
  '5274355215251337018': ' Esta regra não está mais na lista; Salvar a adiciona como regra nova. ',
  // Priority
  '2734022681675842051': 'Prioridade',
  // Lowest first
  '8652945755434536606': 'A menor primeiro',
  // Enabled
  '4816216590591222133': 'Ligada',
  // Rule parts
  '1603751809721155075': 'Partes da regra',
  //  All conditions must match. Leave a section empty to accept anything. After a test, each condition says how it did.
  '5729691912537780217':
    ' Todas as condições precisam casar. Deixe uma seção vazia para aceitar qualquer coisa. Depois de um teste, cada condição diz como foi. ',
  //  Some near misses were recorded before condition tracking: their conditions come from the recorded phrase.
  '858861506031829926':
    ' Alguns quase acertos foram gravados antes do registro por condição: as condições deles vêm da frase gravada. ',
  // Any
  '3184700926171002527': 'Qualquer',
  // Path match
  '6229203245897643271': 'Casamento do caminho',
  // Any path
  '3108651526003208577': 'Qualquer caminho',
  // Equals
  '6424246633820870206': 'É igual a',
  // Starts with
  '8863611568205528132': 'Começa com',
  // Matches regex
  '1660683262139231443': 'Casa com a regex',
  // /payments
  '7235421195392282299': '/payments',
  // After the URL's token; "" is "/"
  '7875631797502906881': 'Depois do token da URL; "" é "/"',
  //  The path includes this URL's token. Rule paths are relative to the URL (what comes after /{$INTERPOLATION}), so this rule never matches.
  '5932563079024737539':
    ' O caminho inclui o token desta URL. Os caminhos das regras são relativos à URL (o que vem depois de /{$INTERPOLATION}), então esta regra nunca casa. ',
  //  Remove the token from the path
  '838577534283306722': ' Tirar o token do caminho ',
  // Operator
  '1179184907489210406': 'Operador',
  // Condition
  '2838129566011107043': 'Condição',
  // JSONPath
  '971892641146501942': 'JSONPath',
  // $.status
  '6699899154911691719': '$.status',
  // Equals (JSON)
  '904482514307360381': 'É igual a (JSON)',
  // "paid", 10, true
  '6537026039485973795': '"paid", 10, true',
  // Empty: the path exists
  '917408878876318167': 'Vazio: o caminho existe',
  // Text
  '6162693758764653365': 'Texto',
  // Key order is ignored
  '6627245072730118087': 'A ordem das chaves é ignorada',
  //  Add body condition
  '5120317169293791316': ' Adicionar condição do corpo ',
  // Set up signature verification in Checks
  '330777829988418611': 'Configure a verificação de assinatura em Verificações',
  // Set up schema validation in Checks
  '1711681564122380362': 'Configure a validação de schema em Verificações',
  // Fault
  '7586043432986819460': 'Falha',
  // Simulate a network failure
  '136630442196246950': 'Simular uma falha de rede',
  //  With a fault, the status, headers, body, delay and dribble are ignored: the request is recorded, then the connection fails.
  '7512463070098652496':
    ' Com uma falha, o status, os cabeçalhos, o corpo, o atraso e o conta-gotas são ignorados: a requisição é gravada e a conexão falha. ',
  //  Add response header
  '7844985063139280587': ' Adicionar cabeçalho da resposta ',
  // Template
  '5610425955750546094': 'Template',
  // Handlebars in the body and in header values
  '2115828389023521024': 'Handlebars no corpo e nos valores dos cabeçalhos',
  // Template helpers
  '917630306877755063': 'Helpers de template',
  // Delay
  '1418101411356139094': 'Atraso',
  // Before answering; up to 60 s
  '8308321026273336632': 'Antes de responder; até 60 s',
  // Delay (ms)
  '8009699707499085537': 'Atraso (ms)',
  // Delay min (ms)
  '469714917588149371': 'Atraso mínimo (ms)',
  // Delay max (ms)
  '3787494651146932489': 'Atraso máximo (ms)',
  // Delay median (ms)
  '486878575504038889': 'Atraso mediano (ms)',
  // Sigma
  '2547429542584013376': 'Sigma',
  // Spread; capped at {$INTERPOLATION} ms
  '1365956893657787158': 'Dispersão; limitada a {$INTERPOLATION} ms',
  // Dribble
  '3606692355726237093': 'Conta-gotas',
  // Chunks
  '7220858327592433788': 'Pedaços',
  // Dribble duration (ms)
  '6865995082922078305': 'Duração do conta-gotas (ms)',
  // Send the body in chunks spread evenly over the duration
  '7814961949316902186': 'Manda o corpo em pedaços espalhados por igual ao longo da duração',
  //  Optional. The rule only matches while the scenario is in the required state, and moves it to the new state when it answers. Every scenario starts at "Started". Use it for "fail 3 times, then succeed".
  '4047257826264828822':
    ' Opcional. A regra só casa enquanto o cenário está no estado exigido e o leva para o estado novo quando responde. Todo cenário começa em "Started". Use para "falhar 3 vezes, depois dar certo". ',
  // Scenario name
  '6399898663628521445': 'Nome do cenário',
  // Empty: no scenario
  '1275945778309773831': 'Vazio: sem cenário',
  // Required state
  '8002019310447878952': 'Estado exigido',
  // Empty: any state
  '5879452221360165378': 'Vazio: qualquer estado',
  // New state
  '8152379597441096069': 'Estado novo',
  // Empty: keeps the state
  '4039102480098358947': 'Vazio: mantém o estado',
  // Scenario {$INTERPOLATION} with this rule
  '7720850937080278289': 'Cenário {$INTERPOLATION} com esta regra',
  // Rule JSON
  '9084383820735529436': 'JSON da regra',
  // Check which of the recorded requests this rule would match, without saving it
  '2308625564938613918': 'Ver quais das requisições gravadas esta regra casaria, sem salvá-la',
  //  Test against history
  '8194247567496147362': ' Testar contra o histórico ',
  //  Save
  '3620188369327429839': ' Salvar ',
  //  Missed here by {$ICU}
  '9194388078939579027': ' Falhou aqui em {$ICU} ',
  // {VAR_PLURAL, plural, =1 {1 recorded request} other {{INTERPOLATION} recorded requests}}
  '7651032547637262387':
    '{VAR_PLURAL, plural, =1 {1 requisição gravada} other {{INTERPOLATION} requisições gravadas}}',
  //  Runs the rule as it is in the editor, unsaved, on the {$INTERPOLATION} most recent requests at most.
  '7704144480551140198':
    ' Roda a regra como está no editor, sem salvar, nas {$INTERPOLATION} requisições mais recentes, no máximo. ',
  // With the rules before it
  '7601400113286827407': 'Com as regras antes dela',
  //  Based on the rule that answered at the time; ignores scenario state.
  '8823180892239058592': ' Com base na regra que respondeu na hora; ignora o estado dos cenários. ',
  // This rule is off; turn it on to answer.
  '78167379411983619': 'Esta regra está desligada; ligue-a para responder.',
  // {$INTERPOLATION} would now get {$INTERPOLATION_1} from this rule
  '8758745832004953313': '{$INTERPOLATION} agora receberiam {$INTERPOLATION_1} desta regra',
  // {$INTERPOLATION} still answered by earlier rule {$INTERPOLATION_1}
  '7868313625932043703':
    '{$INTERPOLATION} continuam respondidas pela regra anterior {$INTERPOLATION_1}',
  //  Could not read the recorded requests for this preview.
  '1714866520584713830': ' Não foi possível ler as requisições gravadas para esta prévia. ',
  // Testing…
  '9133703782808481756': 'Testando…',
  // No test yet: click "Test against history".
  '8894637699792041269': 'Nenhum teste ainda: clique em "Testar contra o histórico".',
  // Match
  '6619869754055745168': 'Casamento',
  // Scenario
  '7268724710243443192': 'Cenário',
  // Test
  '6563391987554512024': 'Teste',
  // HTTP method
  '8624416928888064138': 'Método HTTP',
  // Path after the URL's token
  '1656544899489212385': 'Caminho depois do token da URL',
  // Full URL
  '6386098750267477929': 'URL completa',
  // Query parameter "id"
  '7818212838014643543': 'Parâmetro de query "id"',
  // Header, name in lowercase
  '3216630040386122731': 'Cabeçalho, nome em minúsculas',
  // Raw request body
  '3667939077277017111': 'Corpo bruto da requisição',
  // Sequence number of the request
  '2306532116425752435': 'Número de sequência da requisição',
  // Current time, ISO-8601 UTC
  '5502848920751236771': 'Hora atual, ISO-8601 UTC',
  // Current time, Java date pattern
  '8232932648510896618': 'Hora atual, padrão de data do Java',
  // Random UUID
  '824664977630159598': 'UUID aleatório',
  // Random text: ALPHANUMERIC, NUMERIC or HEX (length 16 by default)
  '8928108372928571997':
    'Texto aleatório: ALPHANUMERIC, NUMERIC ou HEX (16 de comprimento, por padrão)',
  // Arithmetic: '+', '-', '*', '/'
  '7797929411085924471': "Aritmética: '+', '-', '*', '/'",
  // New rule
  '609790514962379936': 'Nova regra',
  // Add query condition
  '2822509143046858985': 'Adicionar condição de query',
  // Add header condition
  '2420128804747895988': 'Adicionar condição de cabeçalho',
  // equals
  '3697582909018473071': 'é igual a',
  // contains
  '326106955650253946': 'contém',
  // matches regex
  '3599663444722178290': 'casa com a regex',
  // is present
  '9159433559441189171': 'está presente',
  // is absent
  '1773801036438612572': 'está ausente',
  // Contains
  '6238291467288576076': 'Contém',
  // Equal to JSON
  '2577169615394187504': 'É igual ao JSON',
  // Absent (no signature header)
  '8104314127848761778': 'Ausente (sem cabeçalho de assinatura)',
  // Fixed
  '4108478337308251505': 'Fixo',
  // Uniform (random)
  '2482237160502701032': 'Uniforme (aleatório)',
  // Log-normal
  '3761080073073715220': 'Log-normal',
  // An integer between 0 and {$PH} (ms).
  '5348000120438028024': 'Um número inteiro de 0 a {$PH} (ms).',
  // The name is required.
  '2251827586065267500': 'O nome é obrigatório.',
  // The priority must be an integer of at least 1.
  '2207428802465937153': 'A prioridade precisa ser um número inteiro de pelo menos 1.',
  // The path is required.
  '2667481719713596528': 'O caminho é obrigatório.',
  // The JSONPath is required.
  '5946675482642489113': 'O JSONPath é obrigatório.',
  // The value must be valid JSON.
  '4060759168736211664': 'O valor precisa ser um JSON válido.',
  // The status must be an integer between 100 and 599.
  '6742532429707368197': 'O status precisa ser um número inteiro de 100 a 599.',
  // At least the min, up to 60000 (ms).
  '5417346972907244808': 'No mínimo o valor mínimo, até 60000 (ms).',
  // A number of at least 0.
  '7746830683176421346': 'Um número de pelo menos 0.',
  // An integer between 1 and 100.
  '8088872202130126469': 'Um número inteiro de 1 a 100.',
  // Up to 100 characters.
  '7452353939910904225': 'Até 100 caracteres.',
  // Edit rule {$PH}
  '2547758668904389075': 'Editar a regra {$PH}',
  // Fails on {$failed} of {$tested} tested
  '1999225047819466463': 'Falha em {$failed} de {$tested} testadas',
  // Passes on all {$tested} tested
  '2113082443290172072': 'Passa nas {$tested} testadas',
  // Query {$number} name
  '233478066120015611': 'Query {$number}: nome',
  // Query {$number} operator
  '265456987234451664': 'Query {$number}: operador',
  // Query {$number} value
  '6779815515272671145': 'Query {$number}: valor',
  // Remove query {$number}
  '501341756846129966': 'Remover a query {$number}',
  // Header {$number} operator
  '6408646595548645248': 'Cabeçalho {$number}: operador',
  // Body {$number} type
  '8308355925924578923': 'Corpo {$number}: tipo',
  // Body {$number} path
  '823922318292377054': 'Corpo {$number}: caminho',
  // Body {$number} equals
  '522421462930466892': 'Corpo {$number}: é igual a',
  // Body {$number} value
  '6158416231215601815': 'Corpo {$number}: valor',
  // Remove body {$number}
  '6438795118930117974': 'Remover a condição do corpo {$number}',
  // Response header {$number} name
  '4348450316430411614': 'Cabeçalho da resposta {$number}: nome',
  // Response header {$number} value
  '581355660005497699': 'Cabeçalho da resposta {$number}: valor',
  // Remove response header {$number}
  '5365124439588054789': 'Remover o cabeçalho da resposta {$number}',
  // Could not test the rule ({$PH}).
  '2941832689797231625': 'Não foi possível testar a regra ({$PH}).',
  // The rule must be a JSON object.
  '6588126907468031121': 'A regra precisa ser um objeto JSON.',
  // Could not save the rules (unknown).
  '928725473809988578': 'Não foi possível salvar as regras (desconhecido).',
  // Could not save the rules ({$PH}).
  '2939453186195223024': 'Não foi possível salvar as regras ({$PH}).',
  // Rule {$position} › {$field}:
  '1619912122646364208': 'Regra {$position} › {$field}: ',
  // Describe the rule
  '7034436938184564320': 'Descreva a regra',
  // What should the rule do?
  '1377608685058341473': 'O que a regra deve fazer?',
  // Answer 429 with Retry-After 5 for POST on /payments
  '5421087220437655747': 'Responder 429 com Retry-After 5 para POST em /payments',
  // Paths are relative to this URL (say /payments). Nothing is saved until you click Save.
  '4605968302108106293':
    'Os caminhos são relativos a esta URL (por exemplo, /payments). Nada é salvo até você clicar em Salvar.',
  //  Your description mentions this URL. The rule's path is only what comes after /{$INTERPOLATION}: describe it as /payments, not as the full URL.
  '1071461579321275486':
    ' A descrição cita esta URL. O caminho da regra é só o que vem depois de /{$INTERPOLATION}: descreva como /payments, não como a URL inteira. ',
  // Use the open request as example ({$INTERPOLATION})
  '6865598316148725689': 'Usar a requisição aberta como exemplo ({$INTERPOLATION})',
  //  Suggest
  '159796731387745428': ' Sugerir ',
  // Suggestion errors
  '7525535972409983324': 'Erros da sugestão',
  // Suggestion
  '703654473580242036': 'Sugestão',
  //  Suggested in {$ICU}. Review the rule below and click Save to keep it.
  '9101299821667311506':
    ' Sugerida em {$ICU}. Revise a regra abaixo e clique em Salvar para mantê-la. ',
  // {VAR_PLURAL, plural, =1 {1 attempt} other {{INTERPOLATION} attempts}}
  '5786928460558931082':
    '{VAR_PLURAL, plural, =1 {1 tentativa} other {{INTERPOLATION} tentativas}}',
  // When any request
  '9202146983718243336': 'Quando qualquer requisição',
  // When a {$methods}
  '1192478214337819242': 'Quando um {$methods}',
  // query {$name}
  '5189704128861120796': 'a query {$name}',
  // header {$name}
  '671740933703996045': 'o cabeçalho {$name}',
  //  has {$conditions}
  '7728608720362041319': ' tiver {$conditions}',
  // , while scenario {$scenario} is in {$state}
  '7427457293979710682': ', enquanto o cenário {$scenario} estiver em {$state}',
  // , {$response}
  '2116228078712248832': ', {$response}',
  //  and moves scenario {$scenario} to {$state}
  '5612461601284425645': ' e levar o cenário {$scenario} para {$state}',
  // a valid signature
  '2366840414129770031': 'uma assinatura válida',
  // an invalid signature
  '8845664058059729277': 'uma assinatura inválida',
  // no signature header
  '4126643192592460277': 'nenhum cabeçalho de assinatura',
  // a body valid against the schema
  '4330561618798698484': 'um corpo válido pelo schema',
  // a body invalid against the schema
  '2616683234706928614': 'um corpo inválido pelo schema',
  //  to {$path}
  '916173346180633514': ' para {$path}',
  //  to a path starting with {$prefix}
  '1041177723918929444': ' para um caminho que começa com {$prefix}',
  //  to a path matching {$regex}
  '6120465592973573416': ' para um caminho que casa com {$regex}',
  // {$target} present
  '399192746694499653': '{$target} presente',
  // no {$target}
  '4526765948885602539': 'sem {$target}',
  // {$target} equal to {$value}
  '1745170143742075582': '{$target} igual a {$value}',
  // {$target} containing {$value}
  '3116102020133134623': '{$target} contendo {$value}',
  // {$target} matching {$regex}
  '2436855986268198376': '{$target} casando com {$regex}',
  // {$path} present
  '4716783619636203183': '{$path} presente',
  // {$path} equal to {$value}
  '3734887181811744453': '{$path} igual a {$value}',
  // a body equal to the given JSON
  '4416594301411065209': 'um corpo igual ao JSON dado',
  // a body equal to {$value}
  '227978063814580931': 'um corpo igual a {$value}',
  // a body containing {$value}
  '6512901344878179955': 'um corpo contendo {$value}',
  // a body matching {$regex}
  '5011744985685492691': 'um corpo casando com {$regex}',
  // fail with {$fault}
  '2554878304407464729': 'falhar com {$fault}',
  //  with a templated body
  '7686440254764373882': ' com o corpo de template',
  //  after {$delay}
  '7739113087185754206': ' depois de {$delay}',
  // answer {$status}{$body}{$delay}
  '5566218938374452301': 'responder {$status}{$body}{$delay}',
  // about {$median} ms
  '1888478615595597552': 'cerca de {$median} ms',
  // {$first} or {$last}
  '8212926519424367459': '{$first} ou {$last}',
  // {$first} and {$last}
  '5762149304068294084': '{$first} e {$last}',
  // Connection reset (TCP RST)
  '50377479265602245': 'Conexão reiniciada (TCP RST)',
  // Empty response (close without writing)
  '7376426893026105254': 'Resposta vazia (fecha sem escrever)',
  // Malformed chunk (valid status and headers)
  '2686611374263089455': 'Chunk malformado (status e cabeçalhos válidos)',
  // Random data, then close
  '591981001989807613': 'Dados aleatórios, depois fecha',
  // Fault: {$PH}{$PH_1}
  '1515005386435880546': 'Falha: {$PH}{$PH_1}',
  // Body and header values are templates
  '5220783512275914726': 'O corpo e os valores dos cabeçalhos são templates',
  // Delay: {$PH}
  '1806199785485314113': 'Atraso: {$PH}',
  // Scenario {$scenario}: {$from} → {$to}
  '391099507236654123': 'Cenário {$scenario}: {$from} → {$to}',
  // any state
  '4607248102861950784': 'qualquer estado',
  // keeps the state
  '5422596717510972238': 'mantém o estado',
  //  Checked by priority, lowest first (ties in list order). The first enabled rule that matches answers the request; with none, the URL answers with its default response.
  '4665377075231924686':
    ' Conferidas por prioridade, a menor primeiro (empate na ordem da lista). A primeira regra ligada que casa responde a requisição; sem nenhuma, a URL responde com a resposta padrão. ',
  //  New rule
  '9165932520457161115': ' Nova regra ',
  // Replace all rules with the ones in a JSON file
  '4173945230632532972': 'Trocar todas as regras pelas de um arquivo JSON',
  //  Import
  '727310260821422069': ' Importar ',
  // Rules JSON file
  '619699644984878010': 'Arquivo JSON de regras',
  // Download the saved rules as JSON
  '8556016147397832585': 'Baixar as regras salvas em JSON',
  //  Export
  '4375214631223740583': ' Exportar ',
  //  The rules changed elsewhere since this page read them, so nothing was saved. Reload to see the current rules, then try again.
  '5676955896221894273':
    ' As regras mudaram em outro lugar desde que esta página as leu, então nada foi salvo. Recarregue para ver as regras atuais e tente de novo. ',
  // This rule no longer exists.
  '7016076853172263386': 'Esta regra não existe mais.',
  // Hits over the last {$ICU}.
  '8274610231537942565': 'Acertos {$ICU}.',
  // {VAR_PLURAL, plural, =1 {1 request kept} other {{INTERPOLATION} requests kept}}
  '7371048342128462743':
    '{VAR_PLURAL, plural, =1 {na última requisição guardada} other {nas últimas {INTERPOLATION} requisições guardadas}}',
  // Rule table
  '6904943491245640212': 'Tabela de regras',
  // Reorder
  '5721589179245249262': 'Reordenar',
  // Behavior
  '7779249123661446825': 'Comportamento',
  // Hits
  '4793456052173041220': 'Acertos',
  // Actions
  '3193976279273491157': 'Ações',
  // Drag, or use the arrow keys, to change the order
  '6085721866820141077': 'Arraste, ou use as setas do teclado, para mudar a ordem',
  // Enable rule {$INTERPOLATION}
  '5435142594205571808': 'Ligar a regra {$INTERPOLATION}',
  // Move up
  '8502065112576581103': 'Subir',
  // Move up (checked earlier)
  '5437684036423709854': 'Subir (conferida antes)',
  // Move down
  '2207764482815871800': 'Descer',
  // Move down (checked later)
  '7059595352322663003': 'Descer (conferida depois)',
  // Edit
  '7585826646011739428': 'Editar',
  //  Delete
  '6660925946511264619': ' Apagar ',
  //  No rules yet. Every request gets the URL's default response.
  '4356305880738650678': ' Nenhuma regra ainda. Toda requisição recebe a resposta padrão da URL. ',
  // When no rule matches
  '1971050335506975022': 'Quando nenhuma regra casa',
  // Answered {$INTERPOLATION}
  '510967272684994108': 'Respondeu {$INTERPOLATION}',
  // Reorder {$rule}
  '7851725313429979857': 'Reordenar {$rule}',
  //  · 1 near miss
  '6079555798105880101': ' · 1 quase acerto',
  //  · {$count} near misses
  '4310678172376392590': ' · {$count} quase acertos',
  // Answered {$answered}{$nearMisses}
  '5761756633808174113': 'Respondeu {$answered}{$nearMisses}',
  // Rule saved
  '6780557385928670316': 'Regra salva',
  // {$rule} moved to position {$position} of {$count}
  '5187806192635689626': '{$rule} foi para a posição {$position} de {$count}',
  // Rule deleted
  '2977727935765571611': 'Regra apagada',
  // The file is not valid JSON.
  '2741448267815220083': 'O arquivo não é um JSON válido.',
  // The file must contain a JSON list of rules.
  '2188018162120172622': 'O arquivo precisa conter uma lista JSON de regras.',
  // Imported {$count} rules
  '7573871593633533768': '{$count} regras importadas',
  // Could not load the request {$PH} ({$PH_1}).
  '3992814709031259779': 'Não foi possível carregar a requisição {$PH} ({$PH_1}).',
  // Could not load the rules ({$PH}).
  '2621589954778433638': 'Não foi possível carregar as regras ({$PH}).',
  // Network fault
  '3343973467318013215': 'Falha de rede',
  // stays in {$INTERPOLATION}
  '1583668281576007461': 'fica em {$INTERPOLATION}',
  // No enabled rule uses this scenario yet.
  '4664522660511832479': 'Nenhuma regra ligada usa este cenário ainda.',
  // Scenarios
  '1470503036790362672': 'Cenários',
  //  A rule with a scenario only answers in its required state, then moves the scenario to its new state. Every scenario starts at "Started".
  '8325056894296571913':
    ' Uma regra com cenário só responde no estado exigido e depois leva o cenário ao estado novo. Todo cenário começa em "Started". ',
  // Read the current states again
  '3468362183638571454': 'Ler de novo os estados atuais',
  // Move every scenario back to Started
  '4116228028354126363': 'Voltar todos os cenários para Started',
  //  Reset all
  '4760846516919742648': ' Reiniciar todos ',
  // Scenario table
  '3720212523757594428': 'Tabela de cenários',
  // Current state
  '4849277051965761197': 'Estado atual',
  // Set state
  '7564985964620616970': 'Definir estado',
  // State
  '5911214550882917183': 'Estado',
  // New state of {$INTERPOLATION}
  '8256760822294678696': 'Novo estado de {$INTERPOLATION}',
  //  Set state
  '8744168147430634241': ' Definir estado ',
  // No scenario state yet.
  '7287268288391150525': 'Nenhum estado de cenário ainda.',
  // Scenario {$INTERPOLATION}
  '3647917601104716260': 'Cenário {$INTERPOLATION}',
  // Scenario {$scenario} set to {$state}
  '2073198119882707396': 'Cenário {$scenario} definido como {$state}',
  // Scenarios reset to {$state}
  '1524236363010811687': 'Cenários reiniciados em {$state}',
  // Could not update the scenarios ({$status}).
  '2276106420599073954': 'Não foi possível atualizar os cenários ({$status}).',
  // Filter requests
  '7506409234432679914': 'Filtrar requisições',
  // Search
  '4580988005648117665': 'Buscar',
  // Search path, IP, header or body
  '7816062410528188063': 'Buscar no caminho, IP, header ou corpo',
  // Search (/)
  '3185098119447169060': 'Buscar (/)',
  // Filters
  '4163272119298020373': 'Filtros',
  //  More filters
  '1642449050488603077': ' Mais filtros ',
  //  Clear filters
  '6634790566400449864': ' Limpar filtros ',
  // Copy as anzol wait-for
  '1673917569694962048': 'Copiar como anzol wait-for',
  // 1 request matches · search runs on the server over all {$total}
  '54548846186041710': '1 requisição casa · a busca roda no servidor, sobre todas as {$total}',
  // {$count} requests match · search runs on the server over all {$total}
  '4728142484903370833':
    '{$count} requisições casam · a busca roda no servidor, sobre todas as {$total}',
  // Copied. The text search is not part of wait-for: only the filters went into --match.
  '8331056956976948859':
    'Copiado. A busca por texto não entra no wait-for: só os filtros foram para o --match.',
  // Copied the anzol wait-for command.
  '2357434999679102400': 'Comando anzol wait-for copiado.',
  // Redirection Settings
  '788519496287490371': 'Configurações de redirecionamento',
  //  Redirection allows you to automatically, or with a click, send incoming requests to another URL via XHR. The content will be redirected, and you can choose a static method to use.
  '7941862739883598695':
    ' O redirecionamento manda as requisições que chegam para outra URL via XHR, automaticamente ou com um clique. O conteúdo é redirecionado, e dá para escolher um método fixo. ',
  //  Headers to be passed along can be provided as a comma-separated list. Be sure to ensure these headers are allowed in any security settings (Cross-Domain)
  '2511685163288285324':
    ' Os cabeçalhos a repassar podem ser dados numa lista separada por vírgulas. Confira se eles são permitidos nas configurações de segurança (Cross-Domain). ',
  // Since XHR is used, there might be issues with Cross-Domain Requests.
  '3907556543618805840': 'Como o XHR é usado, pode haver problemas com requisições entre domínios.',
  // Redirect to
  '464005320174432128': 'Redirecionar para',
  // http://localhost
  '698546006864055708': 'http://localhost',
  // Redirect Headers
  '5776452087709992802': 'Cabeçalhos a redirecionar',
  // e.g. x-token,referer
  '9001969817717874425': 'ex.: x-token,referer',
  // HTTP Method
  '6769004555858769001': 'Método HTTP',
  // Default (use request method)
  '3215927471856292774': 'Padrão (usa o método da requisição)',
  // Redirected request to {$url}. Status: {$status}
  '8165836203746506483': 'Requisição redirecionada para {$url}. Status: {$status}',
  // Error redirecting request to {$url}. Status: {$status}
  '5848676174481124755': 'Erro ao redirecionar a requisição para {$url}. Status: {$status}',
  // Share read-only link
  '3881892841334066836': 'Compartilhar link só-leitura',
  //  Anyone with the link sees this request only, read-only, until it expires. No secret is needed.
  '6022442036507439913':
    ' Quem tiver o link vê só esta requisição, sem poder mudar nada, até ele expirar. Não precisa de segredo. ',
  // Expires in
  '4230599882607893875': 'Expira em',
  // Hide sensitive values
  '3168532569793551134': 'Esconder valores sensíveis',
  //  Hides credential headers (Authorization, Cookie, API keys, the signature header) and query values whose name has token, key, secret, password or signature.
  '3906344023337131069':
    ' Esconde os cabeçalhos de credencial (Authorization, Cookie, chaves de API, o cabeçalho da assinatura) e os valores de query cujo nome tem token, key, secret, password ou signature. ',
  //  The request body is not masked: the link shows it exactly as received.
  '4776315704249375444':
    ' O corpo da requisição não é mascarado: o link o mostra exatamente como chegou. ',
  // Read-only link
  '8094561349966607605': 'Link só-leitura',
  // Expires {$INTERPOLATION}
  '4146411457225714951': 'Expira {$INTERPOLATION}',
  //  Copy link
  '6143795228406387052': ' Copiar link ',
  // Active links
  '1122183606548293857': 'Links ativos',
  //  expires {$INTERPOLATION} · {$START_BLOCK_IF} sensitive values hidden {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} all values shown {$CLOSE_BLOCK_ELSE}{$START_BLOCK_IF_1} · this request {$CLOSE_BLOCK_IF}
  '317944432976388770':
    ' expira {$INTERPOLATION} · {$START_BLOCK_IF} valores sensíveis escondidos {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} todos os valores à mostra {$CLOSE_BLOCK_ELSE}{$START_BLOCK_IF_1} · esta requisição {$CLOSE_BLOCK_IF}',
  //  Revoke
  '2438803034455350509': ' Revogar ',
  // No active links for this URL.
  '4448658094695204319': 'Nenhum link ativo para esta URL.',
  //  Create link
  '4859350702674712542': ' Criar link ',
  // Revoke link {$id}
  '960117636857124775': 'Revogar o link {$id}',
  // create the link
  '633537937116220590': 'criar o link',
  // Link revoked
  '6644784554144787727': 'Link revogado',
  // revoke the link
  '1060400676506569756': 'revogar o link',
  // Copied link
  '3198248282936256481': 'Link copiado',
  // load the active links
  '3445716779265435198': 'carregar os links ativos',
  // Could not {$action}.
  '2782600301985371685': 'Não foi possível {$action}.',
  // Could not {$action} ({$status}){$detail}
  '2755372319248692235': 'Não foi possível {$action} ({$status}){$detail}',
  //  Shared read-only link · expires {$INTERPOLATION}
  '137361549104371657': ' Link só-leitura compartilhado · expira {$INTERPOLATION} ',
  // This link is not available
  '3639045973623864497': 'Este link não está disponível',
  // It may have expired, been revoked, or the request may have been deleted.
  '3273295538698935574':
    'Ele pode ter expirado ou sido revogado, ou a requisição pode ter sido apagada.',
  // Ask whoever shared it for a new link.
  '8622000804318804963': 'Peça um link novo a quem o compartilhou.',
  //  Could not load the shared request ({$INTERPOLATION}). Try again later.
  '5559034119714713477':
    ' Não foi possível carregar a requisição compartilhada ({$INTERPOLATION}). Tente de novo mais tarde. ',
  // Help
  '7911416166208830577': 'Ajuda',
  // Keyboard shortcuts
  '7005745151564974365': 'Atalhos de teclado',
  // Turn single-key shortcuts off in Settings.
  '119407959208203761': 'Desligue os atalhos de uma tecla em Configurações.',
  // About
  '1726363342938046830': 'Sobre',
  // Anzol, open source under the MIT license.
  '5695241118696703046': 'Anzol, código aberto sob a licença MIT.',
  // G then I, R, C, O, N
  '7040474656175352156': 'G e depois I, R, C, O, N',
  // Go to Inbox, Rules, Checks, Outbound, Insights
  '2519926290844920206': 'Ir para Entrada, Regras, Verificações, Saída, Métricas',
  // Copy the webhook URL
  '8898447637806868278': 'Copiar a URL do webhook',
  // New URL
  '1181290163704192854': 'Nova URL',
  // Search requests
  '1989514738415409079': 'Buscar requisições',
  // This help
  '7699330960857960553': 'Esta ajuda',
  // Close this panel
  '6602700438890249747': 'Fechar este painel',
  // Settings
  '4930506384627295710': 'Configurações',
  // Theme
  '7103588127254721505': 'Tema',
  // Density
  '4583661526350417559': 'Densidade',
  // Language
  '2826581353496868063': 'Idioma',
  // The language changes when the page reloads.
  '8106173394979980158': 'O idioma muda quando a página recarrega.',
  // Reload now
  '8491974984518503778': 'Recarregar agora',
  //  Single-key shortcuts (G then I, C, N, ?…). They never fire while typing.
  '1856278147796350981':
    ' Atalhos de uma tecla (G e depois I, C, N, ?…). Eles nunca disparam enquanto você digita. ',
  // System
  '29832309535656200': 'Sistema',
  // Light
  '413116577994876478': 'Claro',
  // Dark
  '3892161059518616136': 'Escuro',
  // Comfortable
  '597360384236921330': 'Confortável',
  // Compact
  '4046649033157042513': 'Compacta',
  // Anzol
  '8985871462726005345': 'Anzol',
  // Search requests (/)
  '5478414183275041974': 'Buscar requisições (/)',
  // More actions
  '117068237894470695': 'Mais ações',
  // Send, new URL, delete URL, settings and help
  '6801798798110034903': 'Enviar, nova URL, apagar a URL, configurações e ajuda',
  // New URL (N)
  '131281839817929607': 'Nova URL (N)',
  // URL sections
  '190122656479276377': 'Seções da URL',
  // Help and shortcuts (?)
  '5036287821443969284': 'Ajuda e atalhos (?)',
  // {$destination} (G then {$key})
  '1735799584802064851': '{$destination} (G e depois {$key})',
  // {$destination}, {$count} unread
  '814164756853505191': '{$destination}, {$count} não lidas',
  // {$destination}, needs attention
  '1469418318150552308': '{$destination}, pede atenção',
  // Edit URL
  '5639322219019388338': 'Editar a URL',
  // Copy CLI command
  '438815826227761396': 'Copiar o comando do CLI',
  // Lock
  '5635860082093871248': 'Trancar',
  // Delete URL
  '2138164891962720900': 'Apagar a URL',
  // Webhook URL
  '8582782147430932081': 'URL do webhook',
  // Copy URL (C)
  '5765890918485292193': 'Copiar a URL (C)',
  // · keeps {$INTERPOLATION}
  '2776081700505103837': '· guarda {$INTERPOLATION}',
  // Schema validation on. Open Checks
  '8301965875232311588': 'Validação de schema ligada. Abrir Verificações',
  // Send a request from the server: open Outbound
  '6940018098964837895': 'Mandar uma requisição pelo servidor: abrir Saída',
  // More URL actions
  '9064031518606878552': 'Mais ações da URL',
  // Edit URL, open in new tab, copy CLI command, delete URL
  '5707574018885283160': 'Editar a URL, abrir em nova aba, copiar o comando do CLI, apagar a URL',
  // Signature verification: {$provider}. Open Checks
  '7448920973178183690': 'Verificação de assinatura: {$provider}. Abrir Verificações',
  // {$stored}, auto cleanup keeps the {$limit} most recent
  '1886402781235704922': '{$stored}, a limpeza automática guarda as {$limit} mais recentes',
  // Delete this URL?
  '8240225322229955099': 'Apagar esta URL?',
  //  The URL {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} stops receiving, and its requests, rules and history are deleted. This can't be undone. A new URL opens in its place.
  '1451742787852545337':
    ' A URL {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} deixa de receber, e as requisições, as regras e o histórico dela são apagados. Não dá para desfazer. Uma URL nova abre no lugar. ',
  // Copied the CLI command.
  '8435024155600644601': 'Comando do CLI copiado.',
  // URL locked
  '7160754438595707040': 'URL trancada',
  // URL deleted. A new URL is open.
  '423054761492435849': 'URL apagada. Uma URL nova está aberta.',
  // Could not delete the URL ({$status}).
  '3286163688907254875': 'Não foi possível apagar a URL ({$status}).',
  // New URL created
  '527966257423045718': 'Nova URL criada',
  // Error creating token: {$messages}
  '5484573448941431902': 'Erro ao criar a URL: {$messages}',
  // Error creating token ({$status})
  '2520860617031932539': 'Erro ao criar a URL ({$status})',
  // Create New URL
  '4429755721790420681': 'Criar nova URL',
  //  This URL could not be found. It might have been automatically deleted.{$LINE_BREAK} Please create a new URL.
  '8359383791425232856':
    ' Esta URL não foi encontrada. Ela pode ter sido apagada automaticamente.{$LINE_BREAK} Crie uma URL nova. ',
  //  The new URL answers 200 with an empty body until you change it. Signature, schema and the rest are in Checks.
  '5064926752845036721':
    ' A URL nova responde 200 com o corpo vazio até você mudar. Assinatura, schema e o resto ficam em Verificações. ',
  // Customize response
  '2961669848729020227': 'Personalizar a resposta',
  // Seconds or HTTP-date; useful with 429, 503 or 3xx
  '3760983201194713094': 'Segundos ou data HTTP; útil com 429, 503 ou 3xx',
  // Keeps the {$INTERPOLATION} most recent requests
  '551564307771458202': 'Guarda as {$INTERPOLATION} requisições mais recentes',
  //  Create
  '7941428823403788384': ' Criar ',
  // fill in: {$fields}
  '7615313807359232783': 'preencha: {$fields}',
  // fix: {$fields}
  '5913194384140121592': 'corrija: {$fields}',
  // To save, {$parts}
  '1634369451692992793': 'Para salvar, {$parts}',
  // This URL is protected
  '5373322810477456488': 'Esta URL é protegida',
  //  Enter the secret to view the requests, rules and history of {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}.
  '8486491065980257305':
    ' Digite o segredo para ver as requisições, as regras e o histórico de {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}. ',
  // Webhooks sent to the URL are still captured without the secret.
  '1672118851921750943':
    'Os webhooks mandados para a URL continuam sendo capturados sem o segredo.',
  // Enter the secret.
  '3351263094026524262': 'Digite o segredo.',
  //  Unlock
  '4677347038463775354': ' Destrancar ',
  //  Too many attempts. Try again in {$ICU}.
  '1415917445817505479': ' Tentativas demais. Tente de novo em {$ICU}. ',
  // {VAR_PLURAL, plural, =1 {1 second} other {{INTERPOLATION} seconds}}
  '7010851370082512618': '{VAR_PLURAL, plural, =1 {1 segundo} other {{INTERPOLATION} segundos}}',
  // URL unlocked
  '3637233564088078863': 'URL destrancada',
  // Wrong secret. Try again.
  '6779109023100559816': 'Segredo errado. Tente de novo.',
  // Could not unlock the URL ({$status}).
  '4820442917323397437': 'Não foi possível destrancar a URL ({$status}).',
  // Copy
  '4323470180912194028': 'Copiar',
  // Nothing here.
  '4451967922263063703': 'Nada aqui.',
  // Live
  '8610504659433544583': 'Ao vivo',
  // New requests appear here as they arrive
  '3981700339777898411': 'As requisições novas aparecem aqui assim que chegam',
  // Connecting…
  '5040941334959805672': 'Conectando…',
  // Opening the real-time connection
  '6175965777948899135': 'Abrindo a conexão em tempo real',
  // Reconnecting…
  '6435128530540717306': 'Reconectando…',
  // The real-time connection dropped; trying again
  '8436854779844607643': 'A conexão em tempo real caiu; tentando de novo',
  // Offline
  '313850810538580916': 'Offline',
  // Not receiving in real time; reload to try again
  '9007747183585189500': 'Sem receber em tempo real; recarregue para tentar de novo',
  // {$width} pixels
  '3434214639687233214': '{$width} pixels',
  // No response
  '7913570146997711091': 'Sem resposta',
};
