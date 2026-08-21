# Posição cega de Claude — regra de destinatário do e-mail no MVP (M4)

Pergunta: a regra `recipientUserId = item.assigneeUserId ?? tenantId` (proposta pelo Codex, `codex-proposal-round1.md` §3.2) é a regra correta para M4?

## Posição

**Aceitar a regra como está, sem alteração.** Justificativa:

1. O estágio atual do produto é MVP single-user por tenant (`tenantId=userId`, decisão já registrada em M1/M3). Não existe hoje nenhum conceito de segundo usuário dentro de um tenant nem de "responsável" distinto do dono — `assigneeUserId` no `ExpirationItem` (se existir no domínio atual) é, na prática, sempre o próprio `tenantId`/usuário dono, ou `undefined`. Ou seja, o fallback `?? tenantId` cobre 100% dos casos reais hoje; a cláusula `assigneeUserId` é forward-looking, não urgente.
2. O ponto crítico não é a regra em si, mas onde ela mora: o Codex já isolou isso atrás de uma porta (`NotificationRecipientResolver`), o que é a escolha certa de engenharia — a regra pode mudar sem tocar o router/worker. Isso é suficiente para não travar a evolução futura (organizações multiusuário).
3. Custo de errar essa regra agora é baixo e reversível: é uma função pura sem persistência de estado próprio (o resultado, `recipientUserId`, é gravado no intent, mas a lógica de resolução pode mudar em versão futura sem migração de dados retroativa — intents antigos já processados não são reprocessados).
4. Não há decisão de custo envolvida (nenhum recurso AWS novo, nenhuma escolha de fornecedor) — não escalar ao usuário por esse critério.

## Verificação

Confirmado: `assigneeUserId?: string` já existe em `src/modules/expiration/domain/expiration-item.ts:27` (também usado em `authorization.ts` para autorização de acesso ao recurso). A regra do Codex não é aspiracional — o campo já é real e populado (`expiration-service.ts:94`).

## Veredito

Aceitar a regra do Codex tal como proposta, sem ressalva.
