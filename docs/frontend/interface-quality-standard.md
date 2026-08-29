---
status: APPROVED (formalização — não introduz critério novo)
owner: Marcelo
authority: padrão de qualidade normativo para todo o planejamento de interface em `docs/frontend/`
---

# Expiration Tracker — Interface Engineering Quality Standard

Este documento formaliza o padrão de qualidade que **já vinha sendo aplicado, de forma
consistente, desde a primeira etapa** do planejamento de interface (`interface-context-and-
critical-tasks.md`) até a mais recente concluída (`interface-heuristic-accessibility-evaluation.md`).
Ele não introduz nenhum critério, eixo, peso, ou threshold novo — apenas nomeia e centraliza o que
os documentos anteriores já citavam como "eixos do prompt-fonte" sem um arquivo formal para
apontar. Produzido como Workstream G da etapa **Validation Readiness + Product Focus Hardening**
(`interface-validation-readiness.md`), por instrução explícita de não reabrir nem reavaliar
nenhuma etapa já `APPROVED` — isto é catalogação, não nova revisão.

Este documento é distinto de `bff-frontend-quality-standard-proposal.md` (mesma pasta,
movido da raiz em 2026-08-29), que cobre um escopo mais amplo e ainda não adotado (BFF, performance, estratégia de testes
do frontend de produção real) — não decidido se/quando esse candidato mais amplo será convergido
via protocolo Claude↔Codex. Este documento aqui cobre especificamente a qualidade do
**planejamento de interface** (os artefatos em `docs/frontend/`), não a implementação real.

## 1. Escopo

Aplica-se a toda etapa de planejamento de interface deste projeto: Context/Task Model, Conceptual
Model + IA, Critical User Journeys, Screen + State Inventory, Low-Fidelity Wireframes, Interaction
Prototype, Heuristic + Accessibility Evaluation, e as etapas futuras (User Validation, Visual
Language/Design System, High-Fidelity UI, Frontend Implementation) na medida em que cada eixo se
torna avaliável na fidelidade daquela etapa.

## 2. Os 12 eixos

Nomenclatura canonizada (pequenas variações de nome entre etapas anteriores — ex.
"ErrorRobustness" na Conceptual Model vs. "Error Prevention / Recovery" na Heuristic Evaluation —
são o mesmo eixo; este documento fixa o nome final usado a partir de agora):

1. **Task Suitability** — a interface serve as tarefas reais identificadas (JTBD/outcomes), não
   tarefas hipotéticas.
2. **Information Architecture** — estrutura de navegação/agrupamento coerente com o modelo mental
   do usuário (aqui: dual-anchor Vencimentos + Fornecedor/Subject).
3. **Information Presentation** — hierarquia primária/secundária/contextual clara; informação
   urgente não compete com informação de apoio.
4. **System Feedback** — todo estado assíncrono (pending/success/failed/unknown) é distinto,
   perceptível e anunciado — nunca só `aria-live` sem mudança visível para usuário vidente.
5. **Error Prevention / Recovery** — erros são preveníveis quando possível e sempre recuperáveis;
   uma guarda de segurança (ex. anti-duplo-submit) nunca pode deixar o usuário sem caminho de
   correção.
6. **Forms** — labels reais (nunca placeholder-como-label), validação clara, dados preservados em
   erro, associação programática de erro ao campo.
7. **Data Operations** — CRUD, filtro, ordenação e concorrência (OCC) modelados corretamente; UI
   nunca afirma um fato sobre o estado dos dados que não é verdade no próprio modelo de dados.
8. **Accessibility** — WCAG 2.2 nível AA como alvo (ver §7); semântica HTML real preferida a ARIA.
9. **Consistency** — a mesma convenção aplicada identicamente em todas as superfícies equivalentes,
   verificado por inspeção cruzada, não por amostragem.
10. **Content** — vocabulário sem jargão técnico vazando para o usuário, sem overclaiming
    (ver Epistemic Integrity, §6).
11. **Responsiveness** — viabilidade estrutural em mobile/narrow viewport e reflow, não
    performance de rede.
12. **Trust / Risk** — nenhum blocker mascarado, anti-enumeração preservado, ações de alta
    consequência com confirmação deliberada, identidade de solicitante/remetente nunca omitida
    sem aviso.

## 3. Aplicabilidade por fidelidade (N/A é uma resposta válida)

