# Checklist de conclusão de tarefa

> Uso obrigatório ao final de qualquer tarefa/item de todo list que produza ou altere código real,
> decisão registrada, ou documento normativo. Uma tarefa não está concluída até passar por esta
> checklist inteira — não é um resumo do que já foi feito, é o próprio gate. Operacionaliza em
> formato de checkbox o que já é normativo em `definition-of-done.md` + `change-risk-scale.md` +
> `quality-gate-tiers.md` + `joint-review-criteria.md` (nossos "pilares") — não os substitui, não
> duplica o texto deles, só torna a aplicação rápida de verificar item a item. Em qualquer
> divergência entre esta checklist e um dos quatro documentos-fonte, o documento-fonte vence.
> Existe uma Skill (`/task-checklist`, `.claude/skills/task-checklist/SKILL.md`) que aplica este
> arquivo de forma consistente — invocação do próprio agente, não hook bloqueante (`definition-of-
> done.md` §"O que isso NÃO é").

## 0. Isto é uma unidade válida de conclusão?

- [ ] O diff tem escopo coeso e um único nível máximo de risco identificável (`definition-of-done.md`
      §"Unidade de conclusão"). Se cruza mais de uma camada com gates diferentes (schema + handler +
      teste) ou mais de um gatilho de risco — decompor antes de continuar, não aplicar esta checklist
      a um item guarda-chuva.
- [ ] Se for um item read-only (inventário, pesquisa, leitura de código, planejamento) — esta
      checklist não se aplica; não há diff para avaliar.

## 1. Classificar o risco real (`change-risk-scale.md`)

- [ ] Nível classificado **pelo diff real produzido**, não pela intenção original do item, citando o
      gatilho concreto (ex. "nível 5 porque criou GSI novo", nunca só "parece arriscado").
- [ ] Em dúvida entre dois níveis adjacentes → usar o mais alto.
- [ ] Se a implementação revelou um contrato/fronteira de módulo novo não visível no início →
      reclassificar para 5-6 ANTES de fechar, não depois.

Nível classificado: **___** (1 Cosmético / 2 Correção mecânica / 3 Implementação já aprovada /
4 Judgment call reversível / 5 Contrato/chave/fronteira nova / 6 Decisão arquitetural formal)

## 2. Gate mínimo pelo nível (`definition-of-done.md` + `quality-gate-tiers.md`)

- [ ] **1-2**: `npm run typecheck` + `npm run lint` rodados e verdes.
- [ ] **3-4** (tudo do 1-2, mais): teste do módulo tocado roda e passa; `npm run check-boundaries` se
      import/fronteira mudou; `npm run validate-schemas` se schema/contrato mudou; `npm run
      build:lambdas` se handler/runtime mudou.
- [ ] Se o diff toca `src/shared/observability/**`/`app-error.ts`/log novo →
      `logging-observability-standard.md` aplicado, não só citado.
- [ ] Se o diff adiciona/altera teste automatizado → **G-V3 aplicado de fato**: cada `it()`
      novo/alterado tem comentário imediatamente acima nomeando uma mutação concreta que faria a
      asserção falhar (não basta a suíte estar verde — verde prova que passa, não que detectaria um
      bug real). G-V4 (nome/comentário declara a intenção) confirmado.
- [ ] **5-6** (tudo do 3-4, mais): protocolo Claude↔Codex (`AGENTS.md` §4) completo, nota ≥9,0 de
      ambos sem arredondar, artefato salvo em `docs/engineering/reviews/` ou
      `docs/architecture/reviews/`. Nível 6 adicionalmente exige ADR formal em
      `docs/architecture/adr/` + entrada em `decisions-log.md`.
- [ ] Se nível 5-6 depende de um padrão que sistemas externos já resolveram (RBAC, invite, sessão
      multi-tenant, etc.) → declaração `SIM`/`SIM PARCIAL`/`NÃO` de pesquisa externa registrada na
      Rodada 1 (`research-protocol.md`), não omitida.
- [ ] Se a decisão depende de comportamento específico de um serviço AWS → documentação oficial
      consultada antes de propor solução (`AGENTS.md` §4), não só memória interna.

