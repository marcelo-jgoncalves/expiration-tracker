# docs/frontend/ — Índice do Planejamento de Interface

```text
Sequência:       Context/Task Model → Conceptual Model + IA → Critical User Journeys → Screen + State Inventory → Low-Fidelity Wireframes → Interaction Prototype → Heuristic + Accessibility Evaluation → Validation Readiness + Product Focus Hardening → User Validation (próxima, não iniciada)
Status vigente:  8 de 9 etapas APPROVED; protótipo com Participant Mode/Evaluator Mode separados, CREATE-IDEMPOTENCY-01 resolvido no backend real, nenhuma identidade visual/frontend de produção ainda
Last verified:   2026-08-24
```

Ver `docs/architecture/README.md` para o mapa de arquitetura de sistema (este índice cobre só o
planejamento de interface). Precedência de fontes idêntica à de `docs/architecture/README.md`:
`AGENTS.md` > decisão reconciliada > documento temático corrente > `NEXT_SESSION_PROMPT.md`
(estado, nunca normativo).

## Full BFF + Frontend de Produção (implementação real, distinto do planejamento de interface abaixo)

`docs/frontend/frontend-production-foundation.md` — Full BFF (D-053/D-054) implementado de ponta a ponta (`src/modules/bff/`, infra Terraform) e uma fundação de frontend de produção real (`frontend/`, projeto npm separado — Vite+React+TS+React Router v7+TanStack Query v5). `APPROVED AS FRONTEND PRODUCTION FOUNDATION` via protocolo Claude↔Codex (Rodada D levou 6 passagens até convergir — 5 achados bloqueantes reais de segurança de sessão encontrados e corrigidos, todos na família "leitura de Session/LoginAttempt tratada como autoridade sem checar todas as propriedades de validade"). Não confundir com os 8 documentos de planejamento de interface abaixo (que cobrem UX/IA/journeys, nunca código de produção).

## Índice por documento

