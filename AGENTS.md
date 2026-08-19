# AGENTS.md — Expiration Tracker

> Fonte canônica de regras duráveis para qualquer agente de IA (Claude Code, Codex CLI) trabalhando neste repositório. `CLAUDE.md` importa este arquivo — não duplicar conteúdo nele.

## 1. Papel e estágio do projeto

Micro-SaaS de controle de vencimentos/renovações, arquitetura AWS serverless. O projeto está na transição **Design Maturity APPROVED → Implementation Blueprint** (ver `docs/architecture/README.md` para o status exato e vigente — não confiar em datas antigas deste arquivo). Marcelo é o responsável final por decisões de produto/arquitetura; o agente atua como engenheiro autônomo, não assistente passivo.

**`docs/00-prompt-mestre.md` é a especificação de processo do ciclo de design já concluído — não é o ponto de entrada da sessão atual.** Não reiniciar a Fase 0 nem tratar suas instruções ("comece pela Fase 0") como comando ativo.

## 2. Início de sessão

1. Ler `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação).
2. Ler `docs/architecture/README.md` (mapa de fontes, status vigente, regra de precedência).
3. Consultar `docs/project/working-memory.md` só quando a tarefa envolver COMO trabalhar com Marcelo (ferramentas, processo), não O QUE decidir sobre o produto.
4. Não carregar todo `docs/architecture/history/` por padrão — é evidência histórica, consultar sob demanda.

## 3. Protocolo de debate Claude ↔ Codex

Aplica-se **obrigatoriamente** a: decisões de arquitetura, requisitos, modelo de dados, segurança/privacidade, e qualquer entregável explicitamente submetido ao protocolo (Type 1, difícil de reverter). **Não é obrigatório** para: correção mecânica, documentação factual, refactors locais reversíveis, lint/teste, implementação direta de decisão já aprovada — aplicar bom senso de engenharia nesses casos.

Quando aplicável: mínimo 3 rodadas (proposta → crítica → tréplica), nota mínima 9.0 de ambos antes de considerar concluído, sem arredondar (8.99 não vira 9). Protocolo de nota cega: o avaliador que responde depois não vê a nota/parecer do primeiro até ambos existirem registrados; desacordo abaixo de 9 reabre rodada em vez de arredondar ou fazer média.

Invocação do Codex: `codex exec --skip-git-repo-check "<prompt>"`, rodar em background. **Nunca usar crases (`` ` ``) dentro de um prompt passado por Bash com aspas duplas** — o shell interpreta como substituição de comando e corrompe a entrada silenciosamente (o processo trava esperando stdin, CPU ~0). Para prompts com crases/markdown, escrever em arquivo e usar `codex exec --skip-git-repo-check - < arquivo.txt`. Se um processo `codex` rodar muito mais que rodadas comparáveis com CPU quase zero, está travado — matar e relançar, não esperar. **Não combinar `- < arquivo.txt` com backgrounding (`&`)** — essa combinação já produziu duas falhas silenciosas (processo travado relendo arquivo grande e bloqueado por política de sandbox; depois saída vazia sem erro) mesmo com prompt correto. Rodar `codex exec --skip-git-repo-check - < arquivo.txt > saida.txt 2>&1` em primeiro plano (sem `&`) é o padrão confiável verificado; só background se o prompt for curto o bastante para passar inline sem stdin.

## 4. Precedência de fontes

Ver tabela completa em `docs/architecture/README.md`. Resumo: `AGENTS.md` (processo) > ADR aceito (decisão específica) > documento temático corrente (`docs/architecture/*.md`) > `ARCHITECTURE.md` (visão consolidada) > `NEXT_SESSION_PROMPT.md` (estado, nunca normativo) > `docs/architecture/history/` (nunca normativo).

## 5. Manutenção de contexto — checklist por marco

Ao concluir uma fase/marco relevante (ex.: fim do Implementation Blueprint, fim de cada fase de implementação), verificar:

- Estado e próxima ação concordam entre `ARCHITECTURE.md`, `docs/architecture/README.md` e `NEXT_SESSION_PROMPT.md`.
- Nenhum documento em `history/` está sendo tratado como normativo em algum lugar.
- ADRs e `decisions-log.md` têm status compatível entre si.
- Arquivos novos em `docs/architecture/` aparecem no índice.
- Referências a caminhos de arquivo (`docs/architecture/...`) continuam válidas.
- Regras duráveis não foram duplicadas entre `AGENTS.md`, working-memory e handoff.
- Este `AGENTS.md` continua dentro do limite de tamanho (ver §6).
- Fatos temporários foram removidos de `NEXT_SESSION_PROMPT.md` ou promovidos ao lugar correto.

