# D-328 — Rodada 4, parecer independente Codex

Nota cega: **8.4/10**. **Não aprovo D-328 nesta rodada.** Não li a autoavaliação do Claude.

Escopo: cinco correções submetidas, variações de concorrência e qualidade dos testes correspondentes. Os arquivos solicitados foram lidos na ordem indicada. Nenhum código funcional foi alterado nesta revisão.

## Correções verificadas

- Identidade no reenvio: fechado o interleaving original com três atores. Reenvio lê A/v1 e espera no provider; tentativa errada grava A/v2; confirmação de A lê v2 e espera na escrita; reenvio perde OCC, relê e grava B/v3; confirmação antiga é rejeitada, sem opt-in nem atualização do telefone.
- Orçamento: dez tentativas erradas concorrentes, após quatro erros realmente persistidos, terminam em exatamente cinco. Confirmação correta pendente também é rejeitada quando a quinta tentativa errada vence.
- Expiração: retry contra desafio ainda não confirmado rejeita após expiração. Há uma variante aberta abaixo.
- Logout: cinco escritas reais concorrentes de telefone provocam cinco conflitos e `DependencyUnavailableError`, sem falso sucesso.
- Watermark: três chamadas reais de logout, com a mais antiga pausada, preservam o maior instante persistido.

## Achados abertos

### R4-1 — Média: shortcut de confirmação no retry ainda ignora expiração

`src/modules/notification/application/whatsapp-phone-confirmation-service.ts:316`: `if (fresh.confirmedAt) return` precede a validação contra `freshNow`. O chamador continua com `setPhoneNumber` e `recordOptIn`.

Reprodução com pausa assíncrona na escrita: desafio A criado às 00:00; confirmação A1 inicia às 00:09:59 e pausa; A2 confirma A; outra chamada confirma telefone B; relógio avança a 00:10:01; A1 retoma, perde OCC, encontra A confirmado e retorna sucesso sem verificar expiração. O último `setPhoneNumber` volta de B para A, embora A esteja expirado. Não exige uma pausa de onze minutos: dois segundos na borda do TTL bastam.

Correção necessária: validar expiração do estado fresco antes do retorno idempotente no retry. O teste deve exigir rejeição e ausência de novos efeitos de telefone/consentimento neste ramo. Não basta verificar o ramo `fresh.confirmedAt` ausente.

### R4-2 — Média: reenvios concorrentes contornam cooldown e restauram timestamps antigos

`src/modules/notification/application/whatsapp-phone-confirmation-service.ts:112`, `:121`, `:147`: cooldown verificado uma vez; envio externo ocorre antes da escrita condicionada; retry usa `now` original e não revalida cooldown.

Duas reproduções:

1. B e C começam no mesmo instante, após o cooldown de A. B pausa na escrita; C envia e persiste; B retoma, perde OCC e sobrescreve C. Ambas retornam sucesso e ambas enviam mensagens dentro da mesma janela.
2. B começa às 00:01:01 e pausa; C começa às 00:02:02 e persiste. B retoma e restaura `createdAt=00:01:01`. Uma chamada D às mesmas 00:02:02 é aceita imediatamente. A versão cresce corretamente, mas o relógio do cooldown retrocede.

A corrida de envio já existia antes da rodada; o novo retry condicionado ainda não a fecha. Rechecar cooldown somente depois de `send` não impede o efeito externo. É necessário arbitrar a admissão ao envio antes do provider e impedir que um perdedor substitua o desafio vencedor usando o timestamp antigo, preservando tratamento explícito da falha do provider.

### R4-3 — Baixa, regressão no serviço: validação E.164 após o envio

`src/modules/notification/application/whatsapp-phone-confirmation-service.ts:121` e `:147`: o builder que valida o telefone foi movido para depois de `send`. Chamar o serviço com `invalid-phone` invoca o provider antes de lançar `ValidationError`.

A rota HTTP atual valida o schema antes de chamar o serviço (`preferences-handlers.ts:143`), portanto não classifico isso como bypass HTTP nem como bloqueador de segurança isolado. Restaurar validação antes do efeito externo e corrigir o comentário que afirma a garantia oposta.

## Cobertura

Os dois arquivos submetidos passam: **27/27 testes**. A execução convencional não carregou `vitest.config.ts` por acesso negado do sandbox; a API programática de `vitest/node` com configuração inline executou os dois arquivos com sucesso. Não houve execução de AWS/DynamoDB real.

- O novo teste de reenvio usa pausa assíncrona válida, mas completa a confirmação antes de liberar o reenvio; não reproduz a confirmação ainda pendente do interleaving original. Sua asserção final prova avanço de versão, não rejeição do código antigo nem ausência de efeitos colaterais. O nome também promete preservar uma confirmação que o reenvio efetivamente remove. Acrescentar o interleaving original completo e afirmar resultado/efeitos da confirmação pendente. A mutação falhar por timeout por não interceptar mais `transactWrite` é evidência mais fraca que falhar na invariante observada.
- O teste de orçamento fabrica `attemptCount=4` apenas na leitura, sem persistir esse estado. `<=5` também aceita nenhuma contabilização. Reproduzi as mesmas asserções com o helper de incremento substituído em runtime por um no-op: todas passam e o valor persistido fica em **0**. Persistir quatro erros reais, congelar esse snapshot real, exigir exatamente cinco, erros do tipo esperado e rejeição posterior do código correto. A mutação específica que produzia nove foi coberta, mas não prova suficiência do oráculo.
- O teste de expiração cobre retry não confirmado; falta R4-1.
- Os testes de logout cobrem os defeitos locais. Complementei a evidência com escritores reais intercalados, inclusive três logouts, sem encontrar variante regressiva.

Reprodução independente: [round-4-codex-repro.ts](round-4-codex-repro.ts), com os serviços reais e stores in-memory existentes, pausas assíncronas antes de persistir, relógio injetado e asserts. O probe de mutação atua só na instância de teste; não modifica o arquivo do serviço.

```powershell
node --require ./docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-3-codex-loader.cjs ./docs/architecture/reviews/d328-whatsapp-phone-confirmation-adversarial-review/round-4-codex-repro.ts
```

## Fechamento da revisão

Skill `/task-checklist` aplicada: revisão sem alteração funcional, não fechamento da implementação D-328. Avaliados consistência/concorrência, segurança de confirmação e logout, qualidade dos testes e correspondência das alegações com o código. Sem mudança de infra, contrato, produto, jurídico ou autorização de deploy. A implementação permanece `PENDING_PROTOCOL_REVIEW` pelos achados R4-1/R4-2.

DoD: item=revisão cega D-328 R4; risco=avaliação read-only, artefatos de evidência sem alteração funcional; evidência=27/27 testes direcionados e reproduções independentes; lacunas=R4-1/R4-2, regressão local R4-3, cobertura descrita acima; sem aprovação de implementação.

NOTA_CODEX: 8.4
