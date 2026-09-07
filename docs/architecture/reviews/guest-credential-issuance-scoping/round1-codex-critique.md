# Round 1 — Codex critique (blind, before seeing Claude self-score)

NOTA: 5,8/10

A direção outbox → SQS → consumidor na Lambda guest é correta e preserva o isolamento do pepper estabelecido em D-146. Porém, a proposta não fecha o fluxo de credencial de ponta a ponta e deixa lacunas graves de corretude.

1. **O consumidor SQS não é idempotente — bloqueador.** `issueCredential()` sempre gera selector/secret aleatórios e faz `putIfAbsent` pela chave derivada do selector. Se a mesma mensagem for entregue duas vezes, ambas as chamadas normalmente terão sucesso e criarão duas credenciais válidas para o mesmo `DocumentRequest`. O relay documenta explicitamente que pode reenviar depois de `SendMessage` bem-sucedido e espera que o consumidor absorva a duplicata. A proposta ignora esse contrato central.

   É necessário definir uma chave de idempotência estável, preferivelmente `eventId` ou uma `issuanceId` persistida no evento, e gravar atomicamente:

   - o marcador de consumo/idempotência;
   - a credencial;
   - qualquer comando de notificação que carregue o token.

   Replay deve retornar o resultado já persistido ou virar no-op, nunca gerar outra credencial. Como o token bruto não é persistido atualmente, “retornar o resultado anterior” não é trivial: isso precisa ser resolvido no desenho, não deixado para implementação.

2. **O token nasce no consumidor e desaparece.** `issueCredential()` retorna o único token completo, mas persiste apenas hashes. A proposta diz que notificação é uma fatia futura e que “deixa o outbox pronto”, porém o evento `DocumentRequestCreated` existe antes de o token ser gerado e não pode carregá-lo. Depois que `issueCredential()` retorna, se o handler terminar sem enviar ou persistir uma entrega, o token é irrecuperável. Reprocessar gera outro token, agravando o problema anterior.

   O consumidor deve executar uma segunda transação atômica que crie a credencial e um comando durável de entrega contendo o token — com exposição explicitamente limitada e TTL — ou deve ser redesenhado como um worker de issuance-and-delivery. Não é aceitável criar hoje credenciais inutilizáveis esperando um consumidor futuro.

3. **Preservar o pepper não basta para provar D-146.** O evento deve ser um wake-up hint mínimo: `tenantId`, `subjectId`, `documentRequestId` e talvez `issuanceId`. O consumidor deve reler o `DocumentRequest` de forma autoritativa e validar tenant, subject, requirement, status e prazo. Não deve confiar em `requirementId` ou `deadline` vindos do payload para criar uma capability. Naturalmente, nunca pode conter token, secret, `secretHash`, selector ou qualquer material que permita calcular/verificar credenciais sem o pepper.

4. **A proposta contradiz o modelo de prazo existente.** Ela afirma que o evento carrega `deadline` suficiente para `issueCredential()`, mas `DocumentRequest.deadline` é opcional e `issueCredential.expiresAt` é obrigatório. Além disso, o builder real de `materializeAttempt` não popula `deadline`. Portanto, o fluxo recorrente proposto nem consegue chamar o método para várias requests atuais. É preciso decidir a origem normativa do vencimento ou tornar prazo obrigatório na criação; um consumidor não pode inventar TTL.

5. **`DocumentRequestCreated` é nomenclatura ampla demais para um destino imperativo.** Se todo `DocumentRequestCreated` implica emissão, o nome pode funcionar como evento de domínio, mas a semântica precisa ser formalizada e versionada em schema. No padrão concreto do repositório, destinos SQS frequentemente carregam comandos/wake-up hints especializados. Algo como `DocumentRequestCredentialIssuanceRequested` descreve melhor a intenção e evita que futuros criadores de requests emitam `Created` sem perceber o efeito de segurança. Também faltam schema JSON, versão do contrato, producer/consumer ownership e política de evolução.