## 3. Pilares/eixos de revisão — aplicar só os genuinamente tocados (`joint-review-criteria.md`)

Não forçar os 9 eixos em toda tarefa (proporcionalidade, `principles.md` #1) — marcar cada um
como **N/A** (não tocado) ou **avaliado** (com achado ou "sem achado"):

- [ ] **Arquitetura** — mudou topologia, contrato entre componentes, ou reaproveitou padrão
      existente em vez de generalizar prematuramente?
- [ ] **Qualidade de engenharia** — cobertura de teste real (não só verde), duplicação, dívida
      técnica introduzida vs. removida?
- [ ] **Engenharia de contexto** — documentos de estado (`NEXT_SESSION_PROMPT.md`,
      `docs/architecture/README.md`, decisions-log) continuam concordantes após esta mudança? Novo
      `.md` (se houver) está indexado e dentro do allowlist/guardrails de `check-doc-drift.ts`?
- [ ] **Segurança da informação/AppSec** — toca autenticação, autorização, segredo, superfície de
      ataque nova?
- [ ] **Privacidade/governança de dados** — toca PII, retenção, TTL, direito do titular?
- [ ] **Operações/SRE** — toca alarme, runbook, capacidade, rollback, DLQ?
- [ ] **Governança de IA** — envolveu delegação de subagente (checar limite de profundidade,
      `definition-of-done.md` §"Limite de profundidade de redelegação"), ou decisão que dispensou o
      protocolo Claude↔Codex (checar as 3 condições de `ai-governance.md` §2)?
- [ ] **Governança jurídica/terceiros** — introduziu dependência de terceiro, secret de vendor
      externo, ou termo contratual novo?
- [ ] **Governança de produto/multi-tenant** — toca isolamento de tenant, RBAC, ou rota HTTP nova
      (checar `authorize()` coverage, D-287)?

## 4. Evidência de ponta a ponta, se este item fecha um item de ROADMAP

- [ ] Se esta tarefa declara um item de `roadmap-competitivo-2026-09-01.md`/backlog P1/P2 como 🟢
      concluído: a linha de fechamento cita explicitamente qual evidência prova o fluxo PONTA A
      PONTA (teste de integração real, ou verificação ao vivo pós-deploy com comando/consulta
      citado) — nunca só "cada fatia estava verde isoladamente" (achado real, D-227/D-228).
- [ ] Se não há evidência ponta a ponta ainda disponível → o item fica 🟡, nomeando explicitamente o
      que falta, nunca 🟢 com a lacuna só em prosa.

## 5. Registro mínimo de evidência (obrigatório a partir do nível 3)

- [ ] Linha registrada no formato:
      `DoD: item=<nome curto>; risco=<nível + gatilho>; evidência=<comandos/rubricas e resultado>; lacunas=<nenhuma | pendência explícita>`
- [ ] Registrada no lugar certo, em ordem de preferência: (1) mensagem de commit real; (2) artefato
      de revisão em `reviews/` citando o arquivo real; (3) corpo da resposta da sessão, só se nenhum
      dos dois anteriores existir para este item.
- [ ] Gate falhou ou não rodou → item permanece `in_progress`/`pending` com o achado registrado,
      nunca marcado `completed` "para corrigir depois".

## 6. Manutenção de contexto, só ao concluir uma fase/marco (não todo item — `AGENTS.md` §6)

- [ ] Estado e próxima ação concordam entre `ARCHITECTURE.md`, `docs/architecture/README.md` e
      `NEXT_SESSION_PROMPT.md`.
- [ ] Nenhum `.md` novo foi deixado solto na raiz do repo fora do allowlist.
- [ ] `npm run check-docs` verde.

## 7. Padrão de trabalho autônomo — antes de considerar a sessão "parada"

- [ ] Se o próximo passo depende de decisão exclusiva do Marcelo (produto/arquitetura genuína,
      credencial, ação física, custo não trivial) → pendência registrada em `NEXT_SESSION_PROMPT.md`/
      `decisions-log.md`, e a sessão segue para outra frente independente em vez de ficar ociosa.
- [ ] Nenhuma ação genuinamente destrutiva/irreversível foi tomada sem confirmação (force-push,
      `terraform apply` local, deletar branch/dado real).