| Documento | Status | Do que trata |
|---|---|---|
| `interface-context-and-critical-tasks.md` | `APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE` | Papéis funcionais (`Internal Operator`, `External Submitter`), Jobs to Be Done, inventário completo de tarefas, classificação de criticidade (T0-T3) × frequência × `Implementation Readiness` (READY/PARTIAL/BLOCKED/FUTURE) — eixos deliberadamente separados após amendment metodológico. Descobriu os 3 blockers técnicos de backend (ver abaixo). |
| `interface-conceptual-model-and-information-architecture.md` | `APPROVED AS INPUT FOR CRITICAL USER JOURNEYS` | Modelo conceitual de usuário (Vencimento/Documento/Fornecedor/Requisito/Solicitação/Alerta), Information Architecture recomendada (**dual-anchor**: Vencimentos + Fornecedor/Subject como dois anchors mentais coexistentes, sem hierarquia única — `ExpirationItem` não tem `subjectId`). Amendment semântico corrigiu `Document.CLEAN`="Aprovado" e `RequirementAssignment.SATISFIED`="Em dia" (nenhum dos dois é verdade — verificado em código) e formalizou `GTR-01`. |
| `interface-critical-user-journeys.md` | `APPROVED AS INPUT FOR SCREEN + STATE INVENTORY` | 8 journeys (J-01 a J-08) mapeadas outcome-a-outcome, com fluxo passo-a-passo classificado por `System Knowledge` (KNOWN/INFERRED/PENDING/CONFIRMED/FAILED/UNKNOWN), failure/recovery paths, matrizes de dependência de backend. Achou que `POST /items` não tem idempotência (`CREATE-IDEMPOTENCY-01`) e que o guest flow comprime "enviado" com "verificado". |
| `interface-screen-and-state-inventory.md` | `APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES` | 17 Interaction Surfaces (`SURF-001` a `SURF-017`) derivadas das 8 journeys, com taxonomia de estado compartilhada (loading/empty/error/persistence/visibility), Epistemic Integrity Matrix, e as 3 matrizes Surface↔Journey/Concept/Transition. Achado real da revisão: `Document.SCANNING` estava classificado `PERSISTED` incorretamente como `REMOTE_ASYNC`/`USER_KNOWN` — corrigido para `NOT_CURRENTLY_OBSERVABLE` (o mesmo gap de leitura de `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN`). |
| `interface-low-fidelity-wireframes.md` | `APPROVED AS INPUT FOR INTERACTION PROTOTYPE` | Wireframe ASCII de baixa fidelidade das 17 `SURF-xxx`, agrupadas em 3 lotes (âncora Vencimento → âncora Fornecedor → isoladas/utility), com hierarquia primary/secondary/contextual, convenções estruturais fixas (`[PRIMARY]`/`⚠[DANGEROUS]`/`[BLOQUEADO: BLOCKER-X]`), 8 journey walkthroughs e State Coverage Matrix. Achados reais da revisão: affordance de ação primária ausente em 4 coleções, `BLOCKER-A` mascarado no estado inicial de Document Context (afirmava "nenhum documento" quando a interface não pode saber isso), `SATISFIED` reaproximado de "compliance atual" numa das variantes de branch de `BLOCKER-C`, e um canal (WhatsApp) sem lastro — todos corrigidos. |
| `interface-interaction-prototype.md` + `prototype/` | `APPROVED AS INPUT FOR HEURISTIC + ACCESSIBILITY EVALUATION AND USER VALIDATION` | Protótipo interativo real (HTML/CSS/JS sem dependências, `prototype/app.js`), 17 rotas 1:1 com `SURF-001`–`SURF-017`, 34 Prototype Scenario IDs determinísticos cobrindo J-01–J-08 (happy path + alternates + falha + recovery + re-entry), verificado com testes automatizados de navegador headless. Achados reais da revisão: compressão de estados no guest upload (faltava validação de arquivo e o estado "reserva aceita" distinto de "enviado"), uma simulação de coleta externa anunciando ao operador uma verificação de segurança que `BLOCKER-A`/`BLOCKER-C` tornam `NOT_CURRENTLY_OBSERVABLE`, dois campos de formulário sem `<label>`, e uma reincidência de menção a WhatsApp — todos corrigidos e reverificados funcionalmente. |
| `interface-heuristic-accessibility-evaluation.md` | `APPROVED AS INPUT FOR USER VALIDATION` | Avaliação do protótipo **executável** (Nielsen H1-H10, WCAG 2.2 AA, teclado/foco/semântica/forms real em navegador headless, `axe-core`, re-execução de J-01–J-08, Epistemic Integrity, `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`). Protocolo completo de 4 rodadas Claude↔Codex: Rodada A (autoavaliação, 9 achados corrigidos) concluiu aprovação prematuramente — Rodada B (adversarial) achou 6 problemas-raiz reais não vistos, o mais grave sendo a própria guarda anti-duplo-submit da Rodada A quebrando recovery de validação (S3) e `reconcileImport()` afirmando ter criado registros sem materializá-los (violação epistêmica real); Rodada C corrigiu os 6, mas errou ao manter jargão técnico ("SIMULATED...BACKEND") numa superfície pública de guest; Rodada D (nova adversarial) achou essa lacuna e uma correção incompleta em `submitAlert` (travava após sucesso, não só após erro) — ambos corrigidos e reverificados no fechamento. Quality Score final **9.04/10**, calculado após esse histórico, não apenas sobre o estado final do código. |
| `interface-validation-readiness.md` | `APPROVED FOR USER VALIDATION PLANNING` | Hardening final antes de User Validation, 8 workstreams: Participant Mode (default, sem anotações técnicas) vs. Evaluator Mode (`?mode=evaluator`, preserva tudo); `GTR-01` simulado no guest flow (identidade do solicitante), documentado como simulação, não backend-resolvido; cenário de densidade `PROTO-STRESS-DENSITY-01` (155 vencimentos/38 fornecedores/95 requisitos) que achou e corrigiu uma falta real de ordenação por urgência; `CREATE-IDEMPOTENCY-01` **resolvido no backend real** (`createItem` ganhou `idempotencyKey` opcional, mesmo padrão de `renewItem`); tese de produto (compliance documental leve de terceiros) e métricas de validação formalizadas; `interface-quality-standard.md` criado (12 eixos já em uso desde a 1ª etapa, agora formal); matriz de gates User Validation/Pilot/Paid Pilot/Public Production. Protocolo de 4 rodadas + 1 fechamento: Rodada B achou 4 furos reais (2 vazamentos de anotação técnica, teste de idempotência incompleto, 2 imprecisões de documentação); Rodada D, após reconciliação, achou **mais 6 vazamentos** numa releitura exaustiva (nenhum introduzido pela Rodada C) — todos corrigidos no fechamento, zero contaminação residual confirmada. |

