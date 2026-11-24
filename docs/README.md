# Documentação

[![English](https://img.shields.io/badge/English-6B737C?style=flat-square)](en/README.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-1B5A68?style=flat-square)](README.md)

O mapa das docs do Anzol. Ache a página pela tarefa que você quer cumprir, ou pelo tipo de página. Se uma palavra
não fizer sentido, o [glossário](glossario.md) diz o que ela é e como ela se chama na API, no MCP e na CLI.

**Nesta página:** [Por onde começar](#por-onde-começar) · [Quero…](#quero) ·
[Todas as páginas](#todas-as-páginas)

## Por onde começar

1. [Início rápido](../README.pt-BR.md#início-rápido): suba o Anzol com Docker e veja o primeiro webhook chegar.
2. [O que ele faz](../README.pt-BR.md#o-que-ele-faz): cada recurso em uma linha, com o link do detalhe.
3. [Primeira rodada do laboratório de defesa](laboratorio-defesa.md#primeira-rodada): meça o que o seu script ou
   agente barra quando o ataque vem assinado.

## Quero…

| Quero… | Vá para |
|---|---|
| Ver o que o meu serviço manda | [Início rápido](../README.pt-BR.md#início-rápido) |
| Escolher o que a URL responde | [Regras de resposta](api.md#regras-de-resposta) |
| Fazer a URL falhar algumas vezes e depois responder 200 | [Cenários](api.md#cenários) |
| Atrasar a resposta ou derrubar a conexão de propósito | [Atrasos e falhas de rede](api.md#atrasos-e-falhas-de-rede) |
| Conferir a assinatura do provedor e ver por que ela falhou | [Verificação de assinatura](api.md#verificação-de-assinatura) |
| Validar o corpo contra um formato | [Validação de schema](api.md#validação-de-schema) |
| Abrir um atributo que o remetente cifrou | [Decifra de atributo (E2EE)](api.md#decifra-de-atributo-e2ee) |
| Entregar no meu app local o que chega na URL | [`anzol listen`](cli.md#anzol-listen) |
| Disparar um webhook assinado no meu app | [`anzol send`](cli.md#anzol-send) |
| Esperar um webhook num teste, sem `sleep` | [`anzol wait-for`](cli.md#anzol-wait-for), [`anzol test`](cli.md#anzol-test) ou a rota de [Esperar por mensagens](api.md#esperar-por-mensagens) |
| Reenviar uma requisição gravada para o meu app | [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor) |
| Achar uma requisição no meio de muitas | [Buscar mensagens](api.md#buscar-mensagens) |
| Proteger a leitura da URL com um segredo | [Segredo de leitura](privacidade.md#segredo-de-leitura) |
| Mostrar uma requisição a alguém sem expor dado sensível | [Links só-leitura](privacidade.md#links-só-leitura) |
| Ligar um agente de IA ao Anzol | [MCP](mcp-e-ia.md#mcp) |
| Pedir uma regra em texto a um LLM local | [IA local](mcp-e-ia.md#ia-local) |
| Medir a defesa do meu script ou agente | [Laboratório de defesa](laboratorio-defesa.md) |
| Ligar o MCP, a IA local ou publicar o app | [Configuração](operacao.md#configuração) |
| Saber se o servidor está de pé e em que versão | [Saúde e versão](operacao.md#saúde-e-versão) |
| Subir no Kubernetes | [Helm](helm.md) |
| Rodar os testes e contribuir | [Desenvolvimento](desenvolvimento.md) |
| Entender um erro ou um comportamento estranho | [Solução de problemas](solucao-de-problemas.md) |
| Entender uma palavra | [Glossário](glossario.md) |

## Todas as páginas

Cada página é de um tipo. **Primeiro uso** leva você do zero a um resultado. **Como fazer** resolve uma tarefa.
**Referência** lista tudo, para consulta. **Explicação** diz por que é assim.

| Página | Tipo | Para quem | O que tem |
|---|---|---|---|
| [README](../README.pt-BR.md) | Primeiro uso | quem está chegando | o que o Anzol é, início rápido, cada recurso em uma linha |
| [Laboratório de defesa](laboratorio-defesa.md) | Primeiro uso e explicação | quem recebe webhook com script ou agente de IA | a primeira rodada, os 14 ataques, como ler o relatório, limites |
| [API](api.md) | Referência | quem integra | todas as rotas, campos, erros e limites |
| [CLI](cli.md) | Referência | quem desenvolve e testa | cada comando do `anzol`, com opções e exemplos |
| [MCP e IA local](mcp-e-ia.md) | Como fazer e referência | quem usa agente de IA | como ligar, as 23 ferramentas, a IA local e os riscos |
| [Privacidade e segurança](privacidade.md) | Explicação | quem guarda dado real | quem lê o quê, segredo de leitura, links só-leitura, proteções |
| [Operação](operacao.md) | Como fazer | quem roda o servidor | variáveis, saúde, memória do Redis, observabilidade |
| [Helm](helm.md) | Como fazer | quem usa Kubernetes | o chart e os valores |
| [Desenvolvimento](desenvolvimento.md) | Como fazer | quem contribui | suítes de teste, CI local, padrões de código |
| [Solução de problemas](solucao-de-problemas.md) | Como fazer | quem travou num erro | o que você vê, por que acontece e o que fazer, por tema |
| [Glossário](glossario.md) | Referência | todos | cada termo, o nome dele na API e o nome que você talvez já conheça |

Fora desta pasta: o documento OpenAPI 3.1, servido pelo app em `/openapi.yaml` e `/openapi.json`, e o contrato
caixa-preta que garante as rotas, em [`tests/contract/README.md`](../tests/contract/README.md).
