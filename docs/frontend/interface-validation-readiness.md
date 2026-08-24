---
status: DRAFT — RODADA A (Claude), aguardando revisão adversarial Codex
owner: Marcelo
authority: insumo para User Validation (próxima etapa) — não normativo de identidade visual
---

# Expiration Tracker — Validation Readiness + Product Focus Hardening

Oitava etapa do planejamento de interface. Objeto: reduzir os últimos riscos conhecidos que
poderiam contaminar a leitura de User Validation, formalizar os gates de produção mais
importantes, e preparar um protótipo genuinamente adequado para ser colocado diante de
participantes reais — sem reabrir nenhuma etapa já `APPROVED` (esta é uma tarefa de hardening, não
de redesign).

---

## 1. Executive Summary

Esta etapa executou 8 workstreams: (A) separação Participant Mode / Evaluator Mode no protótipo
executável; (B) simulação correta de `GTR-01` (identidade do solicitante) no guest flow; (C)
cenário determinístico de densidade de dados (155 vencimentos/38 fornecedores/95
requisitos/21 solicitações) e correção de um achado real que ele expôs (ordenação por urgência
ausente); (D) reavaliação e **resolução** de `CREATE-IDEMPOTENCY-01` no backend real (não só no
protótipo); (E) formalização da tese de validação de produto; (F) definição de métricas enxutas de
User Validation; (G) formalização de `docs/frontend/interface-quality-standard.md` (não existia
como arquivo, já era usado desde a primeira etapa); (H) matriz de gates de produto/engenharia por
estágio (User Validation → Pilot → Paid Pilot → Public Production).

Nenhum blocker foi silenciosamente removido ou marcado como resolvido por simulação. `BLOCKER-A`,
`BLOCKER-B`, `BLOCKER-C` continuam reais e não resolvidos (apenas `GTR-01` ganhou simulação
correta em Participant Mode, e `CREATE-IDEMPOTENCY-01` foi genuinamente resolvido no backend, não
simulado). `BLOCKER-C` não recebeu decisão — apenas a análise consolidada foi atualizada (§22).

## 2. Scope

Dentro do escopo: as 8 workstreams acima, aplicadas ao protótipo executável (`prototype/`) e, no
caso específico de `CREATE-IDEMPOTENCY-01`, ao backend real (`src/modules/expiration/`). Fora do
escopo, explicitamente: reabertura de Context Model, Critical Tasks, dual-anchor IA, Journey
structure, Screen + State Inventory, as 17 Interaction Surfaces, Low-Fi architecture, Epistemic
Integrity, guest isolation, anti-enumeração, decisão do Full BFF (D-053/D-054); User Validation
Planning (roteiro de entrevista, recrutamento, agendamento, execução de sessão) — fica para a
próxima etapa.

## 3. Baseline

```
Branch: feat/frontend-validation-readiness (a partir de develop)
Baseline commit avaliado: a06b84f (docs: corrige drift de contexto - session-log e README de
  arquitetura desatualizados)
git status no início: limpo (working tree clean)
npm run check-docs no início: PASS (193 arquivos, sem link quebrado)
```

## 4. Inputs

`AGENTS.md` (processo, protocolo Claude↔Codex, convenções de código real), `docs/frontend/README.md`
(estado consolidado das 7 etapas anteriores), `NEXT_SESSION_PROMPT.md`,
`interface-heuristic-accessibility-evaluation.md` (etapa imediatamente anterior — achados,
Quality Score, Final Status), `interface-critical-user-journeys.md` §37 (decision brief original
de `BLOCKER-C`), `interface-conceptual-model-and-information-architecture.md` §37/§44 (decision
brief e Epistemic Integrity), código real de `src/modules/expiration/` e `src/shared/idempotency/`.

## 5. Why This Stage Exists

Uma revisão externa consolidada identificou que a maturidade de modelagem de interface/produto
ultrapassou a maturidade de implementação em produção — aceitável, mas exige cuidado antes da
próxima fonte de evidência ser comportamento humano real. A pergunta orientadora: **não estamos
levando aos usuários problemas que já conhecemos e que deveriam ser corrigidos ou isolados antes
do teste?** As oito workstreams respondem, cada uma, a um risco concreto dessa lista: contaminação
do participante, confiança do guest, densidade de dados, semântica insegura de criação,
ambiguidade de posicionamento de produto, drift do padrão de qualidade, e ambiguidade de gates de
produção.

## 6. Participant vs Evaluator Mode

O Interaction Prototype servia, até esta etapa, simultaneamente como artefato de produto e como
artefato de auditoria técnica — útil para engenharia, mas capaz de contaminar User Validation (um
participante vendo `[BLOQUEADO: BLOCKER-A]` reage a um rótulo de debug, não à experiência
pretendida). Implementado um modo de runtime único, detectado uma vez no boot via query parameter:

```js
var MODE = new URLSearchParams(location.search).get('mode') === 'evaluator' ? 'evaluator' : 'participant';
```

**Participant Mode é o default** (ausência do parâmetro, ou qualquer valor diferente de
`evaluator`) — decisão deliberada de fail-safe: um link de sessão entregue a um participante real
nunca vaza anotações técnicas só porque alguém esqueceu de anexar um parâmetro. `?mode=evaluator`
ativa o modo de engenharia explicitamente. Isolamento verificado programaticamente (não apenas por
inspeção visual): varredura de 15 superfícies + 5 fluxos de feedback dinâmico (salvar alerta,
simular fornecedor, variantes de submission review) em Participant Mode, zero ocorrências de
`BLOQUEADO`, `BLOCKER-A/B/C`, `GTR-01`, `CREATE-IDEMPOTENCY`, `SIMULADO PARA VALIDAR`,
`PROTOTYPE-ONLY`, `EMPTY_TRUE`/`EMPTY_FILTERED`, `DESIGN REQUIRED`/`IMPLEMENTATION BLOCKED`,
`anti-enumeração`, `backend` em texto renderizado ou em anúncios de região `aria-live` (ver §27).

## 7. Participant Mode Rules

