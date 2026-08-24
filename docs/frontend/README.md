# docs/frontend/ — Índice do Planejamento de Interface

```text
Sequência:       Context/Task Model → Conceptual Model + IA → Critical User Journeys → Screen + State Inventory → Low-Fidelity Wireframes → Interaction Prototype → Heuristic + Accessibility Evaluation → User Validation (próxima, não iniciada)
Status vigente:  7 de 8 etapas APPROVED; protótipo interativo navegável real corrigido e reverificado (prototype/), nenhuma identidade visual/frontend de produção ainda
Last verified:   2026-08-24
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
| `interface-critical-user-journeys.md` | `APPROVED AS INPUT FOR SCREEN + STATE INVENTORY` | 8 journeys (J-01 a J-08) mapeadas outcome-a-outcome, com fluxo passo-a-passo classificado por `System Knowledge` (KNOWN/INFERRED/PENDING/CONFIRMED/FAILED/UNKNOWN), failure/recovery paths, matrizes de dependência de backend. Achou que `POST /items` não tem idempotência (`CREATE-IDEMPOTENCY-01`) e que o guest flow comprime "enviado" com "verificado". |
| `interface-screen-and-state-inventory.md` | `APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES` | 17 Interaction Surfaces (`SURF-001` a `SURF-017`) derivadas das 8 journeys, com taxonomia de estado compartilhada (loading/empty/error/persistence/visibility), Epistemic Integrity Matrix, e as 3 matrizes Surface↔Journey/Concept/Transition. Achado real da revisão: `Document.SCANNING` estava classificado `PERSISTED` incorretamente como `REMOTE_ASYNC`/`USER_KNOWN` — corrigido para `NOT_CURRENTLY_OBSERVABLE` (o mesmo gap de leitura de `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN`). |
| `interface-low-fidelity-wireframes.md` | `APPROVED AS INPUT FOR INTERACTION PROTOTYPE` | Wireframe ASCII de baixa fidelidade das 17 `SURF-xxx`, agrupadas em 3 lotes (âncora Vencimento → âncora Fornecedor → isoladas/utility), com hierarquia primary/secondary/contextual, convenções estruturais fixas (`[PRIMARY]`/`⚠[DANGEROUS]`/`[BLOQUEADO: BLOCKER-X]`), 8 journey walkthroughs e State Coverage Matrix. Achados reais da revisão: affordance de ação primária ausente em 4 coleções, `BLOCKER-A` mascarado no estado inicial de Document Context (afirmava "nenhum documento" quando a interface não pode saber isso), `SATISFIED` reaproximado de "compliance atual" numa das variantes de branch de `BLOCKER-C`, e um canal (WhatsApp) sem lastro — todos corrigidos. |
| `interface-interaction-prototype.md` + `prototype/` | `APPROVED AS INPUT FOR HEURISTIC + ACCESSIBILITY EVALUATION AND USER VALIDATION` | Protótipo interativo real (HTML/CSS/JS sem dependências, `prototype/app.js`), 17 rotas 1:1 com `SURF-001`–`SURF-017`, 34 Prototype Scenario IDs determinísticos cobrindo J-01–J-08 (happy path + alternates + falha + recovery + re-entry), verificado com testes automatizados de navegador headless. Achados reais da revisão: compressão de estados no guest upload (faltava validação de arquivo e o estado "reserva aceita" distinto de "enviado"), uma simulação de coleta externa anunciando ao operador uma verificação de segurança que `BLOCKER-A`/`BLOCKER-C` tornam `NOT_CURRENTLY_OBSERVABLE`, dois campos de formulário sem `<label>`, e uma reincidência de menção a WhatsApp — todos corrigidos e reverificados funcionalmente. |
| `interface-heuristic-accessibility-evaluation.md` | `APPROVED AS INPUT FOR USER VALIDATION` | Avaliação do protótipo **executável** (Nielsen H1-H10, WCAG 2.2 AA, teclado/foco/semântica/forms real em navegador headless, `axe-core`, re-execução de J-01–J-08, Epistemic Integrity, `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`). Protocolo completo de 4 rodadas Claude↔Codex: Rodada A (autoavaliação, 9 achados corrigidos) concluiu aprovação prematuramente — Rodada B (adversarial) achou 6 problemas-raiz reais não vistos, o mais grave sendo a própria guarda anti-duplo-submit da Rodada A quebrando recovery de validação (S3) e `reconcileImport()` afirmando ter criado registros sem materializá-los (violação epistêmica real); Rodada C corrigiu os 6, mas errou ao manter jargão técnico ("SIMULATED...BACKEND") numa superfície pública de guest; Rodada D (nova adversarial) achou essa lacuna e uma correção incompleta em `submitAlert` (travava após sucesso, não só após erro) — ambos corrigidos e reverificados no fechamento. Quality Score final **9.04/10**, calculado após esse histórico, não apenas sobre o estado final do código. |

## Blockers técnicos de backend (citados por ID em todo o planejamento, nenhum resolvido)

| ID | O que é | Onde bloqueia |
|---|---|---|
| `BLOCKER-A` | Nenhuma rota lê/lista `Document`/`DocumentSubmission` — só upload/delete existem | Outcome "manter evidência documental" (J-04); indireto em renovação (J-03) |
| `BLOCKER-B` | Materialização de `ReminderOccurrence` parece desconectada do caminho normal de criação/edição de item | Outcome "ser avisado antes do vencimento" (J-05) |
| `BLOCKER-C` | Ciclo de coleta externa (guest upload) não fecha sozinho — sem transição automática nem visibilidade da submissão | Outcome "obter documentação de terceiros" (J-06); branch point não decidido (automático vs. revisão humana) |
| `GTR-01` | Guest flow não expõe identidade do solicitante ao fornecedor externo — risco de Trust/phishing | J-07 (guest submission), UX trust readiness `NOT READY` |

Achados menores registrados, não elevados a blocker nomeado: `POST /items` sem proteção de
idempotência, `CREATE-IDEMPOTENCY-01` (`interface-critical-user-journeys.md` §9); guest flow sem
rota pública de confirmação pós-envio (`interface-critical-user-journeys.md` §14); query
tenant-wide de solicitações pendentes inexistente (`interface-screen-and-state-inventory.md` §41,
bloqueia `SURF-013`).

## Pendência de formalização

`interface-quality-standard.md` (citado pelos 3 documentos acima) **não existe ainda como
arquivo formal** — os documentos usam os nomes de eixo (`TaskSuitability`,
`InformationArchitecture`, etc.) diretamente do prompt-fonte de cada etapa.
`expiration-tracker-bff-frontend-quality-standard.md` (raiz do repo) contém uma rubrica candidata
(§13-30) que, se adotada como padrão oficial, deveria passar pela mesma convergência independente
Claude↔Codex que os 9 eixos de `docs/engineering/joint-review-criteria.md` já usaram — não
decidido.

## Próxima etapa

**User Validation** — ainda não iniciada (o roteiro formal de entrevista fica para `User Validation
Planning`, não produzido em `interface-heuristic-accessibility-evaluation.md` §42 por decisão
explícita de escopo). Recebe como input o protótipo interativo real já corrigido (`prototype/`, ver
`prototype/README.md` para como rodar) e `interface-heuristic-accessibility-evaluation.md` §42
(tarefas candidatas, limitações conhecidas a comunicar ao facilitador, observações a capturar) —
sem redescobrir estrutura, estados, semântica ou achados de acessibilidade já fechados. Não obriga
o início imediato de Visual Design/Design System.
