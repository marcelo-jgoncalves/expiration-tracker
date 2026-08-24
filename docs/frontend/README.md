# docs/frontend/ — Índice do Planejamento de Interface

```text
Sequência:       Context/Task Model → Conceptual Model + IA → Critical User Journeys → Screen + State Inventory (próxima, não iniciada)
Status vigente:  3 de 4 etapas APPROVED; nenhum wireframe/componente/layout produzido ainda
Last verified:   2026-08-23
```

Ver `docs/architecture/README.md` para o mapa de arquitetura de sistema (este índice cobre só o
planejamento de interface). Precedência de fontes idêntica à de `docs/architecture/README.md`:
`AGENTS.md` > decisão reconciliada > documento temático corrente > `NEXT_SESSION_PROMPT.md`
(estado, nunca normativo).

## Índice por documento

| Documento | Status | Do que trata |
|---|---|---|
| `interface-context-and-critical-tasks.md` | `APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE` | Papéis funcionais (`Internal Operator`, `External Submitter`), Jobs to Be Done, inventário completo de tarefas, classificação de criticidade (T0-T3) × frequência × `Implementation Readiness` (READY/PARTIAL/BLOCKED/FUTURE) — eixos deliberadamente separados após amendment metodológico. Descobriu os 3 blockers técnicos de backend (ver abaixo). |
| `interface-conceptual-model-and-information-architecture.md` | `APPROVED AS INPUT FOR CRITICAL USER JOURNEYS` | Modelo conceitual de usuário (Vencimento/Documento/Fornecedor/Requisito/Solicitação/Alerta), Information Architecture recomendada (**dual-anchor**: Vencimentos + Fornecedor/Subject como dois anchors mentais coexistentes, sem hierarquia única — `ExpirationItem` não tem `subjectId`). Amendment semântico corrigiu `Document.CLEAN`="Aprovado" e `RequirementAssignment.SATISFIED`="Em dia" (nenhum dos dois é verdade — verificado em código) e formalizou `GTR-01`. |
| `interface-critical-user-journeys.md` | `APPROVED AS INPUT FOR SCREEN + STATE INVENTORY` | 8 journeys (J-01 a J-08) mapeadas outcome-a-outcome, com fluxo passo-a-passo classificado por `System Knowledge` (KNOWN/INFERRED/PENDING/CONFIRMED/FAILED/UNKNOWN), failure/recovery paths, matrizes de dependência de backend. Achou que `POST /items` não tem idempotência e que o guest flow comprime "enviado" com "verificado". |

## Blockers técnicos de backend (citados por ID em todo o planejamento, nenhum resolvido)

| ID | O que é | Onde bloqueia |
|---|---|---|
| `BLOCKER-A` | Nenhuma rota lê/lista `Document`/`DocumentSubmission` — só upload/delete existem | Outcome "manter evidência documental" (J-04); indireto em renovação (J-03) |
| `BLOCKER-B` | Materialização de `ReminderOccurrence` parece desconectada do caminho normal de criação/edição de item | Outcome "ser avisado antes do vencimento" (J-05) |
| `BLOCKER-C` | Ciclo de coleta externa (guest upload) não fecha sozinho — sem transição automática nem visibilidade da submissão | Outcome "obter documentação de terceiros" (J-06); branch point não decidido (automático vs. revisão humana) |
| `GTR-01` | Guest flow não expõe identidade do solicitante ao fornecedor externo — risco de Trust/phishing | J-07 (guest submission), UX trust readiness `NOT READY` |

Achados menores registrados, não elevados a blocker nomeado: `POST /items` sem proteção de
idempotência (`interface-critical-user-journeys.md` §9); guest flow sem rota pública de
confirmação pós-envio (`interface-critical-user-journeys.md` §14).

## Pendência de formalização

`interface-quality-standard.md` (citado pelos 3 documentos acima) **não existe ainda como
arquivo formal** — os documentos usam os nomes de eixo (`TaskSuitability`,
`InformationArchitecture`, etc.) diretamente do prompt-fonte de cada etapa.
`expiration-tracker-bff-frontend-quality-standard.md` (raiz do repo) contém uma rubrica candidata
(§13-30) que, se adotada como padrão oficial, deveria passar pela mesma convergência independente
Claude↔Codex que os 9 eixos de `docs/engineering/joint-review-criteria.md` já usaram — não
decidido.

## Próxima etapa

**Screen + State Inventory** — ainda não iniciada. Transforma as 8 journeys aprovadas em
superfícies de interação, estados, transições e condições (loading/erro/vazio/permissão)
necessárias, ainda antes de wireframe/design visual.