- Nenhum Scenario ID, controle de cenário, ou barra de controle (`#control-bar`) — removidos do
  DOM por completo no boot (não apenas ocultos via CSS), para não vazarem via view-source,
  devtools, ou leitura de landmark por leitor de tela.
- `#banner` ("PROTOTYPE ONLY...") também removido — se/como comunicar ao participante que está
  testando um protótipo é decisão de consentimento informado do facilitador (`User Validation
  Planning`, próxima etapa), não algo que o próprio software deve anunciar em runtime.
- Nenhuma anotação técnica de estado (`(EMPTY_TRUE)`, `(EMPTY_FILTERED)`, notas de a11y do
  `shell()`) — substância mantida (a frase em si já é copy válida), só o rótulo interno é
  removido.
- `SURF-012` (Submission Review, branch point de `BLOCKER-C`) nunca mostra a tela seletora de
  variante a um participante — internamente é um artefato de exploração de design, não algo que um
  usuário real encontraria. O caminho normal (a partir do detalhe da solicitação) leva direto à
  Variante B (revisão humana — hipótese líder para v1, §22), apresentada como o funcionamento
  normal do produto. A Variante A continua alcançável por Scenario ID próprio
  (`PROTO-J06-A`) para uma rodada comparativa futura, nunca como escolha visível ao participante
  (§62 do prompt-fonte: preservar os dois cenários separadamente, nunca como decisão do
  participante).
- Blockers continuam comunicados, em linguagem sem jargão — ver §9 do prompt-fonte e a distinção
  detalhada em §8 abaixo.
- **Exceção documentada, decisão deliberada (não um esquecimento)**: rótulos entre colchetes tipo
  `[PENDENTE]`, `[VINCULADO A UM VENCIMENTO]`, `[RENOVADO]`, `[ALERTA CONFIGURADO]` **permanecem
  visíveis em ambos os modos**. Estes não são anotações de engenharia no sentido que esta etapa
  proíbe (nomes de rota, Scenario IDs, tags `BLOCKER-x`) — são uma convenção de fidelidade de
  wireframe estabelecida desde `interface-low-fidelity-wireframes.md` (junto de `[PRIMARY]`/
  `⚠[DANGEROUS]`), preservada deliberadamente em toda etapa desde então precisamente para não
  reabrir a decisão de Epistemic Integrity da Conceptual Model (`SATISFIED` nunca vira "Em dia",
  `[VINCULADO A UM VENCIMENTO]` nunca vira "Aprovado") sob pressão de polimento visual. Reescrever
  esses rótulos em prosa mais "natural" é trabalho de identidade visual real (crachás/ícones
  coloridos substituindo texto em colchetes) — pertence à etapa de Visual Language/High-Fidelity
  UI, não a este hardening. Risco residual aceito: um participante pode achar `[COLCHETES]`
  visualmente "não polido"; isto não é o mesmo risco que a missão desta etapa existe para
  eliminar (vazamento de informação técnica capaz de enviesar a leitura do teste), e por isso não
  foi tratado como um achado desta etapa.

## 8. Evaluator Mode Rules

Evaluator Mode preserva **exatamente** o comportamento e o texto que já existiam antes desta
etapa — Scenario IDs, barra de controle, `[BLOQUEADO: BLOCKER-x]`/`GTR-01`, anotações de estado,
notas de a11y, controles internos/debug, anotações de capacidade de backend. Nenhuma regressão:
verificado que `/items/item-3` ainda mostra `[BLOQUEADO: BLOCKER-A]` e que `/guest/tok-valid`
ainda mostra o disclaimer explícito de `GTR-01` **junto com** a identidade simulada — não um
lugar ou outro. Isso é deliberado: remover a evidência técnica de Evaluator Mode destruiria o
valor de auditoria que fez as 7 etapas anteriores (heurística, acessibilidade, achados reais)
funcionarem; ocultar anotações não é o objetivo em si, é meio para um fim (não contaminar
Participant Mode).

`blockedBlock(tag, evaluatorText, participantText)` é o mecanismo central: o texto do engenheiro
(com o tag/colchete) e o texto do participante (mesma substância, sem jargão) são escritos e
mantidos juntos, no mesmo call site — nunca um "esconder e torcer para a substância sobreviver".
Todos os 12 call sites de `blockedBlock` no arquivo têm ambos os textos.

## 9. GTR-01 Validation Simulation

`GTR-01` (nenhuma rota expõe a identidade da organização requisitante ao fornecedor externo) é o
único blocker que recebeu tratamento de simulação completa nesta etapa, por instrução explícita da
missão (Workstream B) — não gastar participantes redescobrindo uma lacuna já confirmada. Ambos os
modos agora mostram:

```
Solicitado por: Empresa Alfa Ltda.
```

na página do guest (`/guest/:token`), derivado de um novo campo `requesterOrgName` nos registros
de `DB.guestTokens` — dado simulado, fixo por token, nunca por uma rota real. Em Evaluator Mode,
um `a11y-note` adicional (visível só nesse modo) documenta explicitamente: *"GTR-01: identidade do
solicitante é SIMULADA nesta etapa (...). Nenhuma rota real deriva isso hoje por
tenant/solicitação — não tratar como resolvido tecnicamente."* Em Participant Mode, essa mesma
informação aparece sem nenhum comentário meta — exatamente o que um guest real veria se `GTR-01`
estivesse corrigido, que é o próprio objetivo da simulação.

**`GTR-01` permanece um gap de backend real, não resolvido tecnicamente** — ver §20 (matriz de
gates: `SIMULATABLE` para User Validation, `REQUIRED` a partir de Pilot).

## 10. Guest Trust Readiness

Com `GTR-01` simulado, o guest flow agora suporta as perguntas de confiança que a próxima etapa
(User Validation) precisa fazer, sem que a resposta seja trivialmente "não sei quem está pedindo":

- O usuário reconhece quem está pedindo? (agora testável — antes não havia nada a reconhecer)
- Confia suficientemente para continuar?
- Entende o documento solicitado e o prazo? (já suportado antes desta etapa — `Documento
  solicitado`/`Prazo` sempre estiveram presentes)
