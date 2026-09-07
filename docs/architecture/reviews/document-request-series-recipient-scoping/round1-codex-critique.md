NOTA: 7.6

(Crítica cega — Codex não viu a nota do Claude antes de responder.)

A solução funciona tecnicamente, mas a proposta minimiza decisões de produto e classifica o risco
incorretamente.

Pontos fracos:
- A classificação como nível 3 contradiz `change-risk-scale.md`: há mudança de contrato HTTP
  (`docarchive-series-create-request.v1.json`) e mudança persistida no modelo de dados. Pela régua
  vigente isso pode ser nível 5, mesmo sendo aditivo/retrocompatível.
- D-228 não aprovou esta decisão; registrou-a como "pendência de produto". Logo não é "implementação
  de decisão já aprovada" no sentido estrito do nível 3.
- A proposta escolhe silenciosamente semântica de snapshot imutável (endereço fixo desde a criação
  da série, usado por todos os ciclos futuros) sem declarar isso como decisão explícita.
- `cancelSeries` + `createSeries` não é equivalente a atualizar o destinatário: fragmenta
  identidade/histórico da recorrência e reinicia o ciclo. Justificativa para rejeitar mutabilidade
  é fraca.
- Não define comportamento quando o endereço muda depois de um ciclo já materializado.
- Não discute exposição do e-mail em `getSeries`/`listSeries` (retenção/PII).
- Não define normalização (espaços/caixa).
- Plano de testes estreito — falta cobrir: persistência por `createSeries`, cópia pelo
  `buildMaterializeAttemptEntries`, caminho do MATERIALIZADOR PERIÓDICO (não só o interativo),
  preservação do destinatário entre tentativas/ciclos, ausência do campo preservando comportamento
  atual, validação de contrato HTTP (email válido/inválido/maxLength), exposição em
  `getSeries`/`listSeries`.

Confirmação técnica: `buildDocumentRequestCreatedOutboxEntry` de fato não precisa mudar — recebe o
`DocumentRequest` já construído e emite só chaves + `issuanceGeneration`; o consumidor sempre relê o
registro autoritativo. Se `buildMaterializeAttemptEntries` copiar `series.recipientEmail` para
`request.recipientEmail` ANTES de montar as entries, nenhuma mudança no builder é necessária.
Adicionar o e-mail ao evento seria pior (duplicaria PII no payload do outbox).

Riscos não nomeados: série com endereço digitado errado fica permanentemente inutilizável sem
correção in-place; mudança de responsável externo exige cancelar/recriar; `listSeries` pode virar
superfície de enumeração de endereços; endereço comprometido continua em uso até intervenção
estrutural; o E2E proposto pode não provar que o worker PERIÓDICO (não só o método interativo) usa o
mesmo snapshot corretamente.

Alternativa melhor: manter o destinatário no nível da série ainda é a menor modelagem coerente, mas
a decisão deveria explicitar: (1) `recipientEmail` é configuração mutável da série; (2) cada
`DocumentRequest` recebe um SNAPSHOT no momento da materialização; (3) atualizar a série afeta só
requests futuros; (4) requests já materializados nunca são reendereçados implicitamente; (5)
política de exposição/leitura do campo, se necessária.
