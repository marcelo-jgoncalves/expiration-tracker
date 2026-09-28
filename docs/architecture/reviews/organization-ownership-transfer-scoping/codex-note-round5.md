---
status: final (parecer Codex, rodada 5)
owner: Marcelo
authority: evidência de revisão do protocolo Claude↔Codex; não substitui especificação normativa
---

# Transferência de titularidade — parecer Codex, Rodada 5

Data: 2026-09-28. Avaliação independente, sem acesso a nota do Claude da Rodada 5.
Base: propostas R1–R4 com as substituições explícitas da [Rodada 5](claude-proposal-round5.md),
e [concordância do Claude com os achados da R4](claude-note-round4.md).

**Desenho: 9,2/10. Régua: 9,3/10. Nota geral: 9,2/10** (juízo global conservador,
não média que compensa eixo abaixo do gate).

**Aprovo explicitamente, pelo lado Codex, o fechamento do protocolo de desenho.**
As três pendências da Rodada 4 estão resolvidas; não solicito Rodada 6.
O mínimo de rodadas está cumprido. A declaração de convergência bilateral exige que a nota
independente do Claude nesta rodada também alcance 9,0 nos dois objetos. Não atribuo ao Claude
uma nota que não recebi. Esta aprovação não certifica implementação ou deploy.

## Verificações

1. **Auditoria — fechado.** A correção limita a afirmação aos três serviços verificados.
   `ChangeMembershipRoleService` acrescenta auditoria em `change-membership-role.ts:63` antes
   da transação em `:82`; `RemoveMembershipService`, em `remove-membership.ts:108/127`;
   `LeaveOrganizationService`, em `leave-organization.ts:91/110`. Em todos, o evento integra
   o mesmo array transacional da mutação. `CreateOrganizationService.buildCreateEntries()`
   cria a Membership OWNER inicial sem evento de auditoria. R5 reconhece essa exceção e mantém
   sua correção fora do escopo. Não resta promessa de universalidade.

2. **Classificador — fechado.** A [referência oficial de TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
   confirma os nomes de `CancellationReasons[].Code`. `PERMANENT` contém `ValidationError`
   e `ItemCollectionSizeLimitExceeded`; `TRANSIENT` contém `TransactionConflict`,
   `ThrottlingError` e `ProvisionedThroughputExceeded`. São códigos de razão, não nomes de
   exceção do SDK. A ordem é: ausência/nenhuma razão útil → permanente → desconhecida →
   condições por índice → transitória → fallback. Assim, razão desconhecida não pode ser
   escondida por uma condição no índice 0. A categoria permanente representa falha sem retry
   automático útil desta operação, não impossibilidade de remediação operacional futura.

   Extraí o bloco TypeScript da proposta, removi somente as anotações de tipo e executei suas
   funções em Node, injetando a extração das razões. Os cinco resultados conferem:

   | Razões, na ordem das quatro entradas | Resultado executado |
   |---|---|
   | `None, None, ConditionalCheckFailed, ValidationError` | `InternalError` |
   | `TransactionConflict, None, ValidationError, None` | `InternalError` |
   | `ProvisionedThroughputExceeded, None, None, None` | `DependencyUnavailableError` |
   | `ThrottlingError, None, None, None` | `DependencyUnavailableError` |
   | `ConditionalCheckFailed, Unknown, None, None` | `InternalError` |

   Essa execução valida o algoritmo proposto, não a integração futura com o SDK/DynamoDB.
   O texto introdutório diz “4 casos”, mas a tabela tem cinco: lapso editorial sem efeito técnico.

3. **F.2 — fechado.** Cada leitura forte informa somente a Membership observada no instante
   daquela leitura. O contrato exclui tanto simultaneidade quanto causalidade da tentativa
   incerta. O contraexemplo da R4 continua possível, mas já não contradiz a garantia oferecida.
   “Estado atual” deve ser lido sob essa delimitação explícita, não como validade contínua após
   a leitura. A [documentação de isolamento do DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
   distingue leituras individuais de uma leitura transacional conjunta. `TransactGetItems`
   daria a fotografia conjunta, mas não provaria a autoria histórica da tentativa; dispensá-lo
   é proporcional ao objetivo informativo adotado. Permanecem as versões originais no retry
   e o resultado inconclusivo quando a reconciliação não puder ser realizada.

## Notas por eixo aplicável ao desenho

Aplicação proporcional dos [critérios do projeto](../../../engineering/joint-review-criteria.md):
as notas avaliam o contrato proposto, não maturidade operacional de código ainda não entregue.

| Eixo | Nota | Fundamentação |
|---|---:|---|
| Arquitetura | 9,3 | Atomicidade de quatro entradas, delta zero de owners e garantias de leitura delimitadas. |
| Qualidade de engenharia | 9,2 | Classificação defensiva correta e cinco regressões reproduzidas; integração fica para implementação. |
| Engenharia de contexto | 9,2 | Evidência restrita ao código verificado, precedência das emendas explícita; pequeno lapso “4/5”. |
| Segurança/AppSec | 9,1 | OWNER específico, OCC e auditoria preservados; step-up continua adiado com responsável e gatilho. |
| Operações/SRE | 9,2 | Falha permanente/desconhecida separada de transitória e resultado incerto tratado honestamente. |
| Produto/multi-tenant | 9,2 | Sucessor elegível na mesma organização; transferência de papel não promete billing ou reatribuição por terceiro. |

Privacidade, governança de IA e jurídico/terceiros: N/A para mudanças desta rodada; não introduz
PII/retenção, delegação/dispensa do protocolo ou dependência contratual nova. FinOps não pontuado.

**Régua 9,3:** pesos preservados em 100%; origem externa, interpretação e decisão interna
distinguíveis, incluindo a correção da auditoria. Sem novo bloqueador de calibração.
O adiamento já aceito de step-up continua sendo dívida explícita, não controle implementado.

DoD: item=parecer Codex R5; risco=5 (contrato de transferência/autorização sob revisão); evidência=leitura dos quatro serviços, documentação oficial AWS, execução 5/5 casos do pseudocódigo, rubrica e task-checklist aplicadas; lacunas=nota independente do Claude R5 necessária para declarar convergência bilateral; implementação e seus gates fora desta entrega.

Validação documental global pendente por ambiente: `npm run check-docs` não iniciou o checker
(`tsx`: `uv_os_get_passwd ENOMEM`). Execução alternativa do mesmo script com
`node --experimental-strip-types scripts/check-doc-drift.ts` parou em `EPERM` ao ler
`docs/architecture/history/architecture-fase3/claude-architecture-proposal.md`.
Não se declara gate documental verde nem marco/implementação concluído a partir deste parecer.