- Entende o resultado do envio? (já suportado — `Envio recebido pelo seu navegador`, distinto de
  "verificado")

`Guest verification visibility gap` (o guest não vê se o arquivo passou por verificação de
segurança) **permanece intencionalmente sem simulação de capacidade** (§16 do prompt-fonte: não
inventar que o guest pode consultar `Document.CLEAN`). O texto plain-language em Participant Mode
("Não é possível ver aqui se o arquivo já passou por alguma verificação") preserva exatamente essa
fronteira — este é um caso em que a *limitação em si* é o que deve ser testado, não algo a
esconder.

## 11. Data Density Stress Scenario

Novo Prototype Scenario ID `PROTO-STRESS-DENSITY-01` (grupo `STRESS` na barra de controle,
Evaluator Mode apenas — este cenário é uma ferramenta de avaliação interna nesta rodada, não uma
tarefa da primeira rodada de User Validation, ver §15/§38). `seedDensityStress()` (`app.js`) gera,
de forma determinística (ciclos por módulo sobre arrays fixos, nunca `Math.random`), camadas sobre
o seed pequeno original:

```
155 vencimentos totais: 24 vencidos, 29 vencendo em 7 dias, 35 entre 8-30 dias,
  35 depois de 30 dias, 15 arquivados, 15 renovados
38 fornecedores, 95 requisitos (60% MISSING / 40% SATISFIED — backlog realista,
  não um dataset artificialmente limpo)
21 solicitações externas ativas (REQUESTED/OPENED/SUBMITTED)
```

Distribuição deliberadamente heterogênea (6 categorias, 6 responsáveis, múltiplos fornecedores e
estados de requisito) — não 155 itens idênticos.

## 12. Stress Scenario Findings

**Achado real, não hipótese**: os grupos "VENCIDOS"/"VENCE EM BREVE" da Overview (`SURF-001`) e a
lista da Expiration Collection (`SURF-002`) eram renderizados em **ordem de inserção**, não por
urgência — invisível no seed original de 5 itens (a ordem "certa" e a ordem "de inserção"
coincidiam por acidente), um problema de scanning real a partir de dezenas de itens: o vencimento
mais atrasado podia aparecer abaixo de um menos urgente. **Corrigido nesta etapa** — ambas as
listas agora ordenam por `dueDate` ascendente antes de renderizar (mais urgente primeiro),
verificado em navegador antes/depois da correção (§27).

Demais perguntas do prompt-fonte (§23), avaliadas com o dataset de 155 itens:

- **Atenção continua clara?** Sim, após a correção de ordenação — os cabeçalhos `VENCIDOS (24)`/
  `VENCE EM BREVE (29)` com contagem continuam no topo, texto nunca só cor.
- **Grouping funciona?** Sim, estruturalmente (dois grupos, cada um sua `<ul>`) — mas com 24+29=53
  linhas na Overview e mais 155 na Collection, não há sub-agrupamento por responsável/categoria.
- **Scanning é aceitável?** Aceitável para os grupos de urgência real (VENCIDOS/VENCE EM BREVE,
  tipicamente menores); a Expiration Collection completa (155 linhas, sem paginação real — já
  registrado como limitação do protótipo em `interface-heuristic-accessibility-evaluation.md`
  §41) fica pesada de rolar. Isto é uma limitação estrutural do protótipo em baixa fidelidade, não
  necessariamente do produto final.
- **Ações continuam encontráveis?** Sim — o botão "Abrir" por linha não competiu visualmente com o
  volume nos testes realizados.
- **Informação secundária compete com urgência?** Não identificado como problema novo; a
  hierarquia primária (nome + status)/secundária (data/responsável) já testada em
  `interface-low-fidelity-wireframes.md` se manteve legível.
- **Filtros/ordenação atuais são suficientes?** **Não completamente** — os filtros de status
  (Todos/Vencidos/Vencendo/Ativos/Arquivados) existem, mas não há filtro por responsável,
  categoria ou fornecedor, nem controle de ordenação exposto ao usuário (a ordenação por data
  agora é o padrão fixo, não uma escolha).
- **Contexto se perde?** Não observado — cada linha carrega nome/status/data/responsável
  suficientes para identificação sem navegar.
- **Collection structure escala conceitualmente?** Com ressalvas — a estrutura de lista simples
  escala até algumas dezenas de itens por grupo; acima disso, filtro por responsável/categoria e
  paginação real deixam de ser "nice to have" e passam a ser prováveis necessidades. Registrado
  como hipótese, não implementado (§13 abaixo).

**HYPOTHESIS / FUTURE UX NEED** (não implementado, por instrução explícita de não introduzir
feature creep, §24 do prompt-fonte): filtro por responsável/categoria/fornecedor na Expiration
Collection; paginação real; alguma forma de "saved view" para operadores com portfólios grandes.
Nenhum destes corrige uma falha real em journey crítica hoje (o dataset de produção real de um
cliente pequeno, per a tese de validação em §15, provavelmente começa bem abaixo de 155 itens) —
candidatos a validar com dados reais de uso, não a construir preventivamente.

## 13. CREATE-IDEMPOTENCY-01 Reassessment

Reverificado diretamente no código atual (não apenas nos documentos anteriores que registraram o
achado original). Confirmado real antes desta etapa:

- `src/modules/expiration/application/expiration-service.ts` (`createItem`, antes da correção):
  gerava `itemId` incondicionalmente, nunca consultava o `IdempotencyStore` já injetado na classe
  (usado por `renewItem` desde M2). Nenhum header `idempotency-key` lido no handler HTTP
  (`item-handlers.ts`, `handleCreateItem`).
- `renewItem` (mesmo arquivo) já é idempotente desde M2: `key = idempotencyKey ?? \`${itemId}|
  ${expectedVersion}|${cycle}\``, `begin()`/`complete()` via `IdempotencyStore`, header
  `idempotency-key` opcional lido em `handleRenewItem`.
- `import.reserveImport` usa o mesmo `IdempotencyStore`, com chave **obrigatória** (não opcional).
- Teste dedicado de idempotência existia para `renewItem`
  (`test/unit/expiration/expiration-service.test.ts`); **zero** teste equivalente para
  `createItem`.

