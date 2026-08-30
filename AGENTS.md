# AGENTS.md — Expiration Tracker

> Fonte canônica de regras duráveis para qualquer agente de IA (Claude Code, Codex CLI) trabalhando neste repositório. `CLAUDE.md` importa este arquivo — não duplicar conteúdo nele.

## 1. Papel e estágio do projeto

Micro-SaaS de controle de vencimentos/renovações, arquitetura AWS serverless. Design Maturity `APPROVED`; implementação em andamento por milestone — ver `docs/architecture/README.md` (bloco de status no topo) para a fase/milestone vigente e `NEXT_SESSION_PROMPT.md` para a próxima ação exata; nenhum dos dois é normativo, mas ambos são o estado real, não este arquivo. Marcelo é o responsável final por decisões de produto/arquitetura; o agente atua como engenheiro autônomo, não assistente passivo.

**Autonomia padrão (2026-08-29)**: para manter o máximo de trabalho em andamento, postergar — nunca bloquear a sessão esperando — qualquer subtarefa que dependa inteiramente de decisão exclusiva de Marcelo (produto/arquitetura genuína, credencial, ação física); registrar o pendente claramente e seguir com outra frente independente, retomando depois. Decisão que implica custo incremental não-recorrente abaixo de US$5 (ex.: chamada de API, execução de teste em nuvem) não precisa de autorização prévia dele. Isto não dispensa o protocolo Claude↔Codex do §4 nem a confirmação de merge `develop→main` do §3.

Princípios de engenharia, tiers de gate de qualidade, escala de risco que calibra quando o protocolo do §4 é obrigatório, e os critérios ponderados por eixo (Arquitetura/Qualidade de Engenharia/Engenharia de Contexto) usados nas revisões conjuntas: `docs/engineering/{principles,quality-gate-tiers,change-risk-scale,joint-review-criteria}.md` (padrões adotados do projeto irmão `event-discovery-platform`, adaptados — não copiados — à complexidade real deste projeto).

**Definition of Done por item de todo list (2026-08-29, decisão de processo permanente, protocolo `§4` completo)**: nenhum item de todo list que produza/altere código real é marcado concluído sem passar pelo gate correspondente ao seu nível de risco (`docs/engineering/definition-of-done.md`) — inclui decompor itens guarda-chuva, classificar o risco pelo diff real, e registrar uma linha `DoD:` de evidência mínima antes de fechar. Aplica-se a partir de agora, em toda sessão, não só a esta.

**`docs/00-prompt-mestre.md` é a especificação de processo do ciclo de design já concluído — não é o ponto de entrada da sessão atual.** Não reiniciar a Fase 0 nem tratar suas instruções ("comece pela Fase 0") como comando ativo.

## 2. Início de sessão

1. Ler `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação).
2. Ler `docs/architecture/README.md` (mapa de fontes de arquitetura/sistema, status vigente, regra de precedência).
3. Se a tarefa envolver processo de qualidade/revisão (rubrica, protocolo Claude↔Codex, achados de auditoria por eixo), ler `docs/engineering/README.md` em vez de navegar `docs/engineering/` às cegas.
4. Se a tarefa envolver planejamento de interface (UX, IA, journeys, telas), ler `docs/frontend/README.md` primeiro — inclui os 3 blockers técnicos de backend (BLOCKER-A/B/C) e GTR-01, citados por ID em todo o planejamento, que não devem ser reabertos nem mascarados.
5. Consultar `docs/project/working-memory.md` só quando a tarefa envolver COMO trabalhar com Marcelo (ferramentas, processo), não O QUE decidir sobre o produto.
6. Não carregar todo `docs/architecture/history/` (nem `docs/engineering/reviews/`) por padrão — é evidência histórica, consultar sob demanda.

## 3. Estratégia de branch (padrão a partir de 2026-08-19)

`develop` é o branch de trabalho ativo — todo commit de sessão (implementação, remediação, docs) vai para `develop`, nunca direto em `main`. `main` é protegido no GitHub (required status check `guardrails`/CI, sem force-push, sem deleção) e só recebe merge via PR de `develop` quando um marco está estável e verificado (CI verde, gates relevantes revisados). Antes de começar qualquer trabalho de código, confirmar `git branch --show-current` = `develop` (ou uma branch de feature a partir dele, se a tarefa justificar); se estiver em `main`, trocar para `develop` antes de commitar.

**Autonomia de merge (2026-08-29)**: ao concluir com sucesso uma etapa relevante da lista de tarefas em andamento, commit, push de `develop` e merge do PR `develop→main` podem ser feitos sem aguardar confirmação explícita de Marcelo — os recursos hoje só são deployados em `dev` (CD dispara em push a `main`, ver §7), não existe ambiente de produção real ainda e não há previsão próxima de criar um. Isto substitui a exigência anterior desta seção de confirmar antes de merjar. Não dispensa o protocolo Claude↔Codex do §4 para decisões Type 1 antes do merge, nem uma checagem rápida antes de operação genuinamente destrutiva/irreversível (force-push, deletar branch).

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
- Nenhum `.md` novo foi deixado solto na raiz do repo (handoff/prompt/mission-brief pertence a `docs/`, ver a tabela de precedência em `docs/architecture/README.md`).

`npm run check-docs` (`scripts/check-doc-drift.ts`, bloqueante no CI desde full-audit round1/eixo Engenharia de Contexto) automatiza parte desta checklist: link relativo quebrado entre qualquer `.md` do repo; referência `AGENTS.md §N` que não corresponde a um `## N.` real neste arquivo; `.md` novo na raiz fora do allowlist explícito do script; `AGENTS.md`/`NEXT_SESSION_PROMPT.md` excedendo o guardrail de tamanho declarado no próprio script. Não cobre as checagens semânticas acima (status concordante entre documentos, `history/` tratado como normativo) — essas continuam manuais.

