---
status: design-approved-by-codex-awaiting-claude-score
owner: engineering
authority: review-evidence
---

# D-337 / M4 — Parecer Codex, Rodada 5

**Design aprovado pelo Codex: 9,1/10, sem arredondamento.** Régua E-014 permanece aprovada em 9,1/10 na Rodada 4; não foi reaberta. Avaliação independente: a proposta da Rodada 5 não contém nota de design do Claude. Portanto, não há evidência suficiente para declarar o fechamento bilateral completo do protocolo de cinco rodadas. Falta registrar a avaliação independente do Claude desta rodada; não identifiquei bloqueador técnico que exija Rodada 6.

Notas por eixo, restritas ao desenho M4 avaliado (não constituem auditoria da implementação ou do repositório): Arquitetura 9,2; Qualidade de Engenharia 9,1; Segurança/AppSec 9,2; Privacidade 9,1; Operações/SRE 9,1; Engenharia de Contexto 9,0. Demais eixos não recebem nota nesta revisão. Nota geral é julgamento do desenho, não média das auditorias globais desses eixos.

## 1. Classificação de cancelamento

A classificação proposta fecha o bloqueador da Rodada 4 no caminho real pelo wrapper:

- Preferência isolada em `ConditionalCheckFailed`: `PREFERENCE_CHANGED_RECHECK`.
- Attempt em `ConditionalCheckFailed`, preferência em `None` ou `ConditionalCheckFailed`, demais índices em `None`: `REEVALUATE`.
- `TransactionConflict`, throttling, validação ou motivo desconhecido em qualquer índice não satisfazem essas condições e são relançados.
- Fence em `ConditionalCheckFailed`: o wrapper já converte em `TenantNotActiveError`; preservar o tratamento existente.
- Fence ausente ou sem código string: o wrapper lança `ConflictError`, que não é reinterpretado pelo classificador.

**Correção factual no primeiro parágrafo da proposta:** receber uma exceção crua NÃO garante fence=`None`. Em `src/shared/tenant-lifecycle/tenant-business-mutation.ts`, o wrapper relança qualquer código string do fence diferente de `ConditionalCheckFailed`, inclusive `TransactionConflict` e `ThrottlingError`. O novo código é seguro justamente porque inspeciona também esse índice: `[ConditionalCheckFailed,None,TransactionConflict]` chega ao `throw` final. Essa imprecisão textual não invalida o algoritmo proposto.

A documentação oficial confirma a ordenação posicional e os diferentes códigos de cancelamento: [AWS TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html), consultada nesta revisão. Não confundir condição de negócio rejeitada com falha operacional.

Na implementação, explicitar `isTransactionCanceled(err)` antes de extrair os códigos e validar a forma completa dos três elementos torna o contrato local autossuficiente: `getCancellationReasonCodes` não valida o tipo da exceção, e o wrapper valida especificamente o elemento do fence, não o array inteiro. É endurecimento defensivo proporcional, não novo mecanismo arquitetural. Incluir na aceitação erros de infraestrutura no índice do fence e combinações mistas.

## 2. Reavaliação limitada

Uma repetição local é suficiente: tentativa inicial mais uma readmissão completa. A segurança decorre da releitura e das condições transacionais; aumentar o número de repetições não é necessário para preservá-la.

Reler o attempt consistentemente, renovar o horário da decisão e executar `decideSendAction` novamente. Se elegível, repetir política, preferência, quiet hours e claim; se resolvido/em andamento, aplicar o resultado real; se teto esgotado, terminalizar condicionalmente; se adiado, persistir o adiamento recuperável antes do ack. Nova disputa após a repetição produz erro propagado ao handler e `batchItemFailures`, sem ack de trabalho não resolvido. Falhas nas próprias leituras/escritas de recuperação também devem propagar. O orçamento local é compartilhado pelos caminhos de reavaliação, não reiniciado a cada troca de motivo.

## 3. Desenho consolidado aprovado

1. Lease único em `SUBMITTING`; somente o consumidor chama SES. Reconciliador descobre via GSI6, confirma versão/status/due-time e consome o ponteiro com publicação no outbox na mesma transação. Claim concorrente remove o ponteiro atomicamente. Comando reconstruído de attempt+intent persistidos, incluindo locale; GSI6 com IAM restrito.
2. `RECONCILE_UNKNOWN` usa OCC e preserva resolução concorrente; estado ambíguo não autoriza reenvio automático.
3. `nextEligibleSendAt` é o deadline persistido único para `PREPARED` e `FAILED_RETRYABLE`, preservado ao remover o ponteiro. Backoff/quiet hours e ponteiro recuperável são gravados atomicamente antes do ack.
4. `sendAttempts` conta admissões: incremento único e teto na própria claim. `redeliverAttempts` conta republicações separadamente; cada teto tem terminalização condicionada e motivo próprio.
5. Preferência lida diretamente e consistentemente, sem criação automática; opt-out encerra, ausência adia. Claim condiciona `emailEnabled=true` e a versão usada para calcular quiet hours, além de versão/status/orçamento do attempt e fence do tenant.
6. Política lida fresca; correção usa a versão atual. Política não é protegida transacionalmente: envios que já a leram podem ser admitidos após mudança, sem limite temporal ou quantitativo garantido.
7. Cancelamentos classificados por índice conforme a Rodada 5; erros operacionais propagados. `REEVALUATE` refaz a decisão e, quando cabível, toda a admissão, com uma repetição local e falha ao SQS quando esgotada.

## Evidência e limite de conclusão

Inspeção das propostas das Rodadas 2–5, notas das Rodadas 3–4, wrapper real, helpers de OCC e correção existente de `RECONCILE_UNKNOWN`. Não executados testes de implementação nesta revisão de design. Critérios de aceitação anteriores permanecem, sujeitos às correções explícitas das rodadas posteriores.

Aplicada `.claude/skills/task-checklist/SKILL.md`: unidade é o parecer da Rodada 5; não fecha implementação, backlog ou milestone. Nenhuma alteração de código/infra. `npm run check-docs` foi tentado, mas não iniciou a validação: o runtime de `tsx` falhou em `uv_os_get_passwd` com `ENOMEM` (Node local v24.15.0); validação documental pendente.

DoD: item=parecer M4 Rodada 5; risco=5-6 do desenho de admissão e recuperação assíncrona; evidência=inspeção estática e documentação AWS, design Codex 9,1, E-014 mantida 9,1; lacunas=nota independente de design Claude R5 para fechamento bilateral, implementação e respectivos gates futuros.