**Classificação formal**:

```
CREATE-IDEMPOTENCY-01
Classification: PRODUCTION GATE (era: achado registrado, nunca formalmente classificado)
```

## 14. CREATE-IDEMPOTENCY-01 Resolution

Corrigido nesta etapa, no backend real (`src/modules/expiration/`), não apenas no protótipo —
avaliado como seguro per §28 do prompt-fonte: não reabre arquitetura, não altera contrato de forma
incompatível, reutiliza o padrão já existente (`IdempotencyStore`, o mesmo mecanismo de
`renewItem`/`import`), escopo baixo, testável.

**Decisão de design**: `idempotencyKey` **opcional** (padrão de `renewItem`, não o obrigatório de
`import`) — diferente de `renewItem`, a criação não tem um `expectedVersion`/`cycle` natural para
compor uma chave de fallback determinística quando o header está ausente; a alternativa seria
tornar o header obrigatório (padrão de `import`), o que quebraria qualquer chamador existente que
não o enviasse. Om opcional preserva 100% de compatibilidade retroativa: sem o header, o
comportamento é idêntico ao de antes (nenhuma proteção, como sempre foi); com o header, a mesma
proteção `begin()`/`complete()` de `renewItem` se aplica.

```ts
async createItem(ctx: RequestContext, input: CreateItemInput, idempotencyKey?: string): Promise<ExpirationItem>
```

`requestHash` construído a partir dos campos do payload (`name|category|dueDate|description|...`,
mesmo estilo de junção usado por `document-service.ts`/`import-service.ts` — sem biblioteca de
hash, consistente com o resto do código-base). Reaproveitando `ConcurrentOperationError` já
existente em `IdempotencyStore`, sem mecanismo novo (§29 do prompt-fonte).

**Testes adicionados** (`test/unit/expiration/expiration-service.test.ts`), cobrindo a lista do
§30 do prompt-fonte:

| Requisito do §30 | Teste |
|---|---|
| First request succeeds / same key reconcilia | `createItem` com a mesma chave e payload duas vezes → mesmo `itemId`, 1 item no store |
| Duplicate item not created | idem — `store.allItems()` filtrado por `ExpirationItem` tem `toHaveLength(1)` |
| Different key can create distinct item | chaves `key-a`/`key-b`, mesmo payload → itens diferentes |
| Payload mismatch behavior | mesma chave, payload diferente → `ConcurrentOperationError` (não aceito silenciosamente, não confundido com sucesso) |
| Tenant isolation | mesma chave, dois tenants → itens independentes, sem colisão |
| Timeout/retry path is safe | coberto pelo mesmo teste de "same key" — é exatamente o cenário de retry pós-timeout |
| Backward compatibility (sem key) | duas chamadas idênticas sem `idempotencyKey` → dois itens distintos (comportamento pré-existente preservado) |

