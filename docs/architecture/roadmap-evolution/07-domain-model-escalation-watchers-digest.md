---
status: draft
owner: Marcelo
authority: informativo (decisão de domínio reconciliada via protocolo AGENTS.md §4; promovida a ADR formal só na Fase 3, junto do roadmap final)
---

# Fase 2b — Modelagem de domínio: Escalation/múltiplos recipients + Watchers + Digest

Quinto cluster de decisão da Fase 2, dependente do cluster 4 (chasing). Decisão nível 4-5
(`change-risk-scale.md` — extensão de módulo existente, não agregado raiz novo, mas toca o motor
de notificação já em produção). Protocolo Claude↔Codex completo via MCP, sandbox read-only, 3
rodadas reais, eixo Arquitetura + Governança de Produto.

**Nota final: Claude 9,2 / Codex 9,4 — gate ≥9,0 atingido, sem arredondar.**

## Processo

- **Rodada 1**: convergência forte em lista fechada de audiences (sem `MANAGER`/`EXPLICIT_USER`
  antes de Organization/RBAC real), `ItemWatch` como agregado separado (não mutar
  `ExpirationItem` já em produção), digest sem decisão forçada (registrado como questão aberta,
  não implementado nem rejeitado — nenhum concorrente pesquisado o menciona).
- **Rodada 2**: Claude pediu verificação factual de 2 pontos. (1) Confirmação com
  `arquivo:linha` de que o desenho de `ItemWatch` (coleção sob a partição do item) é extensão
  direta de um padrão já em produção — confirmado: `ExpirationItem` usa
  `PK=TENANT#t#ITEM#itemId`/`SK=META` (`expiration-item.ts:40`) e `Document` de M6 já coexiste
  na mesma partição via `SK=DOC#documentId` (`document.ts:56`). (2) Confirmação de que a
  assimetria "`ExpirationItem` comum não notifica contato externo, só `DocumentChasingIntent`
  consegue" é intencional, não lacuna — confirmado, mesma lógica de preservar o agregado já em
  produção usada no cluster de chasing.
- **Rodada 3**: reconciliação. Nota cega final sem ver a nota do Claude.

## Decisão final

### Escalation/múltiplos recipients — lista fechada, não engine de audiência

`ASSIGNEE`, `OWNER` (fallback enquanto `tenantId=userId` valer no MVP), `WATCHERS`,
`EXTERNAL_CONTACT` (só via `DocumentChasingIntent`). **Sem `MANAGER`/`EXPLICIT_USER` no v1** —
pressupõem hierarquia organizacional/escape hatch genérico que ainda não tem base real
(Organization/RBAC continua não implementado). Continua **1 intent por destinatário por canal**,
nunca `recipientIds[]` — preserva retry, preferences, quiet hours, bounce/suppression, auditoria
e idempotência por destinatário (mesmo princípio já fixado nos clusters 2 e 4).

### Watchers — agregado separado, extensão direta de padrão já em produção

```
PK = TENANT#<tenantId>#ITEM#<itemId>
SK = WATCH#USER#<userId>
```
Confirmado com evidência real (não suposição): `ExpirationItem` já usa essa mesma partição
(`PK=TENANT#t#ITEM#itemId`, `SK=META`), e `Document` de M6 já coexiste nela como coleção
(`SK=DOC#documentId`) — `ItemWatch` é o mesmo padrão aplicado a uma nova relação 1:N, não técnica
nova. Sem GSI novo até existir consumidor real de "todos os itens que eu assisto". Evita mutar o
agregado `ExpirationItem` (já em produção, versionado) para adicionar/remover watcher.

### `EXTERNAL_CONTACT` — assimetria intencional, não lacuna

Um `ExpirationItem` comum (mesmo linkado a um `subjectId`) **não** notifica contato externo em
v1. Só `DocumentChasingIntent` alcança destinatário externo, via snapshot do `DocumentRequest`
(decisão do cluster 4). Preserva o agregado `NotificationIntent` já em produção sem generalização
— "lembrete de vencimento" continua interno; "cobrança de documento" pode ir ao externo.

### Digest — questão aberta, decisão explicitamente adiada

**Não decidido implementar nem rejeitar.** Nenhum concorrente pesquisado (`02-market-research.md`)
menciona digest — evidência insuficiente para justificar a complexidade agora
(`docs/engineering/principles.md` #1). Gatilho de reavaliação: evidência real de notification
fatigue ou volume de notificações por usuário acima de threshold observado em uso real, não
especulação. Se implementado no futuro: agregação **na camada de entrega**
(`DigestEntry` por intent elegível, agrupado por `tenantId+recipient+channel+window`), nunca no
domínio do evento original (`NotificationIntent`/`DocumentChasingIntent` continuam 1-por-evento);
vencido/escalation crítico/chasing externo são candidatos a bypass, decisão final só quando (se)
digest for de fato implementado.

## Residual registrado (não bloqueante)

Quando Organization/RBAC existir (cluster 3, gatilho B2B), `OWNER` como audience e a futura
noção de `MANAGER`/papéis internos precisarão de revisão formal para não virar semântica ambígua
— não bloqueia o v1 proposto aqui.

## Próxima ação

Restam 2 clusters antes da Fase 3: custom fields (eixo Arquitetura, com risco de complexidade já
documentado na pesquisa de mercado) e CSV import/export (eixo Qualidade de Engenharia +
Segurança).
