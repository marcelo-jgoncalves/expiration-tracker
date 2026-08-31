# W3-07 Purge Orchestrator — Round 3 self-grade (blind, written before invoking Codex again)

**Nota: 9,1/10**

## Pontos fortes

- Os 2 achados bloqueantes da Rodada 2 fechados com verificação concreta: reconfirmei por leitura
  que `TenantPurgeCheckpoint` é seguro (não é o vetor de risco), isolando precisamente o campo
  problemático (`unresolvedErrors`) em vez de assumir todo o resultado era arriscado; a alegação de
  reuso de alarme foi corrigida para uma proposta explícita de alarme novo, sem fingir que já existe.
- Achado de ordenação real e não-trivial da própria Rodada 2 (item não-bloqueante do Codex, mas
  genuíno): corrigi a ordem de checagem terminal-state vs. retry incondicional no contrato do
  `CloseOrganizationService` — isso teria sido um bug real de implementação se a próxima sessão só
  seguisse a Rodada 2 ao pé da letra.
- Superfície mínima de IAM nomeada explicitamente por role, sem inventar uma política nova onde uma
  já existente (`tenant_facing_read_write_policy_json`) já cobre o caso.

## Pontos fracos / possíveis achados restantes

- ~~Não verifiquei se `AWS/States` `ExecutionsFailed`/`ExecutionsTimedOut` são de fato os NOMES
  corretos de métrica~~ — verificado após escrever esta nota, antes de invocar o Codex
  (`docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html`): nomes corretos,
  citação adicionada à proposta. Risco fechado antes da rodada, não durante.
- O `counters` do envelope compacto (Fix 6) presume que `dynamoRejectedCount`/
  `sessionRejectedCount` já existem como contadores prontos nos resultados de
  `DynamoTenantPurgeResult`/`SessionTableTenantPurgeResult` — não reli esses 2 arquivos nesta
  rodada para confirmar os nomes/existência exatos dos campos, só inferi da menção de D-082
  ("`itemsRejectedBySafetyCondition`"/"`sessionsRejectedBySafetyCondition`") no decisions-log.
- Ainda não há nenhuma prova/teste real de que 256 KiB é suficiente MESMO com o envelope compacto
  para o pior caso real (um tenant com milhares de erros por dynamo/session, não só S3) — a
  proposta assume que os CONTADORES agregados resolvem isso para todo caso, o que é verdade por
  construção (um número é sempre pequeno), mas não citei essa garantia como uma prova formal, só
  como uma consequência óbvia.

Nota reflete: acredito que os 2 bloqueantes reais da Rodada 2 estão de fato fechados com evidência
concreta (não só prosa), e a rodada mínima de 3 exigida por `AGENTS.md` §4 está satisfeita com um
achado adicional real (ordenação) corrigido no processo — mas mantenho a nota levemente abaixo de
9,2+ porque a verificação do nome exato da métrica CloudWatch não foi feita com o mesmo rigor de
fetch direto que apliquei ao resto desta rodada.
