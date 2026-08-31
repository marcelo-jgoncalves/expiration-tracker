# Round 1 — Auto-avaliação às cegas (Claude)

Escrita ANTES de invocar o Codex (`AGENTS.md` §4 — nota cega).

## Contra o checklist de trade-off da própria proposta

1. **Nunca perder rastreabilidade (30%)** — atende: bloqueio explícito, nenhum item fica órfão
   silenciosamente. ✅
2. **Nenhum access pattern não governado (25%)** — atende: reaproveita GSI1 já `ALL`-projetado, já
   em produção para o dashboard, zero GSI novo, zero decisão D-026 nova. ✅
3. **Fronteira de módulo respeitada (20%)** — atende: porta nova estreita
   (`SoleResponsibilityChecker`) no módulo consumidor, implementação só no composition root, mesmo
   padrão já `APPROVED` de `MemberEligibilityChecker` (B2B-11). ✅
4. **UX não trava indecifrável (15%)** — atende: erro novo lista os `itemId`s afetados
   explicitamente. ✅
5. **Watchers coerente com precedente (10%)** — atende: deixado fora de escopo, com justificativa
   (falta de access pattern + precedente B2B-11 já aceito). ✅

## Pontos fracos que eu mesmo vejo, antes do Codex apontar

- **Atomicidade não resolvida de verdade**: o check (`findSoleResponsibilityItems`) roda ANTES da
  transação de remoção, não dentro dela — existe uma janela real de TOCTOU (Time-of-check to
  time-of-use): entre o check retornar vazio e a transação de remoção de fato commitar, alguém
  poderia reatribuir um item PARA o usuário sendo removido, criando exatamente o estado que o
  bloqueio deveria prevenir. Não proponho solução ainda - preciso decidir se isso é aceitável (janela
  pequena, mesma classe de "best-effort" que outras partes do sistema já toleram) ou se precisa de
  um mecanismo mais forte.
- **Não defini a mensagem/contrato de erro completo** — `ResponsibilityReassignmentRequiredError`
  precisa de um shape de `details` real (lista de itemIds só, ou também nomes/dueDate para o
  frontend renderizar algo útil sem uma segunda chamada?) - deixei implícito.
- **Não considerei se o mesmo problema existe para `RequirementAssignment`** (módulo subject, outra
  entidade com um conceito parecido de responsável, mencionada de relance no achado de B2B-11 mas
  nunca lida a fundo por mim nesta rodada) - posso estar deixando um segundo caso real de fora do
  escopo sem perceber.
- **Escala real do "quantos itens uma pessoa pode ter"**: não verifiquei `capacity-model.md` para
  saber se `findSoleResponsibilityItems` (uma Query com FilterExpression sobre potencialmente todos
  os itens ACTIVE do tenant) é realmente barata em qualquer tenant real, ou se um tenant grande já
  torna isso um scan disfarçado de query cara. Assumi que sim com base no comentário "distribuição de
  cauda longa" do capacity model, mas não fiz a conta.

## Nota (às cegas, antes do Codex)

**Claude: 7.8/10** — o mecanismo central (reaproveitar GSI1, porta estreita, erro nomeado) está
certo e bem fundamentado, mas a janela de TOCTOU não resolvida e a lacuna de `RequirementAssignment`
são bloqueantes reais que eu mesmo identifiquei, não apenas lacunas de polimento.