## Blockers técnicos de backend (citados por ID em todo o planejamento, nenhum resolvido)

| ID | O que é | Onde bloqueia |
|---|---|---|
| `BLOCKER-A` | Nenhuma rota lê/lista `Document`/`DocumentSubmission` — só upload/delete existem | Outcome "manter evidência documental" (J-04); indireto em renovação (J-03) |
| `BLOCKER-B` | Materialização de `ReminderOccurrence` parece desconectada do caminho normal de criação/edição de item | Outcome "ser avisado antes do vencimento" (J-05) |
| `BLOCKER-C` | Ciclo de coleta externa (guest upload) não fecha sozinho — sem transição automática nem visibilidade da submissão | Outcome "obter documentação de terceiros" (J-06); branch point não decidido (automático vs. revisão humana) |
| `GTR-01` | Guest flow não expõe identidade do solicitante ao fornecedor externo — risco de Trust/phishing | J-07 (guest submission), UX trust readiness `NOT READY` no backend real. **Simulado** no Participant Mode do protótipo desde `interface-validation-readiness.md` (identidade fixa "Empresa Alfa Ltda."), nunca implementado — ver matriz de gates nesse documento §20. |

Achados menores registrados, não elevados a blocker nomeado: guest flow sem rota pública de
confirmação pós-envio (`interface-critical-user-journeys.md` §14); query tenant-wide de
solicitações pendentes inexistente (`interface-screen-and-state-inventory.md` §41, bloqueia
`SURF-013`). `CREATE-IDEMPOTENCY-01` (`POST /items` sem proteção de idempotência,
`interface-critical-user-journeys.md` §9) **resolvido no backend real** em
`interface-validation-readiness.md` §14 (`createItem` ganhou `idempotencyKey` opcional, mesmo
padrão de `IdempotencyStore` já usado por `renewItem`) — classificado formalmente como
`PRODUCTION GATE`; ver matriz de gates para o status por estágio (ainda `REQUIRED` para Pilot,
pois nenhum frontend/BFF real envia o header ainda).

## Padrão de qualidade formalizado

`docs/frontend/interface-quality-standard.md` — criado em `interface-validation-readiness.md`
(Workstream G), consolidando os 12 eixos, modelo de severidade, quality gates e threshold
(`Overall ≥ 9.0`) que já eram usados desde a primeira etapa, sem introduzir critério novo.
`expiration-tracker-bff-frontend-quality-standard.md` (raiz do repo) continua sendo um documento
distinto e mais amplo (BFF, performance, testes de frontend de produção real), ainda não adotado —
se/quando adotado, precisaria da mesma convergência Claude↔Codex que os 9 eixos de
`docs/engineering/joint-review-criteria.md` já usaram.

## Próxima etapa

**User Validation** — ainda não iniciada (o roteiro formal de entrevista fica para `User Validation
Planning`, não produzido em `interface-validation-readiness.md` §23 por decisão explícita de
escopo). Recebe como input o protótipo já com Participant Mode isolado (`prototype/`, ver
`prototype/README.md` para como rodar — Participant Mode é o default, `?mode=evaluator` ativa o
modo de engenharia) e `interface-validation-readiness.md` §15-18/§23-24 (tese de produto, métricas
de validação, tarefas candidatas, limitações conhecidas a comunicar ao facilitador) — sem
redescobrir estrutura, estados, semântica, achados de acessibilidade, ou os gates de produto/
engenharia já fechados. Não obriga o início imediato de Visual Design/Design System.
