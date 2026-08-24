# Expiration Tracker — Status e Próxima Sessão

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), não histórico. Para a linha do tempo completa por sessão, ver `docs/architecture/session-log.md`; para toda decisão com nota Claude/Codex, ver `docs/architecture/decisions-log.md`. Reescrito em 2026-08-23 para remover narrativa já duplicada nesses dois arquivos (checklist `AGENTS.md` §6).

## Estado atual

**Backend**: M0-M11 implementados. M6 (documentos/malware), M9 (Subject/Requirement), M10 (guest upload + automated chasing + convite inicial), M11 (CSV import) — todos deployados em `main`/`dev`. M7 (extração/OCR) tem design aprovado (D-035) mas implementação **não iniciada** — aguardando decisão do Marcelo sobre início. M12 (billing) **bloqueado por decisão de produto** (D-052, escolha de fornecedor de pagamento). M13 (Organization/Membership/RBAC) **gated** por gatilho comercial real (primeira venda B2B) que não disparou.

**Full BFF (autenticação de browser)**: design fechado via protocolo Claude↔Codex em duas rodadas — D-053 (Full BFF, Claude 9,2/Codex 9,3) e D-054 (amendment de uma auditoria adversarial de 16 pontos, Claude 9,2/Codex 9,4). **Zero código implementado.** É pré-requisito técnico de qualquer frontend real: o browser não tem hoje nenhuma forma segura de chamar uma rota autenticada (só `Authorization: Bearer` direto). Debate completo em `docs/architecture/reviews/bff-full-vs-session-design/`.

**Planejamento de interface**: 3 documentos produzidos em sequência, todos `docs/frontend/*.md`, cada um fechado via protocolo Claude↔Codex e `APPROVED`:
1. `interface-context-and-critical-tasks.md` — papéis, JTBD, inventário de tarefas, criticidade/readiness.
2. `interface-conceptual-model-and-information-architecture.md` — modelo conceitual, IA recomendada (dual-anchor: Vencimentos + Fornecedor/Subject).
3. `interface-critical-user-journeys.md` — 8 journeys outcome-a-outcome.

Esses 3 documentos descobriram **3 blockers técnicos reais de backend** (nenhum resolvido, todos citados por ID em todo lugar relevante, nunca mascarados):
- **BLOCKER-A** — nenhuma rota lê/lista documentos (`Document`/`DocumentSubmission`); só upload/delete existem.
- **BLOCKER-B** — a materialização automática de `ReminderOccurrence` parece desconectada do caminho normal de criação/edição de item (só um worker de reconciliação de DST chama o materializer) — salvar uma política de lembrete hoje não parece produzir lembrete real.
- **BLOCKER-C** — o ciclo de coleta externa (guest upload) não fecha sozinho: nenhuma transição automática leva o requisito a satisfeito, nem visibilidade da submissão ao operador interno.

Mais dois achados menores, registrados mas não elevados a blocker nomeado: `POST /items` não tem proteção de idempotência (retry após timeout pode duplicar item); o guest flow não tem rota pública para o fornecedor externo confirmar o resultado do scan de segurança pós-envio, nem identidade do solicitante exposta (**GTR-01**, requisito de confiança formal, não resolvido).

**Próxima etapa natural do design** (ainda não iniciada): Screen + State Inventory — prompt já trazido pelo Marcelo, arquivo `expiration-tracker-screen-and-state-inventory-next-step.md` (raiz do repo).

## Decisões pendentes do Marcelo

1. **Prioridade entre**: (a) implementar o Full BFF; (b) corrigir os 3 blockers de backend (BLOCKER-A/B/C); (c) continuar o design de interface (Screen + State Inventory); (d) iniciar M7 (extração/OCR). Nenhuma bloqueia as outras — podem avançar em paralelo (ver Engineering Enablement Dependencies em `interface-conceptual-model-and-information-architecture.md` §36).
2. **Branch point de `BLOCKER-C`**: fechamento automático vs. revisão humana explícita da coleta externa — as duas alternativas estão comparadas lado a lado (decision brief, não decidido) em `interface-conceptual-model-and-information-architecture.md` §37 e `interface-critical-user-journeys.md` §37.
3. **Estado real de `git`/deploy no início da próxima sessão não deve ser presumido** — várias features foram implementadas e mergeadas ao longo de 2026-08-23; confirmar `git status`/`git log`/branch atual antes de qualquer trabalho novo, em vez de reconstruir a partir deste resumo.

## Pendências residuais não bloqueantes (registradas, não bloqueiam nada)

- `npm audit --omit=dev` no job `guardrails` segue com achado pré-existente não batendo exatamente com `docs/engineering/exceptions.md` EX-001 — vale reavaliar quando houver tempo.
- Observabilidade por função (alarmes CloudWatch) para `ImportParseWorker`/`ImportCommitWorker`: deixada como residual documentado em D-050 (a DLQ-age alarm genérica já cobre "está falhando").
- Camada 3 de M6 (teste real de reconciliação de upload slot expirado) nunca exercitada contra AWS real.
- `docs/frontend/interface-quality-standard.md` ainda não existe como arquivo formal — os 3 documentos de interface usam os nomes de eixo direto do prompt-fonte. `expiration-tracker-bff-frontend-quality-standard.md` (raiz) contém uma rubrica candidata (§13-30) que, se adotada como padrão oficial, deveria passar pela mesma convergência independente Claude↔Codex que os 9 eixos de `docs/engineering/joint-review-criteria.md` já usaram — não decidido ainda.

## Referências (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` — todas as decisões (D-000 a D-054) com nota Claude/Codex e status.
- `docs/frontend/` — os 3 documentos de planejamento de interface aprovados.
- `docs/architecture/reviews/bff-full-vs-session-design/` — debate completo do Full BFF.
