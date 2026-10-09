// Tradução pt-BR da tela, carregada em runtime pelo `loadLocale` (docs/padroes-angular.md, § i18n).
// Chaves: os ids de `messages.json`, gerado por `npx ng extract-i18n`; o comentário é o texto
// em inglês. Placeholders ({$…}) e ICU iguais aos da fonte; o locale.spec.ts confere.
export const translations: Record<string, string> = {
  // The AI call failed (unknown).
  '2216355350989627843': 'A chamada à IA falhou (desconhecido).',
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
  // Could not toggle CORS.
  '3959730088680902960': 'Não foi possível alternar o CORS.',
  // Health
  '2041675390931385838': 'Saúde',
  // Refresh
  '1102717806459547726': 'Atualizar',
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
  // {$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$START_LINK}{$INTERPOLATION}{$CLOSE_LINK} valid
  '9060021169051208683':
    '{$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$START_LINK}{$INTERPOLATION}{$CLOSE_LINK} válidas',
  // {$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$START_LINK}{$INTERPOLATION}{$CLOSE_LINK} invalid
  '7174448461388720825':
    '{$START_TAG_SPAN}{$CLOSE_TAG_SPAN}{$START_LINK}{$INTERPOLATION}{$CLOSE_LINK} inválidas',
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
  '1887623065097316356':
    'É o segredo de leitura: abre a URL em outro navegador e na API (cabeçalho X-Anzol-Secret). 8 a 256 caracteres.',
  // The secret must have 8 to 256 characters.
  '6941653480005557323': 'O segredo precisa ter de 8 a 256 caracteres.',
  // Confirm secret
  '1185216263758586139': 'Confirme o segredo',
  // The secrets do not match.
  '8661255126898122827': 'Os segredos não conferem.',
  // Saving removes the secret: anyone with the URL will see its requests.
  '7336699927416654716': 'Salvar remove o segredo: quem tiver a URL vai ver as requisições dela.',
  // Decrypted requests keep the decrypted value. The server removes the secret only with decryption off and no decrypted request stored. To remove it, turn decryption off (it can be in this same save) and delete the decrypted requests; or keep the secret.
  '4563539906052769861':
    'Requisições decifradas guardam o valor decifrado. O servidor só remove o segredo com a decifra desligada e nenhuma requisição decifrada gravada. Para remover, desligue a decifra (pode ser neste mesmo salvar) e apague as decifradas; ou mantenha o segredo.',
  // The server refused: this URL has decrypted requests. Delete them before removing the secret, or keep the secret.
  '6213658804702770639':
    'O servidor recusou: há requisições decifradas nesta URL. Apague-as antes de remover o segredo, ou mantenha o segredo.',
  // The server refused: decryption is on. Turn it off and delete any decrypted requests before removing the secret, or keep the secret.
  '964826114271213227':
    'O servidor recusou: a decifra está ligada. Desligue-a e apague as requisições decifradas que houver antes de remover o segredo, ou mantenha o segredo.',
  // Discard
  '3823219296477075982': 'Descartar',
  // New secret
  '7702420551206203313': 'Novo segredo',
  // Secret to view
  '8726240724963767305': 'Segredo para ver',
  // Response
  '6552449600024516046': 'Resposta',
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
  // The timeout must be an integer between 0 and 10.
  '4994309984804411886': 'A espera precisa ser um número inteiro de 0 a 10.',
  // Retry-After
  '6340462620175900175': 'Retry-After',
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
  // Reload
  '7967484035994732534': 'Recarregar',
  // Schema validation
  '2706296271281532374': 'Validação de schema',
  // E2EE
  '1120152822886112434': 'Decifra',
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
  // No request with a JSON body yet.
  '662249624956915255': 'Nenhuma requisição com corpo JSON ainda.',
  // Loading requests…
  '2288182186106794766': 'Carregando requisições…',
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
  // Anatomy of a {$INTERPOLATION} signature
  '5449939660123036620': 'Anatomia de uma assinatura {$INTERPOLATION}',
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
  '6147551848935825364': 'Segredo do HMAC',
  // Leave blank to keep the current secret
  '1920165940832819589': 'Deixe em branco para manter o segredo atual',
  // The secret is required, up to 256 characters.
  '4344811737802546370': 'O segredo é obrigatório, até 256 caracteres.',
  // Prefix
  '2942230580917375982': 'Prefixo',
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
  // An integer between 1 and 86400.
  '2158922591797595494': 'Um número inteiro de 1 a 86400.',
  // Send a signed test
  '3245840457560393248': 'Mandar um teste assinado',
  // The app's client secret
  '6542656792500449511': 'O client secret do app',
  // None
  '6252070156626006029': 'Nenhum',
  // Requests are not checked
  '173793797808874548': 'As requisições não são verificadas',
  // {$encoding} of HMAC-{$algorithm}(body)
  '4183363098626322521': '{$encoding} do HMAC-{$algorithm}(corpo)',
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
  // unknown
  '4097761430561209267': 'desconhecido',
  // Compare
  '2572999724448976084': 'Comparar',
  // Resize list and comparison
  '3856815953527229917': 'Redimensionar lista e comparação',
  // Request list
  '15212477353048134': 'Lista de requisições',
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
  // ⋯ {$ICU}
  '927387446773884935': '⋯ {$ICU}',
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
  // All {$count} headers
  '161049480210663794': 'Todos os {$count} headers',
  // 1 identical header hidden
  '8059953916755911493': '1 header igual escondido',
  // {$count} identical headers hidden
  '2785637161823178330': '{$count} headers iguais escondidos',
  // 1 unchanged line hidden. Show them
  '801177145871744473': '1 linha igual escondida. Mostrar',
  // {$count} unchanged lines hidden. Show them
  '4286455686589260222': '{$count} linhas iguais escondidas. Mostrar',
  // Method {$value}
  '5084813980770254689': 'Método {$value}',
  // Path {$value}
  '514355960469125400': 'Caminho {$value}',
  // No query
  '3009536505899258472': 'Sem query',
  // Query {$value}
  '8229021867167958969': 'Query {$value}',
  // Request line
  '100085521649993870': 'Linha da requisição',
  // method, path and query are the same
  '4185829569096081231': 'método, caminho e query são os mesmos',
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
  // {$hour}: 1 request
  '5496979186847827795': '{$hour}: 1 requisição',
  // {$hour}: {$count} requests
  '3054627359281954205': '{$hour}: {$count} requisições',
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
  // {$INTERPOLATION} of these requests
  '5474134307332322819': '{$INTERPOLATION} destas requisições',
  //  The {$INTERPOLATION} most recent of the {$INTERPOLATION_1} requests this URL keeps, from {$START_TAG_TIME}{$INTERPOLATION_2}{$CLOSE_TAG_TIME} to {$START_TAG_TIME_1}{$INTERPOLATION_3}{$CLOSE_TAG_TIME}.
  '2585615423957965856':
    ' As {$INTERPOLATION} mais recentes das {$INTERPOLATION_1} requisições que esta URL guarda, de {$START_TAG_TIME}{$INTERPOLATION_2}{$CLOSE_TAG_TIME} a {$START_TAG_TIME_1}{$INTERPOLATION_3}{$CLOSE_TAG_TIME}. ',
  // Methods:
  '3388416697125145396': 'Métodos:',
  // No requests yet
  '1449645803904783050': 'Nenhuma requisição ainda',
  // Send a request to this URL and its numbers show up here.
  '2524390348568148473': 'Mande uma requisição para esta URL e os números dela aparecem aqui.',
  // Requests per hour
  '1853040955264579548': 'Requisições por hora',
  // local time (UTC{$INTERPOLATION})
  '7943578839355815128': 'hora local (UTC{$INTERPOLATION})',
  // Data table
  '8269518462221334396': 'Tabela de dados',
  // Hourly data
  '7800763927527128894': 'Dados por hora',
  // Requests per hour data
  '1916612874706188972': 'Dados das requisições por hora',
  // Hour
  '3284697869924237097': 'Hora',
  // Methods
  '563272627948836175': 'Métodos',
  // Signature failure reasons
  '5703917518480704784': 'Motivos das falhas de assinatura',
  // Decryption failure reasons
  '2745039701708034811': 'Motivos das falhas de decifra',
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
  '7419704019640008953': 'Compartilhar',
  // Bar
  '6587679027921703718': 'Barra',
  // Near misses
  '7753383578255871160': 'Quase acertos',
  // Closest rule when none matched
  '5614787940017710801': 'Regra mais próxima quando nenhuma casou',
  // Answers by status
  '2253959432758805530': 'Respostas por status',
  // {VAR_PLURAL, plural, =1 {Counted over the newest request.} other {Counted over the newest {INTERPOLATION} requests.}}
  '1144277527212253758':
    '{VAR_PLURAL, plural, =1 {Contado na requisição mais nova.} other {Contado nas {INTERPOLATION} requisições mais novas.}}',
  // No answers yet.
  '7671642818829633701': 'Nenhuma resposta ainda.',
  // Closest rule: {$rule}
  '3869916993611205037': 'Regra mais próxima: {$rule}',
  // All requests
  '4551006451537993722': 'Todas as requisições',
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
  // Requests per hour, 1 hour from {$from} to {$to}, local time; peak {$peak} at {$peakHour}
  '3777714026261237248':
    'Requisições por hora, 1 hora, de {$from} a {$to}, hora local; pico de {$peak} em {$peakHour}',
  // Requests per hour, {$count} hours from {$from} to {$to}, local time; peak {$peak} at {$peakHour}
  '3076982277501395605':
    'Requisições por hora, {$count} horas, de {$from} a {$to}, hora local; pico de {$peak} em {$peakHour}',
  // Your URL is ready
  '6958916196237326012': 'Sua URL está pronta',
  // Hide this panel while the URL has requests
  '776911038843722187': 'Esconder este painel enquanto a URL tiver requisições',
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
  // Response headers
  '2382279394038645925': 'Cabeçalhos da resposta',
  // (none)
  '1961496988675941063': '(nenhum)',
  // Sent headers
  '1976452198769794416': 'Cabeçalhos enviados',
  // Blocked
  '9081463435738465430': 'Bloqueado',
  // The server does not send to private, loopback or link-local addresses. For a target on your machine or network, start the server with ANZOL_OUTBOUND_ALLOW_PRIVATE=true. Link-local (cloud metadata), multicast and 0.0.0.0 stay blocked.
  '2280768893811336375':
    'O servidor não manda para endereços privados, de loopback ou link-local. Para um destino na sua máquina ou rede, suba o servidor com ANZOL_OUTBOUND_ALLOW_PRIVATE=true. Link-local (metadados de nuvem), multicast e 0.0.0.0 continuam bloqueados.',
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
  // No request to replay yet: send one to this URL first.
  '4241869674120211654':
    'Nenhuma requisição para reenviar ainda: mande uma para esta URL primeiro.',
  // Request to replay
  '6616065411331496250': 'Requisição a reenviar',
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
  // {$START_BLOCK_IF} Appends {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} to the target {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} The request has no path or query to append {$CLOSE_BLOCK_ELSE}
  '6980006274384158389':
    '{$START_BLOCK_IF} Acrescenta {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} ao destino {$CLOSE_BLOCK_IF}{$START_BLOCK_ELSE} A requisição não tem caminho nem query para acrescentar {$CLOSE_BLOCK_ELSE}',
  // Timeout (s)
  '3923887161250817705': 'Tempo limite (s)',
  // Sending…
  '7606672167560356784': 'Enviando…',
  // Send request
  '736940570258467336': 'Mandar requisição',
  // Method
  '8864288285279476751': 'Método',
  // URL
  '2375260419993138758': 'URL',
  // Value
  '6555318547274416232': 'Valor',
  // Add header
  '2179697481488400528': 'Adicionar cabeçalho',
  // Sign with this URL's signature
  '2846310330944913846': 'Assinar com a assinatura desta URL',
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
  // {$reason}
  '6474081033615562232': 'o HMAC bateu, mas {$reason}',
  // Signature invalid
  '76465393282813109': 'Assinatura inválida',
  // Stale timestamp
  '8763408669913941457': 'Timestamp velho',
  // Mismatch
  '416100071486197374': 'Não confere',
  // Malformed
  '858472238147711112': 'Formato',
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
  // Received before rules
  '2479848593142434231': 'Recebida antes das regras',
  // No rule answered
  '2294482763688392758': 'Nenhuma regra respondeu',
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
  '109936488826144296':
    'Assinatura inválida — o {$formula} não bateu (signature mismatch): segredo diferente nos dois lados, ou corpo alterado no caminho.',
  // Signature invalid — {$formula} matched, but {$reason}
  '9200910835768230509': 'Assinatura inválida — o {$formula} bateu, mas {$reason}',
  // Signature {$state} — {$reason}
  '150094202595422510': 'Assinatura {$state} — {$reason}',
  // valid
  '7503125606381083319': 'válida',
  // invalid
  '5803994708044197526': 'inválida',
  // absent
  '8551676869035882346': 'ausente',
  // valid
  '6992343261774394257': 'válida',
  // invalid
  '5293212363437508464': 'inválida',
  // unknown_kid
  '6364275002283565910': 'com chave desconhecida',
  // absent
  '8040894524429193284': 'em claro',
  // signature mismatch
  '6658909463270317571': 'o HMAC não bateu (signature mismatch)',
  // malformed header
  '5614377539724595183': 'o cabeçalho não está no formato esperado (malformed header)',
  // header {$header} absent
  '2590303353863801781': 'faltou o cabeçalho {$header}',
  // timestamp outside tolerance ({$seconds} s)
  '8115838192454396102':
    'o timestamp está a {$seconds} s de agora, fora da tolerância (timestamp outside tolerance)',
  // Check that the HMAC secret here is the sender's; if it is, something on the way altered the body.
  '1124365388298629180':
    'Confira se o segredo do HMAC daqui é o mesmo do remetente; se for, algo no caminho alterou o corpo.',
  // Check that the HMAC secret here is the same as {$provider}'s; if it is, something on the way altered the body.
  '2512571080916805776':
    'Confira se o segredo do HMAC daqui é o mesmo do {$provider}; se for, algo no caminho alterou o corpo.',
  // Compare the Prefix and the Encoding (hex/base64) in Checks › Signature with the header that arrived, in the Headers tab. If the sender is off the agreed format (no prefix, for example), the sender fixes it; if the sender's format is the agreed one, adjust the Prefix and the Encoding here.
  '8889743004754572638':
    'Compare o Prefixo e a Codificação (hex/base64) de Verificações › Assinatura com o cabeçalho que chegou, na aba Cabeçalhos. Se o remetente mandou fora do combinado (sem o prefixo, por exemplo), quem corrige é ele; se o formato dele é o combinado, ajuste o Prefixo e a Codificação aqui.',
  // The header does not follow {$provider}'s format: confirm the sender is {$provider}, or use Generic.
  '650505594850629909':
    'O cabeçalho não segue o formato do {$provider}: confirme que o remetente é o {$provider}, ou use Generic.',
  // The sender did not sign, or the header configured here is another.
  '6322115884395614581': 'O remetente não assinou, ou o cabeçalho configurado aqui é outro.',
  // {$provider} did not sign (no secret set there).
  '4754275997427626891': 'O {$provider} não assinou (sem segredo cadastrado lá).',
  // The timestamp is above the tolerance set here: late redelivery or a wrong clock; or raise the tolerance.
  '758622676241767451':
    'O timestamp passa da tolerância configurada: reentrega atrasada ou relógio errado; ou aumente a tolerância.',
  // The timestamp is above the {$seconds} s tolerance: late redelivery or a wrong clock; or raise the tolerance.
  '5829324004263661322':
    'O timestamp passa da tolerância de {$seconds} s: reentrega atrasada ou relógio errado; ou aumente a tolerância.',
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
  //  Create schema from this request
  '3050372262779981936': ' Criar schema a partir desta requisição ',
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
  // Copy payload
  '324655176291010387': 'Copiar payload',
  // Copy As
  '6540883201841879405': 'Copiar como',
  // Share read-only link…
  '7056354008020030259': 'Compartilhar link só-leitura…',
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
  // The decrypted value is not in this link. To see it, open the URL in Anzol with the read secret.
  '4915544080899440645':
    'O valor decifrado não está neste link. Para vê-lo, abra a URL no Anzol com o segredo de leitura.',
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
  // No recorded requests to test against.
  '2187455510077358653': 'Nenhuma requisição gravada para testar.',
  // Only the {$INTERPOLATION} most recent requests were tested.
  '6289177450660401926': 'Só as {$INTERPOLATION} requisições mais recentes foram testadas.',
  // Would not match ({$INTERPOLATION})
  '7537023677815855960': 'Não casariam ({$INTERPOLATION})',
  // Open request {$uuid}
  '1549963127344206416': 'Abrir a requisição {$uuid}',
  // Editor view
  '437546908340999973': 'Visão do editor',
  // Form
  '6907807228975360219': 'Formulário',
  // JSON
  '2742664813202759813': 'JSON',
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
  '6229203245897643271': 'Como casar o caminho',
  // Equals
  '6424246633820870206': 'É igual a',
  // Starts with
  '8863611568205528132': 'Começa com',
  // /payments
  '7235421195392282299': '/payments',
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
  // Fault
  '7586043432986819460': 'Falha',
  // Simulate a network failure
  '136630442196246950': 'Simular uma falha de rede',
  //  With a fault, the status, headers, body, delay and dribble are ignored: the request is recorded, then the connection fails.
  '7512463070098652496':
    ' Com uma falha, o status, os cabeçalhos, o corpo, o atraso e o conta-gotas são ignorados: a requisição é gravada e a conexão falha. ',
  //  The request is recorded, then nothing is sent until the client gives up (at most 5 minutes). The status, headers, body, delay and dribble are ignored.
  '8706195172885417779':
    ' A requisição é gravada e nada é enviado até o cliente desistir (no máximo 5 minutos). Status, cabeçalhos, corpo, atraso e conta-gotas são ignorados. ',
  //  The request is recorded; the status and headers are sent (with the body's Content-Length), then nothing until the client gives up (at most 5 minutes). Delay and dribble are ignored.
  '6103224503698173865':
    ' A requisição é gravada; status e cabeçalhos são enviados (com o Content-Length do corpo) e depois nada até o cliente desistir (no máximo 5 minutos). Atraso e conta-gotas são ignorados. ',
  //  The request is recorded; the status, headers and half the body are sent, then the connection closes. Delay and dribble are ignored.
  '6526356406957568090':
    ' A requisição é gravada; status, cabeçalhos e metade do corpo são enviados, e a conexão fecha. Atraso e conta-gotas são ignorados. ',
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
  // Rule JSON
  '9084383820735529436': 'JSON da regra',
  //  Save
  '3620188369327429839': ' Salvar ',
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
  //  Could not read the recorded requests for this preview.
  '1714866520584713830': ' Não foi possível ler as requisições gravadas para esta prévia. ',
  // Testing…
  '9133703782808481756': 'Testando…',
  // No test yet: click "Test against history".
  '8894637699792041269': 'Nenhum teste ainda: clique em "Testar contra o histórico".',
  // Match
  '6619869754055745168': 'Condições',
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
  // equals
  '3697582909018473071': 'é igual a',
  // contains
  '326106955650253946': 'contém',
  // is present
  '9159433559441189171': 'está presente',
  // is absent
  '1773801036438612572': 'está ausente',
  // Contains
  '6238291467288576076': 'Contém',
  // Equal to JSON
  '2577169615394187504': 'É igual ao JSON',
  // Fixed
  '4108478337308251505': 'Fixo',
  // Log-normal
  '3761080073073715220': 'Log-normal',
  // An integer between 0 and {$PH} (ms).
  '5348000120438028024': 'Um número inteiro de 0 a {$PH} (ms).',
  // The name is required.
  '2251827586065267500': 'O nome é obrigatório.',
  // The priority must be an integer of at least 1.
  '2207428802465937153': 'A prioridade precisa ser um número inteiro de pelo menos 1.',
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
  // A body is required for this fault.
  '7919303706590829193': 'Esta falha precisa de um corpo.',
  // Up to 100 characters.
  '7452353939910904225': 'Até 100 caracteres.',
  // Edit rule {$PH}
  '2547758668904389075': 'Editar a regra {$PH}',
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
  // , in {$chance}% of the matching requests
  '280051474596829594': ', em {$chance}% das requisições que casam',
  // , {$response}
  '2116228078712248832': ', {$response}',
  //  and moves scenario {$scenario} to {$state}
  '5612461601284425645': ' e levar o cenário {$scenario} para {$state}',
  // , from {$from} until {$until}
  '7852927927290231760': ', de {$from} até {$until}',
  // , starting at {$from}
  '2562815811429817030': ', a partir de {$from}',
  // , until {$until}
  '2834321984474819290': ', até {$until}',
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
  // Hang (no response until the client gives up)
  '1158852838414144182': 'Travar (sem resposta até o cliente desistir)',
  // Stall after headers (status and headers, then nothing)
  '8981790536022781849': 'Parar depois dos cabeçalhos (status e cabeçalhos, depois nada)',
  // Truncated body (half the body, then close)
  '524222624119811788': 'Corpo cortado (metade do corpo, depois fecha)',
  // Fault: {$PH}{$PH_1}
  '1515005386435880546': 'Falha: {$PH}{$PH_1}',
  // Body and header values are templates
  '5220783512275914726': 'O corpo e os valores dos cabeçalhos são templates',
  // Delay: {$PH}
  '1806199785485314113': 'Atraso: {$PH}',
  // Chance
  '1183797493670218572': 'Chance',
  // Chance: {$chance}% of the matching requests
  '5242297083211751360': 'Chance: {$chance}% das requisições que casam',
  // Window
  '1551676159021844754': 'Janela',
  // Active from {$from} until {$until} (UTC)
  '555038280772081166': 'Ativa de {$from} até {$until} (UTC)',
  // Active from {$from} (UTC)
  '2167757105873429137': 'Ativa a partir de {$from} (UTC)',
  // Active until {$until} (UTC)
  '7737695945172037268': 'Ativa até {$until} (UTC)',
  // Scenario {$scenario}: {$from} → {$to}
  '391099507236654123': 'Cenário {$scenario}: {$from} → {$to}',
  // any state
  '4607248102861950784': 'qualquer estado',
  // keeps the state
  '5422596717510972238': 'mantém o estado',
  //  New rule
  '9165932520457161115': ' Nova regra ',
  // Rules JSON file
  '619699644984878010': 'Arquivo JSON de regras',
  //  The rules changed elsewhere since this page read them, so nothing was saved. Reload to see the current rules, then try again.
  '5676955896221894273':
    ' As regras mudaram em outro lugar desde que esta página as leu, então nada foi salvo. Recarregue para ver as regras atuais e tente de novo. ',
  // This rule no longer exists.
  '7016076853172263386': 'Esta regra não existe mais.',
  // Rule table
  '6904943491245640212': 'Tabela de regras',
  // Reorder
  '5721589179245249262': 'Reordenar',
  // Drag, or use the arrow keys, to change the order
  '6085721866820141077': 'Arraste, ou use as setas do teclado, para mudar a ordem',
  // Move up
  '8502065112576581103': 'Subir',
  // Move up (checked earlier)
  '5437684036423709854': 'Subir (conferida antes)',
  // Move down
  '2207764482815871800': 'Descer',
  // Move down (checked later)
  '7059595352322663003': 'Descer (conferida depois)',
  // When no rule matches
  '1971050335506975022': 'Quando nenhuma regra casa',
  // Reorder {$rule}
  '7851725313429979857': 'Reordenar {$rule}',
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
  // Search path, IP, header, body or decrypted value
  '8418663352099230135': 'Buscar no caminho, IP, header, corpo ou valor decifrado',
  // Search (/)
  '3185098119447169060': 'Buscar (/)',
  // Filters
  '4163272119298020373': 'Filtros',
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
  //  The decrypted attribute is not in the link: whoever opens it sees the body as it arrived (with the JWE) and the decryption result, without the value.
  '8036630662021816851':
    ' O atributo decifrado não vai no link: quem o abrir vê o corpo como chegou (com o JWE) e o resultado da decifra, sem o valor. ',
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
  // Edit URL
  '5639322219019388338': 'Configurar a URL',
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
  // Lab · expires {$relative}
  '8594661010844912779': 'Laboratório · expira {$relative}',
  // E2EE lab URL, expires {$relative}. Open Checks
  '5917116743026150008': 'URL de laboratório E2EE, expira {$relative}. Abrir Verificações',
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
  // This URL is protected
  '5373322810477456488': 'Esta URL é protegida',
  //  Enter the secret to view the requests, rules and history of {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}.
  '8486491065980257305':
    ' Digite o segredo para ver as requisições, as regras e o histórico de {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}. ',
  // Webhooks sent to the URL are still captured without the secret.
  '1672118851921750943':
    'Os webhooks mandados para a URL continuam sendo capturados sem o segredo.',
  // Secret
  '8379108869363699178': 'Segredo de leitura',
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
  // {$what}, 1 request. Open in the Inbox
  '9133523512567191017': '{$what}, 1 requisição. Abrir na Entrada',
  // {$what}, {$count} requests. Open in the Inbox
  '1722199096429218269': '{$what}, {$count} requisições. Abrir na Entrada',
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
  // Turn off
  '7889909065193723586': 'Desligar',
  // Example header
  '1580302866004562110': 'Cabeçalho de exemplo',
  // {$INTERPOLATION} settings
  '3190437767017675641': 'Configuração do {$INTERPOLATION}',
  // 1 to 86400. Older or future timestamps are rejected (replay protection).
  '2355991685879491443':
    'De 1 a 86400. Horários mais antigos ou futuros são recusados (proteção contra reenvio).',
  // Unix time of signing. Rejected when more than the tolerance away from arrival.
  '3940968034357494067':
    'Hora Unix da assinatura. Recusada quando se afasta da chegada mais que a tolerância.',
  // Hex HMAC-SHA256 of t + "." + the raw body, keyed with the whole whsec_… secret.
  '5090726087814907412':
    'HMAC-SHA256 em hex de t + "." + o corpo bruto, com o segredo whsec_… inteiro como chave.',
  // Fixed prefix.
  '2108478388469687295': 'Prefixo fixo.',
  // HMAC-SHA256 of the raw body, keyed with the webhook secret.
  '2215843431946467223': 'HMAC-SHA256 do corpo bruto, com o segredo do webhook como chave.',
  // HMAC-SHA256 of the raw body, keyed with the client secret, in base64.
  '1122854570024246615': 'HMAC-SHA256 do corpo bruto, com o client secret como chave, em base64.',
  // Seconds since epoch; checked against the tolerance.
  '765520211070489398': 'Segundos desde a época Unix; conferido contra a tolerância.',
  // Version prefix.
  '6531473085533879379': 'Prefixo da versão.',
  // HMAC-SHA256 of "v0:" + timestamp + ":" + raw body.
  '1983953012220759325': 'HMAC-SHA256 de "v0:" + timestamp + ":" + corpo bruto.',
  // The header name; you type it in Signature header.
  '414751637088345085': 'O nome do cabeçalho; você o digita em Cabeçalho da assinatura.',
  // Optional text before the signature, removed before comparing.
  '8710897513934450078': 'Texto opcional antes da assinatura, tirado antes de comparar.',
  // HMAC-{$algorithm} of the raw body in {$encoding}.
  '7311316083823946136': 'HMAC-{$algorithm} do corpo bruto em {$encoding}.',
  // Open in the Inbox
  '2812107648188046488': 'Abrir na Entrada',
  //  From the result recorded on each request. Click a line to see those requests in the Inbox.
  '629890697824617560':
    ' Do resultado gravado em cada requisição. Clique numa linha para ver essas requisições na Entrada. ',
  // {VAR_PLURAL, plural, =1 {1 rule answers first} other {{INTERPOLATION} rules answer first}}
  '8423644983548581328':
    '{VAR_PLURAL, plural, =1 {1 regra responde antes} other {{INTERPOLATION} regras respondem antes}}',
  // valid
  '3878543995923799007': 'válido',
  // invalid
  '7640664565182744014': 'inválido',
  // Resize history and request
  '6349860591652904562': 'Redimensionar histórico e requisição',
  // Copied as curl
  '6645837697535777190': 'Copiado como curl',
  // Result
  '2525230676386818985': 'Resultado',
  //  Run again
  '975693364861189738': ' Rodar de novo ',
  // Copy as curl
  '2234229222499268461': 'Copiar como curl',
  // Result parts
  '4588729003481512132': 'Partes do resultado',
  //  Response body
  '2419742386349038907': ' Corpo da resposta ',
  //  Response headers ({$INTERPOLATION})
  '5307814005224398056': ' Cabeçalhos da resposta ({$INTERPOLATION}) ',
  //  Sent headers ({$INTERPOLATION})
  '4033474878383385581': ' Cabeçalhos enviados ({$INTERPOLATION}) ',
  //  Truncated: only the first 64 KB of the body is shown.
  '1301096563980270869': ' Cortado: só o primeiro 64 KB do corpo aparece. ',
  // The target answered with no body.
  '8192263622528673983': 'O destino respondeu sem corpo.',
  // Keep path and query
  '4098448859935651316': 'Manter o caminho e a query',
  //  A header name, without spaces or colons.
  '3232184008194083676': ' Um nome de cabeçalho, sem espaços nem dois-pontos. ',
  // Adds {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} with this URL's secret; the secret never leaves the server.
  '3905286544474359363':
    'Acrescenta {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} com o segredo do HMAC desta URL; ele nunca sai do servidor.',
  // This URL has no signature configured. Set one up in {$START_LINK}Checks{$CLOSE_LINK} to sign.
  '4053673393621536099':
    'Esta URL não tem assinatura configurada. Configure uma em {$START_LINK}Verificações{$CLOSE_LINK} para assinar.',
  // Sends to {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}
  '4419100359222645495': 'Manda para {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}',
  // · method, headers and body as received; hop-by-hop headers dropped
  '9114896514441904652':
    '· método, cabeçalhos e corpo como chegaram; os cabeçalhos hop-by-hop saem',
  // Request to replay. Choose
  '1481637659035866979': 'Requisição a reenviar. Escolher',
  // Request to replay: #{$id}, {$method} {$path}. Change
  '4897714653704161369': 'Requisição a reenviar: #{$id}, {$method} {$path}. Trocar',
  // Same formula, same secret, over the exact bytes received, compared in constant time. Each request is marked Valid, or Invalid with the reason.
  '1290468726882053783':
    'Mesma fórmula, mesmo segredo, sobre os bytes exatos recebidos, comparados em tempo constante. Cada requisição fica marcada como Válida, Inválida com o motivo, ou Sem assinatura (faltou o cabeçalho). Com a decifra E2EE ligada, assinatura inválida ou ausente também impede a decifra.',
  // Unsaved: switching from {$INTERPOLATION} (saved) to {$INTERPOLATION_1}. Requests already received keep the result they got on arrival.
  '2256076041282014055':
    'Não salvo: trocando de {$INTERPOLATION} (salvo) para {$INTERPOLATION_1}. As requisições já recebidas mantêm o resultado que tiveram na chegada.',
  // The saved {$INTERPOLATION} secret is not reused for {$INTERPOLATION_1}: paste the {$INTERPOLATION_1} secret.
  '771515961909249733':
    'O segredo salvo do {$INTERPOLATION} não é reaproveitado para o {$INTERPOLATION_1}: cole o segredo do {$INTERPOLATION_1}.',
  //  Where to find the secret: {$INTERPOLATION} The HMAC key is the UTF-8 bytes of the whole secret.
  '5672477284479518071':
    ' Onde achar o segredo: {$INTERPOLATION} O HMAC usa os bytes UTF-8 do segredo inteiro. ',
  // Endpoint signing secret (whsec_…)
  '4870652055908188265': 'Signing secret do endpoint (whsec_…)',
  // Stripe Dashboard › Developers › Webhooks › your endpoint › Signing secret.
  '3826857760944154085':
    'Stripe Dashboard › Developers › Webhooks › seu endpoint › Signing secret.',
  // The webhook Secret field
  '1507753916702191566': 'O campo Secret do webhook',
  // Repository or organization › Settings › Webhooks › Secret.
  '95634975908449751': 'Repositório ou organização › Settings › Webhooks › Secret.',
  // Partners › Apps › your app › Client credentials › Client secret.
  '5610967971845069495': 'Partners › Apps › seu app › Client credentials › Client secret.',
  // The app Signing Secret
  '191036864016606422': 'O Signing Secret do app',
  // api.slack.com › your app › Basic Information › Signing Secret.
  '3390356502925590830': 'api.slack.com › seu app › Basic Information › Signing Secret.',
  // A header you name, optional prefix + signature
  '4103468559002721539': 'Um header que você nomeia, prefixo opcional + assinatura',
  // Any shared secret, 1–256 chars
  '8268973624833839509': 'Qualquer segredo compartilhado, de 1 a 256 caracteres',
  // Whatever secret the sender signs with.
  '3865428615171776315': 'O segredo com que quem envia assina.',
  // Saved. Leave the secret blank to keep it.
  '3116130584750615135': 'Salvo. Deixe o segredo em branco para mantê-lo.',
  // 1 field needs attention: {$fields}
  '1952012124061719459': '1 campo precisa de atenção: {$fields}',
  // {$count} fields need attention: {$fields}
  '624500080299950127': '{$count} campos precisam de atenção: {$fields}',
  // Window
  '6718069813936046169': 'Janela',
  // Last {$INTERPOLATION}
  '394634218099291067': 'Últimas {$INTERPOLATION}',
  // {$INTERPOLATION} s
  '3969642018190845113': '{$INTERPOLATION} s',
  // 120 or HTTP date
  '6894572111922321814': '120 ou data HTTP',
  // Off when empty. For 429, 503, 3xx.
  '3049454891898194535': 'Desligado quando vazio. Para 429, 503, 3xx.',
  // {$seconds} seconds
  '1941477924301007516': '{$seconds} segundos',
  //  Pick a JSON request; the schema is inferred from its body.
  '8344561646705861323': ' Escolha uma requisição JSON; o schema sai do corpo dela. ',
  // Generate schema
  '1389905508423715434': 'Gerar schema',
  //  Every key present becomes required; integers become integer. Review before saving.
  '8146939615938260524':
    ' Toda chave presente vira obrigatória; inteiros viram integer. Revise antes de salvar. ',
  //  Sends requests to another URL with an XHR from this browser, as the old Redirect did. The target must allow the call (CORS). Prefer Replay (the server sends it, with no CORS) or {$START_TAG_CODE}anzol listen{$CLOSE_TAG_CODE} on your machine.
  '5233543101749253123':
    ' Manda as requisições para outra URL com um XHR deste navegador, como o antigo Redirect. O destino precisa permitir a chamada (CORS). Prefira o Reenvio (quem manda é o servidor, sem CORS) ou o {$START_TAG_CODE}anzol listen{$CLOSE_TAG_CODE} na sua máquina. ',
  // last 50 sent by the server
  '6199054697071433153': 'os últimos 50 mandados pelo servidor',
  // Refresh history
  '4912403083664375741': 'Atualizar histórico',
  //  Replays of received requests and new sends, newest first. 30 sends per minute per URL.
  '643997531098809619':
    ' Reenvios de requisições recebidas e envios novos, do mais novo para o mais antigo. 30 envios por minuto por URL. ',
  // The server sends it and records the answer below.
  '593047702260873933': 'O servidor manda e grava a resposta abaixo.',
  //  Nothing reached the target, so there is no response. The sent headers are below.
  '1571395589030646298':
    ' Nada chegou ao destino, então não há resposta. Os cabeçalhos enviados estão abaixo. ',
  //  The {$INTERPOLATION} signature in this request is older than the tolerance ({$INTERPOLATION_1} s): the receiver will likely reject the replay. It was signed {$INTERPOLATION_2} ago ({$INTERPOLATION_3}).
  '179855389406776803':
    ' A assinatura {$INTERPOLATION} desta requisição é mais antiga que a tolerância ({$INTERPOLATION_1} s): o destino provavelmente vai recusar o reenvio. Ela foi assinada há {$INTERPOLATION_2} ({$INTERPOLATION_3}). ',
  // Rule name
  '8014521341313741580': 'Nome da regra',
  // Unsaved changes
  '6721990731116033031': 'Alterações não salvas',
  // Delete rule
  '4754052462239552170': 'Apagar regra',
  // {$seconds} s delay
  '6629307616548746858': 'atraso de {$seconds} s',
  // no delay
  '1834062188646222394': 'sem atraso',
  // path starts with {$prefix}
  '1715239868738025527': 'caminho começa com {$prefix}',
  // path matches {$regex}
  '5810002288823785088': 'caminho casa com {$regex}',
  // any request
  '3670253094280446538': 'qualquer requisição',
  // {$target} contains {$value}
  '5477821780168442986': '{$target} contém {$value}',
  // body = JSON
  '6878238939551544688': 'corpo = JSON',
  // body = {$value}
  '2538706247232815013': 'corpo = {$value}',
  // body contains {$value}
  '5916210482965604209': 'corpo contém {$value}',
  // body ~ {$regex}
  '426427422302801536': 'corpo ~ {$regex}',
  // fault: {$fault}
  '2242014359194309244': 'falha: {$fault}',
  // lognormal delay, median {$median} ms
  '8885647612294526854': 'atraso log-normal, mediana {$median} ms',
  // delay {$delay}
  '8028499000481447692': 'atraso {$delay}',
  // Resize rule list and editor
  '3606807096802832930': 'Redimensionar a lista de regras e o editor',
  // Rule
  '8462130792607498110': 'Regra',
  // Order
  '220550782947016929': 'Ordem',
  // Scenario "{$INTERPOLATION}"
  '8653788004349694466': 'Cenário "{$INTERPOLATION}"',
  // state: {$INTERPOLATION}
  '2109895373996309615': 'estado: {$INTERPOLATION}',
  // P{$INTERPOLATION}
  '748057184661191470': 'P{$INTERPOLATION}',
  // Answered {$answered}
  '1718242002612993810': 'Respondeu {$answered}',
  // Against history
  '3865041831127255584': 'Contra o histórico',
  // of the {$INTERPOLATION} most recent would match
  '3419759645909503817': 'das {$INTERPOLATION} mais recentes casariam',
  // Closest misses
  '2572533559527738245': 'Falhas mais próximas',
  // {VAR_PLURAL, plural, =1 {1 condition} other {{INTERPOLATION} conditions}}
  '276488709221725208': '{VAR_PLURAL, plural, =1 {1 condição} other {{INTERPOLATION} condições}}',
  //  Test again
  '1645325731858691881': ' Testar de novo ',
  // All results
  '2757869225055392739': 'Todos os resultados',
  //  Not tested yet. "Test against history" runs the rule as it is here, unsaved, on the recorded requests.
  '3951404826277819774':
    ' Ainda não testada. "Testar contra o histórico" roda a regra como está aqui, sem salvar, nas requisições gravadas. ',
  // Missed here by {$ICU}
  '5963745014580778667': 'Falhou aqui em {$ICU}',
  //  Recorded on arrival · {$INTERPOLATION} · {$START_LINK}Set up in Checks{$CLOSE_LINK}
  '700416008090876555':
    ' Gravado na chegada · {$INTERPOLATION} · {$START_LINK}Configurar em Verificações{$CLOSE_LINK}',
  // No condition
  '259340347945213850': 'Sem condição',
  // Fails on {$failed}/{$tested}
  '4232143714547810509': 'Falha em {$failed}/{$tested}',
  // Passes {$passed}/{$tested}
  '8699347718386103992': 'Passa {$passed}/{$tested}',
  // not set up
  '1340974250420078790': 'não configurado',
  // {$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} of the {$INTERPOLATION_1} most recent requests would match
  '777640898733405651':
    '{$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} das {$INTERPOLATION_1} requisições mais recentes casariam',
  // Unsaved rule as in the editor · scenario state not considered
  '1891269785782569214': 'Regra não salva, como está no editor · estado do cenário não considerado',
  // Would match ({$INTERPOLATION})
  '8648422323386277627': 'Casariam ({$INTERPOLATION})',
  //  Closest first
  '6966871819784814657': ' Mais próximas primeiro ',
  // fault
  '380949171996294505': 'falha',
  // then {$INTERPOLATION} while in {$INTERPOLATION_1}
  '3177195542514149033': 'depois {$INTERPOLATION} enquanto em {$INTERPOLATION_1}',
  // Scenarios on this URL
  '1428341111551699472': 'Cenários desta URL',
  //  Reset all to Started
  '3626015837035842959': ' Voltar tudo a Started ',
  // not validated
  '6369481998239960406': 'não validado',
  // OFF
  '3129001544428431323': 'DESLIGADA',
  // {$INTERPOLATION} · {$INTERPOLATION_1} on
  '3968264942277486357': '{$INTERPOLATION} · {$INTERPOLATION_1} ligadas',
  // Import
  '1071721880474488785': 'Importar',
  // Export
  '7462301153729425254': 'Exportar',
  // Not checked while off
  '7978723831900223519': 'Não avaliada enquanto desligada',
  // Rule in plain words
  '2268582330010433110': 'Regra em palavras',
  // Before answering; up to 60 s.
  '9000665470264003000': 'Antes de responder; até 60 s.',
  // Send the body in chunks over time
  '9054680744614346306': 'Enviar o corpo em pedaços ao longo do tempo',
  // Uniform
  '8809095087586023378': 'Uniforme',
  // the newest {$evaluated} of {$total} kept
  '4303907595329868490': 'as {$evaluated} mais novas de {$total} guardadas',
  // of the {$total} kept
  '6960211955108263369': 'das {$total} guardadas',
  // not recorded
  '8179776042517989255': 'sem registro',
  // by rules
  '1182262427154339265': 'por regras',
  // default response
  '5456299837149947366': 'resposta padrão',
  // both
  '1598170280549949741': 'as duas',
  // {$answer} · {$count} · {$origin}
  '6424199982821671522': '{$answer} · {$count} · {$origin}',
  // {$INTERPOLATION} would now get {$INTERPOLATION_1} from this rule instead of the default {$INTERPOLATION_2}
  '8949862395501794336':
    '{$INTERPOLATION} agora receberiam {$INTERPOLATION_1} desta regra no lugar da resposta padrão {$INTERPOLATION_2}',
  // {$INTERPOLATION} would now get {$INTERPOLATION_1} from this rule
  '8758745832004953313': '{$INTERPOLATION} agora receberiam {$INTERPOLATION_1} desta regra',
  // Request
  '6170082236603228916': 'Requisição',
  // signature valid
  '522720521720403118': 'assinatura válida',
  // signature invalid
  '2251206797069218320': 'assinatura inválida',
  // signature absent
  '1779933695441110135': 'sem assinatura',
  // schema valid
  '5850464247858785304': 'schema válido',
  // schema invalid
  '2600812382397698771': 'schema inválido',
  // Request parts
  '6662098247758340763': 'Partes da requisição',
  // Discard changes?
  '3936342611104784665': 'Descartar as alterações?',
  // "{$name}" has unsaved changes.
  '7163658526230808830': '"{$name}" tem alterações não salvas.',
  // Keep editing
  '8981392061253349616': 'Continuar editando',
  // Duplicate rule
  '6522449937996210007': 'Duplicar regra',
  // Save · Ctrl+S
  '3611292774072398130': 'Salvar · Ctrl+S',
  // You have a draft from {$INTERPOLATION}.
  '7011260492722296430': 'Você tem um rascunho de {$INTERPOLATION}.',
  // Sensitive header values were not kept.
  '1035245266472532859': 'Valores de cabeçalhos sensíveis não foram guardados.',
  //  Restore draft
  '7645461215340851755': ' Restaurar rascunho ',
  // Discard draft
  '3994785510011227477': 'Descartar rascunho',
  // Placed before "{$INTERPOLATION}" so it can answer (same priority, earlier in the list).
  '1122072330668859379':
    'Colocada antes de "{$INTERPOLATION}" para poder responder (mesma prioridade, antes na lista).',
  // Test against history · Ctrl+Enter
  '8085145350439017761': 'Testar contra o histórico · Ctrl+Enter',
  // To save, fix: {$fields}
  '5436604255318318239': 'Para salvar, corrija: {$fields}',
  // To test, fix: {$fields}
  '4033769259283366536': 'Para testar, corrija: {$fields}',
  // 0–{$max} ms
  '6076492520631458917': '0–{$max} ms',
  // at least 1
  '4245312397963019202': 'no mínimo 1',
  // at least 0
  '4206476819442328517': 'no mínimo 0',
  // required
  '1555721751742522708': 'obrigatório',
  // invalid JSON
  '989772344596348865': 'JSON inválido',
  // up to 100 characters
  '4109185880787660547': 'até 100 caracteres',
  // at least the min
  '243500472496876097': 'pelo menos o mínimo',
  // Import rules
  '4093475112032445060': 'Importar regras',
  // This file has {$ICU}. Compared with the {$INTERPOLATION_1} saved:
  '6194967565668606157': 'Este arquivo tem {$ICU}. Comparado com as {$INTERPOLATION_1} salvas:',
  // {VAR_PLURAL, plural, =1 {1 rule} other {{INTERPOLATION} rules}}
  '6799431695330327454': '{VAR_PLURAL, plural, =1 {1 regra} other {{INTERPOLATION} regras}}',
  // Changed ({$INTERPOLATION})
  '8159504106451560664': 'Alteradas ({$INTERPOLATION})',
  // Removed ({$INTERPOLATION})
  '2519077745627798462': 'Apagadas ({$INTERPOLATION})',
  // New ({$INTERPOLATION})
  '484681768866565220': 'Novas ({$INTERPOLATION})',
  // Unchanged ({$INTERPOLATION})
  '1014824396237074245': 'Iguais ({$INTERPOLATION})',
  // Import mode
  '6001628830748553103': 'Modo de importação',
  // Replace the {$INTERPOLATION} saved rules
  '136018925314073282': 'Substituir as {$INTERPOLATION} regras salvas',
  // Merge: keep the {$INTERPOLATION}, add {$INTERPOLATION_1}
  '8521208746137378765': 'Mesclar: manter as {$INTERPOLATION}, acrescentar {$INTERPOLATION_1}',
  // Would exceed 100 rules.
  '5593565440168449881': 'Passaria de 100 regras.',
  // Merge
  '3206542606001340679': 'Mesclar',
  // Replace
  '6254459922754143568': 'Substituir',
  //  Turn all rules off
  '3096730165381343020': ' Desligar todas as regras ',
  // Import rules from a JSON file: see what changes, then replace or merge
  '8481706238319045391':
    'Importar regras de um arquivo JSON: ver o que muda e então substituir ou mesclar',
  // Download the saved rules as JSON
  '8556016147397832585': 'Baixar as regras salvas em JSON',
  // Turn all rules off?
  '2013222664173539552': 'Desligar todas as regras?',
  // 1 rule stops answering until turned on again.
  '8893957426717963848': '1 regra para de responder até ser religada.',
  // {$count} rules stop answering until turned on again.
  '1959308614678541425': '{$count} regras param de responder até serem religadas.',
  // 1 rule turned off
  '4711952792605897143': '1 regra desligada',
  // {$count} rules turned off
  '275407520297556682': '{$count} regras desligadas',
  // Imported 1 rule
  '7354024378873626781': '1 regra importada',
  // Reset all scenarios?
  '949672927874840835': 'Voltar todos os cenários a Started?',
  // Resets 1 scenario to {$state}: {$names}.
  '2221343192476305963': 'Volta 1 cenário a {$state}: {$names}.',
  // Resets {$count} scenarios to {$state}: {$names}.
  '4627306994793137545': 'Volta {$count} cenários a {$state}: {$names}.',
  // Reset
  '7808756054397155068': 'Voltar a Started',
  // 1 rule created
  '8111803652865274694': '1 regra criada',
  // {$count} rules created
  '4181024584311100471': '{$count} regras criadas',
  // New
  '5280218112746407598': 'Nova',
  // No rules yet. Every request gets the URL's default response.
  '1203691831002489713': 'Nenhuma regra ainda. Toda requisição recebe a resposta padrão da URL.',
  // Describe it in words
  '2864935487876308676': 'Descrever em palavras',
  // Start from a template
  '7386303229223377554': 'Começar de um modelo',
  // Accept everything, fail N times, 429, echo the body…
  '9005906866026590725': 'Aceitar tudo, falhar N vezes, 429, ecoar o corpo…',
  // Create from the latest request
  '4862606005298451734': 'Criar da última requisição',
  // Method, path and the fields you pick from it.
  '2471562936211935700': 'Método, caminho e os campos que você escolher dela.',
  // Filter rules
  '2879450285645799843': 'Filtrar regras',
  //  No hits
  '3519224739628110563': ' Sem acertos ',
  //  Off
  '4914428896389458402': ' Desligadas ',
  // Hits not loaded yet
  '4026223932393559589': 'Acertos ainda não carregados',
  // {$shown} of 1 rule
  '78782951837747861': '{$shown} de 1 regra',
  // {$shown} of {$total} rules
  '4839048077174252619': '{$shown} de {$total} regras',
  // Not in the order while off
  '2226922472797566277': 'Fora da ordem enquanto desligada',
  // Position {$position} of {$total}
  '4510795111832032521': 'Posição {$position} de {$total}',
  // Priority {$priority} · lower answers first; ties keep the list order
  '7530667603237720364':
    'Prioridade {$priority} · menor responde antes; empate vale a ordem da lista',
  // Same priority as {$names}; the list order decides.
  '3447396849691130292': 'Mesma prioridade de {$names}; a ordem da lista decide.',
  // Checked top to bottom; the first match answers.
  '4935813545954456448': 'Conferidas de cima para baixo; a primeira que casa responde.',
  // Catch-all
  '4636283119343202334': 'Pega-tudo',
  // Never matches
  '973330275832372822': 'Nunca casa',
  // Probably: the state can be set by hand
  '8749435059008581854': 'Provável: o estado pode ser definido à mão',
  // Shadowed by {$name}
  '8628775128285537893': 'Sombreada por {$name}',
  // Likely shadowed by {$name}
  '5710380685735464393': 'Provável sombra de {$name}',
  // No enabled rule leads to state "{$state}" — probably a typo.
  '8179108278723638687':
    'Nenhuma regra ligada leva ao estado "{$state}" — provável erro de digitação.',
  // This URL does not check signatures.
  '4227215750366821731': 'Esta URL não verifica assinaturas.',
  // This URL has no schema.
  '5410902376993536149': 'Esta URL não tem schema.',
  // Never answers: "{$name}" comes first and matches everything this rule matches.
  '6250291666996673480': 'Nunca responde: "{$name}" vem antes e casa tudo o que esta regra casa.',
  // In the last test, every request it would match was answered by "{$name}", which comes first.
  '2826914424459712815':
    'No último teste, toda requisição que ela casaria foi respondida por "{$name}", que vem antes.',
  // Would be shadowed by {$name} if turned on
  '6711857965293516944': 'Ficaria sombreada por {$name} se ligada',
  // Off · what it answered now goes to the next matching rule, or the default response.
  '3837117238298835306':
    'Desligada · o que ela respondia passa para a próxima regra que casar, ou para a resposta padrão.',
  // Accept everything (200)
  '3292124381288468940': 'Aceitar tudo (200)',
  // Accept all
  '8083493007965546479': 'Aceitar tudo',
  // Unavailable (503)
  '3625955200239056082': 'Indisponível (503)',
  // Unavailable
  '5643561794785412000': 'Indisponível',
  // Reject invalid signature (401)
  '3425401109636224115': 'Rejeitar assinatura inválida (401)',
  // Invalid signature
  '4580307664295277933': 'Assinatura inválida',
  // Fail N times, then accept
  '8425594347645137535': 'Falhar N vezes e depois aceitar',
  // 429 with Retry-After
  '9080920292284316815': '429 com Retry-After',
  // Rate limited
  '2592013088082732998': 'Limite de taxa',
  // Echo the body (template)
  '7203220197738494455': 'Ecoar o corpo (template)',
  // Echo
  '4793466030773017910': 'Eco',
  // Delay 30 s
  '6101128022523346557': 'Demorar 30 s',
  // Slow
  '6080928629553303128': 'Lenta',
  // Drop the connection
  '4583422923504382124': 'Derrubar a conexão',
  // Dropped
  '5273750484998241238': 'Conexão derrubada',
  // Fault
  '3287623397123391336': 'Falha de rede',
  // Template
  '8559760479505620412': 'Modelo',
  // Delay
  '175111390716806412': 'Atraso',
  // Scenario
  '2652985951636638800': 'Cenário',
  // Rules are checked in this order. The first one that matches answers. A catch-all rule answers whatever is left; the URL's default response answers when no rule does.
  '5908097950043593699':
    'As regras são conferidas nesta ordem. A primeira que casa responde. Uma regra pega-tudo responde o que sobrar; a resposta padrão da URL responde quando nenhuma regra casa.',
  // New rule from template
  '2817826205300978148': 'Nova regra a partir de modelo',
  // Rule templates
  '6992886022976183186': 'Modelos de regra',
  // "{$INTERPOLATION}" answers whatever is left. While it is on, messages don't keep why the other rules didn't match — use "Why not rule…?" on a message.
  '6695659366602667770':
    '"{$INTERPOLATION}" responde o que sobrar. Enquanto estiver ligada, as mensagens não guardam por que as outras regras não casaram — use "Por que não a regra…?" numa mensagem.',
  // Set up in Checks
  '2992367576258621195': 'Configurar em Verificações',
  // No rule matches "{$INTERPOLATION}".
  '6563400618459673943': 'Nenhuma regra corresponde a "{$INTERPOLATION}".',
  // No rule matches the filter.
  '2848213093498153538': 'Nenhuma regra corresponde ao filtro.',
  // Duplicate
  '6621329748219109148': 'Duplicar',
  //  Delete
  '6660925946511264619': ' Apagar ',
  // Hits unavailable
  '8408130486231768977': 'Acertos indisponíveis',
  //  (copy)
  '994379331389938192': ' (cópia)',
  // Moved before {$name} · priorities updated
  '9202216842897341715': 'Movida para antes de {$name} · prioridades atualizadas',
  // Move before {$name}
  '5546546439788139494': 'Mover para antes de {$name}',
  // More actions for {$name}
  '8729238051828358887': 'Mais ações para {$name}',
  // Not valid JSON: line {$INTERPOLATION}
  '4806967465749791118': 'JSON inválido: linha {$INTERPOLATION}',
  // Format JSON
  '7727411307313638815': 'Formatar JSON',
  //  Add Content-Type: application/json
  '3016847253917011809': ' Adicionar Content-Type: application/json ',
  // Value from the JSON body. Simple paths only ($.a.b[0]).
  '5309509505649925809': 'Valor do corpo JSON. Só caminhos simples ($.a.b[0]).',
  // HMAC of a value with the URL's signature secret (sha256, hex by default)
  '928348241778222891': 'HMAC de um valor com o segredo do HMAC da URL (sha256, hex por padrão)',
  // Insert {$helper}
  '5789766334463883938': 'Inserir {$helper}',
  // Use the URL's default content type ({$type})
  '2428483083374671654': 'Usar o content-type padrão da URL ({$type})',
  // Use contains
  '6936085676556518513': 'Usar "contém"',
  // Can't check here — test against history.
  '5814477858291137311': 'Não dá para conferir aqui — teste contra o histórico.',
  // Checked in the browser against the example request; the server decides (Test against history).
  '8474311635979109501':
    'Conferido no navegador contra a requisição de exemplo; quem decide é o servidor (Testar contra o histórico).',
  // Matches "{$value}" · approx.
  '5800604626736257828': 'Casa "{$value}" · aproximado',
  // Doesn't match "{$value}" — a regex must cover the whole value.
  '258208735216943759': 'Não casa "{$value}" — a regex precisa cobrir o valor inteiro.',
  // Matches regex (whole value)
  '869703986535961805': 'Casa com regex (valor inteiro)',
  //  Add body field (JSONPath)
  '4394009986034316686': ' Adicionar campo do corpo (JSONPath) ',
  //  Add header condition
  '4433328523263320245': ' Adicionar condição de cabeçalho ',
  //  Add query condition
  '5090794539046267445': ' Adicionar condição de query ',
  //  Require invalid signature
  '4867317813871861421': ' Exigir assinatura inválida ',
  // Never matches: this URL has no schema.
  '3211926513376260686': 'Nunca casa: esta URL não tem schema.',
  // Chance and time window
  '1570693796396288182': 'Chance e janela de tempo',
  // Chance (%)
  '8506713964359095244': 'Chance (%)',
  //  Empty: every matching request. Otherwise the rule answers this share of them; the others go on to the next rule.
  '764316158307088158':
    ' Vazio: toda requisição que casa. Senão, a regra responde essa fração delas; as outras seguem para a próxima regra. ',
  // Time window
  '3846175638346913423': 'Janela de tempo',
  // Always
  '9212449559226155586': 'Sempre',
  // For the next minutes
  '2211720859590569956': 'Pelos próximos minutos',
  // Between dates
  '5310955674355818712': 'Entre datas',
  // Minutes
  '5531237363767747080': 'Minutos',
  // An integer between 1 and {$max}.
  '3942265491156030663': 'Um inteiro entre 1 e {$max}.',
  // Active until {$time} UTC once saved.
  '9032348715368376559': 'Ativa até {$time} UTC depois de salvar.',
  // Active from (UTC)
  '738949923430773766': 'Ativa a partir de (UTC)',
  // Active until (UTC)
  '4653375036582078715': 'Ativa até (UTC)',
  //  Like 2026-09-29T12:00:00Z; either may be empty.
  '2706666733288577206': ' Como 2026-09-29T12:00:00Z; qualquer um pode ficar vazio. ',
  // To go back to the form, fix: {$INTERPOLATION}
  '8101346880063119588': 'Para voltar ao formulário, corrija: {$INTERPOLATION}',
  // matches regex (whole value)
  '8416180482197619105': 'casa com regex (valor inteiro)',
  // In this request: {$value} · approx.
  '7054898019530027341': 'Nesta requisição: {$value} · aproximado',
  // Not in this request · approx.
  '3294585082886741399': 'Não está nesta requisição · aproximado',
  // Read as JSON
  '5139151961807640573': 'Lido como JSON',
  // Read as number {$value}
  '4365958862567833997': 'Lido como número {$value}',
  // Read as text "{$value}"
  '6207110056463736572': 'Lido como texto "{$value}"',
  // Suggestion applied
  '8392756175069451017': 'Sugestão aplicada',
  // From this request
  '4725489339357598023': 'Desta requisição',
  // Filter fields
  '3146169635583212418': 'Filtrar campos',
  // No field matches the filter.
  '6891630005770047513': 'Nenhum campo corresponde ao filtro.',
  // Send a test request to this URL to pick fields from it.
  '8914673232790370642': 'Mande uma requisição de teste para esta URL para escolher campos dela.',
  // Use {$path}: {$value}
  '7537697903847209598': 'Usar {$path}: {$value}',
  // The suggestion is the same as the rule in the editor.
  '1189830175344405965': 'A sugestão é igual à regra do editor.',
  // Dismiss
  '1536087519743707362': 'Descartar',
  //  Apply conditions only
  '5999023799827095398': ' Aplicar só as condições ',
  // Apply all
  '3091293284187618147': 'Aplicar tudo',
  // present
  '955347580366498573': 'presente',
  // absent
  '9014505645678586424': 'ausente',
  // any path
  '7757231910273596539': 'qualquer caminho',
  // any
  '2296681895307893686': 'qualquer',
  // method {$from} → {$to}
  '6021203730821305308': 'método {$from} → {$to}',
  // path {$from} → {$to}
  '6576801711635600805': 'caminho {$from} → {$to}',
  // body conditions changed
  '8016074541223761152': 'condições do corpo alteradas',
  // signature
  '6157864740955181402': 'assinatura',
  // schema
  '7808181091236621835': 'schema',
  // status {$from} → {$to}
  '2692246892597644818': 'status {$from} → {$to}',
  // + response header {$name} = {$value}
  '6722844627728109849': '+ cabeçalho da resposta {$name} = {$value}',
  // body changed
  '3596087248925302431': 'corpo alterado',
  // other response settings changed
  '5027396356958677874': 'outras configurações da resposta alteradas',
  //  Never matches: this URL does not check signatures.
  '7927255546748147807': ' Nunca casa: esta URL não verifica assinaturas. ',
  // the default response
  '8189510642712303845': 'a resposta padrão',
  // Rules of this scenario
  '5535406424806016209': 'Regras deste cenário',
  //  Reset scenario
  '6086569093846860422': ' Voltar a Started ',
  // No enabled rule answers in state "{$state}"; the next request falls to {$next}.
  '733143069025237422':
    'Nenhuma regra ligada responde no estado "{$state}"; a próxima requisição cai em {$next}.',
  // Create chained scenario rules: one response N times, then another that stays
  '2312528688059824949':
    'Criar regras de cenário encadeadas: uma resposta N vezes, depois outra que fica',
  //  Sequence…
  '2957039154454210559': ' Sequência… ',
  // Sequence
  '3071361935587815300': 'Sequência',
  //  Scenario rules chained with the same conditions: answer one response a few times, then another that stays. For "fail 2 times, then accept".
  '3688995182435416377':
    ' Regras de cenário encadeadas com as mesmas condições: responder uma resposta algumas vezes, depois outra que fica. Para "falhar 2 vezes e depois aceitar". ',
  // When
  '3198123723060667787': 'Quando',
  // Matches regex (whole value)
  '6268471435166560344': 'Casa com regex (valor inteiro)',
  // First response
  '180890281978183006': 'Primeira resposta',
  // Times
  '5421076199587087589': 'Vezes',
  // Final response (stays)
  '1073939249427332423': 'Resposta final (fica)',
  // Preview
  '1295614462098694869': 'Prévia',
  // Create {$count} rules
  '2791776533478758946': 'Criar {$count} regras',
  // {$count} rules will be created
  '3178933165331553930': '{$count} regras serão criadas',
  // {$state} (stays)
  '6047408236667940055': '{$state} (fica)',
  // Joins the existing scenario "{$name}"
  '5685225146017975482': 'Entra no cenário existente "{$name}"',
  // To create, fix: {$fields}
  '5597568351688685915': 'Para criar, corrija: {$fields}',
  // The rules changed elsewhere since this page read them, so nothing was saved. Reload to see the current rules, then try again.
  '8698042377833318988':
    'As regras mudaram em outro lugar desde que esta página as leu, então nada foi salvo. Recarregue para ver as regras atuais e tente de novo.',
  // First status (100–599)
  '3043969212334318627': 'Status da primeira resposta (100–599)',
  // Times (1–20)
  '6008475733454314598': 'Vezes (1–20)',
  // Final status (100–599)
  '496817270242983918': 'Status da resposta final (100–599)',
  // Empty: any path. After the URL's token.
  '2285437227648346581': 'Vazio: qualquer caminho. Depois do token da URL.',
  '3108651526003208577': 'Qualquer caminho',
  // Back to request
  '2017205740176414848': 'Voltar à requisição',
  // No rule leads to state "{$state}" — probably a typo.
  '3523141136168498829': 'Nenhuma regra leva ao estado "{$state}" — provável erro de digitação.',
  // Enable rule {$rule}
  '4770561319318769665': 'Ligar a regra {$rule}',
  // Loading the rules…
  '376406299257554731': 'Carregando as regras…',
  // This URL has no rules.
  '3925454944770620440': 'Esta URL não tem regras.',
  // Rule trace
  '8227783643264448580': 'Avaliação das regras',
  // Checking the rules…
  '4231066785775524429': 'Conferindo as regras…',
  // (off)
  '287155608094834469': '(desligada)',
  // Scenario state as of now.
  '8990065265892574385': 'Estado do cenário de agora.',
  // {$name} (off)
  '7123563499146636497': '{$name} (desligada)',
  // Answered by: {$name}
  '5135446671104824410': 'Respondida por: {$name}',
  // did not match: {$conditions}
  '8263309055675122129': 'não casou: {$conditions}',
  // would match, but it is off
  '2127508777159107346': 'casaria, mas está desligada',
  // matches now
  '7676470987513502147': 'casa agora',
  // matched · answered
  '8918857376217466112': 'casou · respondeu',
  // matched, but an earlier rule answered
  '2839748771603961803': 'casou, mas uma regra anterior respondeu',
  // This request no longer exists.
  '1262408562080601275': 'Esta requisição não existe mais.',
  // Could not check the rules ({$status}).
  '6880150177600715185': 'Não foi possível conferir as regras ({$status}).',
  // Why not rule…?
  '3835773417306108672': 'Por que não a regra…?',
  // Answered {$answered} of the last {$window}
  '2479730488820423139': 'Respondeu {$answered} das últimas {$window}',
  // 1 near miss
  '4562285775534877675': '1 quase acerto',
  // {$count} near misses
  '2807979711783765088': '{$count} quase acertos',
  // 1 request without a rule since {$time} — see them
  '1399707326815643504': '1 requisição sem regra desde {$time} — ver',
  // {$count} requests without a rule since {$time} — see them
  '4918300128465595845': '{$count} requisições sem regra desde {$time} — ver',
  // Near miss of: {$name}
  '2282262815863593717': 'Quase acerto de: {$name}',
  // {$destination} · 1 request without a rule
  '1491812982266449461': '{$destination} · 1 requisição sem regra',
  // {$destination} · {$count} requests without a rule
  '8651699805099577856': '{$destination} · {$count} requisições sem regra',
  // Answered by: {$name}
  '7987311005276722867': 'Respondidas por: {$name}',
  // Back to list
  '4176542659011926633': 'Voltar à lista',
  //  Duplicate rule
  '8393825377641601981': ' Duplicar regra ',
  // Details (Priority {$priority} · Enabled)
  '8324244046177042506': 'Detalhes (Prioridade {$priority} · Ligada)',
  // Details (Priority {$priority} · Off)
  '9118935933745823731': 'Detalhes (Prioridade {$priority} · Desligada)',
  // Out of date
  '9161462110331438114': 'Desatualizado',
  // Test again
  '1574794591863580114': 'Testar de novo',
  // answered by {$rule} at the time
  '4721076730862488015': 'respondida por {$rule} na época',
  // answered {$status} by {$rule} at the time
  '8147400412142813296': 'respondida {$status} por {$rule} na época',
  // Test against history
  '8757397461687997049': 'Testar contra o histórico',
  // {$INTERPOLATION} still answered by earlier rule {$START_LINK}{$INTERPOLATION_1}{$CLOSE_LINK}
  '8344223446232918156':
    '{$INTERPOLATION} continuam com a regra anterior {$START_LINK}{$INTERPOLATION_1}{$CLOSE_LINK}',
  // Loading the request…
  '4791386586357239732': 'Carregando a requisição…',
  // Request {$uuid}
  '3162761057963063529': 'Requisição {$uuid}',
  //  Preview response
  '8830640757016765901': ' Ver como responderia ',
  // Nothing would match yet
  '5348008142135533378': 'Nada casaria ainda',
  // Rendered responses
  '5158358178420034517': 'Respostas renderizadas',
  // seq and now are from now.
  '960207092644559768': 'seq e now são de agora.',
  // Fault: {$INTERPOLATION}
  '5211711429271102908': 'Falha de rede: {$INTERPOLATION}',
  // Timed out (1 s)
  '8107371803010217629': 'Estourou o prazo (1 s)',
  // Could not render: {$INTERPOLATION}
  '9109980654677406198': 'Não foi possível renderizar: {$INTERPOLATION}',
  // Rendered body
  '1729320846134795312': 'Corpo renderizado',
  // Test a variation
  '7841897472094892053': 'Testar uma variação',
  // Conditions
  '2079395509894825886': 'Condições',
  // Add response header
  '8911476744078832650': 'Adicionar cabeçalho da resposta',
  // Counting…
  '4347220840936880702': 'Contando…',
  // Too specific: only this request would match (of the last 500).
  '7655690352868609824': 'Específica demais: só esta requisição casaria (das últimas 500).',
  // Loosen
  '4327816279085003575': 'Afrouxar',
  // Open in editor
  '7079548184775636186': 'Abrir no editor',
  // Method {$method}
  '3095120692025332648': 'Método {$method}',
  // Path {$path}
  '3786537193063354848': 'Caminho {$path}',
  // Query {$name} = {$value}
  '1702566577371003724': 'Query {$name} = {$value}',
  // Header {$name} = {$value}
  '5108907827292708180': 'Cabeçalho {$name} = {$value}',
  // Body {$path} = {$value}
  '6348613277266986519': 'Corpo {$path} = {$value}',
  // Body equals the text (10 KiB max)
  '3412030411320376891': 'Corpo igual ao texto (até 10 KiB)',
  // looks like an id
  '6547458834284057072': 'parece um id',
  // timestamp
  '496260205220116434': 'data-hora',
  // UUID
  '7716208024960184784': 'UUID',
  // {$count} of the last {$window} requests would match
  '7375431196650714596': '{$count} das últimas {$window} requisições casariam',
  // The rules changed elsewhere; open Rules and try again.
  '3321906449955825761': 'As regras mudaram em outro lugar; abra Regras e tente de novo.',
  // method: expected one of {$list}, got {$got}
  '7846216507391491587': 'método: esperava um de {$list}, veio {$got}',
  // method: expected {$expected}, got {$got}
  '6744282959739294730': 'método: esperava {$expected}, veio {$got}',
  // path: expected prefix {$expected}, got {$got}
  '240407957127034661': 'caminho: esperava começar com {$expected}, veio {$got}',
  // path: expected to match {$expected}, got {$got}
  '3488351269425483045': 'caminho: esperava casar a regex {$expected}, veio {$got}',
  // path: expected {$expected}, got {$got}
  '9006985689427972170': 'caminho: esperava {$expected}, veio {$got}',
  // {$target}: absent
  '5620596733399889321': '{$target}: ausente',
  // {$target}: present
  '964563040468101815': '{$target}: presente',
  // {$target}: expected to contain {$expected}, got {$got}
  '8768389120418433368': '{$target}: esperava conter {$expected}, veio {$got}',
  // {$target}: expected to match {$expected}, got {$got}
  '860026762485362589': '{$target}: esperava casar a regex {$expected}, veio {$got}',
  // {$target}: expected {$expected}, got {$got}
  '8428123385147001192': '{$target}: esperava {$expected}, veio {$got}',
  // {$target}: body is not JSON
  '6745144186278603040': '{$target}: o corpo não é JSON',
  // body: body is not JSON
  '7562279532876293375': 'corpo: o corpo não é JSON',
  // body: not equal to the expected JSON
  '6434402795018602279': 'corpo: diferente do JSON dado',
  // body: expected to contain {$expected}
  '3000720646748437340': 'corpo: esperava conter {$expected}',
  // body: expected to match {$expected}
  '5394357430299189555': 'corpo: esperava casar a regex {$expected}',
  // body: expected {$expected}, got {$got}
  '4699872197355484648': 'corpo: esperava {$expected}, veio {$got}',
  // signature: expected {$expected}, got not configured
  '1239663005845036139':
    'assinatura: não configurada nesta URL (a regra pede assinatura {$expected})',
  // signature: expected {$expected}, got {$got}
  '7418487935490997162': 'pede assinatura {$expected}; esta veio {$got}',
  // schema: expected {$expected}, got not configured
  '1930130574293914257': 'schema: não configurado nesta URL (a regra pede {$expected})',
  // schema: expected {$expected}, got {$got}
  '3951080615472233541': 'schema: esperava {$expected}, veio {$got}',
  // scenario {$name}: expected state {$expected}, got {$got}
  '3953946883460574491': 'cenário {$name}: esperava o estado {$expected}, estava em {$got}',
  // chance {$chance}%: rolled {$rolled}, not applied
  '1173132669005150007': 'chance de {$chance}%: sorteou {$rolled}, não aplicou',
  // window: opens at {$from}, received at {$received}
  '5650594681904720699': 'janela: abre em {$from}, chegou em {$received}',
  // window: closed at {$until}, received at {$received}
  '6067454115892884404': 'janela: fechou em {$until}, chegou em {$received}',
  // The e2ee requires a read secret on this URL (read_secret).
  '6741177789058956154': 'A decifra exige segredo de leitura: ligue Privacidade nesta URL.',
  // The e2ee.trusted_signers.{$index} must have a kid.
  '5708450635793682693': 'Um signatário confiável (e2ee.trusted_signers.{$index}) precisa de kid.',
  // The kid is already in use on this URL.
  '6804776611289070484': 'Já existe uma chave de cifra com esse kid nesta URL.',
  // The regex is invalid.
  '4314563148369354905': 'A regex é inválida.',
  // The status must be between {$min} and {$max}.
  '4315191220319314541': 'O status deve estar entre {$min} e {$max}.',
  // The priority must be at least 1.
  '5091493556931668565': 'A prioridade deve ser 1 ou mais.',
  // The name field is required.
  '3196084850965031890': 'O nome é obrigatório.',
  // The name may not be greater than {$max} characters.
  '6588427496217666784': 'O nome pode ter no máximo {$max} caracteres.',
  // The rules may not have more than {$max} items.
  '5473226211877652746': 'Mais de {$max} regras.',
  // The template is invalid: {$reason}.
  '1900476710738240300': 'Erro no template: {$reason}.',
  // The rendered template is too large.
  '4123183016493912490': 'O template renderizado ficou grande demais.',
  // The template took too long to render.
  '1705356405171248564': 'O template demorou demais para renderizar.',
  // The header name is invalid.
  '7222083873748907047': 'O nome do cabeçalho é inválido.',
  // The header value is invalid.
  '5308364508939811054': 'O valor do cabeçalho é inválido.',
  // The path is invalid.
  '1136326979901743249': 'O caminho é inválido.',
  // The id field has a duplicate value.
  '1555571571247850858': 'O id está repetido.',
  // The id must be a valid UUID.
  '3479472037801366985': 'O id deve ser um UUID válido.',
  // The max must be greater than or equal to the min.
  '3974144077387209997': 'O máximo deve ser maior ou igual ao mínimo.',
  // The equalToJson must be a valid JSON string.
  '2006144874960565238': 'O equalToJson deve ser um JSON válido.',
  // The {$field} field is required when fault is {$fault}.
  '4976552856285487820': 'O campo {$field} é obrigatório com a falha {$fault}.',
  // The {$field} must be an ISO-8601 date-time with a time zone, like {$example}.
  '7126490529915996773':
    'O campo {$field} deve ser uma data-hora ISO-8601 com fuso, como {$example}.',
  // The active until must be a date after active from.
  '4044617024680091138': 'O campo active until deve ser uma data depois de active from.',
  // The selected {$field} is invalid.
  '10981317029088923': 'O {$field} escolhido é inválido.',
  // The {$field} field is required.
  '1772870605253351736': 'O campo {$field} é obrigatório.',
  // The {$field} must be between {$min} and {$max}.
  '6244131550246797163': 'O campo {$field} deve estar entre {$min} e {$max}.',
  // The {$field} must be at least {$min}.
  '733407780387240958': 'O campo {$field} deve ser pelo menos {$min}.',
  // The {$field} must be an integer.
  '388542053114501103': 'O campo {$field} deve ser um número inteiro.',
  // The {$field} must be a number.
  '8720525036878434644': 'O campo {$field} deve ser um número.',
  // The {$field} must be a string.
  '8714035860586208505': 'O campo {$field} deve ser um texto.',
  // The {$field} must be an object.
  '3339942095543240176': 'O campo {$field} deve ser um objeto.',
  // The {$field} must be an array.
  '1549263646704579002': 'O campo {$field} deve ser uma lista.',
  // The {$field} field must be true or false.
  '2093276602253257282': 'O campo {$field} deve ser true ou false.',
  // Original: {$phrase}
  '3876084183795082544': 'Original: {$phrase}',
  // Signature absent — the {$provider} check expects the {$header} header
  '6760205189786701313':
    'Sem assinatura — a verificação do {$provider} espera o cabeçalho {$header}',
  // The schema is invalid: {$reason}.
  '4408653464724127151': 'Schema inválido: {$reason}.',
  // The {$field} must have exactly one of: {$list}.
  '1606575023713199953': 'O campo {$field} deve ter exatamente um de: {$list}.',
  // The {$field} may not be greater than {$max} characters.
  '2992969966405280607': 'O campo {$field} pode ter no máximo {$max} caracteres.',
  // The {$field} is invalid.
  '7680023505659143656': 'O campo {$field} é inválido.',
  // header {$name}
  '7954786449630480040': 'cabeçalho {$name}',
  // body {$path}
  '3614190978895842984': 'corpo {$path}',
  // query {$name}
  '7767340803089953733': 'query {$name}',
  // Say what should answer; if this server has AI set up, it drafts the rule.
  '5244421226679972779':
    'Diga o que deve responder; se este servidor tiver IA configurada, ela rascunha a regra.',
  // {$matched} of {$total}
  '5481673356259336453': '{$matched} de {$total}',
  //  Empty: any path. After the URL's token.
  '5803951141866487424': ' Vazio: qualquer caminho. Depois do token da URL. ',
  // {VAR_PLURAL, plural, other {{INTERPOLATION} unchanged}}
  '6537404698767307831': '{VAR_PLURAL, plural, =1 {1 igual} other {{INTERPOLATION} iguais}}',
  // {$ICU} · {$ICU_1} · {$ICU_2} · {$ICU_3}
  '9142788427657206483': '{$ICU} · {$ICU_1} · {$ICU_2} · {$ICU_3}',
  // {VAR_PLURAL, plural, other {{INTERPOLATION} changed}}
  '600712590348718114': '{VAR_PLURAL, plural, =1 {1 alterada} other {{INTERPOLATION} alteradas}}',
  // {VAR_PLURAL, plural, other {{INTERPOLATION} removed}}
  '3602575198958243443': '{VAR_PLURAL, plural, =1 {1 apagada} other {{INTERPOLATION} apagadas}}',
  // {VAR_PLURAL, plural, other {{INTERPOLATION} new}}
  '2018068437367180273': '{VAR_PLURAL, plural, =1 {1 nova} other {{INTERPOLATION} novas}}',
  // TCP RST
  '4127614586149668823': 'TCP RST',
  // Empty response
  '4641971412692797273': 'Resposta vazia',
  // Malformed chunk
  '83176253600131737': 'Chunk malformado',
  // Random data
  '1501759568592515471': 'Dados aleatórios',
  // Hang
  '7698540947590186219': 'Trava',
  // Stall
  '1024768233459301749': 'Parada',
  // Truncated
  '3992517163368458304': 'Cortado',
  // {VAR_PLURAL, plural, =0 {No requests yet: the hits start with the first one.} =1 {Hits over the last 1 request kept.} other {Hits over the last {INTERPOLATION} requests kept.}}
  '1357560753461228101':
    '{VAR_PLURAL, plural, =0 {Ainda sem requisições: os acertos começam com a primeira.} =1 {Acertos na última requisição guardada.} other {Acertos nas últimas {INTERPOLATION} requisições guardadas.}}',
  // Header conditions
  '1713967737010144929': 'Condições de cabeçalho',
  // {VAR_PLURAL, plural, =1 {1 more header} other {{INTERPOLATION} more headers}}
  '5798468791560194063':
    '{VAR_PLURAL, plural, =1 {mais 1 cabeçalho} other {mais {INTERPOLATION} cabeçalhos}}',
  // Show translation
  '2553373886817327991': 'Ver tradução',
  // Show original
  '4635704663136718774': 'Ver original',
  // Remove this filter
  '784681343382270982': 'Tirar este filtro',
  // the text search
  '3155831626610695456': 'a busca por texto',
  // the answered-by filter
  '6630855973617381492': 'o filtro por desfecho',
  // the signature reason
  '8992241665092471762': 'o motivo da assinatura',
  // the schema error path
  '2288461845927882528': 'o caminho do erro de schema',
  // Copied. wait-for only reads --match, so these filters were left out: {$filters}.
  '5715478624325180190':
    'Copiado. O wait-for só lê o --match, então estes filtros ficaram de fora: {$filters}.',
  // URLs in this browser
  '1420223674501820857': 'URLs neste navegador',
  // Forget all URLs
  '4036736979449925541': 'Esquecer todas as URLs',
  // This browser keeps no URL.
  '1624912463664143510': 'Este navegador não guarda nenhuma URL.',
  // {$name} opened. {$destination}.
  '6303705556815657799': '{$name} aberta. {$destination}.',
  // {$name} opened. {$destination}, 1 request.
  '1701679191436093296': '{$name} aberta. {$destination}, 1 requisição.',
  // {$name} opened. {$destination}, {$count} requests.
  '400677308965091713': '{$name} aberta. {$destination}, {$count} requisições.',
  // Locked · Anzol
  '6702304759840597563': 'Trancada · Anzol',
  // Find a URL
  '8927650353574476551': 'Achar uma URL',
  // New URL…
  '952550687544504597': 'Nova URL…',
  // Rename this URL…
  '1573761292761070106': 'Dar um apelido a esta URL…',
  // Forget a URL…
  '2232671604462752651': 'Esquecer uma URL…',
  // Kept only in this browser.
  '5605026589357116232': 'Guardado só neste navegador.',
  // This browser does not keep a list of URLs.
  '7976746003970762703': 'Este navegador não guarda a lista de URLs.',
  // {$name}. Switch URL
  '7245409839690326348': '{$name}. Trocar de URL',
  // Switch URL (U)
  '4523328322717728643': 'Trocar de URL (U)',
  // {$name}, {$id}, {$state}
  '1330717471217071990': '{$name}, {$id}, {$state}',
  // deleted
  '588230151780724018': 'apagada',
  // locked
  '1870560040946711505': 'trancada',
  // open now
  '2610775498865168001': 'aberta agora',
  // opened {$time}
  '7580833839488927113': 'aberta {$time}',
  // URL {$id}
  '5993660627004756475': 'URL {$id}',
  // URL deleted. {$name} is open.
  '6777769258177567893': 'URL apagada. {$name} está aberta.',
  // Rename this URL
  '8277164463205500247': 'Dar um apelido a esta URL',
  // Nickname
  '5506569422969383542': 'Apelido',
  // Only you see it, in this browser.
  '3265072182635430832': 'Só você vê, neste navegador.',
  // Save nickname
  '2887532306631886876': 'Salvar apelido',
  // Nickname saved.
  '3341314895600241596': 'Apelido salvo.',
  // Forget a URL
  '3870527098434719022': 'Esquecer uma URL',
  // Forgetting does not delete the URL on the server.
  '8369573811157422938': 'Esquecer não apaga a URL no servidor.',
  // Forget
  '4324014649445417243': 'Esquecer',
  // This URL no longer exists
  '8039439248004008986': 'Esta URL não existe mais',
  // URL not found · Anzol
  '1980921594499245572': 'URL não encontrada · Anzol',
  // Shared request · Anzol
  '6258065545959765662': 'Requisição compartilhada · Anzol',
  // 1 hour
  '6271244023512252924': '1 hora',
  // 1 day
  '5323977768209814541': '1 dia',
  // 7 days
  '3632882916729566395': '7 dias',
  // 30 days
  '851936834775838572': '30 dias',
  // This address is not a valid URL id.
  '6471129166427164540': 'Este endereço não é um identificador de URL válido.',
  // It was deleted, or it expired after 7 days without use.
  '4610501835605438098': 'Ela foi apagada, ou expirou depois de 7 dias sem uso.',
  // Whoever sends to it gets 410 Gone.
  '6965947420408597039': 'Quem manda para ela recebe 410 Gone.',
  // Create a new URL
  '7786936735789676703': 'Criar uma URL nova',
  // Removed from this browser.
  '2163451178499135035': 'Tirada deste navegador.',
  // Switch to another URL
  '2071123639523165657': 'Trocar para outra URL',
  // Remove from this browser
  '4323343669166253624': 'Tirar deste navegador',
  // This request is not in the current filter.
  '6750321599802887800': 'Esta requisição não está no filtro atual.',
  // Open the first result
  '8935977311033141693': 'Abrir o primeiro resultado',
  // Answer
  '4669216542007588508': 'Resposta',
  // Answered by rule…
  '2990063144930561403': 'Respondidas por regra…',
  // Near miss of…
  '3985861356657946810': 'Quase acerto de…',
  // Default response
  '9069767196486974269': 'Resposta padrão',
  // Show 1 request
  '6671799649393310300': 'Mostrar 1 requisição',
  // Show {$count} requests
  '8052346497025257180': 'Mostrar {$count} requisições',
  // Filters (F)
  '2473449691218981136': 'Filtros (F)',
  // Active filters
  '1540693748364941000': 'Filtros ligados',
  // Remove this filter: {$filter}
  '2079715007977872465': 'Tirar este filtro: {$filter}',
  // Filters · {$count}
  '8817799166454017318': 'Filtros · {$count}',
  // Filters, {$count} active
  '2125536548958201660': 'Filtros, {$count} ligados',
  // Search: {$text}
  '7736249514208329990': 'Busca: {$text}',
  // Switch URL
  '7206950408817526226': 'Trocar de URL',
  // Open or close the filters of the Inbox
  '2339541821310133786': 'Abrir ou fechar os filtros da Entrada',
  // No connection to the server since {$time}. What you typed is kept.
  '6676655514486655765':
    'Sem conexão com o servidor desde {$time}. O que você digitou está guardado.',
  // Connected again.
  '880525040732919916': 'Conexão de volta.',
  // Connection
  '2303041439224647987': 'Conexão',
  // Try again now
  '91400465433579092': 'Tentar agora',
  // Trying again in {$seconds} s
  '6526354410800284325': 'Nova tentativa em {$seconds} s',
  // Skip to content
  '3411805131914952915': 'Pular para o conteúdo',
  // The server did not answer. Nothing was changed.
  '8338815686281471068': 'O servidor não respondeu. Nada foi alterado.',
  // Could not open {$destination}
  '5572606818235964803': 'Não deu para abrir {$destination}',
  // Choose a URL
  '4989615607784125989': 'Escolher uma URL',
  // Filters cleared. {$requests}.
  '196162360584832288': 'Filtros limpos. {$requests}.',
  // No filter. {$requests}.
  '4610618820518753401': 'Sem filtro. {$requests}.',
  // Changes to save
  '4669666205343552713': 'Alterações a salvar',
  // Save anyway
  '7590965072754750003': 'Salvar mesmo assim',
  //  Review changes
  '1453959627369876853': ' Conferir as alterações ',
  // Save changes
  '7000649363168371045': 'Salvar alterações',
  // Saved. 1 change.
  '719940640156898501': 'Salvo. 1 alteração.',
  // Saved. {$count} changes.
  '5752996065078203419': 'Salvo. {$count} alterações.',
  // Changes discarded.
  '6043267881580519433': 'Alterações descartadas.',
  // Draft restored.
  '8736511586262562517': 'Rascunho restaurado.',
  // Saved. Type the new secret to open this URL.
  '3768184719388265277': 'Salvo. Digite o segredo novo para abrir esta URL.',
  // This URL was changed elsewhere since you opened this page.
  '6904025461932211719': 'Esta URL foi alterada em outro lugar desde que você abriu esta página.',
  // Could not save. The server did not answer. Your changes are still here.
  '5885774553484122599':
    'Não foi possível salvar. O servidor não respondeu. Suas alterações continuam aqui.',
  // 1 unsaved change: {$fields}
  '1416090410117301609': '1 alteração não salva: {$fields}',
  // {$count} unsaved changes: {$fields}
  '8314476467671160744': '{$count} alterações não salvas: {$fields}',
  // {$field}: set (not shown)
  '2347523290020722312': '{$field}: definido (não mostrado)',
  // {$field}: {$old} → {$new}
  '5461607654576853907': '{$field}: {$old} → {$new}',
  // Could not load this URL.
  '7581075395114297532': 'Não foi possível carregar esta URL.',
  // unsaved
  '1001212805141003337': 'não salvo',
  // On · {$dialect}
  '239084826548390646': 'Ligada · {$dialect}',
  // on
  '4101941266124151376': 'ligado',
  // off
  '6110089012347909146': 'desligado',
  // protected
  '2934732845854580004': 'protegida',
  // open
  '9010413891924313175': 'aberta',
  //  Show health
  '1380560978091127676': ' Mostrar a saúde ',
  // Open in Insights
  '1841026810064988201': 'Abrir em Métricas',
  // not checked
  '5352265248740972007': 'não conferido',
  // {VAR_PLURAL, plural, =1 {Checks has 1 unsaved change:} other {Checks has {INTERPOLATION} unsaved changes:}}
  '2907088232744299679':
    '{VAR_PLURAL, plural, =1 {Verificações tem 1 alteração não salva:} other {Verificações tem {INTERPOLATION} alterações não salvas:}}',
  // Save and leave
  '7211581972318359535': 'Salvar e sair',
  // Lets a browser page call this URL.
  '974402416930793809': 'Permite que uma página no navegador chame esta URL.',
  // {$seconds} s
  '3024352918195545398': '{$seconds} s',
  // edited
  '5611353616187282769': 'editado',
  // Save first: the test uses the saved settings.
  '2222270083272087568': 'Salve antes: o teste usa a configuração salva.',
  // Tolerance
  '8452154984826492593': 'Tolerância',
  // · Ctrl+S
  '2853807330238074173': '· Ctrl+S',
  // 1 unsaved change
  '1331381156208841382': '1 alteração não salva',
  // {$count} unsaved changes
  '6049785110692446958': '{$count} alterações não salvas',
  // {$rate} % valid
  '8563181798843418348': '{$rate} % válidas',
  // {$rate} % valid
  '444478121034528836': '{$rate} % válido',
  // Signatures {$signature} · Schema {$schema}, over the newest {$count}
  '1415018692366075249': 'Assinaturas {$signature} · Schema {$schema}, nas {$count} mais novas',
  // This server has no local AI.
  '7068960708670219253': 'Este servidor não tem IA local.',
  // The local model did not answer in {$seconds} s.
  '7104052009364981188': 'O modelo local não respondeu em {$seconds} s.',
  // AI progress
  '4880010500669150524': 'Andamento da IA',
  //  Cancel
  '2330577642930707695': ' Cancelar ',
  // Still waiting. It can take up to 90 s.
  '8066438826652779829': 'Ainda esperando. Pode levar até 90 s.',
  // Asking the local model. It usually takes about {$seconds} s.
  '7584494609528040457': 'Consultando o modelo local. Costuma levar uns {$seconds} s.',
  // Cancelled. Nothing was changed.
  '1121134393989312430': 'Cancelado. Nada foi alterado.',
  // How to turn it on
  '7910589373338593747': 'Como ligar',
  // Use the open request as example
  '1884523766341567100': 'Usar a requisição aberta como exemplo',
  // Open a request in the Inbox to use it as example.
  '5433192229016445458': 'Abra uma requisição na Entrada para usá-la como exemplo.',
  // Checks on this suggestion
  '1864616300923821113': 'Conferências desta sugestão',
  //  Open the sequence assistant
  '1738472425812493958': ' Abrir o assistente de sequência ',
  // What this rule does
  '854737549236501305': 'O que esta regra faz',
  // Rule in words
  '1737559912978522222': 'Regra em palavras',
  //  A rule only chooses the answer to a request: status, headers, body, delay or a network fault. It does not send e-mail, write to a database or call another service.
  '1354577027139222235':
    ' Uma regra só escolhe a resposta de uma requisição: status, cabeçalhos, corpo, atraso ou falha de rede. Ela não manda e-mail, não grava em banco e não chama outro serviço. ',
  // What the model wrote
  '1244579015447124023': 'O que o modelo escreveu',
  // Not checked. The rule above is what counts.
  '3673518146887921042': 'Não conferido. O que vale é a regra acima.',
  // Apply conditions only
  '4736996876565591306': 'Aplicar só as condições',
  // OK
  '8998179362936748717': 'OK',
  // Attention
  '5871928281314022227': 'Atenção',
  // Problem
  '8567992300546355012': 'Problema',
  // 1 problem found. Review before applying.
  '3892049111927339592': '1 problema encontrado. Revise antes de aplicar.',
  // {$count} problems found. Review before applying.
  '842207861771704787': '{$count} problemas encontrados. Revise antes de aplicar.',
  // Could not check against the history.
  '934337390594568172': 'Não foi possível conferir com o histórico.',
  // Checked: matches the example and {$count} of the last {$window}.
  '2478760070108804814': 'Conferido: casa com o exemplo e com {$count} das últimas {$window}.',
  // Checked: matches {$count} of the last {$window}. No example request was used.
  '6225663337273242969':
    'Conferido: casa com {$count} das últimas {$window}. Nenhuma requisição de exemplo foi usada.',
  // Matches the example request.
  '928152315882124874': 'Casa com a requisição de exemplo.',
  // Does not match the example request: {$reason}
  '783219791614417644': 'Não casa com a requisição de exemplo: {$reason}',
  // No requests yet to check against.
  '2254750423768124066': 'Ainda não há requisições para conferir.',
  // Would match none of the last {$count} requests.
  '2802692465666960198': 'Não casaria com nenhuma das últimas {$count} requisições.',
  // Too specific: only this request would match (of the last {$window}).
  '7240208236563247245': 'Específica demais: só esta requisição casaria (das últimas {$window}).',
  // Would match {$count} of the last {$window} requests.
  '7180781872638632893': 'Casaria com {$count} das últimas {$window} requisições.',
  // {$field} is not in the example request.
  '4792486099026131612': '{$field} não está na requisição de exemplo.',
  // Path {$path} was never received.
  '1323767854421339258': 'O caminho {$path} nunca foi recebido.',
  // Every field in the conditions is in the example request.
  '6547744609295354733': 'Todo campo das condições está na requisição de exemplo.',
  // The body has {{…}} but Template is off: it would be sent as text.
  '3673280776752648568':
    'O corpo tem {{…}} mas o Template está desligado: seria mandado como texto.',
  // No conditions: it would answer every request.
  '504929995822926231': 'Sem condições: responderia toda requisição.',
  // Priority {$priority}: it would be checked before all {$count} rules.
  '6465384780389154490':
    'Prioridade {$priority}: seria conferida antes de todas as {$count} regras.',
  // Enters at position {$position} of {$total}, before "{$name}".
  '2658163456512654840': 'Entra na posição {$position} de {$total}, antes de "{$name}".',
  // Enters at position {$position} of {$total}.
  '9033191985661609231': 'Entra na posição {$position} de {$total}.',
  // You asked for steps in sequence. One rule cannot do that.
  '1340771433969030793': 'Você pediu passos em sequência. Uma regra só não faz isso.',
  // What the checks say
  '5491324759980656309': 'O que as verificações dizem',
  // Explanation by the local model
  '6685975473562896761': 'Explicação do modelo local',
  // Ask again
  '3455113651738349214': 'Perguntar de novo',
  // Explanation for #{$id} is ready.
  '242311052496414437': 'A explicação da #{$id} está pronta.',
  // Open
  '1892281640132108689': 'Abrir',
  // Answered with the network fault {$fault}.
  '4187134368516566005': 'Respondida com a falha de rede {$fault}.',
  // Answered {$status} with the default response.
  '7557983095218865496': 'Respondida com {$status} pela resposta padrão.',
  // Answered at {$time}, in {$seconds} s.
  '4792786251807402944': 'Respondida às {$time}, em {$seconds} s.',
  // Explanation ready.
  '1232550950075785189': 'Explicação pronta.',
  // Suggest
  '5320136382998259826': 'Sugerir',
  //  Requests sent to this URL show up here instantly, without reloading the page.
  '8138564294754979260':
    ' As requisições mandadas para esta URL aparecem aqui na hora, sem recarregar a página.\n',
  // Copy curl command
  '870274556331514269': 'Copiar o comando curl',
  //  Open it
  '7943845711648992952': ' Abrir ',
  // Nothing arrived yet. It shows up here as soon as it does.
  '4762573553516586348': 'Nada chegou ainda. Aparece aqui assim que chegar.',
  // Open the signature check
  '1869256605991588144': 'Abrir a verificação de assinatura',
  // Open a new rule
  '3285491115436237556': 'Abrir uma regra nova',
  // Open the retry guide
  '1982129478068923839': 'Abrir o roteiro de retry',
  // {$method} {$path}, at {$time}.
  '8301129789587842799': '{$method} {$path}, às {$time}.',
  // Command copied. It has this URL, which is a secret.
  '7416015124255239910': 'Comando copiado. Ele tem esta URL, que é um segredo.',
  // done
  '6608890834230007808': 'feito',
  // to do
  '2984799506684715632': 'falta',
  // optional
  '4166774598423340967': 'opcional',
  // Send a request
  '4978029334199195744': 'Mandar uma requisição',
  // See it arrive
  '4374266784233071018': 'Ver ela chegar',
  // Check the provider's signature
  '8330956694183366348': 'Conferir a assinatura do provedor',
  // Choose the answer
  '833293779024791270': 'Escolher a resposta',
  // Test a retry
  '2528763963435679040': 'Testar um retry',
  // Close guide
  '8345334258582014743': 'Fechar o roteiro',
  // First webhook
  '5981944048959947106': 'Primeiro webhook',
  // Guide: {$name}
  '6858753259371437221': 'Roteiro: {$name}',
  // 1 request came before the asked wait of {$asked} s.
  '2635089868568940743': '1 requisição chegou antes da espera pedida de {$asked} s.',
  // {$count} requests came before the asked wait of {$asked} s.
  '1039230917711493728': '{$count} requisições chegaram antes da espera pedida de {$asked} s.',
  // 1 request arrived. Answers: {$trail}
  '8749884057350443520': '1 requisição chegou. Respostas: {$trail}',
  // {$count} requests arrived. Answers: {$trail}
  '523967820852876500': '{$count} requisições chegaram. Respostas: {$trail}',
  // {$arrived}. Programmed: {$expected}.
  '820510369025858786': '{$arrived}. Programado: {$expected}.',
  // {$arrived}, as programmed.
  '2242979637206419025': '{$arrived}, como programado.',
  //  Make this URL refuse a few times and then accept, and see what your sender does.
  '4192414966276023752':
    ' Faça esta URL recusar algumas vezes e depois aceitar, e veja o que o seu remetente faz.\n',
  // Which requests
  '4257089478461499283': 'Quais requisições',
  // What to answer first
  '8814643182392645942': 'O que responder primeiro',
  // Retry-After (s)
  '1383441937650891318': 'Retry-After (s)',
  // Empty: no header.
  '5934847549179195783': 'Vazio: sem o cabeçalho.',
  // What to answer after
  '2901512282513937291': 'O que responder depois',
  // stays
  '1055819287593553384': 'fica',
  // Create
  '1710278196506983304': 'Criar',
  // Start over
  '763434360141362050': 'Recomeçar',
  // Send and check
  '2605852370196739930': 'Mandar e conferir',
  //  Copy curl loop
  '7746792139359704378': ' Copiar o laço de curl ',
  // Retry check
  '2132221897326012086': 'Conferência do retry',
  // Attempt {$INTERPOLATION}
  '5724306736011437599': 'Tentativa {$INTERPOLATION}',
  // +{$INTERPOLATION} s
  '2865391584899672648': '+{$INTERPOLATION} s',
  // Starts at the most common: {$method}, {$count} of {$total}.
  '6490810650501315836': 'Começa no mais comum: {$method}, {$count} de {$total}.',
  // {$count} rules created · scenario "{$name}"
  '378328566973426481': '{$count} regras criadas · cenário "{$name}"',
  // (any path)
  '2894766746158019845': '(qualquer caminho)',
  // Arriving: {$trail}
  '2094621065270066430': 'Chegando: {$trail}',
  // Waiting for {$target}. Nothing arrived yet.
  '6559590418845380926': 'Esperando {$target}. Nada chegou ainda.',
  // Send {$count} test requests
  '6727056494125901404': 'Mandar {$count} requisições de teste',
  // {$count} rules created.
  '3022137233878357464': '{$count} regras criadas.',
  // Sent from this browser, {$seconds} s apart. This checks the rules, not your sender.
  '6638281695338567350':
    'Mandadas deste navegador, a cada {$seconds} s. Isto confere as regras, não o seu remetente.',
  // Retry-After (0–{$max})
  '4749208494832048739': 'Retry-After (0–{$max})',
  // Came {$seconds} s after the previous answer. It asked to wait {$asked} s.
  '8424115092357568360':
    'Chegou {$seconds} s depois da resposta anterior. Ela pedia para esperar {$asked} s.',
  // Came about {$asked} s after. Times are kept to the second, so this cannot be told apart from {$asked} s.
  '997921781507708810':
    'Chegou cerca de {$asked} s depois. As horas são guardadas por segundo, então não dá para distinguir de {$asked} s.',
  // Waited {$seconds} s. It asked to wait {$asked} s.
  '2350130687248509203': 'Esperou {$seconds} s. Ela pedia para esperar {$asked} s.',
  // Wait asked: Retry-After: {$asked}, as configured now. Times are kept to the second.
  '524192982117577614':
    'Espera pedida: Retry-After: {$asked}, como está configurado agora. As horas são guardadas por segundo.',
  // Choose another request
  '1489808353545983136': 'Escolher outra requisição',
  // Request A (#{$id}) no longer exists.
  '4195017405011090073': 'A requisição A (#{$id}) não existe mais.',
  // Request B (#{$id}) no longer exists.
  '2680638928772326002': 'A requisição B (#{$id}) não existe mais.',
  // Nothing was compared.
  '2948659986953822115': 'Nada foi comparado.',
  // Request notice
  '6332235221655261516': 'Aviso da requisição',
  // Open the newest request
  '7627733301374734916': 'Abrir a requisição mais nova',
  // Loading request #{$id}…
  '3059349265274800799': 'Carregando a requisição #{$id}…',
  // You are seeing the copy this page had loaded.
  '4747150425800960017': 'Você está vendo a cópia que esta página tinha carregado.',
  // This copy goes away when you leave it.
  '2271896899361152623': 'Esta cópia some quando você sair dela.',
  // This request was deleted from the server by auto cleanup (keeps the newest {$limit}), noticed at {$time}. {$copy}
  '1216006690166364016':
    'Esta requisição foi apagada do servidor pela limpeza automática (guarda as {$limit} mais novas), percebido às {$time}. {$copy}',
  // This request was deleted from the server by auto cleanup, noticed at {$time}. {$copy}
  '963071689171665060':
    'Esta requisição foi apagada do servidor pela limpeza automática, percebido às {$time}. {$copy}',
  // You deleted this request at {$time}. {$copy}
  '3520060693784969119': 'Você apagou esta requisição às {$time}. {$copy}',
  // This request is no longer on the server, noticed at {$time}. It may have been deleted or cut by auto cleanup.
  '56780826527671468':
    'Esta requisição não está mais no servidor, percebido às {$time}. Ela pode ter sido apagada ou cortada pela limpeza automática.',
  // Connection reset
  '1755383718055848550': 'Conexão reiniciada',
  // Closest rule: {$rule} — {$reason}{$more}
  '686882120115347084': 'Regra que chegou mais perto: {$rule} — {$reason}{$more}',
  // Network fault · {$fault}
  '6971063513701035037': 'Falha de rede · {$fault}',
  // Network fault by rule: {$fault}: {$rule}
  '7913267087440531484': 'Falha de rede por regra: {$fault}: {$rule}',
  // Answered {$status} · by rule
  '3651774791336490256': 'Respondeu {$status} · pela regra',
  // — · not recorded
  '7013986684116090892': '— · sem registro',
  // Answered by rule · {$status}: {$rule}
  '7482772772898741860': 'Respondida por regra · {$status}: {$rule}',
  // Answer not recorded, by rule {$rule}
  '8671415770375958661': 'Resposta sem registro, pela regra {$rule}',
  // Answered {$status} · default response
  '1632889250580930909': 'Respondeu {$status} · resposta padrão',
  // {$status} · Default response
  '3603420320165745482': '{$status} · Resposta padrão',
  // Default response · {$status}
  '4762015500217354798': 'Resposta padrão · {$status}',
  // Answer not recorded
  '546447634607016272': 'Resposta sem registro',
  // The server no longer has this request.
  '2106765886275018133': 'O servidor não tem mais esta requisição.',
  // Request restored.
  '8505713565664755746': 'Requisição restaurada.',
  // Checked against the rules as they are now.
  '5397359920811842463': 'Conferido com as regras como estão agora.',
  // No other request was opened in its place.
  '4813557657527501326': 'Nenhuma outra requisição foi aberta no lugar dela.',
  // Search for this id
  '1304787567684709449': 'Buscar por este identificador',
  // Could not load this request. The server did not answer.
  '7152006975872720851': 'Não foi possível carregar esta requisição. O servidor não respondeu.',
  // It was received on {$date}.
  '5045762088893355178': 'Ela foi recebida em {$date}.',
  // Retry-After: {$value} (as configured now)
  '3550688370858859981': 'Retry-After: {$value} (como está configurado agora)',
  // (not received)
  '1498983752416848503': '(não recebido)',
  // Answered {$class}
  '2178342429442273342': 'Respondeu {$class}',
  // answered {$status}
  '924699136068025743': 'respondeu {$status}',
  // Look in older requests
  '5564639954442159945': 'Procurar nas mais antigas',
  // {$count} match among the newest {$scanned}
  '8256896967558960134': '{$count} casam entre as {$scanned} mais novas',
  // Looking in {$scanned} of {$total}…
  '9194493308386689993': 'Procurando em {$scanned} de {$total}…',
  // the answered status
  '7064010877324652228': 'o status respondido',
  // Previous pair
  '3956303614446710206': 'Par anterior',
  // Next pair
  '64026305064503317': 'Próximo par',
  //  This is the first attempt kept of this event.
  '7892683169288698141': ' Esta é a primeira tentativa guardada deste evento. ',
  // Compare with attempt {$number}
  '8233028178130337941': 'Comparar com a tentativa {$number}',
  // Compare with attempt —
  '7911875509569051900': 'Comparar com a tentativa —',
  // Open the event
  '7667328383791234730': 'Abrir o evento',
  // Change the event key
  '5028182250393627626': 'Trocar a chave do evento',
  // Change
  '7612223201633992283': 'Trocar',
  // Group by event
  '749101426018814705': 'Agrupar por evento',
  //  Some requests repeat the same {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}. Group them by event?
  '4129270642537948290':
    ' Algumas requisições repetem o mesmo {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}. Agrupar por evento? ',
  // Choose another field…
  '1337850331952507359': 'Escolher outro campo…',
  // Not now
  '5161411570094992408': 'Agora não',
  // No loaded request has {$key}. Showing requests one by one.
  '4805455414659438233':
    'Nenhuma requisição carregada tem {$key}. Mostrando as requisições uma a uma.',
  // Showing requests one by one.
  '2199503352046497942': 'Mostrando as requisições uma a uma.',
  // Grouped by {$key}
  '5300215160159648801': 'Agrupado por {$key}',
  // 1 event in the {$loaded} loaded
  '7450195745920996659': '1 evento nas {$loaded} carregadas',
  // {$events} events in the {$loaded} loaded
  '4134443978746333591': '{$events} eventos nas {$loaded} carregadas',
  // Attempts of {$value}
  '689808152544993810': 'Tentativas de {$value}',
  // Requests with the same value in this field are shown together.
  '3165589734968426862': 'Requisições com o mesmo valor neste campo aparecem juntas.',
  // Event key
  '3407925812216959607': 'Chave do evento',
  // Another header or body path
  '5071432184528587853': 'Outro cabeçalho ou caminho do corpo',
  // Header name or JSONPath
  '2237715338911993231': 'Nome do cabeçalho ou JSONPath',
  // x-event-id or $.id
  '1438157554909794275': 'x-event-id ou $.id',
  // Do not group
  '4776413195156332209': 'Não agrupar',
  // This is not a header name or a JSONPath like $.id.
  '6737556997851489894': 'Isto não é um nome de cabeçalho nem um JSONPath como $.id.',
  //  Group
  '4161689686913223254': ' Agrupar ',
  // No loaded request has this field.
  '3288614647419497410': 'Nenhuma requisição carregada tem este campo.',
  // The {$loaded} loaded requests become 1 event.
  '7633510998594786686': 'As {$loaded} requisições carregadas viram 1 evento.',
  // The {$loaded} loaded requests become {$events} events.
  '8238458730356903933': 'As {$loaded} requisições carregadas viram {$events} eventos.',
  // Body {$key} — e.g. {$example} · {$values} values in {$loaded}
  '4111321129896435706': 'Corpo {$key} — ex.: {$example} · {$values} valores em {$loaded}',
  // Header {$key} — e.g. {$example} · {$values} values in {$loaded}
  '1287443167002433140': 'Cabeçalho {$key} — ex.: {$example} · {$values} valores em {$loaded}',
  // {$minutes} min
  '1913550668122548665': '{$minutes} min',
  // {$hours} h
  '5386830330928988903': '{$hours} h',
  // {$count} attempts loaded · more may be on the next page
  '8125338532756931681': '{$count} tentativas carregadas · pode haver mais na próxima página',
  // {$count} attempts kept
  '3938564561742593138': '{$count} tentativas guardadas',
  // {$count} attempts in {$duration}
  '6618353892263613681': '{$count} tentativas em {$duration}',
  // 1 signature does not match
  '1340474443542292269': '1 assinatura não confere',
  // {$count} signatures do not match
  '7538105549503007585': '{$count} assinaturas não conferem',
  // no signature in {$count}
  '7957762083770143491': '{$count} sem assinatura',
  // 1 with a schema error
  '6862197777904807026': '1 com erro de schema',
  // {$count} with schema errors
  '500832575432537007': '{$count} com erro de schema',
  // {$matching} of {$count} attempts match
  '2271099195635267880': '{$matching} de {$count} tentativas casam',
  // 1 attempt came before the asked wait
  '7633946700269709741': '1 tentativa chegou antes da espera pedida',
  // {$count} attempts came before the asked wait
  '2359897495521070234': '{$count} tentativas chegaram antes da espera pedida',
  // Event {$value}, {$method} {$route}, {$count}, answers {$answers}, {$problems}newest at {$time}. Open the newest attempt
  '7328238802626481809':
    'Evento {$value}, {$method} {$route}, {$count}, respostas {$answers}, {$problems}a mais nova às {$time}. Abrir a tentativa mais nova',
  // … {$hidden} more attempts. Show all {$total} attempts
  '4672029361197341837': '… mais {$hidden} tentativas. Mostrar as {$total} tentativas',
  // attempt {$number}
  '5048971472450475826': 'tentativa {$number}',
  // +{$seconds} s
  '231253134297229402': '+{$seconds} s',
  // Attempt {$number} of {$total},
  '2108670866825125479': 'Tentativa {$number} de {$total}, ',
  // Attempt {$number} of {$total}, {$seconds} s after the previous,
  '592545446324904628': 'Tentativa {$number} de {$total}, {$seconds} s depois da anterior, ',
  // Position among the attempts kept. Older ones may have been cut by auto cleanup.
  '9080270613214824072':
    'Posição entre as tentativas guardadas. As mais antigas podem ter sido cortadas pela limpeza automática.',
  // The wait asked is not a fixed number of seconds, so only the interval is shown.
  '980057163540422391':
    'A espera pedida não é um número fixo de segundos, então só o intervalo aparece.',
  // Group by event…
  '4262715189091817800': 'Agrupar por evento…',
  // 1 request matches
  '3934192990477972863': '1 requisição casa',
  // {$count} requests match
  '3671458829680941640': '{$count} requisições casam',
  // in 1 event
  '3036561420326811671': 'em 1 evento',
  // in {$events} events
  '5537158176643996243': 'em {$events} eventos',
  // {$found}, {$events} · search runs on the server over all {$total}
  '1458439836701961527': '{$found}, {$events} · a busca roda no servidor, sobre todas as {$total}',
  // Filter by a field…
  '765018967022770000': 'Filtrar por um campo…',
  // Value actions
  '7268993424405900428': 'Ações do valor',
  // Filter by this value
  '3805003075729735175': 'Filtrar por este valor',
  // Exclude this value
  '8325100168114797990': 'Excluir este valor',
  // Copy value
  '6893161557341819866': 'Copiar o valor',
  // Copy path
  '6357451566812902581': 'Copiar o caminho',
  // Group by this field
  '252948340581979760': 'Agrupar por este campo',
  // {$label}: {$value}. Value actions
  '9124042716554753399': '{$label}: {$value}. Ações do valor',
  // Value copied.
  '3134188786917238561': 'Valor copiado.',
  // Path copied.
  '9041606023079640888': 'Caminho copiado.',
  // Filter by {$filter}
  '1794171124691043516': 'Filtrar por {$filter}',
  // answered {$status}
  '6215826754927863752': 'respondeu {$status}',
  // method {$method}
  '231893590196781470': 'método {$method}',
  // signature: {$reason}
  '4334536560490865550': 'assinatura: {$reason}',
  // schema error at {$path}
  '4198346018142567275': 'erro de schema em {$path}',
  // {$filter} — not accepted
  '6357474227505433800': '{$filter} — não aceito',
  // path = {$value}
  '8364425698345198313': 'caminho = {$value}',
  // header {$name} = {$value}
  '5530079414624329511': 'cabeçalho {$name} = {$value}',
  // query {$name} = {$value}
  '1702892842862338152': 'query {$name} = {$value}',
  // body {$name} = {$value}
  '5543715258714442929': 'corpo {$name} = {$value}',
  // This link does not carry 1 filter by value.
  '3213603509894203873': 'Este link não leva 1 filtro por valor.',
  // This link does not carry {$count} filters by value.
  '8097161926480675711': 'Este link não leva {$count} filtros por valor.',
  // Inbox. Filtered by {$filters}. {$result}
  '638729785399628401': 'Entrada. Filtrado por {$filters}. {$result}',
  // Filtered by {$filter}. {$result}
  '4283294568415281643': 'Filtrado por {$filter}. {$result}',
  // Guides
  '7423212324650924366': 'Roteiros',
  // First request arrived
  '7991283874369022473': 'Chegou a primeira requisição',
  //  {$INTERPOLATION} {$INTERPOLATION_1}, at {$INTERPOLATION_2}. What next?
  '4433444182437454270': ' {$INTERPOLATION} {$INTERPOLATION_1}, às {$INTERPOLATION_2}. E agora? ',
  // First request arrived: {$method} {$path}, at {$time}.
  '7933586283890613887': 'Chegou a primeira requisição: {$method} {$path}, às {$time}.',
  // Resize action panel
  '4169893092704266173': 'Redimensionar o painel de ação',
  // Actions on this request
  '8363986996106759418': 'Ações sobre esta requisição',
  // Restore panel
  '7504411833492915254': 'Restaurar o painel',
  // Expand panel
  '2036262215218789280': 'Expandir o painel',
  // Close panel
  '5449281378832055106': 'Fechar o painel',
  // Close panel (Esc)
  '4937753927922730541': 'Fechar o painel (Esc)',
  // Open full comparison
  '343669643178076026': 'Abrir a comparação inteira',
  // Pick a request in the list to compare with #{$INTERPOLATION}.
  '1599872129460748980': 'Escolha na lista uma requisição para comparar com a #{$INTERPOLATION}.',
  // Action result
  '1443763351215003012': 'Resultado da ação',
  // Compared #{$a} with #{$b}. 1 change explains the outcome.
  '7041601293769119360': '#{$a} comparada com #{$b}. 1 mudança explica o desfecho.',
  // Compared #{$a} with #{$b}. {$count} changes explain the outcome.
  '1208911136152438594': '#{$a} comparada com #{$b}. {$count} mudanças explicam o desfecho.',
  // Rule created: {$name}.
  '8636708114608722368': 'Regra criada: {$name}.',
  // Rule created: {$name}. It answers {$count} of the last 500.
  '6924471002653127079': 'Regra criada: {$name}. Ela responde {$count} das últimas 500.',
  // Action panel
  '4565505289790871368': 'Painel de ação',
  // localhost:3000/webhooks
  '9170785157558776618': 'localhost:3000/webhooks',
  // Replaying…
  '1852335941893285637': 'Reenviando…',
  //  Sends to {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}
  '8398872837140518609': ' Manda para {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}',
  // The target must be an http:// or https:// address.
  '5920490373486658236': 'O destino precisa ser um endereço http:// ou https://.',
  // Open in Outbound
  '7138826814784193820': 'Abrir na Saída',
  // You typed {$typed}. The server reaches it as {$resolved}.
  '7848879124497701686': 'Você digitou {$typed}. O servidor chega a ele como {$resolved}.',
  // Replay did not get an answer: {$reason}
  '7890191666559754116': 'O reenvio não teve resposta: {$reason}',
  // Blocked: this server only sends to public addresses.
  '1167334649637784152': 'Bloqueado: este servidor só manda para endereços públicos.',
  // Replay result: {$status} in {$ms} ms
  '4712297722375301309': 'Resultado do reenvio: {$status} em {$ms} ms',
  // Replay result: no answer read.
  '5203105364598487691': 'Resultado do reenvio: nenhuma resposta lida.',
  // Injected: {$injected}
  '1330869951499924324': 'Injetado: {$injected}',
  // Inject failure
  '2688133808215704884': 'Injetar falha',
  // Failures to inject
  '4860644148516703400': 'Falhas a injetar',
  // Delay before sending (ms)
  '5200061733063355553': 'Atraso antes de enviar (ms)',
  // Slow body (bytes/s)
  '7519411338503731798': 'Corpo lento (bytes/s)',
  // Give up after (ms)
  '4223135404164756482': 'Desistir depois de (ms)',
  // Send twice
  '4223032021996869123': 'Enviar duas vezes',
  // Cut the body in half
  '7545010710041060638': 'Cortar o corpo ao meio',
  // This request has no body.
  '5922727402286406435': 'Esta requisição não tem corpo.',
  // delay {$ms} ms
  '812950331830617105': 'atraso de {$ms} ms',
  // slow body at {$bps} bytes/s
  '7993793070121249502': 'corpo lento a {$bps} bytes/s',
  // body cut after {$bytes} bytes
  '5251806133287995800': 'corpo cortado depois de {$bytes} bytes',
  // gave up after {$ms} ms
  '5213147227173408522': 'desistiu depois de {$ms} ms',
  // sent twice (second: {$second})
  '4636930357835628269': 'enviada duas vezes (segunda: {$second})',
  // no answer read
  '1774731303607671886': 'nenhuma resposta lida',
  // No answer read
  '337505396291553368': 'Nenhuma resposta lida',
  // Replay (R)
  '5217318402138337552': 'Reenviar (R)',
  // Compare with… (D)
  '5431255101454918695': 'Comparar com… (D)',
  // Ask the local model why signature, schema and rules gave this result (E)
  '1247052206257420938':
    'Perguntar ao modelo local por que assinatura, schema e regras deram este resultado (E)',
  // Older / newer request
  '2370187144452646796': 'Requisição mais antiga / mais nova',
  // Move in the list without opening · open
  '1297608346856233638': 'Andar pela lista sem abrir · abrir',
  // Expand or collapse an event
  '7081442232695146453': 'Abrir ou recolher um evento',
  // Replay, compare, explain the open request
  '4267885476063672177': 'Reenviar, comparar, explicar a requisição aberta',
  // Open or close the action panel
  '3736637070280072810': 'Abrir ou fechar o painel de ação',
  //  Ask the local model
  '2811840060009190762': ' Perguntar ao modelo local ',
  // More list actions
  '5816888929010864485': 'Mais ações da lista',
  // Copy CI test
  '4969155208345973215': 'Copiar o teste de CI',
  // {$found}. Counted over the newest {$window}, as in Insights.
  '2381928169413285310': '{$found}. Contado nas {$window} mais novas, como em Métricas.',
  // Copied the anzol test command.
  '557794263741060364': 'Comando anzol test copiado.',
  // Copied. anzol test only reads --match, so these filters were left out: {$filters}.
  '2974323848043602907':
    'Copiado. O anzol test só lê o --match, então estes filtros ficaram de fora: {$filters}.',
  // {$destination}, 1 invalid signature since {$time}
  '4592034369818190987': '{$destination}, 1 assinatura inválida desde {$time}',
  // {$destination}, {$count} invalid signatures since {$time}
  '4791511819252126960': '{$destination}, {$count} assinaturas inválidas desde {$time}',
  // {$destination}, 1 invalid schema since {$time}
  '8831648283178564529': '{$destination}, 1 schema inválido desde {$time}',
  // {$destination}, {$count} invalid schemas since {$time}
  '3636672581074851539': '{$destination}, {$count} schemas inválidos desde {$time}',
  // repeats
  '2365282192455083444': 'se repete',
  // Group
  '3953128085929585273': 'Agrupar',
  // Some requests repeat the same {$field}. Group them by event?
  '2088030634394823354': 'Algumas requisições repetem o mesmo {$field}. Agrupar por evento?',
  // filters
  '206662866298476658': 'filtros',
  // move
  '5792985922408638829': 'andar',
  // open
  '5856915257480984473': 'abrir',
  // replay
  '2465451770912214844': 'reenviar',
  // compare
  '3409383318324670942': 'comparar',
  // switch URL
  '845106705521905169': 'trocar de URL',
  // all
  '2089017016852932432': 'todos',
  // Share (coluna da tabela "Who answered" de Métricas)
  insightsShareColumn: 'Participação',
  // E2EE decryption
  '5407075505681814999': 'Decifra E2EE',
  // Delete key {$INTERPOLATION}?
  '3592389072273364180': 'Apagar a chave {$INTERPOLATION}?',
  //  Requests already decrypted keep their stored value. Old backups of the volume still have the private key.
  '490918146599079624':
    ' As já decifradas mantêm o valor gravado. Backups antigos do volume ainda têm a chave privada. ',
  //  This is the URL's only encryption key: without it, every new encrypted request is recorded as Unknown key until you generate another.
  '2526831824925286701':
    ' Esta é a única chave de cifra da URL: sem ela, toda requisição cifrada nova fica como Chave desconhecida até você gerar outra. ',
  // Delete key
  '73979960734847259': 'Apagar chave',
  // Decrypt an attribute of each request
  '8050605225511000111': 'Decifrar um atributo de cada requisição',
  // This URL has no read secret, and the server refuses decryption without one: the opened value must stay behind it. Turn on {$START_LINK}Privacy{$CLOSE_LINK} (it can go in the same save).
  '8123080752418416800':
    'Esta URL não tem segredo de leitura, e o servidor recusa a decifra sem ele: o valor decifrado tem de ficar atrás dele. Ligue {$START_LINK}Privacidade{$CLOSE_LINK} (pode ir no mesmo salvar).',
  // This URL has no read secret, and the server refuses decryption without one: the opened value must stay behind it. Turn on Privacy (it can go in the same save).
  '6606005843752952083':
    'Esta URL não tem segredo de leitura, e o servidor recusa a decifra sem ele: o valor decifrado tem de ficar atrás dele. Ligue Privacidade (pode ir no mesmo salvar).',
  // Saving turns decryption off. Requests already received keep the result they got on arrival, and the decrypted ones keep the opened value: the read secret stays required until they are deleted.
  '7563108074876616346':
    'Salvar desliga a decifra. As requisições já recebidas mantêm o resultado que tiveram na chegada, e as decifradas guardam o valor decifrado: o segredo de leitura continua obrigatório até elas serem apagadas.',
  // Encrypted attribute
  '6159255639867175033': 'Atributo cifrado',
  // Audience (aud)
  '2275478400103842309': 'Audiência (aud)',
  // The audience is required, up to 256 characters.
  '1070502496184655538': 'A audiência é obrigatória, com até 256 caracteres.',
  // Max age (seconds)
  '1223920162589771363': 'Idade máxima (segundos)',
  // How old the iat may be: 60 to 604800.
  '6441223185491768805': 'Quanto o iat pode ter de idade: 60 a 604800.',
  // An integer between 60 and 604800.
  '1371521921753704975': 'Um inteiro entre 60 e 604800.',
  // Reject plaintext: an attribute that is not a JWE is invalid (downgrade)
  '5989804956279121487': 'Recusar texto em claro: atributo que não é JWE é inválido (downgrade)',
  // Ignore case
  '840459527132509616': 'Ignorar maiúsculas',
  // Trusted signers
  '8964988845458054386': 'Signatários confiáveis',
  //  JSON array of 1 to 10 public JWKs (EC P-256, ES256, with kid and without d) of whoever signs.
  '3799202753314949753':
    ' Lista JSON de 1 a 10 JWKs públicas (EC P-256, ES256, com kid e sem d) de quem assina. ',
  // Encryption keys
  '5425112736283841497': 'Chaves de cifra',
  // Senders encrypt to the public key; the private key never leaves the server. Up to {$INTERPOLATION}: the current one and the next, for rotation.
  '964229197384454782':
    'Quem envia cifra para a chave pública; a privada nunca sai do servidor. Até {$INTERPOLATION}: a atual e a próxima, para a rotação.',
  // Public JWKS
  '631765191507553383': 'JWKS público',
  // created {$INTERPOLATION}
  '6145219817193754759': 'criada em {$INTERPOLATION}',
  // Copy public key
  '8744575660594907881': 'Copiar chave pública',
  // No key yet: generate one and give its public key to the sender.
  '3681236514121278062': 'Nenhuma chave ainda: gere uma e passe a chave pública a quem envia.',
  // Key ID (kid)
  '6012739271167439204': 'ID da chave (kid)',
  // enc-v1
  '9097663477321127602': 'enc-v1',
  // Optional; letters, digits, . _ -
  '7273159933323824034': 'Opcional; letras, dígitos, . _ -',
  // 1 to 64 letters, digits, dots, underscores or dashes.
  '8369148749855739679': '1 a 64 letras, dígitos, pontos, sublinhados ou hifens.',
  // Generate key
  '3422532865107186286': 'Gerar chave',
  //  This URL already has {$INTERPOLATION} keys. Delete the old one before generating another.
  '7921920284685218787':
    ' Esta URL já tem {$INTERPOLATION} chaves. Apague a antiga antes de gerar outra. ',
  // Paste a JSON array of public JWKs: [{"kty": "EC", …}].
  '7247722906740193394': 'Cole uma lista JSON de JWKs públicas: [{"kty": "EC", …}].',
  // Paste at least one public JWK of the sender.
  '6837025103404078115': 'Cole ao menos uma JWK pública de quem envia.',
  // {$path} (ignore case)
  '2312635762555899740': '{$path} (ignorando maiúsculas)',
  // Reject plaintext
  '7612911005117902438': 'Recusar texto em claro',
  // Key {$kid} generated
  '5657278441646503409': 'Chave {$kid} gerada',
  // Could not generate the key ({$status}).
  '2273086929734881652': 'Não foi possível gerar a chave ({$status}).',
  // Key {$kid} deleted
  '1582049857507548445': 'Chave {$kid} apagada',
  // Could not delete the key ({$status}).
  '6451737655822499020': 'Não foi possível apagar a chave ({$status}).',
  // Copied the public key {$kid}
  '6207131896645598747': 'Chave pública {$kid} copiada',
  // Ignore case in {$claim}
  '7511986161967815160': 'Ignorar maiúsculas em {$claim}',
  // Delete key {$kid}
  '6455727995340679242': 'Apagar chave {$kid}',
  // Copy public key {$kid}
  '1829917073783003479': 'Copiar chave pública {$kid}',
  // none
  '5734888861256751765': 'nenhuma',
  // 1 key
  '921479507001707158': '1 chave',
  // {$count} keys
  '1045003028705186050': '{$count} chaves',
  // Lab scenarios
  '8466398008350004548': 'Cenários do laboratório',
  // Lab URL
  '5063575939344818033': 'URL de laboratório',
  //  This URL came ready: two encryption keys, the test sender {$INTERPOLATION}, the lab policy and rules, and it is not renewed. Run scenarios builds each scenario of the E2EE contract, delivers it through the real capture (HMAC, decryption and rules) and compares the status, the state and the reason with what is expected. The decrypted text never shows in the report.
  '4043935349102843661':
    ' Esta URL veio pronta: duas chaves de cifra, o remetente de teste {$INTERPOLATION}, a configuração e as regras do laboratório (HMAC inválido ou ausente → 401, chave desconhecida → 500, outra falha da decifra → 400, o resto 202), e ela não é renovada. Rodar cenários monta uma mensagem por cenário no servidor, entrega cada uma pela captura real (HMAC, decifra e regras) e compara com o esperado o status, o estado e o motivo; nos que nomeiam a chave, também o kid; nos que decifram, também o data igual ao enviado. O atributo decifrado nunca aparece no relatório. ',
  // Run scenarios
  '3844145349807746390': 'Rodar cenários',
  // Running the scenarios. It takes a few seconds…
  '1199777382771981644': 'Rodando os cenários. Leva alguns segundos…',
  // {VAR_PLURAL, plural, =1 {1 of {INTERPOLATION} matches} other {{INTERPOLATION_1} of {INTERPOLATION} match}}
  '2262345787437292542':
    '{VAR_PLURAL, plural, =1 {1 de {INTERPOLATION} cenários deu o resultado esperado} other {{INTERPOLATION_1} de {INTERPOLATION} cenários deram o resultado esperado}}',
  // {VAR_PLURAL, plural, =1 {1 scenario differs, listed first.} other {{INTERPOLATION} scenarios differ, listed first.}}
  '9133705194015195637':
    '{VAR_PLURAL, plural, =1 {1 cenário diverge, listado primeiro.} other {{INTERPOLATION} cenários divergem, listados primeiro.}}',
  // {VAR_PLURAL, plural, =1 {1 decrypted as expected} other {{INTERPOLATION} decrypted as expected}}
  '5975166268656642221':
    '{VAR_PLURAL, plural, =1 {1 decifrado como previsto} other {{INTERPOLATION} decifrados como previsto}}',
  // {VAR_PLURAL, plural, =1 {1 refused as expected} other {{INTERPOLATION} refused as expected}}
  '900343585218272613':
    '{VAR_PLURAL, plural, =1 {1 recusado como previsto} other {{INTERPOLATION} recusados como previsto}}',
  // {VAR_PLURAL, plural, =1 {1 differing} other {{INTERPOLATION} differing}}
  '6636118491930639223':
    '{VAR_PLURAL, plural, =1 {1 divergente} other {{INTERPOLATION} divergentes}}',
  //  P = must decrypt (with the default settings) · N = must be refused · X = claims, header and limits
  '1542943073742835709':
    ' P = deve decifrar (com a configuração padrão) · N = deve ser recusado · X = claims, cabeçalho e limites ',
  // Scenario results table
  '3911947446427329598': 'Tabela de resultados dos cenários',
  // Scenario results
  '6977076949539191166': 'Resultados dos cenários',
  // Code
  '8186013988289067040': 'Código',
  // Expected
  '7989584202803202902': 'Esperado',
  // Got
  '4603011004208784058': 'Obtido',
  // data matches
  '4043981353335140926': 'data igual ao enviado',
  // data differs
  '3640123933109989273': 'data diferente do enviado',
  // Matches
  '1567940090040631427': 'Esperado',
  // Differs
  '5250864808692692049': 'Divergiu',
  // E2EE lab
  '1137363530760030904': 'Laboratório E2EE',
  //  To see decryption working without setting anything up: a new URL with a read secret, an HMAC secret, two encryption keys, a test sender and the lab policy and rules, ready to run the scenarios of the E2EE contract. It expires in 24 hours.
  '7674714925816119094':
    ' Para ver a decifra funcionando sem configurar nada: uma URL nova com segredo de leitura, segredo do HMAC, duas chaves de cifra, um remetente de teste e a política e as regras do laboratório, pronta para rodar os cenários do contrato E2EE. Ela expira em 24 horas. ',
  // Create a lab URL
  '8706293476076086740': 'Criar URL de laboratório',
  // Too many runs for this URL (up to 6 per minute). Try again in {$seconds} s.
  '7775874228965999651':
    'Rodadas demais nesta URL (até 6 por minuto). Tente de novo em {$seconds} s.',
  // Too many runs for this URL (up to 6 per minute). Try again in a moment.
  '5063035853513844048': 'Rodadas demais nesta URL (até 6 por minuto). Tente de novo em instantes.',
  // The server refused the run: {$reason}
  '6743291150073189530': 'O servidor recusou a rodada: {$reason}',
  // Could not run the scenarios ({$status}).
  '5518836484461613670': 'Não foi possível rodar os cenários ({$status}).',
  // valid
  '5444624488565197915': 'válida',
  // invalid
  '3745493590228312122': 'inválida',
  // unknown_kid
  '4816556229074369568': 'chave desconhecida',
  // absent
  '6493175751219996942': 'em claro',
  // Round trip
  '4219695375143525996': 'Ida e volta',
  // Rotation: encrypted to enc-v1 while enc-v2 is active
  '6982312164038402108': 'Rotação: cifrado para enc-v1 com enc-v2 ativa',
  // Accents and emoji in the data
  '5102885369519702196': 'Acentos e emoji no data',
  // Large and precise numbers in the data
  '4865897090636675286': 'Números grandes e exatos no data',
  // app in a different case from the envelope
  '8796213585604771041': 'app com caixa diferente da do envelope',
  // JWE without a JWS inside (the channel forging with the public key)
  '5416535025711074818': 'JWE sem JWS dentro (forja com a chave pública)',
  // JWS from a signer that is not trusted
  '9118066033648714791': 'JWS de um signatário que não é confiável',
  // JWS with the trusted kid but signed by another key
  '1184476913385327739': 'JWS com o kid confiável, mas assinado por outra chave',
  // Ciphertext of one message in the envelope of another
  '1730209315699905963': 'Cifra de uma mensagem no envelope de outra',
  // Plaintext object where the JWE should be (downgrade)
  '3628491819880300374': 'Objeto em claro no lugar do JWE (downgrade)',
  // JWE for a key the URL does not have
  '7090665772300641183': 'JWE para uma chave que a URL não tem',
  // epk point off the P-256 curve
  '5738967710289813501': 'Ponto epk fora da curva P-256',
  // HMAC computed with another secret
  '7669247890922992257': 'HMAC calculado com outro segredo',
  // Body changed after the HMAC
  '6104516369856179503': 'Corpo alterado depois do HMAC',
  // JWS with alg none
  '855067302493046442': 'JWS com alg none',
  // JWS with alg HS256
  '206851176239018557': 'JWS com alg HS256',
  // app different from the envelope
  '8627567760659512119': 'app diferente do envelope',
  // aud of another recipient
  '2661165840135246941': 'aud de outro destinatário',
  // JWE header without cty
  '1962521155638285096': 'Cabeçalho do JWE sem cty',
  // JWS without data
  '3053419684321600510': 'JWS sem data',
  // evt in a different case from the envelope
  '4052603831608720117': 'evt com caixa diferente da do envelope',
  // iat older than the window
  '1928306576463850988': 'iat mais velho que a janela',
  // JWE header without kid
  '8581292883924708738': 'Cabeçalho do JWE sem kid',
  // JWE larger than 256 KiB
  '2572786614931951458': 'JWE maior que 256 KiB',
  // Expires {$relative} ({$date})
  '3199083783022916599': 'Expira {$relative} ({$date})',
  // Could not create the lab URL ({$status}).
  '3621437451982219202': 'Não foi possível criar a URL de laboratório ({$status}).',
  // Open request #{$id} of {$code} in the Inbox
  '5965149142167971485': 'Abrir a requisição #{$id} de {$code} na Entrada',
  // Lab URL created
  '495412022296792930': 'URL de laboratório criada',
  //  Copy the secrets now: the server shows them only this once, and they don't come back.
  '6360547360362890653':
    ' Copie os segredos agora: o servidor só os mostra desta vez, e eles não voltam. ',
  // Read secret
  '8792974996770948158': 'Segredo de leitura',
  //  Opens this URL in another browser (unlock screen) or in the API (X-Anzol-Secret header).
  '1630345964196771541':
    ' Abre esta URL em outro navegador (tela de desbloqueio) ou na API (cabeçalho X-Anzol-Secret). ',
  // HMAC secret
  '8949787875760698359': 'Segredo do HMAC',
  //  Signs the requests you send yourself: HMAC-SHA256 of the body, in hex, in the {$INTERPOLATION} header.
  '5449514821887823658':
    ' Assina as requisições que você mesmo envia: HMAC-SHA256 do corpo, em hex, no cabeçalho {$INTERPOLATION}. ',
  // Open the lab URL
  '4836875051782765764': 'Abrir a URL de laboratório',
  // Copy read secret
  '2514245971396730298': 'Copiar segredo de leitura',
  // Copy HMAC secret
  '4147119137556216026': 'Copiar segredo do HMAC',
  // Copied the read secret
  '9004039826557714389': 'Segredo de leitura copiado',
  // Copied the HMAC secret
  '8534427223846313672': 'Segredo do HMAC copiado',
  // the URL signature did not pass, so nothing was opened
  '4099669960109730203':
    'a assinatura HMAC desta requisição não passou, então o JWE não foi aberto',
  // the body is not JSON
  '4648007250808057723': 'o corpo não é JSON',
  // the attribute is missing
  '6098038580826029757': 'o atributo cifrado não veio neste corpo',
  // the attribute arrived in plaintext
  '4095206439753465736': 'o atributo cifrado não veio como JWE',
  // the JWE is over 256 KiB
  '2837686852832932293': 'o JWE passa de 256 KiB',
  // the attribute is not a compact JWE
  '8770002820047482648': 'o atributo não é um JWE compacto',
  // the JWE alg is not ECDH-ES
  '1918584685182351139': 'o alg do JWE não é ECDH-ES (acordo direto)',
  // the JWE enc is not A256GCM
  '3268614483128049150': 'o enc do JWE não é A256GCM',
  // a compressed JWE (zip) is not accepted
  '7603376367620961839': 'JWE comprimido (zip) não é aceito',
  // the JWE has no kid
  '6337484597755680831': 'o JWE não tem kid',
  // the JWE cty is not JWT
  '1235433314706885881': 'o cty do JWE não é JWT',
  // the ephemeral key (epk) is invalid
  '1180958178122264389': 'a chave efêmera (epk) é inválida',
  // the ephemeral key (epk) is off the P-256 curve
  '4784819155901149829': 'a chave efêmera (epk) está fora da curva P-256',
  // decryption failed: another key, or the JWE was altered
  '4174154984477755287': 'a chave de cifra nomeada no JWE não o abriu',
  // there is no JWS inside the JWE
  '4978491312377245090': 'não há JWS dentro do JWE',
  // the JWS alg is not ES256
  '3510604211532383033': 'o alg do JWS não é ES256',
  // the JWS kid is not a trusted signer
  '5736766313539511422':
    'o JWS diz ter sido assinado por uma chave de assinatura que não está nos signatários confiáveis desta URL',
  // the JWS signature does not verify
  '6324024128697707385':
    'a assinatura do remetente (JWS) não confere com a chave pública colada aqui',
  // the JWS claims are not a JSON object
  '430255637426026978': 'os claims do JWS não são um objeto JSON',
  // aud does not include the audience
  '8495543216487372431': 'o aud do JWS não inclui a audiência desta URL',
  // jti does not match the envelope
  '5542504737015617522': 'o claim jti do JWS não bate com o envelope (o corpo fora do JWE)',
  // evt does not match the envelope
  '841781475653216409': 'o claim evt do JWS não bate com o envelope (o corpo fora do JWE)',
  // app does not match the envelope
  '3296686154338099088': 'o claim app do JWS não bate com o envelope (o corpo fora do JWE)',
  // the JWS has no iat
  '117103034887306727': 'o JWS não tem iat',
  // iat is outside the allowed window
  '618391409188079226': 'o iat do JWS está fora da janela permitida',
  // the JWS has no data claim
  '3824204479501526840': 'o JWS não tem o claim data',
  // HMAC blocked
  '7411547123659872971': 'HMAC barrou',
  // Not JSON
  '7555270138433697457': 'Corpo não é JSON',
  // Attribute missing
  '2621008442009129297': 'Atributo ausente',
  // Plaintext · refused
  '1994445150066703925': 'Em claro · recusado',
  // JWE too large
  '7702396007361618827': 'JWE grande demais',
  // Malformed JWE
  '6211706700701760635': 'JWE malformado',
  // alg not allowed
  '6159392378611949532': 'alg não aceito',
  // enc not allowed
  '2524118018037540632': 'enc não aceito',
  // Compressed JWE
  '5383964903743763319': 'JWE comprimido',
  // No kid
  '3656950987025646374': 'JWE sem kid',
  // cty not JWT
  '6730616710140792116': 'cty não é JWT',
  // Invalid epk
  '2824784245082944346': 'epk inválida',
  // epk off curve
  '7231825429611556538': 'epk fora da curva',
  // Decrypt failed
  '2137194655050978327': 'Não decifrou',
  // No JWS inside
  '321924482601508371': 'Sem JWS dentro',
  // JWS alg not allowed
  '162741007622960851': 'JWS alg não aceito',
  // Unknown signer
  '4941102327371760730': 'Signatário desconhecido',
  // JWS signature invalid
  '4289207797231348918': 'Assinatura JWS inválida',
  // Malformed claims
  '6059128603543603206': 'Claims malformados',
  // aud mismatch
  '3325928655118531304': 'aud divergente',
  // jti mismatch
  '2494656257691670018': 'jti divergente',
  // evt mismatch
  '57168990296969550': 'evt divergente',
  // app mismatch
  '9063217634725915674': 'app divergente',
  // No iat
  '6179193878457586172': 'Sem iat',
  // iat outside window
  '2774403225745773319': 'iat fora da janela',
  // No data claim
  '5961730565889069577': 'Sem data',
  // Decrypted · repeated jti
  '9201304644456821758': 'Decifrada · jti repetido',
  // Decrypted
  '8002782093253209415': 'Decifrada',
  // key {$kid} · signed by {$signer}
  '1802912247230774408': 'chave de cifra {$kid} · assinatura do remetente {$signer}',
  // Repeated jti
  '3554156791085147337': 'jti repetido',
  // Unknown encryption key
  '8329291668612455386': 'Chave de cifra desconhecida',
  // The JWE kid {$kid} is not one of this URL's keys
  '6338941906368435061': 'O JWE veio cifrado para a chave de cifra {$kid}, que não é desta URL',
  // Unknown kid
  '7820009087498142311': 'Chave desconhecida',
  // Deleted encryption key
  '4631952254094187715': 'Chave de cifra apagada',
  // The JWE kid {$kid} is a key this URL deleted on {$date}
  '4876496398435287862':
    'O JWE veio cifrado para a chave de cifra {$kid}, que esta URL apagou em {$date}',
  // Deleted key
  '2458459851296071879': 'Chave apagada',
  // Not encrypted
  '8872070947491832220': 'Não cifrada',
  // The attribute arrived in plaintext, which this URL accepts
  '6319658340765253763':
    'O atributo cifrado não veio como JWE (ou o corpo não é JSON), e esta URL aceita isso',
  // Plaintext
  '4603020359259128052': 'Em claro',
  // Decryption invalid
  '7254015638160199399': 'Decifra não feita',
  // Decryption invalid
  '7047936464040307733': 'Decifra inválida',
  // Encryption keys here: {$kids}
  '28850327177048580': 'Chaves de cifra desta URL hoje: {$kids}',
  // This URL has no encryption key: generate one in Checks › Decryption and publish the JWKS.
  '5612265685224617344':
    'Esta URL não tem nenhuma chave de cifra: gere uma em Verificações › Decifra e publique o JWKS.',
  // This URL deleted this key on {$date}: the sender still uses the old JWKS. Ask them to fetch it again.
  '3355637576119368145':
    'Esta URL apagou esta chave em {$date}: o remetente ainda usa o JWKS antigo. Peça que ele o baixe de novo.',
  // This URL has no record of deleting this key (it keeps its last 20 deleted keys): the sender most likely encrypted to another recipient. Check which JWKS the sender uses.
  '4657498997186246276':
    'Esta URL não tem registro de ter apagado esta chave (ela guarda as 20 últimas apagadas): o mais provável é que o remetente tenha cifrado para outro destino. Confira qual JWKS o remetente usa.',
  // A key with this kid was deleted on {$date} and recreated: the sender encrypted to the deleted key. Ask them to fetch this URL's JWKS again.
  '8973075580919968031':
    'Uma chave com este kid foi apagada em {$date} e recriada: o remetente cifrou para a chave apagada. Peça que ele baixe de novo o JWKS desta URL.',
  // Binding here: {$claim} ↔ {$path}
  '8127539399860512654': 'Vínculo desta URL: {$claim} ↔ {$path}',
  // Trusted signers here: {$kids}
  '5093069732900863528': 'Signatários confiáveis desta URL: {$kids}',
  // This URL has no trusted signer.
  '3838737910130502070': 'Esta URL não tem nenhum signatário confiável.',
  // Audience here: {$audience}
  '2046406031450925341': 'Audiência desta URL: {$audience}',
  // Encrypted attribute here: {$path}
  '8183379000458726355': 'Atributo cifrado desta URL: {$path}',
  // Max age here: {$seconds} s
  '5466563591429833634': 'Idade máxima desta URL: {$seconds} s',
  // The sender must send a JSON body carrying the encrypted attribute.
  '4772427480392526388': 'O remetente precisa mandar um corpo JSON com o atributo cifrado.',
  // The sender must use a valid P-256 ephemeral key (epk) in the JWE header.
  '8211812893622813100':
    'O remetente precisa pôr no cabeçalho do JWE uma chave efêmera (epk) P-256 válida.',
  // A message cut from another envelope, or the binding set here points at the wrong field (case only: turn on Ignore case).
  '4756990495593773461':
    'Mensagem recortada de outro envelope, ou o vínculo configurado aqui aponta para o campo errado (diferença só de caixa: ligue Ignorar maiúsculas).',
  // Check the HMAC signature first: decryption only runs after it. The signature card says whether the sender or the secret set here is at fault.
  '5417256220283444611':
    'Confira a assinatura HMAC primeiro: a decifra só roda depois dela. O cartão da assinatura diz se o problema está no remetente ou no segredo configurado aqui.',
  // The sender did not send it, or the encrypted attribute set here points at another field: check it against a real message.
  '1685524679813001624':
    'O remetente não o mandou, ou o atributo cifrado configurado aqui aponta para outro campo: confira contra uma mensagem real.',
  // The sender sent it in plaintext, or the encrypted attribute set here points at another field.
  '3759295271342855593':
    'O remetente mandou em claro, ou o atributo cifrado configurado aqui aponta para outro campo.',
  // The sender must keep the JWE up to 256 KiB.
  '7228039824944147233': 'O remetente precisa mandar um JWE de até 256 KiB.',
  // The sender must send a compact JWE (five parts separated by dots).
  '1546446095739417885':
    'O remetente precisa mandar um JWE compacto (cinco partes separadas por ponto).',
  // The sender must encrypt with alg ECDH-ES (direct key agreement), the only one accepted.
  '4634254985051505906':
    'O remetente precisa cifrar com alg ECDH-ES (acordo direto), o único aceito.',
  // The sender must encrypt with enc A256GCM, the only one accepted.
  '2697160424675676546': 'O remetente precisa cifrar com enc A256GCM, o único aceito.',
  // The sender must not compress the JWE (no zip in its header).
  '8061400600846915998': 'O remetente não pode comprimir o JWE (sem zip no cabeçalho).',
  // The sender must put in the JWE header the kid of an encryption key of this URL.
  '4066975636782769812':
    'O remetente precisa pôr no cabeçalho do JWE o kid de uma chave de cifra desta URL.',
  // The sender must put cty: JWT in the JWE header.
  '6700277022736429274': 'O remetente precisa pôr cty: JWT no cabeçalho do JWE.',
  // The message was altered, the key was deleted and recreated with the same kid, or the sender encrypted to another URL's key with the same kid (every lab has enc-v1 and enc-v2). Check which JWKS the sender uses.
  '4243140561487597728':
    'A mensagem foi alterada, a chave foi apagada e recriada com o mesmo kid, ou o remetente cifrou para a chave de cifra de outra URL que usa o mesmo kid (todo laboratório tem enc-v1 e enc-v2). Confira qual JWKS o remetente usa.',
  // The sender encrypted the data directly, without signing: the format requires an ES256 JWS inside the JWE.
  '7430526873102639243':
    'O remetente cifrou o dado direto, sem assinar: o formato exige um JWS ES256 dentro do JWE.',
  // The sender must sign the JWS with ES256.
  '6533783706039618996': 'O remetente precisa assinar o JWS com ES256.',
  // If the sender rotated keys, paste the new public key in Checks › Decryption › Trusted signers; if you do not recognize this key, treat it as an unknown sender.
  '2876590976681982050':
    'Se o remetente trocou de chave, cole a pública nova em Verificações › Decifra › Signatários confiáveis; se você não reconhece essa chave, trate como remetente desconhecido.',
  // The sender rotated keys and kept the kid, the public key pasted here is wrong, or it is a forgery. Paste the sender's current public key again.
  '8491599404628565745':
    'O remetente trocou a chave e manteve o kid, a pública colada aqui está errada, ou é uma forja. Recole a chave pública atual do remetente.',
  // The sender must sign a JSON object of claims in the JWS.
  '8754683856855844907': 'O remetente precisa assinar no JWS um objeto JSON de claims.',
  // The sender must send aud with this URL's audience, or the audience set here is not the agreed one.
  '3134801950448392323':
    'O remetente precisa mandar aud com a audiência desta URL, ou a audiência configurada aqui não é a combinada.',
  // The sender must put iat (the signing time) in the JWS claims.
  '2939605434584310722': 'O remetente precisa pôr iat (a hora da assinatura) nos claims do JWS.',
  // The window goes from the max age set here into the past up to 5 min into the future: late redelivery or a wrong clock at the sender; or raise the max age here.
  '7325933271363727076':
    'A janela vai da idade máxima configurada aqui para trás até 5 min para a frente: reentrega atrasada ou relógio errado no remetente; ou aumente a idade máxima aqui.',
  // The sender must put the data claim (the attribute itself) in the JWS.
  '4294451110972106575': 'O remetente precisa pôr o claim data (o próprio atributo) no JWS.',
  // decryption: expected {$expected}, got not configured
  '7613681671970386143': 'decifra: não configurada nesta URL (a regra pede decifra {$expected})',
  // decryption: expected {$expected}, got {$got}
  '5656599743816655939': 'pede decifra {$expected}; esta veio {$got}',
  // Decrypted
  '3636098527993575441': 'Decifrado',
  //  The attribute as decrypted on arrival (the JWS data claim). The body keeps the JWE as it came.
  '5150909776707982349':
    ' O atributo como o servidor o decifrou na chegada (o claim data do JWS), gravado nesta mensagem. O corpo mantém o JWE como chegou. ',
  // Decrypted attribute
  '6641968519268196135': 'Atributo decifrado',
  // Key: {$kid}
  '2032685813231396424': 'Chave de cifra: {$kid}',
  // Signed by: {$signer}
  '8138824404534403132': 'Chave de assinatura do remetente: {$signer}',
  // Received aud: {$aud}
  '5387378174994900625': 'aud recebido: {$aud}',
  // Received aud: none
  '3526902123017722241': 'aud recebido: nenhum',
  // First request with this jti: #{$id}
  '812133857419478642': 'Primeira requisição com este jti: #{$id}',
  // Decryption
  '1160913992019279897': 'Decifra',
  // Never matches: this URL does not decrypt.
  '4919114349019836568': 'Nunca casa: esta URL não decifra.',
  //  Never matches: this URL refuses plaintext (it is recorded as Invalid, reason downgrade). To answer plaintext, use Invalid (it matches any decryption failure, not just plaintext).
  '4397602734268889825':
    ' Nunca casa: esta URL recusa texto em claro (ele é gravado como Inválida, motivo downgrade). Para responder ao não cifrado, use Inválida (vale para qualquer falha da decifra, não só para o texto em claro). ',
  // Unknown key
  '2035586137456321065': 'Chave desconhecida',
  // This URL does not decrypt.
  '1182506711512105977': 'Esta URL não decifra.',
  // an attribute decrypted and verified
  '2446612875410357651': 'um atributo decifrado, com a assinatura do remetente conferida',
  // an attribute that failed decryption
  '8960455913991763064': 'um atributo cuja decifra falhou',
  // an attribute encrypted to an unknown key
  '6367990955124934417': 'um atributo cifrado para uma chave desconhecida',
  // the attribute in plaintext
  '1320018065265549500': 'o atributo em claro',
  // decryption valid
  '8078563560877042150': 'decifra válida',
  // decryption invalid
  '129354642043346413': 'decifra inválida',
  // decryption unknown key
  '6145758972268919856': 'decifra com chave desconhecida',
  // decryption plaintext
  '2585131728586397201': 'decifra em claro',
  // How decryption works
  '4820026405086517015': 'Como a decifra funciona',
  // The sender encrypts to this URL
  '2049467683147191765': 'O remetente cifra para esta URL',
  // Generate the encryption key below and hand the sender the public JWKS address (or the public key). The private encryption key stays on the Anzol server.
  '4212003059613775870':
    'Gere a chave de cifra abaixo e entregue ao remetente o endereço do JWKS público (ou a chave pública). A chave privada de cifra fica no servidor do Anzol.',
  // The sender signs what it encrypts
  '2543929132158492977': 'O remetente assina o que cifra',
  // Paste the sender's public signing key (an ES256 JWK) in Trusted signers; its private key stays with the sender. Only a JWS from those keys is accepted inside the JWE.
  '370977893511760303':
    'Cole em Signatários confiáveis a chave pública de assinatura do remetente (uma JWK ES256); a privada dela fica com ele. Só um JWS dessas chaves é aceito dentro do JWE.',
  // This URL decrypts on arrival
  '1573950883465894513': 'Esta URL decifra na chegada',
  // If the URL verifies an HMAC signature, that comes first: an invalid or missing HMAC blocks decryption (hmac_failed). The decrypted attribute is stored with the request, behind the read secret; shared links and live events never carry it.
  '6287555236010400960':
    'Se a URL confere assinatura HMAC, ela vem antes: HMAC inválido ou ausente barra a decifra (hmac_failed). O atributo decifrado fica gravado em claro na requisição; o segredo de leitura protege quem lê, não o armazenamento. Links compartilhados e eventos ao vivo nunca o levam.',
  // Without an encryption key, every request that gets past the HMAC, the envelope and the JWE header is recorded as Unknown encryption key. You can save anyway; generate a key above.
  '246389393969456617':
    'Sem chave de cifra, toda requisição que passar do HMAC, do envelope e do cabeçalho do JWE fica como Chave desconhecida. Dá para salvar assim mesmo; gere uma chave acima.',
  // JSONPath of the body field that arrives as a JWE · e.g. {$START_TAG_CODE}$.payload{$CLOSE_TAG_CODE}
  '1916757703914179113':
    'JSONPath do campo do corpo que chega como JWE · ex.: {$START_TAG_CODE}$.payload{$CLOSE_TAG_CODE}',
  // Agree on it with the sender, who puts this value in the aud claim. In the lab it is {$START_TAG_CODE}anzol-lab{$CLOSE_TAG_CODE}.
  '20838032960702302':
    'Combine com o remetente: ele põe esse valor no claim aud. No laboratório é {$START_TAG_CODE}anzol-lab{$CLOSE_TAG_CODE}.',
  // Bindings to the envelope (the body outside the JWE)
  '3113804729555879937': 'Vínculos com o envelope (o corpo fora do JWE)',
  //  For each JWS claim, the envelope field that must hold the same value. It protects against splicing: a JWE pasted into another envelope fails. The paths depend on the sender's envelope: ask the sender where the event id, the event type and the service name are. Ignore case compares both sides in lower case.
  '3493608270126853561':
    ' Para cada claim do JWS, o campo do envelope que precisa ter o mesmo valor. Protege contra recorte: um JWE colado em outro envelope falha. Os caminhos dependem do envelope do remetente: pergunte a ele onde ficam o id do evento, o tipo do evento e o nome do serviço. "Ignorar maiúsculas" compara os dois lados em minúsculas. ',
  // event id · e.g. {$START_TAG_CODE}$.eventId{$CLOSE_TAG_CODE}
  '8248870956948197586': 'id do evento · ex.: {$START_TAG_CODE}$.eventId{$CLOSE_TAG_CODE}',
  // event type · e.g. {$START_TAG_CODE}$.tipoEvento.nome{$CLOSE_TAG_CODE}
  '443431740577312184': 'tipo do evento · ex.: {$START_TAG_CODE}$.tipoEvento.nome{$CLOSE_TAG_CODE}',
  // service name · e.g. {$START_TAG_CODE}$.servico.nome{$CLOSE_TAG_CODE}
  '70040655110193108': 'nome do serviço · ex.: {$START_TAG_CODE}$.servico.nome{$CLOSE_TAG_CODE}',
  // Failure responses
  '6812054586340728067': 'Respostas de falha',
  // Without a rule, a request whose decryption fails gets this URL's default response, and the sender never finds out. These rules answer 500 when the encryption key is unknown, 400 for any other decryption failure, and 401 when the HMAC signature is invalid or missing, as in the lab. Each one goes in only if the URL has no rule for that failure yet.
  '4985324593291538409':
    'Sem regra, a requisição cuja decifra falha recebe a resposta padrão desta URL, e o remetente não fica sabendo. Estas regras respondem 500 quando a chave de cifra é desconhecida, 400 em qualquer outra falha da decifra e 401 quando a assinatura HMAC é inválida ou ausente, como no laboratório. Cada uma só entra se a URL ainda não tem regra para aquela falha.',
  // Without a rule, a request whose decryption fails gets this URL's default response, and the sender never finds out. These rules answer 500 when the encryption key is unknown and 400 for any other decryption failure, as in the lab. Each one goes in only if the URL has no rule for that failure yet.
  '1954758627907120346':
    'Sem regra, a requisição cuja decifra falha recebe a resposta padrão desta URL, e o remetente não fica sabendo. Estas regras respondem 500 quando a chave de cifra é desconhecida e 400 em qualquer outra falha da decifra, como no laboratório. Cada uma só entra se a URL ainda não tem regra para aquela falha.',
  //  Add failure rules
  '5639545307784654948': ' Adicionar regras de falha ',
  // Could not add the rules: {$INTERPOLATION}
  '6325405709459678344': 'Não foi possível adicionar as regras: {$INTERPOLATION}',
  // This URL already has a rule for each failure; nothing was added.
  '7566903684944505324': 'Esta URL já tem uma regra para cada falha; nada foi adicionado.',
  // {VAR_PLURAL, plural, =1 {Added 1 rule: {INTERPOLATION}.} other {Added {INTERPOLATION_1} rules: {INTERPOLATION}.}}
  '7203022990807456957':
    '{VAR_PLURAL, plural, =1 {1 regra adicionada: {INTERPOLATION}.} other {{INTERPOLATION_1} regras adicionadas: {INTERPOLATION}.}}',
  // See them in {$START_LINK}Rules{$CLOSE_LINK}.
  '3902748895990896270': 'Veja em {$START_LINK}Regras{$CLOSE_LINK}.',
  // Closest rule: {$rule} — {$reason}{$more}
  '8820159907201520792': 'Nenhuma regra casou. A mais próxima é “{$rule}” — {$reason}{$more}',
  // Lab created from here: URL {$INTERPOLATION} · expires {$INTERPOLATION_1}
  '7934335812325617943':
    'Laboratório criado daqui: URL {$INTERPOLATION} · expira {$INTERPOLATION_1}',
  //  Without it, the URL answers 401 and does not decrypt (hmac_failed).
  '5108155971505143950': ' Sem ele, a URL responde 401 e não decifra (hmac_failed). ',
  // To send your own message
  '3839717828289932374': 'Para mandar a sua própria mensagem',
  //  Audience: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}
  '797989429479234853': ' Audiência: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}',
  //  Encrypted attribute: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}
  '4476535547461450853': ' Atributo cifrado: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}',
  //  Bindings: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}, {$START_TAG_CODE}{$INTERPOLATION_1}{$CLOSE_TAG_CODE}, {$START_TAG_CODE}{$INTERPOLATION_2}{$CLOSE_TAG_CODE}
  '6694710242208942786':
    ' Vínculos: {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE}, {$START_TAG_CODE}{$INTERPOLATION_1}{$CLOSE_TAG_CODE}, {$START_TAG_CODE}{$INTERPOLATION_2}{$CLOSE_TAG_CODE}',
  //  Paste your public signing key in Trusted signers; the test sender {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} stays.
  '530031002916438542':
    ' Cole a sua chave pública de assinatura em Signatários confiáveis; o remetente de teste {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} continua. ',
  // Optional, before the signature · e.g. {$START_TAG_CODE}sha256={$CLOSE_TAG_CODE}
  '6395332325917127089':
    'Opcional, antes da assinatura · ex.: {$START_TAG_CODE}sha256={$CLOSE_TAG_CODE}',
  // Not decrypted
  '5542406445049123018': 'Não decifrada',
  // This URL did not decrypt this request
  '669421544847439517': 'Esta URL não decifrou esta requisição',
  // {$destination}, 1 invalid decryption since {$time}
  '5372628725475554755': '{$destination}, 1 decifra inválida desde {$time}',
  // {$destination}, {$count} invalid decryptions since {$time}
  '1311871731804323751': '{$destination}, {$count} decifras inválidas desde {$time}',
  //  Requests encrypted to {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} from now on are recorded as unknown key and are not decrypted. The private key is removed from this URL.
  '1523355569219008904':
    ' As requisições cifradas para {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} daqui em diante ficam gravadas como Chave desconhecida e não são decifradas. A chave privada sai da URL. ',
};
