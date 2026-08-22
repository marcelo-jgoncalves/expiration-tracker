# AGENTS.md — Expiration Tracker

> Fonte canônica de regras duráveis para qualquer agente de IA (Claude Code, Codex CLI) trabalhando neste repositório. `CLAUDE.md` importa este arquivo — não duplicar conteúdo nele.

## 1. Papel e estágio do projeto

Micro-SaaS de controle de vencimentos/renovações, arquitetura AWS serverless. Design Maturity `APPROVED`; implementação em andamento por milestone (M0-M3 concluídos, M3.5/G8 com design+implementação aprovados pelo protocolo Claude↔Codex — ver `NEXT_SESSION_PROMPT.md` para o estado exato e vigente, não confiar em datas antigas deste arquivo). Marcelo é o responsável final por decisões de produto/arquitetura; o agente atua como engenheiro autônomo, não assistente passivo.

Princípios de engenharia, tiers de gate de qualidade, escala de risco que calibra quando o protocolo do §4 é obrigatório, e os critérios ponderados por eixo (Arquitetura/Qualidade de Engenharia/Engenharia de Contexto) usados nas revisões conjuntas: `docs/engineering/{principles,quality-gate-tiers,change-risk-scale,joint-review-criteria}.md` (padrões adotados do projeto irmão `event-discovery-platform`, adaptados — não copiados — à complexidade real deste projeto).

**`docs/00-prompt-mestre.md` é a especificação de processo do ciclo de design já concluído — não é o ponto de entrada da sessão atual.** Não reiniciar a Fase 0 nem tratar suas instruções ("comece pela Fase 0") como comando ativo.

## 2. Início de sessão

1. Ler `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação).
2. Ler `docs/architecture/README.md` (mapa de fontes de arquitetura/sistema, status vigente, regra de precedência).
3. Se a tarefa envolver processo de qualidade/revisão (rubrica, protocolo Claude↔Codex, achados de auditoria por eixo), ler `docs/engineering/README.md` em vez de navegar `docs/engineering/` às cegas.
4. Consultar `docs/project/working-memory.md` só quando a tarefa envolver COMO trabalhar com Marcelo (ferramentas, processo), não O QUE decidir sobre o produto.
5. Não carregar todo `docs/architecture/history/` (nem `docs/engineering/reviews/`) por padrão — é evidência histórica, consultar sob demanda.

## 3. Estratégia de branch (padrão a partir de 2026-08-19)

`develop` é o branch de trabalho ativo — todo commit de sessão (implementação, remediação, docs) vai para `develop`, nunca direto em `main`. `main` é protegido no GitHub (required status check `guardrails`/CI, sem force-push, sem deleção) e só recebe merge via PR de `develop` quando um marco está estável e verificado (CI verde, gates relevantes revisados). Antes de começar qualquer trabalho de código, confirmar `git branch --show-current` = `develop` (ou uma branch de feature a partir dele, se a tarefa justificar); se estiver em `main`, trocar para `develop` antes de commitar. Abrir o PR `develop→main` é uma ação visível/compartilhada — confirmar com Marcelo antes de merjar, mesmo que o push para `develop` em si não precise de confirmação a cada commit.

## 4. Protocolo de debate Claude ↔ Codex

Aplica-se **obrigatoriamente** a: decisões de arquitetura, requisitos, modelo de dados, segurança/privacidade, e qualquer entregável explicitamente submetido ao protocolo (Type 1, difícil de reverter — nível 5-6 de `docs/engineering/change-risk-scale.md`). **Não é obrigatório** para: correção mecânica, documentação factual, refactors locais reversíveis, lint/teste, implementação direta de decisão já aprovada (níveis 1-4) — usar a escala de risco para calibrar, não julgamento ad-hoc repetido.

Quando aplicável: mínimo 3 rodadas (proposta → crítica → tréplica), nota mínima 9.0 de ambos antes de considerar concluído, sem arredondar (8.99 não vira 9). Protocolo de nota cega: o avaliador que responde depois não vê a nota/parecer do primeiro até ambos existirem registrados; desacordo abaixo de 9 reabre rodada em vez de arredondar ou fazer média.

O protocolo é dispensável para uma decisão Type 1 quando o responsável final (`AGENTS.md` §1) já decidiu diretamente — mas só sob as três condições registradas em `docs/engineering/ai-governance.md` §2 (achado real de `full-audit-round1-governanca-ia`: ADR-0009 dispensou o protocolo sem essa exceção estar formalizada). Matriz de autoridade por agente, inventário de casos de uso de IA e registro de incidentes do próprio agente (distinto de `exceptions.md`, que é para exceção de regra de engenharia): `docs/engineering/ai-governance.md`.

Invocação do Codex: `codex exec --skip-git-repo-check "<prompt>"`, rodar em background. **Nunca usar crases (`` ` ``) dentro de um prompt passado por Bash com aspas duplas** — o shell interpreta como substituição de comando e corrompe a entrada silenciosamente (o processo trava esperando stdin, CPU ~0). Para prompts com crases/markdown, escrever em arquivo e usar `codex exec --skip-git-repo-check - < arquivo.txt`. Se um processo `codex` rodar muito mais que rodadas comparáveis com CPU quase zero, está travado — matar e relançar, não esperar. **Não combinar `- < arquivo.txt` com backgrounding (`&`)** — essa combinação já produziu duas falhas silenciosas (processo travado relendo arquivo grande e bloqueado por política de sandbox; depois saída vazia sem erro) mesmo com prompt correto. Rodar `codex exec --skip-git-repo-check - < arquivo.txt > saida.txt 2>&1` em primeiro plano (sem `&`) é o padrão confiável verificado; só background se o prompt for curto o bastante para passar inline sem stdin.