6. **A atomicidade da criação está corretamente exigida, mas incompletamente especificada.** O outbox deve entrar exatamente no builder compartilhado usado tanto pelo caminho interativo quanto pelo worker, não ser acrescentado separadamente nos call sites. Caso contrário, os dois caminhos podem divergir novamente. O `aggregateVersion`, `eventId`, `correlationId` do scheduler e a estabilidade do evento em retries precisam ser definidos. Gerar novo `eventId` a cada retry externo pode contornar qualquer deduplicação.

7. **`createDocumentRequest()` avulso está subespecificado.** Faltam autorização própria, validação transacional de existência/estado de Subject e Requirement, comprovação de que o Requirement pertence ao mesmo Subject/tenant, idempotência HTTP, prazo obrigatório ou regra de TTL e endpoint/schema. Apenas deixar quatro campos de recorrência ausentes não constitui um desenho seguro de criação.

8. **Reabrir a request em `rejectVersion()` não resolve sozinho o ciclo.** A proposta precisa definir qual capacidade continua válida:

   - Se o link antigo deve continuar válido, não se deve fingir que uma nova credencial foi emitida; deve haver um evento de rejeição/chasing que reutilize explicitamente aquela capacidade.
   - Se a rejeição inicia uma nova solicitação, a credencial anterior deve ser revogada e outra emitida.
   - Se pode haver mais de uma submissão concorrente, reabrir cegamente para `REQUESTED` pode regredir uma request que já recebeu uma submissão posterior.

   Hoje a credencial é indexada apenas pelo selector hash, sem índice reverso por `documentRequestId`. Logo, a proposta não tem sequer como localizar e revogar credenciais antigas. Isso exige um pointer reverso, uma credencial ativa referenciada na própria request, ou outro modelo equivalente.

9. **O update da request na rejeição precisa de fencing real.** Não basta usar `requestId`. A transação deve verificar que a versão rejeitada pertence àquela request e que a request ainda corresponde à submissão rejeitada, por exemplo por `lastSubmissionId`/versão esperada. Sem isso, a rejeição tardia de uma versão antiga pode reabrir incorretamente uma request já concluída ou com upload mais novo. Também faltam regras para estados `CANCELLED`, `REVOKED`, `EXPIRED` e `COMPLETED`.

10. **`lastRejectionReason` perde informação e mistura agregados.** A razão já pertence ao `DocumentVersion`; duplicá-la como último valor mutável na request exige definir consistência e utilidade. Se necessária para apresentação, deve incluir ao menos `rejectedVersionId`/timestamp e ser atualizada sob condição. `rejectionCount` também precisa de incremento atômico e semântica clara: conta rejeições de versões, reaberturas ou tentativas?

11. **O chasing não está pronto para implementação.** “T+3 como placeholder” é uma decisão de produto efetiva, apesar do rótulo de pendência. Ela muda comportamento externo e pode gerar mensagens reais. O mecanismo pode ser preparado desabilitado, mas não deve enviar automaticamente com um valor arbitrário. Além disso, a alegação de usar GSI1 precisa ser provada contra as chaves reais: o `DocumentRequest` mostrado não possui chaves GSI para consultar requests `REQUESTED/OPENED` por vencimento. O GSI mencionado parece pertencer à série, não à request individual.

12. **Reutilizar `SQS_DOCUMENT_CHASING_DISPATCH_V1` pode ser falsa equivalência.** O módulo `subject` possui entidade homônima e contrato próprio. “Mesmo conceito humano” não prova compatibilidade de payload, destinatário, templates, IAM ou consumidor. Se o consumidor atual espera o modelo antigo, enviar `DocumentRequestChaseDue` do document-archive ao mesmo destino pode resultar em falha ou, pior, interpretação incorreta. É preciso demonstrar contrato discriminado e suporte explícito; caso contrário, usar destino próprio.

Para alcançar 9,0, a próxima rodada deve apresentar uma máquina de estados da emissão/reemissão/revogação, contrato versionado mínimo do evento, idempotência transacional do consumidor, solução durável para o token bruto até a entrega, regra normativa de TTL e condições OCC exatas para rejeição. A escolha arquitetural principal é boa; o protocolo operacional e de segurança necessário para torná-la correta ainda não está desenhado.
