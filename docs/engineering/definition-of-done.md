# Definition of Done — por item de todo list

Formaliza um gate que já existia implicitamente por rodada/marco (`quality-gate-tiers.md` Tier A, `change-risk-scale.md`, `logging-observability-standard.md`, `test-engineering-standard.md`) mas nunca por item de todo list/task da sessão — os padrões já existiam, mas eram consultados por PR/wave inteira, não item a item, permitindo drift acumular antes de ser pego. Este documento fecha esse gap; não substitui nenhum dos documentos acima, só define QUANDO cada um precisa ser consultado antes de marcar um item concluído, e com que evidência.

Decisão de processo/governança com escopo permanente (todas as sessões futuras, Claude e Codex) — `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4, 3 rodadas, Claude 9,1/Codex 9,2, ambos ≥9,0) mesmo não sendo decisão de arquitetura, porque muda como TODO trabalho futuro é avaliado. Registrado como `docs/engineering/decisions-log.md` E-012.

**Aplicação prospectiva, não retroativa**: itens de todo list já marcados `completed` antes deste documento existir não são reabertos por causa dele — o gate vale a partir de quando este documento passou a existir na sessão.

## Regra central

Nenhum item de todo list que produza ou altere código real é marcado `completed` sem antes ter sido avaliado contra os padrões aplicáveis abaixo, com uma linha de evidência registrada (ver §"Registro mínimo de evidência"). "Avaliado" significa comando real rodado e resultado verificado, ou rubrica lida linha a linha contra o diff real — nunca "acho que está de acordo".

## Unidade de conclusão — o que conta como "um item"

Um item de todo list só é uma unidade válida de DoD quando seu diff tem escopo coeso e um único nível máximo de risco identificável. Itens guarda-chuva (waves inteiras, milestones, "chunks" no estilo W3-07) quase sempre cruzam vários níveis da `change-risk-scale.md` dentro do mesmo item — isso é a norma neste projeto, não a exceção.

Regra decidível (não depende de "achar que vale a pena"): **decompor por padrão** sempre que o item tocar mais de uma camada com gates diferentes (ex.: schema + handler + teste) OU contiver mais de um gatilho de risco da `change-risk-scale.md` (ex.: um judgment call reversível nível 4 misturado com uma mudança de chave de partição nível 5). Só permanece como item guarda-chuva quando o diff for atomicamente revisável — uma mudança que não faz sentido dividida em partes menores sem perder coerência de revisão — e nesse caso a linha `DoD:` lista cada subparte reconhecível e o gate que ela satisfez, nunca uma única linha genérica cobrindo um diff heterogêneo grande.

## Gate por nível de risco (`change-risk-scale.md`)

| Nível | Gate mínimo antes de marcar o item `completed` |
|---|---|
| 1-2 (cosmético/mecânico) | `npm run typecheck` (não é file-scoped neste repo — rodar o comando real do projeto) + `npm run lint` (repo-wide ou escopado ao arquivo, se a ferramenta suportar) |
| 3-4 (implementação já aprovada / judgment call reversível) | Subconjunto local das fitness functions de Tier A aplicável ao diff — não o Tier A completo de `quality-gate-tiers.md` (esse continua sendo o gate indivisível de PR): `typecheck`; `lint`; teste do módulo tocado; `check-boundaries` se import/fronteira de módulo mudou; `validate-schemas` se schema/contrato mudou; `build:lambdas` se handler/runtime mudou. **+** `logging-observability-standard.md` se o diff tocar `src/shared/observability/**`/`app-error.ts`/log novo. **+** `test-engineering-standard.md` se o diff adicionar/alterar teste automatizado |
| 5-6 (Type 1) | Tudo do nível 3-4 **+** protocolo Claude↔Codex (`AGENTS.md` §4) até nota ≥9,0 de ambos, com artefato em `docs/engineering/reviews/` ou `docs/architecture/reviews/` — o item não é `completed` enquanto o protocolo não fechar, mesmo que o código já esteja escrito |

## Classificação de risco na prática

Quem implementa classifica o nível pelo diff REAL (não pela intenção original do item), citando o gatilho concreto de `change-risk-scale.md` (ex.: "nível 5 porque criou GSI novo", não só "parece arriscado"). Reclassificar depois de ver o diff completo — um item que parecia nível 3 pode revelar um contrato novo ou fronteira de módulo nova no meio da implementação, e nesse caso o gate sobe para 5-6 antes de fechar, não depois. Em dúvida entre níveis adjacentes, usar o mais alto (mesma regra de `change-risk-scale.md` "Regra prática"). Se a ambiguidade for sobre decisão de produto/arquitetura exclusiva do Marcelo (não sobre risco técnico), aplica-se `AGENTS.md` §1, não este documento.

## Registro mínimo de evidência

Para todo item de código nível 3+, antes de marcar `completed`, registrar uma linha no formato:

```text
DoD: item=<nome curto>; risco=<nível + gatilho da change-risk-scale.md>; evidência=<comandos/rubricas e resultado>; lacunas=<nenhuma | pendência explícita>
```

Onde registrar, em ordem de preferência (persistência em arquivo sempre que houver uma disponível — mesma convenção de `decisions-log.md`/`session-log.md` de não depender de transcript de conversa): (1) mensagem de commit, quando o item corresponder a um commit real; (2) artefato de revisão em `reviews/` citando o arquivo real (não só "protocolo rodado"), quando o nível exigir protocolo Claude↔Codex; (3) corpo da resposta da sessão, só quando nenhuma das duas anteriores existir para aquele item (ex.: item nível 3-4 que não fecha com commit imediato). Não é necessário anexar log completo de comando verde — a linha em si já é a trilha auditável mínima; comando não executado, resultado vermelho, ou evidência parcial impedem `completed` (o item permanece `in_progress` ou volta para `pending` com o achado registrado), salvo reclassificação explícita como pendência conhecida.

Nível 1-2 não exige a linha formal (custo desproporcional ao risco, `principles.md` #1) — os comandos ainda rodam, só não geram registro textual obrigatório.

## Exemplos concretos deste projeto

**Nível 3-4** — "adicionar um novo teste adversarial cobrindo DELETING para um writer já fenced" (padrão real dos chunks W3-07, ex. D-068 a D-080): implementação de decisão já aprovada, sem novo contrato/chave. Gate: `npm run typecheck` + `npm run lint` + rodar o arquivo de teste específico + conferir contra `test-engineering-standard.md` (o teste é adversarial, precisa satisfazer os gates binários G-V1..G-V6 aplicáveis). Evidência: `DoD: item=teste DELETING para ItemWatchService.addWatcher; risco=3 (implementação de padrão já aprovado em D-068); evidência=npm run typecheck PASS, npm run lint PASS, vitest run test/unit/expiration/item-watch-service.test.ts PASS (3 novos casos); lacunas=nenhuma`.

**Nível 5-6** — "definir o physical model de `Organization`/`Membership`/GSI `MembershipByUser`" (Wave B2B-1 do Multi-User B2B): novo access pattern, nova chave de GSI. Gate: tudo do nível 3-4 (quando o código existir) **+** protocolo Claude↔Codex completo até ≥9,0/9,0, com o artefato da rodada citado na evidência. Evidência: `DoD: item=Wave B2B-1 physical model; risco=5 (novo GSI/access pattern, change-risk-scale.md nível 5); evidência=protocolo Claude↔Codex 3 rodadas, nota final Claude 9,2/Codex 9,2, artefato em docs/architecture/reviews/...; lacunas=nenhuma`.

## O que isso NÃO é

- Não substitui `quality-gate-tiers.md` — aquele continua sendo o gate indivisível de PR/deploy/gate de engenharia (G1-G8), rodado sobre o repositório inteiro. Este é um gate ADICIONAL, mais granular, no nível do item de trabalho dentro da sessão, para pegar drift antes de acumular numa PR inteira.
- Não exige Tier B/C (integração real contra serviços/sandbox AWS) por item — isso continua reservado para milestone/gate de engenharia, salvo o item ser especificamente sobre isso.
- Não transforma todo item cosmético numa rodada Claude↔Codex — a tabela acima escala o custo do gate ao risco real do item (`principles.md` #1, proporcionalidade).
- Itens read-only (inventário, pesquisa, leitura de código, planejamento) não passam por este gate — não há diff para avaliar contra padrão nenhum.
- Não é um mecanismo automatizado (sem lint/CI/hook dedicado) — é uma disciplina que o próprio agente aplica antes de fechar o item, com a linha de evidência como trilha auditável mínima e proporcional. Automação real (ex.: hook que bloqueia `completed` sem a linha `DoD:`) fica para se/quando houver evidência de que a disciplina manual não está sendo seguida — mesmo princípio de `principles.md` #1 (não adicionar mecanismo antes de evidência do caso simples não bastar).

## Aplicação prática (TodoWrite)

Um item só vira `completed` depois do gate do seu nível já ter rodado, passado, e (nível 3+) da linha `DoD:` estar registrada. Se o gate falhar, o item permanece `in_progress` (ou volta para `pending` com o achado registrado) — nunca marcar `completed` de forma otimista para "corrigir depois".