Nem todo eixo é avaliável em toda etapa. Um eixo é `N/A` quando a etapa não opera no nível de
fidelidade necessário para julgá-lo — não é uma nota baixa, é ausência de evidência aplicável.
Precedente: `interface-conceptual-model-and-information-architecture.md` §43 marcou
`InformationPresentation`/`SystemFeedback`/`Forms`/`DataOperations`/`Accessibility`/
`Responsiveness` como `N/A` (dependem de layout/wireframe/componente, fases futuras à época) e
`TaskSuitability`/`InformationArchitecture`/`Content`/`Trust` como avaliáveis desde o modelo
conceitual. Nunca forçar uma nota num eixo inaplicável só para preencher a tabela.

## 4. Modelo de severidade

Escala S0 (Cosmético) a S4 (Crítico), fixada em
`interface-heuristic-accessibility-evaluation.md` §6 e reutilizada aqui sem alteração. Dimensões
de severidade: frequência, impacto, persistência, recuperabilidade, criticidade da journey afetada,
risco de confiança (trust), impacto de acessibilidade, consequência sobre dado/domínio.

## 5. Quality Gates

Gates fixados em `interface-heuristic-accessibility-evaluation.md` §7 e reutilizados sem alteração
(Accessibility Gate, Error Safety Gate, e os demais definidos ali). Um gate `FAIL` bloqueia
aprovação independentemente da nota geral.

## 6. Epistemic Integrity

Princípio fixado em `interface-conceptual-model-and-information-architecture.md` §44, o mais
antigo e mais repetidamente citado deste projeto:

> **A interface nunca deve apresentar um estado com grau de certeza maior do que aquele suportado
> pelo domínio.**

Aplica-se a todo eixo, mas com peso mais direto em Content, Data Operations e Trust/Risk. Exemplos
já verificados em código: `Document.CLEAN` ≠ "aprovado"; `RequirementAssignment.SATISFIED` ≠ "em
dia"; um "resultado incerto" (`UNKNOWN_OUTCOME`) nunca é tratado como `FAILED`.

## 7. Alvo de acessibilidade

WCAG 2.2 nível AA, fixado em `interface-heuristic-accessibility-evaluation.md` §5. `axe-core` (ou
equivalente) é auxiliar, nunca suficiente sozinho — "axe passa" não é o mesmo que "é acessível";
raciocínio manual sobre teclado, foco, semântica e forms é obrigatório sempre que a fidelidade
permitir testar em navegador real.

## 8. Expectativa de evidência

Nenhum achado (finding) é aceito sem evidência concreta: leitura de código real (não só do
documento da etapa anterior), e — a partir da fidelidade de Interaction Prototype em diante —
execução em navegador (headless ou real), nunca inferência por nome de função/rota. Nenhuma falha
especulativa: quando um critério não pode ser determinado na fidelidade atual, o rótulo correto é
`NOT ASSESSABLE AT CURRENT FIDELITY`, nunca uma falha inventada nem uma aprovação presumida.

## 9. Threshold de aprovação

```
Overall ≥ 9.0
Nenhum gate de qualidade em FAIL
Nenhum S4
Nenhum S3 não resolvido afetando fluxo crítico
```

Este threshold não é um número novo escolhido para o planejamento de interface — é o mesmo piso
mínimo de nota (`AGENTS.md` §4, "nota mínima 9.0 de ambos... sem arredondar") já aplicado a toda
decisão Type 1 do protocolo Claude↔Codex neste projeto desde antes de existir planejamento de
interface. Confirmado por uso consistente em todas as 7 etapas concluídas, não uma escolha isolada
desta formalização. **Não manipular a nota para atingir o threshold**: se a nota real calculada for
inferior a 9.0, o status correto é `NOT APPROVED`/`CHANGES REQUESTED`, mesmo que a diferença seja
pequena (precedente: `interface-heuristic-accessibility-evaluation.md` §45, nota final 9.04,
calculada e exibida sem arredondamento).

## 10. Manutenção deste padrão

Alterar este documento (adicionar eixo, mudar peso, mudar threshold) é, por definição, uma decisão
de Type 1 (`AGENTS.md` §4/`docs/engineering/change-risk-scale.md`) — exige o protocolo
Claude↔Codex completo, não uma edição direta. A formalização inicial deste arquivo (Validation
Readiness, Workstream G) é uma exceção deliberada: não é uma mudança de critério, é a primeira vez
que o critério já-em-uso ganha um arquivo formal para apontar.