Um 6º teste foi adicionado na Rodada C (§26, achado #2 de Codex), documentando explicitamente o
caso de crash entre `commit()` e `idempotency.complete()` — comportamento seguro (nunca duplica),
herdado do mecanismo compartilhado com `renewItem`, não uma lacuna introduzida aqui.

`npm run typecheck`/`npm run lint`/`npm test` (532 testes na Rodada A, 533 após a Rodada C) — todos verdes após a
mudança (§27).

## 15. Product Validation Thesis

```
PRODUCT VALIDATION HYPOTHESIS (não é fato comprovado — é a tese a validar na primeira rodada)

Expiration Tracker como ferramenta enxuta de controle de vencimentos + compliance documental
leve de terceiros ("Fornecedor"/TrackedSubject).

Organizações pequenas precisam de uma forma leve de rastrear vencimentos, cobrar documentos
recorrentes de terceiros, e saber o que exige atenção sem depender de planilha, cobrança por
e-mail avulsa e memória.
```

Esta tese preserva `TrackedSubject` como conceito **horizontal** (não é redesign de schema) —
"Fornecedor" continua um *working label* de interface para o caso de uso mais forte hoje
(compliance documental de terceiros), não uma verticalização do domínio para "produto exclusivo
para fornecedores". Nenhuma decisão comercial de verticalização foi tomada nesta etapa; essa
continua sendo uma decisão do Marcelo, não implícita nesta tese de validação.

## 16. Alternative Thesis

```
Tese alternativa (registrada, não perseguida na primeira rodada):

"Expiration Tracker genérico" — rastreamento de vencimentos sem ênfase particular em
compliance de terceiros (ex.: lembretes pessoais, contratos, certificados, assinaturas,
licenças, todos com peso equivalente).
```

**Razão para não perseguir as duas na mesma primeira rodada** (§38 do prompt-fonte): misturar
lembretes pessoais, compliance de fornecedor, contratos, certificados e assinaturas no mesmo teste
dilui a leitura — a primeira rodada de User Validation precisa produzir um sinal claro sobre uma
hipótese específica, não uma leitura ambígua sobre várias ao mesmo tempo. Se a tese primária (§15)
não confirmar tração, a tese alternativa fica disponível para uma segunda rodada, não descartada.

## 17. Validation Metrics

Métricas enxutas, não um programa de analytics:

- **Task Completion** — por tarefa: `SUCCESS` (completou sem intervenção do moderador e sem erro
  crítico) / `PARTIAL` (completou, mas com erro crítico ou intervenção) / `FAILURE` (não
  completou). Critério objetivo por tarefa a ser definido em `User Validation Planning`
  (próxima etapa), não aqui — cada tarefa candidata (§23) precisa de seu próprio critério de
  sucesso, que depende do roteiro de entrevista ainda não escrito.
- **Critical Error Count** — muda objeto errado; produz consequência indevida; leva a
  interpretação falsa (ex.: acha que um alerta *será* entregue, ou que um documento foi
  *verificado*); impede conclusão da tarefa; exige intervenção do moderador.
- **Hesitation** — momentos de dúvida relevante, por julgamento do observador — não uma métrica de
  cada pausa de 2 segundos.
- **Backtracking** — entra → não entende → volta → tenta outro caminho — especialmente relevante
  em `J-02` (criação), `J-03` (renovação) e `J-06`/`J-07` (coleta externa/guest).
- **State Comprehension** — pergunta pós-ação-chave: *"o que você acha que aconteceu agora?"* —
  essencial após upload, renovação, solicitação, `UNKNOWN_OUTCOME`, e o envio do guest.
- **Trust / Confidence** — especialmente no guest: *"Você enviaria esse documento? Por quê? Para
  quem você acha que ele será enviado? O que você acredita que aconteceu após o envio?"* — agora
  testável de forma não-trivial graças à simulação de `GTR-01` (§9).
- **Time to First Value** — conceitual, não estatístico nesta rodada: do início até o primeiro
  vencimento rastreado com sucesso — objetivo é identificar fricção de ativação, não produzir um
  KPI.

## 18. Time-to-First-Value

**Correção desta rodada (achado real da Rodada B, §26)**: a versão original desta seção descrevia
o estado inicial como "Overview vazia ou tela de boas-vindas" — nenhum dos dois existe no
protótipo real. O estado inicial observável de fato, em ambos os modos, é a Overview já com o
seed padrão (5 vencimentos pré-existentes, nenhuma tela de boas-vindas/onboarding desenhada ainda
nesta etapa):

```
start (carregamento da página — Overview com o seed padrão, 5 vencimentos já existentes,
  não um estado vazio)
  ↓
primeiro vencimento NOVO cadastrado com sucesso (J-02, tarefa "Cadastre um novo vencimento")
```

Isto significa que a métrica desta primeira rodada não é uma "ativação a partir de zero dados"
genuína (o participante nunca vê uma conta realmente vazia) — é o tempo/fricção para completar a
tarefa de criação a partir de uma Overview já povoada. Tratado conceitualmente nesta etapa
(nenhuma instrumentação/analytics real) — o objetivo em `User Validation Planning` é observar
quantos passos, quanta hesitação e quanto backtracking ocorrem até esse primeiro sucesso, não medir
tempo em segundos com precisão estatística. Um verdadeiro cold-start (conta nova, zero dados) fica
como candidato de instrumentação para uma etapa de Visual Design/Onboarding futura, não construído
aqui.

## 19. Interface Quality Standard Status

`docs/frontend/interface-quality-standard.md` **não existia como arquivo formal antes desta
etapa** — confirmado por sua ausência e pelas 3 referências anteriores que já citavam "eixos do
prompt-fonte" sem um arquivo para apontar (`interface-conceptual-model-and-information-
architecture.md` §43, `interface-heuristic-accessibility-evaluation.md` §45,
`docs/frontend/README.md`). Criado nesta etapa (Workstream G) consolidando exatamente o padrão já
em uso — 12 eixos, modelo de severidade S0-S4, quality gates, threshold `Overall ≥ 9.0` (a mesma
nota mínima de `AGENTS.md` §4, não um número novo), Epistemic Integrity, alvo WCAG 2.2 AA,
expectativas de evidência, tratamento de `N/A` por fidelidade — **nenhuma reavaliação das 7 etapas
anteriores foi feita** (§52 do prompt-fonte: formalizar não é reavaliar). Ver
`docs/frontend/interface-quality-standard.md`.

## 20. Product/Engineering Gate Matrix

| Dependency | User Validation | Pilot | Paid Pilot | Public Production |
|---|---|---|---|---|
| Full BFF (D-053/D-054) | NOT BLOCKING | REQUIRED | REQUIRED | CRITICAL |
| BLOCKER-A (leitura de documento) | SIMULATABLE | REQUIRED | REQUIRED | CRITICAL |
| BLOCKER-B (materialização de lembrete) | SIMULATABLE | REQUIRED | CRITICAL | CRITICAL |
| BLOCKER-C (fechamento de coleta externa) | SIMULATABLE | REQUIRED | REQUIRED | CRITICAL |
| GTR-01 (identidade do solicitante) | SIMULATABLE | REQUIRED | REQUIRED | CRITICAL |
| CREATE-IDEMPOTENCY-01 | NOT BLOCKING | REQUIRED | REQUIRED | CRITICAL |
| Guest verification visibility gap | NOT BLOCKING | NOT BLOCKING | NOT BLOCKING | NOT BLOCKING |
| Operational Architecture approval | NOT BLOCKING | REQUIRED | REQUIRED | CRITICAL |

Notas de classificação (nem todo dependency é igualmente bloqueante, §55 do prompt-fonte):

- **BLOCKER-B elevado a `CRITICAL` já em Paid Pilot**, não apenas em produção pública — ver §21
  para o raciocínio de domínio: prometer lembrete e não entregá-lo silenciosamente é pior do que
  não ter a funcionalidade, e cobrar por isso agrava o risco. Já classificado `REQUIRED` (não
  `NOT BLOCKING`) mesmo num Pilot não-pago, porque rodar um piloto gratuito prometendo lembretes
  que não disparam de verdade quebra a confiança do próprio piloto sem necessidade — o custo de
  não resolver antes de qualquer piloto real é maior que o custo de resolver.
- **`CREATE-IDEMPOTENCY-01` está resolvido no backend (§14), mas ainda `REQUIRED` para Pilot** —
  a proteção só existe se um cliente HTTP real enviar o header `idempotency-key`; como não existe
  ainda um frontend real (Full BFF não implementado), nenhum cliente envia esse header hoje. A
  capacidade existe; o uso dela ainda não.
- **`Guest verification visibility gap` é `NOT BLOCKING` em todas as colunas** — diferente dos
  demais, esta pode ser uma fronteira de produto permanente e legítima (muitos produtos reais não
  expõem resultado interno de verificação de segurança ao remetente externo), não necessariamente
  um defeito a corrigir antes de produção. Recomendação: reavaliar só se User Validation ou um
  Pilot real revelarem confusão/carga de suporte real — não presumir a necessidade agora.
- **`Operational Architecture approval`** (`docs/architecture/README.md`: "Operational
  architecture: NOT APPROVED") é `NOT BLOCKING` para User Validation porque o protótipo é um
  artefato estático local, sem nenhuma dependência de backend implantado.

## 21. Compliance Closure Gap

`BLOCKER-A` + `BLOCKER-C` + `GTR-01` + `Guest verification visibility gap`, analisados em conjunto
(§58 do prompt-fonte), formam um macroproblema conceitual: **fechamento ponta-a-ponta de
documento/compliance externo** — hoje, um documento pode ser solicitado (`SURF-011`), enviado por
um guest (`SURF-014`), mas: (a) o operador não pode confirmar de forma automática que o documento
foi mesmo enviado ou revisá-lo sem passo manual (`BLOCKER-A`/`BLOCKER-C`); (b) o guest não sabe
quem pediu (`GTR-01`, agora simulado para teste, não resolvido); (c) nenhum dos dois lados vê o
resultado da verificação de segurança (`Guest verification visibility gap`, aceito como fronteira
permanente possível, §20). Nenhum destes IDs é substituído por este agrupamento — ele existe só
para priorização: um único investimento de engenharia (uma rota de leitura real para submissões +
fila de revisão) resolveria `BLOCKER-A` e a metade operável de `BLOCKER-C` ao mesmo tempo, o que
pode ser relevante para sequenciamento de trabalho pós-User-Validation.

## 22. BLOCKER-C Decision Brief Update

Decision brief original em `interface-critical-user-journeys.md` §37 e
`interface-conceptual-model-and-information-architecture.md` §37 (Alternativa A — fechamento
automático — vs. Alternativa B — revisão humana), classificado como `STRONG INFERENCE`, não
decisão. **Esta etapa não toma essa decisão** (§61 do prompt-fonte: não há evidência nova
suficiente para um ADR definitivo) — apenas consolida a análise:

> **Hipótese de trabalho para v1**: `CLEAN → Revisão Humana → vincular/criar vencimento
> relevante → Requisito SATISFIED` é semanticamente mais seguro que `CLEAN → SATISFIED
> automático`, dado o estado atual dos dados (`DocumentSubmission` só guarda metadados de
> arquivo, nenhuma fonte estruturada de data de validade/tipo existe para validar
> automaticamente).

Isto é consistente com o padrão de domínio já estabelecido em todo o resto do sistema (nenhuma
outra parte aprova conteúdo automaticamente) e é a razão pela qual o Participant Mode usa a
Variante B como caminho normal (§7) — não porque foi decidida, mas porque é a hipótese mais
defensável para simular como "como o produto funciona" numa primeira rodada de teste. **Pergunta
em aberto que User Validation pode ajudar a responder**: o custo operacional de revisão humana é
aceitável na prática? A Variante A permanece preservada como cenário separado
(`PROTO-J06-A`) para uma eventual rodada comparativa futura (§62 do prompt-fonte), não removida.

**Esclarecimento explícito adicionado na Rodada C (achado real da Rodada B, §26)**: existe uma
tensão genuína entre "não decidir `BLOCKER-C`" e "escolher uma variante concreta para o
Participant Mode mostrar" — um teste de usabilidade não consegue apresentar um conceito
abstrato/indeciso a um participante; alguma experiência concreta única precisa existir na sessão.
A escolha da Variante B como o que o Participant Mode mostra é uma **decisão de construção de
teste** (nenhum teste de usabilidade consegue rodar sem escolher uma experiência concreta para
mostrar), não uma **decisão de produto** sobre `BLOCKER-C` — as duas coisas são categorias
diferentes e não devem ser confundidas. A decisão de produto (qual variante o Expiration Tracker
real implementará) continua tão aberta quanto antes desta etapa; o que mudou é apenas qual
variante é mais barata/coerente de simular para uma primeira leitura de usuário, dado que alguma
tinha que ser escolhida para a sessão funcionar. Se User Validation ou uma decisão comercial
posterior apontarem para a Variante A, nada nesta etapa impede essa mudança — não haveria dado
"perdido" nem inconsistência a reconciliar, porque a Variante A nunca deixou de existir como
Prototype Scenario ID completo.

## 23. User Validation Constraints

Tarefas candidatas (derivadas de outcomes, sem instruir onde clicar — herdadas de
`interface-heuristic-accessibility-evaluation.md` §42, ainda válidas):

```
"Descubra o que precisa da sua atenção hoje."
"Cadastre um novo vencimento."
"Renove o certificado que está próximo do vencimento."
"Envie o documento solicitado usando o link que você recebeu." (External Submitter, agora com
  identidade do solicitante visível — GTR-01 simulado)
"Solicite um documento a um fornecedor." (J-06, agora até uma conclusão coerente — Variante B
  como caminho normal, sem branch point exposto)
```

Limitações a comunicar ao facilitador antes da sessão (consolidado com §41 da etapa anterior +
achados novos desta etapa): a barra de controle e o banner PROTOTYPE-ONLY não existem mais em
Participant Mode (nada a explicar); `BLOCKER-A`/`BLOCKER-B` continuam terminando de forma
honestamente incompleta — reação esperada do participante, não erro de teste; `GTR-01` está
simulado, não implementado — se um participante perguntar "isso é real?", a resposta do
facilitador é fora do escopo deste documento (decisão de `User Validation Planning`); o cenário de
densidade (`PROTO-STRESS-DENSITY-01`) **não é uma tarefa candidata desta primeira rodada** — é uma
ferramenta de avaliação interna (§11), a tese de validação (§15) recomenda um teste focado, não
diluído por volume de dados que provavelmente excede o dataset real de um cliente pequeno na
ativação inicial.

## 24. Remaining Known Limitations

- Filtro por responsável/categoria/fornecedor e paginação real na Expiration Collection — `FUTURE
  UX NEED`, não implementado (§12).
- `Guest verification visibility gap` pode ser uma fronteira permanente de produto, não uma
  lacuna a fechar — recomendação de reavaliar só com evidência de Pilot real (§20).
- `CREATE-IDEMPOTENCY-01` resolvido no backend, mas sem nenhum cliente real que envie o header
  ainda (Full BFF não implementado) — a proteção existe, seu uso ainda não (§14/§20).
- `BLOCKER-C` permanece sem decisão de produto — Participant Mode simula a hipótese mais provável
  (Variante B), não uma decisão (§22).
- Teste real com leitor de tela não realizado nesta etapa (mesma limitação já registrada em
  `interface-heuristic-accessibility-evaluation.md` §41).
- Botão "Desabilitar alerta" (achado da etapa anterior, S0, não crítico) continua exigindo uma
  navegação completa para aparecer após o primeiro "Salvar" — não revisitado nesta etapa (fora do
  escopo de hardening desta rodada).

## 25. Claude↔Codex Review

Codex revisou, em sandbox read-only, o código real (`prototype/app.js`, `prototype/styles.css`,
`src/modules/expiration/application/expiration-service.ts`,
`src/modules/expiration/http/item-handlers.ts`, `src/shared/idempotency/idempotency.ts`,
`test/unit/expiration/expiration-service.test.ts`) e os dois documentos novos, contra 20 pontos
adversariais. Resultado: 16 pontos `SEM FURO`, **4 pontos com `FURO REAL`**:

| # | Achado | Evidência (antes da correção) | Severidade |
|---|---|---|---|
| 1 | Anotações técnicas vazando em Participant Mode fora dos mecanismos `blockedBlock`/`modeText`/`evalOnly`: `CONFLICT:` (2 sites, OCC de item/renovação) e `(EMPTY_NOT_READY)` (Requirement Context) | `app.js:645`, `748`, `915` (linhas pré-correção) | S2 |
| 10 | Testes de idempotência de `createItem` não cobrem o caso de crash entre `commit()` e `idempotency.complete()` — retry nesse cenário recebe `ConcurrentOperationError` em vez de reconciliar | `expiration-service.ts` (`commit()`/`complete()` não atômicos) | S2 (comportamento seguro, não duplica — mas não documentado/testado) |
| 14 | `Time to First Value` (§18) descrevia um estado inicial ("Overview vazia ou tela de boas-vindas") que não existe no protótipo real | `interface-validation-readiness.md` §18 original | S1 (documentação) |
| 18 | `BLOCKER-C` "não decidido" no texto, mas Participant Mode força a Variante B como caminho normal — tensão não explicada | `app.js` (rota `/submission-review`), §7/§22 originais | S1 (documentação/clareza, não código) |

Veredito geral de Codex (verbatim): *"4 furos reais. Severidade maior em #10 e #18. Eu não
aprovaria 'as-is'; após corrigir/qualificar #10 e #18, os demais são ajustes de
documentação/copy e não parecem invalidar User Validation Planning."* Codex também confirmou (não
como furo, mas como pendência aceitável em rascunho): `docs/frontend/README.md` e
`NEXT_SESSION_PROMPT.md` ainda não atualizados nesta rodada — obrigatório antes da aprovação final
(§28), feito em conjunto com o fechamento desta etapa.

Os 16 pontos `SEM FURO` confirmaram, entre outros: nenhuma mudança de verdade de domínio além das
simulações declaradas; `GTR-01` não tratado como resolvido tecnicamente; guest não vê resultado de
scan; anti-enumeração preservada; cenário de densidade plausível e sem product creep implementado;
classificação e implementação de `CREATE-IDEMPOTENCY-01` consistentes com o padrão de
`renewItem`; `UNKNOWN_OUTCOME` preservado nos 3 fluxos (create/renew/import); tese de produto
claramente marcada como hipótese; `interface-quality-standard.md` sem divergência dos eixos/gates/
threshold já usados; matriz de gates não subestima produção; `BLOCKER-B` corretamente não tratado
como opcional.

## 26. Reconciliation

**1. Anotações técnicas vazando (`CONFLICT:`, `(EMPTY_NOT_READY)`) — ACEITO, S2**
Raciocínio: mesma classe de bug já corrigida em `(EMPTY_TRUE)`/`(EMPTY_FILTERED)` noutros pontos
do arquivo — minha própria varredura da Rodada A não foi exaustiva o suficiente. `CONFLICT:` é
jargão de estilo HTTP/técnico em inglês, sem relação com a convenção deliberada de rótulos entre
colchetes (ver abaixo). Mudança aplicada: `CONFLICT: ` agora passa por `modeText('CONFLICT: ',
'')` nos 2 call sites (`showDetailConflict`, conflito de renovação); `(EMPTY_NOT_READY)` agora
passa por `evalOnly(...)`. Reverificado em navegador: Evaluator Mode preserva `CONFLICT:` e a tag
(regressão nula), Participant Mode não mostra nenhum dos dois.

**Achado relacionado, não levantado por Codex mas decidido nesta reconciliação — documentação da
exceção deliberada dos rótulos entre colchetes**: ao investigar #1, ficou claro que a Rodada A
nunca tinha escrito explicitamente a razão de `[PENDENTE]`/`[VINCULADO A UM VENCIMENTO]`/
`[RENOVADO]`/`[ALERTA CONFIGURADO]` permanecerem em ambos os modos — uma decisão real, tomada
durante a implementação, mas não documentada até agora. Corrigido: §7 ganhou um bullet explícito
com o raciocínio completo (convenção de fidelidade de wireframe desde
`interface-low-fidelity-wireframes.md`, preserva a decisão de Epistemic Integrity da Conceptual
Model, pertence à etapa de Visual Language, não a este hardening).

**2. Teste de idempotência não cobre crash entre `commit()` e `complete()` — ACEITO, S2, mas NÃO
corrigido no mecanismo (seria reabertura de arquitetura fora de escopo)**
Verificado tecnicamente correto: `IdempotencyStore.begin()` lança `ConcurrentOperationError` para
uma chave com o mesmo `requestHash` ainda `IN_PROGRESS` — se o processo morrer entre `commit()`
(que já criou o item) e `idempotency.complete()`, o registro fica `IN_PROGRESS` para sempre, e um
retry legítimo recebe erro em vez de ser reconciliado ao item já criado. Raciocínio: este é um
comportamento **pré-existente do mecanismo compartilhado `IdempotencyStore`**, idêntico em
`renewItem` desde M2 e em `import` desde M11 — não foi introduzido por esta mudança, é herdado ao
reutilizar fielmente o padrão já existente (exigido pelo §29 do prompt-fonte: "não crie um
terceiro mecanismo"). Corrigir a não-atomicidade exigiria redesenhar `IdempotencyStore` (ex.: um
padrão de saga/compensação, ou mover `complete()` para dentro da mesma transação), o que é
exatamente o tipo de "reabertura de arquitetura" que o §28 do prompt-fonte instrui a NÃO fazer
nesta fase de hardening — o gate do §28 ("implemente agora SE não reabrir arquitetura") não é
satisfeito aqui. **Mudança aplicada**: um teste novo (`expiration-service.test.ts`) documenta
explicitamente o comportamento atual — simula a falha via `vi.spyOn(store, 'update')
.mockRejectedValueOnce(...)`, confirma que (a) o item É criado exatamente uma vez antes da falha
simulada, e (b) o retry subsequente falha com `ConcurrentOperationError` de forma segura, **sem
nunca duplicar o item** — ou seja, o defeito original de `CREATE-IDEMPOTENCY-01` (duplicação
silenciosa) continua corrigido; o que existe é uma janela rara de indisponibilidade/necessidade de
intervenção manual, não uma regressão de segurança de dados. Registrado como limitação conhecida
compartilhada, não como pendência desta etapa.

**3. `Time to First Value` descrevia um estado inicial inexistente — ACEITO, S1**
Raciocínio: a versão original era aspiracional (assumia uma tela de boas-vindas/estado vazio que
nunca foi construído), não uma descrição do protótipo real. Mudança aplicada: §18 reescrito para
descrever o estado inicial real (Overview com o seed padrão de 5 itens, não vazio), com nota
explícita de que esta rodada mede fricção de criação a partir de uma conta já povoada, não um
cold-start genuíno — que fica como candidato de instrumentação futura.

**4. `BLOCKER-C` "não decidido" vs. Participant Mode forçando Variante B — ACEITO, S1
(clareza/documentação, não código)**
Raciocínio: o código está correto (a Variante B precisa ser escolhida como *algo* concreto para um
teste de usabilidade funcionar — nenhum teste consegue apresentar um conceito abstrato/indeciso a
um participante), mas a Rodada A não deixou explícito que "escolher o que mostrar numa sessão de
teste" e "decidir o que o produto real fará" são categorias diferentes — a ambiguidade textual era
real, mesmo o código estando certo. Mudança aplicada: §22 ganhou um parágrafo explícito
distinguindo "decisão de construção de teste" de "decisão de produto", com a garantia de que a
Variante A não foi removida nem prejudicada (continua um Prototype Scenario ID completo,
`PROTO-J06-A`) e que nada nesta etapa impede uma mudança de rumo posterior.

**Regressão verificada após todas as correções**: `npm run typecheck`/`npm run lint`/`npm test`
(533 testes, +1 desde a Rodada A) — todos verdes; suíte completa de navegador headless
recorrida — 35 Prototype Scenario IDs sem erro de console, varredura de contaminação de
Participant Mode (15 superfícies estáticas + 5 fluxos dinâmicos) repetida com zero ocorrências,
`CONFLICT:`/tag `EMPTY_NOT_READY` confirmados presentes em Evaluator Mode (regressão nula) e
ausentes em Participant Mode; `npm run check-docs` — PASS (194 arquivos).

## 27. Tests / Verification

**Backend** (`src/modules/expiration/`): `npm run typecheck` — PASS. `npm run lint` — PASS
(`--max-warnings=0`). `npm test` — 533/533 testes passando (73 arquivos), incluindo os 6 testes
de `createItem` idempotente (5 da Rodada A + 1 da Rodada C, §14/§26).

**Protótipo** (`prototype/`), verificado em Chromium headless (Playwright), nunca só por leitura
de código:

- Detecção de modo: default (sem parâmetro) e `?mode=xyz` (valor inválido) → Participant Mode;
  `?mode=evaluator` → Evaluator Mode. `#control-bar`/`#banner` ausentes do DOM em Participant
  Mode, presentes em Evaluator Mode — confirmado via contagem de elementos, não apenas CSS.
- Varredura de contaminação: 15 superfícies estáticas + 5 fluxos de feedback dinâmico (salvar
  alerta, simular fornecedor abrindo/enviando, variantes A/B de submission review) em Participant
  Mode — zero termos de contaminação da lista do §6, incluindo no conteúdo de
  `#live-region` (anúncios `aria-live`), não só no HTML visível.
- `GTR-01`: `/guest/tok-valid` mostra "Solicitado por: Empresa Alfa Ltda." em ambos os modos;
  Evaluator Mode também mostra o disclaimer explícito de simulação.
- Anti-enumeração preservada em Participant Mode: 3 tokens com causas de falha diferentes
  (`tok-expired`, `tok-revoked`, inexistente) → `outerHTML` byte-idêntico, reverificado após todas
  as mudanças desta etapa.
- `/submission-review` sem `variant` em Participant Mode → renderiza a Variante B diretamente
  (título "Documento Recebido"), sem mostrar a tela seletora interna.
- Cenário de densidade (`PROTO-STRESS-DENSITY-01`): 155 itens confirmados na Expiration
  Collection, 38 em Fornecedores, contagens de VENCIDOS (24)/VENCE EM BREVE (29) na Overview
  batendo com o dataset gerado; zero erros de console.
- Ordenação por urgência: antes da correção, as 8 primeiras linhas de VENCIDOS apareciam em ordem
  de inserção (datas fora de ordem); depois da correção, as 8 primeiras linhas aparecem em ordem
  cronológica ascendente (mais atrasada primeiro) — confirmado tanto na Overview quanto em
  `/items?status=overdue`.
- Todos os 34 Prototype Scenario IDs pré-existentes + o novo `PROTO-STRESS-DENSITY-01` navegam
  sem erro de console, em Evaluator Mode (regressão completa desta etapa).

`npm run check-docs`: **PASS** (194 arquivos, sem link quebrado, sem referência `AGENTS.md §N`
obsoleta) — confirmado após todas as mudanças de código e documentação desta etapa.

## 28. Final Status

*(preenchido após a Rodada D)*