**Regras de shell específicas do ambiente real de trabalho (Windows, terminal com aprovação de comando por chamada)** — achado real de `full-audit-round1-contexto-summary.md` (critério Portabilidade Agnóstica): as regras acima descrevem semântica de Bash/backgrounding em termos genéricos, mas duas regras adicionais só fazem sentido neste ambiente específico e não devem ser assumidas como universais ao portar o processo para outro agente/SO: (1) **nunca encadear comandos com `&&`** (nem só dois passos triviais como `cd` + outro comando) — cada ação é uma chamada de shell separada; encadear dispara um prompt de aprovação que um agente em background não consegue responder. (2) **Reafirmar o diretório de trabalho (`cd` isolado, sua própria chamada) antes de qualquer comando sempre que houver uma lacuna** — depois de aguardar notificação, depois de comando longo, no início de cada retomada — o diretório de trabalho pode resetar para a raiz entre chamadas/turnos; não presumir que persiste.

## 5. Precedência de fontes

Ver tabela completa em `docs/architecture/README.md`. Resumo: `AGENTS.md` (processo) > ADR aceito (decisão específica) > documento temático corrente (`docs/architecture/*.md`) > `ARCHITECTURE.md` (visão consolidada) > `NEXT_SESSION_PROMPT.md` (estado, nunca normativo) > `docs/architecture/history/` (nunca normativo).

## 6. Manutenção de contexto — checklist por marco

Ao concluir uma fase/marco relevante (ex.: fim do Implementation Blueprint, fim de cada fase de implementação), verificar:

- Estado e próxima ação concordam entre `ARCHITECTURE.md`, `docs/architecture/README.md` e `NEXT_SESSION_PROMPT.md`.
- Nenhum documento em `history/` está sendo tratado como normativo em algum lugar.
- ADRs e `decisions-log.md` têm status compatível entre si.
- Arquivos novos em `docs/architecture/` aparecem no índice.
- Referências a caminhos de arquivo (`docs/architecture/...`) continuam válidas.
- Regras duráveis não foram duplicadas entre `AGENTS.md`, working-memory e handoff.
- Este `AGENTS.md` continua dentro do limite de tamanho (ver §8).
- Fatos temporários foram removidos de `NEXT_SESSION_PROMPT.md` ou promovidos ao lugar correto.

`npm run check-docs` (`scripts/check-doc-drift.ts`, bloqueante no CI desde full-audit round1/eixo Engenharia de Contexto) automatiza parte desta checklist: link relativo quebrado entre qualquer `.md` do repo, e referência `AGENTS.md §N` que não corresponde a um `## N.` real neste arquivo. Não cobre as checagens semânticas acima (status concordante entre documentos, `history/` tratado como normativo) — essas continuam manuais.

## 7. Código real (M0 em diante)