## 7. Convenções e invariantes de código real

Layout por módulo: `src/modules/<módulo>/{domain,application,ports,persistence,http}` (lógica pura + adapters reais separados); workers assíncronos puros em `src/workers/<worker>` (testáveis com relógio injetado, deliberadamente observability-agnostic — `decisions-log.md` E-007); handlers Lambda reais (o único lugar que importa AWS SDK/observability concreta) em `src/runtime/aws/handlers/`. Layout original descrito em `implementation-blueprint.md` §2/§19; estado de implementação por milestone vive em `docs/architecture/README.md`/`NEXT_SESSION_PROMPT.md`, não aqui. `src/shared/observability/security-audit.ts` (taxonomia fechada de eventos de segurança — negação de autorização, acesso a GSI3/GSI6) nunca importa de `src/modules/**` (regra `dependency-cruiser` `shared-must-not-reach-modules`) — os call sites passam os valores já tipados do lado deles.

**Infra (ADR-0009): CDK substituído por Terraform**, `infra/` (módulos + wiring raiz), deploy real via GitHub Actions (`ci.yml` plan-only em PR, `cd.yml` apply em push a `main`, OIDC sem credencial de longa duração). Regra de isolamento de índice: nunca conceder acesso de leitura a um GSI restrito (GSI3/GSI6) via política geral de tabela — só via política escopada explicitamente ao índice (`infra/modules/dynamo-table/main.tf`), anexada só às roles que precisam. Suíte de infra (`infra/tests/stack.tftest.hcl`, `terraform test`) prova isolamento de GSI3/GSI6, DLQ, alarmes, contrato do EventBridge Scheduler. **Acesso AWS real (verificação/smoke test, nunca `apply` local) é via `aws ... --profile claude-dev`** (conta `dev`) — nunca concluir "sem acesso AWS" a partir só do CLI sem profile (retorna `NoCredentials` mesmo quando `claude-dev` funciona).

Comandos: `npm ci` (install imutável, scripts desabilitados via `.npmrc`) · `npm run typecheck` · `npm run lint` (ESLint; `no-console` é erro fora de `src/shared/observability/**` — todo handler usa `SecureLogger`, nunca `console.*`) · `npm test` (Vitest; unit+contract+integration) · `npm run check-docs` (drift de documentação) · `npm run validate-schemas` (carrega tudo em `schemas/` e falha em `$ref` quebrado) · `npm run build:lambdas` (bundla os handlers via esbuild antes de `terraform plan`/`apply`). Node fixado em `.nvmrc` (20.x); CI em `.github/workflows/ci.yml` roda os cinco + audit + SBOM (CycloneDX) + `infra` (Terraform), actions pinadas por SHA.

Convenções: TypeScript estrito (`tsconfig.json`, `noUncheckedIndexedAccess`); erros de app usam a taxonomia normalizada de `src/shared/errors/app-error.ts` (`AppError` + subclasses); toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts` (nunca `UpdateItem`/`PutItem` cru); eventos críticos usam `src/shared/outbox/outbox.ts` dentro do mesmo `TransactWriteItems` do agregado; schemas JSON são a fonte de verdade dos contratos (`src/shared/contracts/schema-validator.ts` os carrega via Ajv) — todo evento/comando novo ganha um schema em `schemas/{events,queues,api}/` com teste de exemplo válido e inválido em `test/contract/`.

## 8. Manutenção do próprio AGENTS.md

Meta: 60-100 linhas. Antes de adicionar algo, verificar: muda comportamento em várias sessões futuras? É estável, não temporário? Não é derivável do código/Git/decisions-log? Não pertence a `NEXT_SESSION_PROMPT.md`, `working-memory.md` ou a um documento de arquitetura? Se alguma resposta for não, não pertence aqui.