Não há automação disso ainda — é proporcional ao estágio (projeto sem código/CI real). Reavaliar automação (ex.: verificador de links, ou uma skill dedicada como a de um projeto irmão do mesmo usuário) quando: (a) existir CI real, ou (b) houver reincidência de link quebrado/drift documental.

## 6. Código real (M0 em diante)

M0 ("guardrails e contratos", `implementation-blueprint.md` §19) está implementado: `src/shared/{errors,observability,config,idempotency,dynamodb,outbox,contracts}`, schemas em `schemas/`, testes em `test/{unit,contract}`. M1 ("Foundation, Identity e isolamento") adicionou `src/modules/identity/{domain,application,ports,persistence,http}` (resolver central, matriz de autorização, quotas — todos SDK-agnostic via portas injetáveis, mesmo padrão de `src/shared`) e `infra/{lib,bin}` (constructs CDK: `ExpirationTrackerTable`, `ExpirationTrackerAuth`, `ScopedLambdaFunction`, `ExpirationTrackerApi`). M2 ("Expiration core e Audit") adicionou `src/modules/expiration/{domain,application,ports,http}` no mesmo padrão; seu port (`ExpirationStore`) introduz `transactWrite` porque a regra de data-model.md §5 (item + outbox + audit numa única `TransactWriteItems`) exige múltiplos itens condicionais atômicos — qualquer módulo futuro com a mesma necessidade deve reusar esse formato de port, não inventar um novo (M3's `ReminderStore` já faz isso). M3 ("Reminder Engine") adicionou `src/modules/reminder/{domain,application,ports,http}` + `src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}` (lógica pura, testável com relógio injetado — nenhum worker tem runtime Lambda real ainda, mesmo estágio de M0-M2). **Regra de isolamento de índice descoberta em M3, válida para qualquer GSI restrito no futuro**: `Table.grantReadWriteData`/`grantReadData` do CDK sempre incluem `<tableArn>/index/*` (todos os índices) quando a tabela tem qualquer GSI — não usar esses helpers para uma tabela com índice restrito (como GSI3); `ExpirationTrackerTable` (`infra/lib/dynamo-table.ts`) já constrói `PolicyStatement`s com lista explícita de recursos por isso. M4+ segue o mesmo layout (`src/modules/<módulo>/...`, `src/workers/<worker>`) descrito em `implementation-blueprint.md` §2. Testes de infra (`test/infra/`) sintetizam a stack via `aws-cdk-lib`/`aws-cdk-lib/assertions` em memória — não exigem AWS CLI/credenciais nem a instalação do binário `aws-cdk`. Suíte cross-tenant negativa (exit criterion de M1) vive em `test/integration/cross-tenant.test.ts`; suíte de isolamento do GSI3 (exit criterion de M3) vive em `test/infra/stack.test.ts`.

Comandos: `npm ci` (install imutável, scripts desabilitados via `.npmrc`) · `npm run typecheck` · `npm run lint` (ESLint; `no-console` é erro fora de `src/shared/observability/**` — todo handler usa `SecureLogger`, nunca `console.*`) · `npm test` (Vitest; unit+contract+integration+infra) · `npm run validate-schemas` (carrega tudo em `schemas/` e falha em `$ref` quebrado). Node fixado em `.nvmrc` (20.x); CI em `.github/workflows/ci.yml` roda os quatro + audit + SBOM (CycloneDX), actions pinadas por SHA (`implementation-blueprint.md` §16.1).

Convenções: TypeScript estrito (`tsconfig.json`, `noUncheckedIndexedAccess`); erros de app usam a taxonomia normalizada de `src/shared/errors/app-error.ts` (`AppError` + subclasses, `retryable` decide roteamento SQS/DLQ); toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts` (nunca `UpdateItem`/`PutItem` cru); eventos críticos usam `src/shared/outbox/outbox.ts` dentro do mesmo `TransactWriteItems` do agregado; schemas JSON são a fonte de verdade dos contratos (`src/shared/contracts/schema-validator.ts` os carrega via Ajv) — todo evento/comando novo ganha um schema em `schemas/{events,queues,api}/` com teste de exemplo válido e inválido em `test/contract/`.

Pendências não bloqueantes registradas no pipeline: assinatura/provenance de artefato (SLSA) fica para M1+ quando existir um alvo de deploy real; SHAs das actions pinadas no CI devem ser reverificados periodicamente (comentário no próprio workflow).

Reavaliar automação da checklist §5 (verificador de links, skill de auditoria) quando o volume de módulos M1+ justificar.

## 7. Manutenção do próprio AGENTS.md

Meta: 60-100 linhas. Antes de adicionar algo, verificar: muda comportamento em várias sessões futuras? É estável, não temporário? Não é derivável do código/Git/decisions-log? Não pertence a `NEXT_SESSION_PROMPT.md`, `working-memory.md` ou a um documento de arquitetura? Se alguma resposta for não, não pertence aqui.
