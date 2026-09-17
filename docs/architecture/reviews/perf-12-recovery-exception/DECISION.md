# PERF-12 — recuperação durável sob exceção temporária

Status: IMPLEMENTAÇÃO AUTORIZADA SOB EXCEÇÃO; revisão independente PENDENTE.
Data: 2026-09-16. Owner: Marcelo. Risco: 5 (protocolo de recuperação assíncrona).

## Autorização e prazo

Marcelo autorizou nesta sessão prosseguir com implementação e validação em dev
antes do protocolo Claude↔Codex, indisponível por orçamento de tokens. Esta é
exceção explícita ao momento da revisão de AGENTS §4/DoD, não uma alegação de
que o desenho foi escolhido diretamente por ele ou já recebeu revisão independente.
Autorrevisão não substitui nota cega. Rodar o protocolo quando a capacidade voltar;
expiraEm: 2026-09-23. Se pendente nessa data, reavaliar a exceção antes de novas
expansões do escopo. CI, testes, tenant fences e deploy pelo pipeline permanecem.
Este registro não autoriza mudanças de topologia, envio externo ou avanço de volume.

## Problema e solução escolhida pelo implementador

No PAGED, devolver CLAIMED expirado a SCHEDULED deixa a ocorrência atrás de uma
lease COMPLETED, sem nova descoberta. Recuperação passa a usar os helpers de
claim existentes em modo explícito de recuperação: ler estado atual consistente,
aceitar apenas CLAIMED expirado, renovar claim/version e inserir novo outbox de
dispatch atomicamente. Abrange ReminderOccurrence e DocumentChasingOccurrence;
reutiliza destinos, permissões e sweeper existentes, sem novo índice/fila.
LEGACY mantém a reversão anterior. Reconciliador expõe claimsRecovered separado
de claimsReverted. A recuperação independe de lookback e de leases de scan.

Um crash antes da transação deixa o claim expirado descobrível. Depois da
transação, o outbox durável cobre a entrega. Concorrência com dispatch/recovery
é protegida por versão e condição; só o cancelamento comprovadamente restrito
à condição do item é benigno. Outros motivos propagam para retry/alarme.
Repetições legítimas continuam possíveis e devem ser absorvidas pelo dispatch.

Correções complementares: aquisição de lease de outbox exige status persistido
PENDING; scan rejeita cursor/lease obsoletos antes de publicar, preservando fence
final; partial failures de Streams usam SequenceNumber; Scheduler registra
scheduledTime/receivedAt para medir a parcela inicial sem mudar sua semântica.

## Alternativas consideradas

- Reabrir scan COMPLETED: exige coordenação entre recuperação e enumeração,
  rescaneia outras ocorrências e acopla recuperação ao estado do shard/minuto.
- Reverter e publicar candidato na mesma transação: correto se durável, mas
  exige novo destino outbox/relay para a fila de claim e outra etapa de espera.
- Aumentar TTL: reduz frequência, mas não corrige ausência de retomada.
- Renovar claim + outbox de dispatch existente: escolhido pelo menor número de
  transições e reutilização de mecanismos já existentes.

## Pesquisa e autorrevisão

Pesquisa externa: SIM. AWS documenta atomicidade de TransactWriteItems, motivos
distintos de TransactionCanceledException e entrega at-least-once de Streams:
[transações](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html),
[Streams](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html).
Critérios: atomicidade estado/outbox; retomada fora do lookback; preservação de
tenant/type; concorrência; erro transitório visível; idempotência downstream;
observabilidade; rollback. Nenhuma nota independente foi atribuída.

Rollback: reverter código pelo pipeline; LEGACY permanece disponível, mas
retornar ao código anterior restaura os defeitos conhecidos. Não apagar outboxes
nem leases para simular rollback. Eventos de recuperação usam contratos atuais.

## Gates e pendências

- [x] Regressões locais e DynamoDB Local: 14 testes de integração em quatro arquivos;
  200 testes dos módulos afetados, mais seleção PAGED/LEGACY e falha de publicação.
  G-V3 aplicado aos testes novos/alterados. Suíte completa: 3.086 passaram e uma
  expectativa antiga de replay falhou; corrigida para descarte antes do envio,
  arquivo de integração reexecutado (2/2). CI completo ainda pendente.
- [x] Typecheck/lint/boundaries/build/check-docs locais e validate-schemas.
- [ ] CI completo.
- [x] Autorrevisão do diff final: versão condiciona renovação; outbox permanece
  atômico; replay consulta estado atual; LEGACY preservado; exceções desconhecidas
  propagam. DynamoDB Local revelou passagem de atributos extras como chave no
  primeiro rascunho: corrigido para PK/SK, regressão real passou. Fixture de chasing
  corrigida para tier T7 e chave CHASING. Sem nota/revisão independente simulada.
- [ ] Deploy em dev e repetição de 10k, SLO original de 300s.
- [ ] Revisão independente completa posterior (não marcar aprovação antes disso).

DoD: recuperação risco 5 (mudança de protocolo), implementada sob EX-PERF-12,
revisão independente pendente; demais correções risco 3-4. Evidência local acima;
logging novo contém somente horários e contagem agregada, sem payload/PII.
Não foram alterados topologia, intervalo do Scheduler, TTL ou destinos de envio.