M0 ("guardrails e contratos", `implementation-blueprint.md` §19) está implementado: `src/shared/{errors,observability,config,idempotency,dynamodb,outbox,contracts}`, schemas em `schemas/`, testes em `test/{unit,contract}`. M1 adicionou `src/modules/identity/{domain,application,ports,persistence,http}` (resolver central, matriz de autorização, quotas). M2 adicionou `src/modules/expiration/{domain,application,ports,http}` (port `ExpirationStore` introduz `transactWrite`, reusado por M3's `ReminderStore`). M3 adicionou `src/modules/reminder/{domain,application,ports,http}` + `src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}` (lógica pura, testável com relógio injetado). M3.5 adicionou runtime Lambda real em `src/runtime/aws/handlers/` — a lógica pura em `src/workers/` continua observability-agnostic por decisão (`decisions-log.md` E-007). M4+ segue o mesmo layout (`src/modules/<módulo>/...`, `src/workers/<worker>`) descrito em `implementation-blueprint.md` §2. M4 (design `APPROVED`, `docs/architecture/m4-notification-engine-design.md`) está implementado de ponta a ponta — `src/modules/notification/{domain,ports,application,persistence,providers}` (lógica pura + 3 workflows composition-root reais + adapters DynamoDB/SES reais), handlers Lambda em `src/runtime/aws/handlers/`, infra Terraform em `infra/` (filas, SES/SNS, IAM). Pendência real restante: spike de validação das tags SES em sandbox (bloqueado externamente, sem identidade SES verificada) — rota HTTP de preferências e template de e-mail versionado (`src/modules/notification/providers/email-templates.ts`) já fechados, ver `NEXT_SESSION_PROMPT.md`. M5 (Observabilidade — correlationId/tenantId contextual via `AsyncLocalStorage` em `src/shared/observability/context.ts`, tracing via ADOT/X-Ray, alerta SNS→e-mail via novo módulo `infra/modules/alert-topic`) está implementado e revisado pelo protocolo Claude↔Codex (nota final 9,1/10) — achado real pré-existente descoberto na revisão (contrato de wire de `reminder.dispatch.v1` incompleto) registrado em `NEXT_SESSION_PROMPT.md`, não corrigido nesta sessão (Type 1, fora do escopo do design M5). `src/shared/observability/security-audit.ts` (taxonomia fechada de eventos de segurança — negação de autorização, acesso a GSI3/GSI6) nunca importa de `src/modules/**` (regra `dependency-cruiser` `shared-must-not-reach-modules`) — os call sites (4 handlers HTTP + 3 adapters GSI) passam os valores já tipados do lado deles.

**Infra (ADR-0009, 2026-08-20): CDK substituído por Terraform**, `infra/` (módulos + wiring raiz), deploy real via GitHub Actions (`ci.yml` plan-only em PR, `cd.yml` apply em push a `main`, OIDC sem credencial de longa duração). Regra de isolamento de índice descoberta em M3, ainda válida: nunca conceder acesso de leitura a um GSI restrito (GSI3/GSI6) via política geral de tabela — só via política escopada explicitamente ao índice (`infra/modules/dynamo-table/main.tf`), anexada só às roles que precisam. Suíte de infra (`infra/tests/stack.tftest.hcl`, `terraform test`) recria as propriedades que a antiga suíte CDK provava — isolamento de GSI3/GSI6, DLQ, alarmes, contrato do EventBridge Scheduler.

Comandos: `npm ci` (install imutável, scripts desabilitados via `.npmrc`) · `npm run typecheck` · `npm run lint` (ESLint; `no-console` é erro fora de `src/shared/observability/**` — todo handler usa `SecureLogger`, nunca `console.*`) · `npm test` (Vitest; unit+contract+integration) · `npm run validate-schemas` (carrega tudo em `schemas/` e falha em `$ref` quebrado) · `npm run build:lambdas` (bundla os 8 handlers via esbuild antes de `terraform plan`/`apply`). Node fixado em `.nvmrc` (20.x); CI em `.github/workflows/ci.yml` roda os quatro + audit + SBOM (CycloneDX) + `infra` (Terraform), actions pinadas por SHA (`implementation-blueprint.md` §16.1).

Convenções: TypeScript estrito (`tsconfig.json`, `noUncheckedIndexedAccess`); erros de app usam a taxonomia normalizada de `src/shared/errors/app-error.ts` (`AppError` + subclasses, `retryable` decide roteamento SQS/DLQ); toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts` (nunca `UpdateItem`/`PutItem` cru); eventos críticos usam `src/shared/outbox/outbox.ts` dentro do mesmo `TransactWriteItems` do agregado; schemas JSON são a fonte de verdade dos contratos (`src/shared/contracts/schema-validator.ts` os carrega via Ajv) — todo evento/comando novo ganha um schema em `schemas/{events,queues,api}/` com teste de exemplo válido e inválido em `test/contract/`.

Pendências não bloqueantes registradas no pipeline: assinatura/provenance de artefato (SLSA) fica para M1+ quando existir um alvo de deploy real; SHAs das actions pinadas no CI devem ser reverificados periodicamente (comentário no próprio workflow).

## 8. Manutenção do próprio AGENTS.md

Meta: 60-100 linhas. Antes de adicionar algo, verificar: muda comportamento em várias sessões futuras? É estável, não temporário? Não é derivável do código/Git/decisions-log? Não pertence a `NEXT_SESSION_PROMPT.md`, `working-memory.md` ou a um documento de arquitetura? Se alguma resposta for não, não pertence aqui.
