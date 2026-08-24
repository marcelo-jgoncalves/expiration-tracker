---
status: APPROVED AS INPUT FOR INTERACTION PROTOTYPE (Claude↔Codex, 2 rodadas — B e D; 5 furos reais + 1 divergência factual, todos corrigidos)
owner: Marcelo
authority: insumo para Interaction Prototype (próxima etapa) — não normativo de identidade visual
---

# Expiration Tracker — Low-Fidelity Wireframes

Quinta etapa formal do planejamento de interface. Entrada primária, lida integralmente, não
refeita: `docs/frontend/interface-screen-and-state-inventory.md` (`APPROVED AS INPUT FOR
LOW-FIDELITY WIREFRAMES`). As três etapas anteriores (`interface-context-and-critical-tasks.md`,
`interface-conceptual-model-and-information-architecture.md`, `interface-critical-user-journeys.md`)
são consumidas por herança através dela, não relidas do zero.

**Esta etapa não decide identidade visual.** Grayscale conceitual, sem paleta, sem tipografia
final, sem ícone detalhado, sem componente de biblioteca. O objetivo é estrutura: hierarquia,
informação, decisão, ação, estado, continuidade de journey.

---

## 1. Executive Summary

- **17 wireframes de baixa fidelidade**, um por `SURF-001` a `SURF-017`, nenhum substituindo os IDs
  e nomes já aprovados. Nenhuma superfície nova inventada; nenhuma das 17 aprovadas ficou sem
  wireframe.
- **Convenções estruturais fixas** (§5) usadas em todas as 17 superfícies: rótulo de status sempre
  em texto entre colchetes (nunca só cor/símbolo), `[PRIMARY]`/`(SECONDARY)`/`⚠[DANGEROUS]` para
  hierarquia de ação, `[BLOQUEADO: BLOCKER-X]` para experiência conceitualmente correta mas
  tecnicamente impedida, `⏳/✓/⚠/✕` sempre pareados com texto para estado assíncrono.
- **Priorização por critério, não por prontidão de implementação** (§6): 8 superfícies `P0`
  (incluindo `SURF-006`/`SURF-007`, ambas `BLOCKED` mas centrais aos outcomes T0 J-04/J-05), 5 `P1`,
  4 `P2`. A sequência de apresentação segue os 3 lotes sugeridos (âncora Vencimento → âncora
  Fornecedor → superfícies isoladas/utility), que é uma decisão de **ordem de produção do
  documento**, não de importância — justificado em §6.
- **`CREATE-IDEMPOTENCY-01` representado estruturalmente** em `SURF-004`: o estado
  `UNKNOWN_OUTCOME` nunca oferece "Tentar novamente" — a estrutura força reconsulta manual da
  coleção.
- **Epistemic Integrity visível na própria estrutura de rótulo**, não só em nota de rodapé:
  `Document.CLEAN` aparece sempre como `[ARQUIVO VERIFICADO]`, nunca "Aprovado";
  `RequirementAssignment.SATISFIED` aparece sempre como `[VINCULADO A UM VENCIMENTO]`, nunca "Em
  dia"; `ReminderPolicy` salva aparece como `[ALERTA CONFIGURADO]`, nunca "você será avisado".
- **`BLOCKER-A`/`BLOCKER-B`/`BLOCKER-C`/`GTR-01` desenhados, não omitidos** — `SURF-006`,
  `SURF-007`, `SURF-012` e a seção de identidade em `SURF-014` mostram a experiência correta com um
  compartimento anotado `[BLOQUEADO: BLOCKER-X]`, nunca um aviso defensivo tipo "pode não
  funcionar".
- **`BLOCKER-C` representado em duas variantes (A/B), nenhuma escolhida** (§ `SURF-012`): a
  Alternativa A (fechamento automático) elimina a necessidade de `SURF-012` como superfície própria;
  a Alternativa B (revisão humana) a mantém como fila de confirmação. Ambas desenhadas para apoiar a
  decisão de produto pendente, não para adiantá-la.
- **Guest Submission (`SURF-014`) permanece isolado**: nenhum elemento de navegação do SaaS, uma
  variante mobile própria (§ Mobile-Relevant Variants), e o estado final do guest nunca ultrapassa
  `[ENVIO RECEBIDO PELO NAVEGADOR]` — nenhuma tela de sucesso reivindica verificação de segurança.
- Revisão adversarial Claude↔Codex (Rodadas B/D) executada — ver §47-48 para achados e reconciliação.

---

## 2. Inputs and Scope

- **Entrada primária, lida integralmente**: `interface-screen-and-state-inventory.md` (`APPROVED`),
  incluindo as 17 superfícies, a taxonomia de estado (§12-31 daquele documento), a Epistemic
  Integrity Matrix (§31), e todas as matrizes de dependência/bloqueio (§40-41).
- **Herdadas através dela, não relidas**: `interface-context-and-critical-tasks.md`,
  `interface-conceptual-model-and-information-architecture.md`, `interface-critical-user-journeys.md`.
- **Constraints confirmadas**: `AGENTS.md`, `NEXT_SESSION_PROMPT.md` (Full BFF zero código;
  BLOCKER-A/B/C e GTR-01 não resolvidos; M0-M11 implementados).
- **Fora de escopo**: identidade visual, paleta, tipografia definitiva, biblioteca de componentes,
  breakpoints detalhados, animação, cópia final de UI, resolução de qualquer blocker, decisão do
  branch point de `BLOCKER-C`, implementação de qualquer código de frontend.
- `docs/frontend/interface-quality-standard.md` continua sem existir como arquivo formal — eixos do
  §77 do prompt-fonte usados diretamente.

---

## 3. Wireframe Methodology

Cada wireframe nasce do bloco já aprovado da superfície correspondente em
`interface-screen-and-state-inventory.md` (§5 daquele documento: Purpose, Journeys, Concepts,
Information/Decision/Action/Feedback obligations, Readiness, Dependencies, Trust, Accessibility).
Nada é inventado aqui — a sequência seguida por superfície é:

```
Purpose + Information obligations      → o que aparece na tela e em que ordem (Attention First, §14)
Decision obligations                    → o que precisa estar visível para essa decisão
Action obligations                      → hierarquia [PRIMARY]/(SECONDARY)/⚠[DANGEROUS]
Feedback obligations                    → onde e como o feedback aparece estruturalmente
Estados aprovados (§12-31 do SSI)       → quais precisam de representação visual distinta
Readiness/Dependencies                  → onde um [BLOQUEADO: BLOCKER-X] precisa aparecer
Trust/Accessibility implications        → anotações A5/A7
```

Nenhum wireframe é produzido a partir de padrão genérico de dashboard/CRUD — cada um responde
diretamente às perguntas/decisões já registradas nas etapas anteriores (§15-16 do prompt-fonte).

---

## 4. Low-Fidelity Constraints

Aplicado em toda superfície, verificado ao final (§49):

```
SEM   grayscale com significado de marca, paleta de cor, fonte definitiva, sombra decorativa,
      ícone detalhado, animação, componente de biblioteca (Button/Card/Modal), pixel-perfect,
      design token.
COM   caixas, linhas, rótulos, headings, conteúdo realista de domínio, placeholder de status,
      placeholder de ação.
```

Conteúdo realista usado em todo o documento (nunca Lorem Ipsum, nunca "Item 1"): nomes de
vencimento plausíveis (Certificado Digital A1, Apólice de Seguro, Alvará de Funcionamento, Licença
Ambiental), fornecedores plausíveis (Transportadora Silva Ltda., Contabilidade Martins), datas
absolutas + relativas (§50), responsáveis por área (Financeiro, Operações, Jurídico) — nunca
implicando capacidade que o domínio não sustenta (ex.: nunca um "score de risco" ou "% de
compliance" que nenhuma rota calcula).

---

## 5. Wireframe Structural Conventions

Convenções usadas em todas as 17 superfícies — nenhuma decide estilo visual final, todas decidem
só estrutura:

```
┌─ NOME DA SUPERFÍCIE ───────────────────────────────────┐
│ contexto/origem (equivalente a breadcrumb — de onde     │   ← identifica onde o usuário está e
│ o usuário veio, quando contextual)                      │     de onde veio (Surface Transition
├──────────────────────────────────────────────────────────┤     Matrix, §37 do SSI)
│ [STATUS-LABEL]                                           │   ← status SEMPRE texto entre colchetes,
│ INFORMAÇÃO PRIMÁRIA                                      │     nunca só cor/posição/símbolo
│ informação secundária                                    │
│ (informação contextual — menor prioridade, mais abaixo)  │
│                                                            │
│ [PRIMARY: ação principal]  (SECONDARY: ação de apoio)     │   ← hierarquia de ação, nunca cor
│                              ⚠[DANGEROUS: ação perigosa]  │
├──────────────────────────────────────────────────────────┤
│ ⏳/✓/⚠/✕ linha de feedback — símbolo SEMPRE pareado com   │   ← async/resultado, nunca símbolo
│ texto explícito                                            │     sozinho
└──────────────────────────────────────────────────────────┘

[BLOQUEADO: BLOCKER-X]     → compartimento explícito onde a experiência correta existiria — nunca
                              omitido, nunca preenchido com dado fictício, sempre nomeando a
                              dependência real
DESIGN REQUIRED /            → usado quando a superfície inteira (não só uma seção) depende de uma
IMPLEMENTATION BLOCKED         decisão de produto ainda não tomada (ex. SURF-012, branch de BLOCKER-C)
```

**Símbolos de feedback e seu significado fixo em todo o documento** (nunca reatribuídos por
superfície):

```
⏳  ação em voo / processo assíncrono em andamento (ex.: "⏳ enviando...")
✓   confirmado pelo backend (ex.: "✓ vencimento criado")
⚠   resultado incerto OU exige atenção/decisão do usuário (ex.: "⚠ não foi possível confirmar")
✕   falha conhecida (ex.: "✕ e-mail inválido")
```

**Anotações numeradas** (§45 do prompt-fonte, reutilizadas com o mesmo significado em toda
superfície, não únicas por tela):

```
A1 — Primary information         A5 — Trust requirement
A2 — Decision support            A6 — Backend blocker
A3 — Primary action              A7 — Accessibility requirement
A4 — Async feedback              A8 — High-consequence / error prevention
```

---

## 6. Surface Prioritization

Critério aplicado (§8 do prompt-fonte): criticidade da journey, frequência, número de journeys
apoiadas, consequência de erro, centralidade na IA — **nunca prontidão de implementação**. Por
isso `SURF-006`/`SURF-007` são `P0` apesar de `BLOCKED`: o outcome que sustentam (J-04/J-05) é T0,
e a interface precisa mostrar a experiência correta independentemente de estar implementável hoje
(§71/§72 do prompt-fonte).

**Nota sobre `Dependencies` (correção, Rodada C, achado real do Codex)**: a tabela abaixo lista só
`Readiness` para caber na largura da tabela — isso não substitui as `Dependencies` completas já
registradas por superfície em `interface-screen-and-state-inventory.md` §5/§40/§41. Em particular,
**`Full BFF` (D-053/D-054) é dependency herdada de TODA superfície autenticada** (`SURF-001` a
`SURF-013`, `SURF-015`, `SURF-016` — todas exceto `SURF-014`, rota pública) — não só de `SURF-017`,
onde aparece destacada por ser a própria superfície que representa essa dependência. Nenhum
wireframe deste documento assume uma sessão de browser funcional além do que o design aprovado
(zero código) sustenta hoje.

| Surface ID | Nome aprovado | Journeys | Type | Readiness | Prioridade de wireframe |
|---|---|---|---|---|---|
| SURF-001 | Overview | J-01 | GLOBAL | PARTIAL | **P0** |
| SURF-002 | Expiration Collection | J-01, J-02, J-08 | GLOBAL | PARTIAL | **P0** |
| SURF-003 | Expiration Detail | J-01, J-03, J-04, J-05 | CONTEXTUAL | PARTIAL | **P0** |
| SURF-004 | Expiration Creation | J-02 | GLOBAL | READY | **P0** |
| SURF-005 | Expiration Renewal | J-03 | CONTEXTUAL | PARTIAL | **P0** |
| SURF-006 | Document Context | J-03, J-04 | CONTEXTUAL | BLOCKED | **P0** |
| SURF-007 | Alert Configuration | J-05 | CONTEXTUAL | READY/BLOCKED | **P0** |
| SURF-014 | Guest Submission | J-07 | GUEST | PARTIAL | **P0** |
| SURF-008 | Subject Collection | J-06 | GLOBAL | READY | P1 |
| SURF-009 | Subject Detail | J-06 | CONTEXTUAL | READY | P1 |
| SURF-010 | Requirement Context | J-06 | CONTEXTUAL | READY/PARTIAL | P1 |
| SURF-011 | Document Request Context | J-06 | CONTEXTUAL | READY | P1 |
| SURF-015 | Import Flow | J-08 | GLOBAL | PARTIAL | P1 |
| SURF-012 | Submission Review | J-06 (branch) | CONTEXTUAL | BLOCKED | P2 |
| SURF-013 | Requests Collection | J-06 (suporte) | GLOBAL (conceitual) | BLOCKED | P2 |
| SURF-016 | Settings | apoio | UTILITY | READY | P2 |
| SURF-017 | Session Recovery | cross-cutting | UTILITY | BLOCKED | P2 |

**Nota sobre `J-06` e o lote 2** (`SURF-008/009/010/011/012/013`): o outcome de `J-06` é T0/P0 no
Context/Task Model, no mesmo nível de `J-01`. Classificar suas superfícies de apoio como `P1` não
reflete "menor importância de produto" — reflete que a journey T0 se distribui por 4-6 superfícies
distintas (menor densidade de decisão por tela) e tem frequência semanal, não diária. A **ordem de
produção** deste documento (lote 1 → lote 2 → lote 3, §7-9 abaixo) segue a mesma lógica adotada nas
etapas anteriores: validar a estrutura do primeiro anchor (Vencimentos) de ponta a ponta antes de
expandir para o segundo (Fornecedores), reduzindo o risco de retrabalho estrutural nos dois anchors
simultaneamente. `SURF-012`/`SURF-013` são `P2` por razão diferente: a própria existência de
`SURF-012` depende de uma decisão de produto ainda não tomada, e `SURF-013` está inteiramente
`BLOCKED` sem caminho de leitura nenhum hoje.

### Lotes de produção (ordem deste documento, não de importância)

```
Lote 1 (§14-20) — âncora Vencimento, loop interno completo:
  SURF-001, SURF-002, SURF-003, SURF-004, SURF-005, SURF-006, SURF-007

Lote 2 (§21-26) — âncora Fornecedor/Requisito:
  SURF-008, SURF-009, SURF-010, SURF-011, SURF-012, SURF-013

Lote 3 (§27-30) — superfícies isoladas/utility:
  SURF-014, SURF-015, SURF-016, SURF-017
```

---

## 7. Surface → Journey Mapping

Herdado sem alteração de `interface-screen-and-state-inventory.md` §6 — não redefinido aqui. Ver
também §41 (Journey Coverage Matrix) para a checagem de completude por journey.

## 8. Surface → State Coverage

Ver §31 (State Coverage Matrix) — consolidação de quais classes de estado (Loading/Empty/Error/
Async/Conflict/Unknown Outcome/Session/Permission) cada superfície precisa representar, derivada
diretamente de `interface-screen-and-state-inventory.md` §12-30.

---

## 9. Navigation/Context Structure

Sem decidir posição visual (menu lateral, topo, etc. — fora de escopo, §69/§70 do prompt-fonte),
a estrutura de navegação conceitual usada nos wireframes é a recomendação de IA já aprovada:

```
OPERATIONAL AREAS (topo conceitual)
  Overview (SURF-001)
  Vencimentos (SURF-002 → SURF-003 → SURF-005/006/007)
  Fornecedores (SURF-008 → SURF-009 → SURF-010 → SURF-011/012)
  Solicitações (SURF-013 — existência condicionada, nunca anunciada como destino funcional hoje)

UTILITY (destino secundário, sem forma decidida)
  Configurações (SURF-016)

ISOLADO (sem navegação principal)
  Guest Submission (SURF-014)

INFRAESTRUTURA (não é destino que o usuário busca)
  Session Recovery (SURF-017)
```

Cada wireframe de superfície `CONTEXTUAL` traz uma linha de "contexto/origem" (§5) mostrando de
onde o usuário veio — nunca a forma final de breadcrumb/tab/sidebar.

---

## 10. Global Structural Patterns

Padrões estruturais repetidos por mais de uma superfície (não componente — estrutura):

```
COLLECTION PATTERN (SURF-002, SURF-008, SURF-013)
  agrupamento por urgência/status → item com [status] + primária + secundária → ação por item
  + ação global de criação

DETAIL/HUB PATTERN (SURF-003, SURF-009)
  contexto de origem → informação primária/secundária/contextual → seções contextuais (para
  SURF-003: Documento, Alerta) → hierarquia de ação

FORM PATTERN (SURF-004, SURF-005, SURF-007, SURF-011 [revogar], SURF-016)
  campos com label visível → obrigatório vs. opcional explícito → validação junto ao campo →
  estado de submissão → confirmação/erro conhecido/resultado incerto

ASYNC TRACKING PATTERN (SURF-006, SURF-014, SURF-015)
  ação inicial → estado "enviado" → limite de observabilidade explícito (nem todo processo é
  consultável — BLOCKER-A/C) → conclusão ou fronteira de bloqueio

REQUEST LIFECYCLE PATTERN (SURF-010, SURF-011, SURF-012)
  requisito pendente → solicitação criada → acompanhamento → (branch, ver SURF-012)
```

---

## 11. Operational Areas

Vencimentos (`SURF-001/002/003/004/005/006/007`) e Fornecedores (`SURF-008/009/010/011/012/013`) —
os dois anchors mentais coexistentes, sem hierarquia única entre eles (herdado, não reaberto). Cada
lote é wireframed de ponta a ponta antes de avançar (§6).

## 12. Utility Area

Settings (`SURF-016`) recebe tratamento estrutural deliberadamente mais simples (formulário único,
sem hub, sem estados assíncronos complexos) — reflexo de sua classificação `UTILITY AREA`, baixa
frequência, sem outcome T0 próprio. Isso não decide posição/proeminência visual (§43 do
prompt-fonte), só reduz a complexidade estrutural da própria tela.

## 13. Guest Experience

`SURF-014` é isolada de todas as outras 16 — nenhum elemento de navegação do SaaS aparece nela
(§35 do prompt-fonte). Sua estrutura é tratada em detalhe no Lote 3 (§27), incluindo a variante
mobile obrigatória (§40).

---

# LOTE 1 — Âncora Vencimento

## 14. SURF-001 — Overview

```
Journeys: J-01 | Actors: Internal Operator | Priority: P0 | Readiness: PARTIAL
```

**Primary information**: contagem/lista de itens vencidos; contagem/lista de itens vencendo em
breve. **Secondary information**: responsável por item, fornecedor associado (se houver).
**Contextual information**: nenhuma métrica de alerta (BLOCKER-B não observável) nem de
solicitações pendentes agregadas (mesma lacuna de `SURF-013` — sem query tenant-wide).

**Primary decision**: "o que exige minha atenção agora?" **Primary action**: abrir um item
(→ `SURF-003`). **Secondary action**: criar novo vencimento (→ `SURF-004`). **High-consequence
actions**: nenhuma nesta superfície (só leitura + navegação).

### Base wireframe

```text
┌─ VENCIMENTOS — VISÃO GERAL ───────────────────────────────┐
│                                                              │
│  VENCIDOS (2)                                          A1   │
│  ┌────────────────────────────────────────────────────┐    │
│  │ [VENCIDO]  Apólice de Seguro          [PRIMARY: Abrir]│  │  A3
│  │ Venceu em 20/08/2026 (há 3 dias) · Financeiro       │    │
│  ├────────────────────────────────────────────────────┤    │
│  │ [VENCIDO]  Alvará de Funcionamento    [PRIMARY: Abrir]│  │
│  │ Venceu em 18/08/2026 (há 5 dias) · Operações        │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  VENCE EM BREVE (1)                                    A2   │
│  ┌────────────────────────────────────────────────────┐    │
│  │ [VENCE EM 7 DIAS]  Certificado Digital A1 [PRIMARY: Abrir]│ │
│  │ Vence em 30/08/2026 · Financeiro                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  (nenhum resumo de alertas ou solicitações pendentes aqui — │
│   ambos NOT_CURRENTLY_OBSERVABLE hoje, BLOCKER-B / query    │
│   tenant-wide inexistente — ver A6)                    A6   │
│                                                              │
│  (SECONDARY: + Novo vencimento)                        A3   │
└──────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `INITIAL_LOADING`: os dois grupos substituídos por placeholder de carregamento, rótulo "carregando vencimentos…" — nunca lista vazia enquanto carrega.
- `EMPTY_TRUE`: "Nenhum vencimento cadastrado ainda" + `[PRIMARY: + Novo vencimento]` em destaque — sucesso genuíno, visualmente distinto de erro (nunca a mesma estrutura de "erro ao carregar").
- Erro de rede: "✕ não foi possível carregar seus vencimentos — tentar novamente", nunca reaproveita a estrutura de `EMPTY_TRUE`.
- `BACKGROUND_REFRESH`: ao retornar de `SURF-003`/`SURF-004`/`SURF-005`, indicador discreto de atualização, sem substituir a lista já visível.

**Epistemic constraints**: nenhuma claim sobre alerta ("você será avisado") ou sobre solicitações
pendentes — ambos ausentes por design desta rodada, não por esquecimento.
**Trust constraints**: nenhuma.
**Accessibility constraints**: `[VENCIDO]`/`[VENCE EM 7 DIAS]` sempre texto, nunca só destaque de
cor; conclusão de carregamento anunciada.
**Backend blockers**: nenhum bloqueia a própria superfície; a ausência de resumo de alerta é
consequência de `BLOCKER-B` (anotada, não escondida).

**Rationale**: agrupamento por urgência (vencido/vence em breve) deriva diretamente do Decision
Inventory herdado ("o que exige minha atenção agora?") — não é padrão genérico de dashboard.
Nenhuma métrica decorativa (gráfico, percentual, total histórico) foi incluída por não responder a
nenhuma pergunta aprovada (§16 do prompt-fonte).
**Open questions**: OQ-6 do SSI (se/quando `BLOCKER-B` for corrigido, a Overview deve resumir
estado de alertas?) permanece em aberto — nenhuma seção reservada para isso hoje.

---

## 15. SURF-002 — Expiration Collection

```
Journeys: J-01, J-02 (destino), J-08 (destino) | Actors: Internal Operator | Priority: P0 | Readiness: PARTIAL
```

**Primary information**: nome, status/urgência, data. **Secondary information**: responsável,
fornecedor associado. **Contextual information**: última renovação, alerta configurado (se
aplicável, ver `SURF-007`).

**Primary decision**: qual item investigar/priorizar. **Primary action**: abrir detalhe
(→ `SURF-003`). **Secondary action**: criar (→ `SURF-004`); filtrar por status.

### Base wireframe

```text
┌─ VENCIMENTOS ──────────────────────────────────── (SECONDARY: + Novo) ┐
│ Filtro: [Todos] [Vencidos] [Vencendo] [Ativos] [Arquivados]      A2   │
├────────────────────────────────────────────────────────────────────┤
│ [VENCIDO]  Apólice de Seguro       20/08/2026  Financeiro [PRIMARY: Abrir]│  A1/A3
│ [VENCIDO]  Alvará de Funcionamento 18/08/2026  Operações  [PRIMARY: Abrir]│
│ [VENCE EM 7 DIAS] Certificado Digital A1 30/08/2026 Financeiro [PRIMARY: Abrir]│
│ [ATIVO]    Contrato de Locação     15/12/2026  Jurídico   [PRIMARY: Abrir]│
│ [ATIVO]    Licença Ambiental       02/03/2027  Operações  [PRIMARY: Abrir]│
├────────────────────────────────────────────────────────────────────┤
│ (carregar mais — dependente de paginação real do backend, PARTIAL)  │
└────────────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `INITIAL_LOADING` / `LOAD_MORE` (paginação incremental — `PARTIAL`, backend não aplica
  ordenação/paginação real hoje; a estrutura existe, a garantia de comportamento não).
- `EMPTY_TRUE` (tenant novo, 0 itens) vs. `EMPTY_FILTERED` (filtro "Vencidos" sem resultado) —
  estruturalmente distintos: `EMPTY_TRUE` oferece `[PRIMARY: + Novo vencimento]`/import;
  `EMPTY_FILTERED` oferece "limpar filtro", nunca a mesma copy.
- Erro de rede: mesma disciplina de `SURF-001`.

**Epistemic constraints**: nenhuma. **Trust constraints**: nenhuma. **Accessibility constraints**:
ordenação/agrupamento perceptível sem depender só de posição.
**Backend blockers**: nenhum bloqueia a existência da superfície; paginação real é `PARTIAL`.

**Rationale (decisão estrutural registrada, §67)**:
```
Decision: lista simples agrupada por status, não tabela densa nem cards grandes
Alternatives considered: tabela multi-coluna (nome/status/data/responsável/fornecedor);
  cards com mais densidade visual
Reasoning: escala real esperada é modesta (~8 itens/usuário, skew até ~800 no maior tenant,
  herdado do Context/Task Model §20) — não há evidência de necessidade de comparação
  multi-atributo densa hoje; ordenação por status/data já é a necessidade real confirmada (GSI1);
  se comparação por múltiplos atributos simultâneos se confirmar necessária (ex. muitos
  fornecedores por item), reavaliar para tabela — registrado como Open Question, não decidido
  contra evidência aqui
Affected journeys: J-01, J-02, J-08
Affected surfaces: SURF-002, SURF-008 (mesmo raciocínio)
Evidence: interface-context-and-critical-tasks.md §20 (Scale Considerations), §27 (Comparison Needs)
```
Nenhuma variante A/B produzida aqui — a evidência favorece um lado sem ambiguidade real (não há
duas soluções estruturais igualmente plausíveis, §68 do prompt-fonte não se aplica).

---

## 16. SURF-003 — Expiration Detail

```
Journeys: J-01, J-03, J-04, J-05 | Actors: Internal Operator | Priority: P0 | Readiness: PARTIAL
```

**Primary information**: nome, status, data (absoluta + relativa). **Secondary information**:
responsável, requisito vinculado (se houver), última renovação. **Contextual information**: seção
Documento (`SURF-006`), seção Alerta (`SURF-007`) — ambas embutidas como seções desta superfície,
não superfícies top-level.

**Primary decisions**: "devo renovar isso?"; "devo agir agora?" **Primary action**: renovar
(→ `SURF-005`). **Secondary actions**: editar; configurar alerta (→ seção `SURF-007`); fazer
upload (→ seção `SURF-006`). **High-consequence actions**: arquivar, excluir.

### Base wireframe

```text
┌─ CERTIFICADO DIGITAL A1 ──────────────── (veio de: Vencidos, Overview) ┐
│ [VENCE EM 7 DIAS]                                                 A1  │
│ Vence em 30/08/2026 (em 7 dias)                                       │
│ Responsável: Financeiro                                               │
│ Requisito vinculado: nenhum                                      A2  │
│                                                                        │
│ ── DOCUMENTO ────────────────────────────────────────────────────    │
│ [BLOQUEADO: BLOCKER-A]                                           A6  │
│ Não é possível hoje consultar o documento associado a este           │
│ vencimento (nenhuma rota de leitura). Você pode enviar um novo        │
│ arquivo, mas não poderá reabri-lo depois de enviado.                  │
│ (PRIMARY: Enviar documento) → SURF-006                                │
│                                                                        │
│ ── ALERTA ───────────────────────────────────────────────────────    │
│ [ALERTA CONFIGURADO]  Avisar 7 dias antes · e-mail               A2  │
│ (política salva — não garante que o aviso será entregue, BLOCKER-B)  │
│ (SECONDARY: Editar alerta) → SURF-007                            A6  │
│                                                                        │
│ [PRIMARY: Renovar]  (SECONDARY: Editar)                          A3  │
│                              ⚠[DANGEROUS: Arquivar] ⚠[DANGEROUS: Excluir] │
└──────────────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `INITIAL_LOADING`.
- Erro "item não encontrado" (`NOT_FOUND` — excluído/arquivado por outro processo desde a lista) →
  mensagem clara + retorno à coleção, nunca tela em branco.
- `CONFLICT` ao tentar editar/arquivar/excluir: "este vencimento foi alterado desde que você o
  abriu" + ação de reler o estado atual — nunca "erro inesperado" genérico.
- Confirmação de alta consequência (arquivar/excluir): passo estrutural intermediário exigindo
  confirmação deliberada antes de aplicar — sem decidir modal/inline (§49 do prompt-fonte).

**Epistemic constraints**: seção Documento nunca implica que um documento existe ou pode ser
revisto; seção Alerta nunca implica entrega garantida.
**Trust constraints**: nenhuma nova além das duas seções.
**Accessibility constraints**: `⚠[DANGEROUS]` sempre navegável por teclado, com confirmação
deliberada antes de aplicar (A8).
**Backend blockers**: `BLOCKER-A` (seção Documento), `BLOCKER-B` (seção Alerta, anotado
"não garante entrega").

**Rationale**: hub único (não 4 telas de detalhe separadas para J-01/J-03/J-04/J-05) — decisão já
travada no SSI (§43, "Rejected Surface Assumptions"), aqui só materializada espacialmente. Seções
Documento/Alerta ficam embutidas, não como abas ou navegação própria, porque cada uma representa
uma extensão contextual de decisão sobre o MESMO objeto (o vencimento), não um objeto à parte.

---

## 17. SURF-004 — Expiration Creation

```
Journeys: J-02 | Actors: Internal Operator | Priority: P0 | Readiness: READY (operação); CREATE-IDEMPOTENCY-01 (gap)
```

**Primary information**: campos mínimos do schema (nome, categoria, data). **Secondary
information**: campos opcionais (responsável, fornecedor/requisito, alerta inicial) —
progressive complexity, nunca obrigatórios. **Contextual information**: nenhuma.

**Primary decision**: nenhuma de alto risco — só entrada de dados. **Primary action**: confirmar
criação. **Secondary action**: associar a um Fornecedor/Requisito existente (opcional).

### Base wireframe (caminho mínimo)

```text
┌─ NOVO VENCIMENTO ──────────────────────────────────────────┐
│ Nome *                                                   A1│
│ [ Licença Ambiental                                     ] │
│                                                              │
│ Categoria *                                                 │
│ [ Licença                                    ▾           ] │
│                                                              │
│ Data de vencimento *                                         │
│ [ 02/03/2027                                             ] │
│                                                              │
│ ── OPCIONAL (expandir) ──────────────────────────────  A2   │
│   Responsável                                                │
│   Fornecedor/Requisito relacionado                            │
│   Alerta inicial (avisar N dias antes)                        │
│                                                              │
│ [PRIMARY: Criar vencimento]                             A3  │
└────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `VALIDATION_ERROR`: erro junto ao campo específico ("Data de vencimento — não pode ser uma data
  já passada sem confirmação"), valores já digitados preservados (P3) — nunca mensagem genérica
  única no topo.
- `SUBMITTING`: "⏳ criando vencimento…", campos desabilitados, sem indicar "criado" antes da
  confirmação do backend.
- `CREATED`: "✓ Certificado Digital A1 foi criado" + navegação para `SURF-003` (o item novo) ou
  `SURF-002`.
- `UNKNOWN_OUTCOME` (**CREATE-IDEMPOTENCY-01, obrigatório representar**):

```text
┌─ NOVO VENCIMENTO ──────────────────────────────────────────┐
│ ⚠ Não foi possível confirmar se o vencimento foi criado.  A4│
│                                                              │
│ Isto pode acontecer por instabilidade de rede. Não          │
│ reenviamos automaticamente para evitar duplicidade.     A6  │
│                                                              │
│ (PRIMARY: Ver meus vencimentos e confirmar)                 │
│ (SECONDARY: Preencher novamente, se confirmar que não foi  │
│  criado)                                                    │
└──────────────────────────────────────────────────────────────┘
```
  Nunca um botão "Tentar novamente" simples — a única ação estrutural oferecida é reconsultar a
  coleção; reenviar o formulário é uma ação explícita e separada, nunca o caminho de um clique.

**Epistemic constraints**: `UNKNOWN_OUTCOME` nunca se torna "criado" nem "falhou" — só "incerto".
**Trust constraints**: usuário precisa confiar que a ausência de retry automático é proteção, não
bug — copy final não decidida aqui, só a obrigação estrutural.
**Accessibility constraints**: erro de validação por campo, não mensagem única.
**Backend blockers**: `CREATE-IDEMPOTENCY-01` (não um dos 3 blockers nomeados, mas com peso
estrutural direto nesta tela).

**Rationale**: campos opcionais colapsados por padrão (progressive complexity, §24-25 do
prompt-fonte) — nenhum vencimento simples é forçado a passar por Fornecedor/Requisito/Documento/
Alerta antes de existir.

---

## 18. SURF-005 — Expiration Renewal

```
Journeys: J-03 | Actors: Internal Operator | Priority: P0 | Readiness: PARTIAL
```

**Primary information**: data atual do ciclo, nova data proposta. **Secondary information**:
versão OCC atual (não exposta como número técnico ao usuário — só usada internamente para detectar
conflito). **Contextual information**: aviso de continuidade documental bloqueada (`BLOCKER-A`).

**Primary decision**: "devo renovar isso?"; "a nova data está correta?" **Primary action**:
confirmar renovação. **High-consequence**: a própria confirmação (cria registro novo,
irreversível como operação simples).

### Base wireframe

```text
┌─ RENOVAR — CERTIFICADO DIGITAL A1 ─────────── (veio de: Detalhe) ┐
│ Ciclo atual: vence em 30/08/2026                             A2 │
│                                                                    │
│ Nova data de vencimento *                                          │
│ [ 30/08/2027                                                    ] │
│                                                                    │
│ ⚠ Renovar cria um novo ciclo — o ciclo atual será preservado  A2 │
│   como histórico (Renovado), não editado.                    A8 │
│                                                                    │
│ (documento associado ao novo ciclo: não é possível confirmar   │
│  hoje qual documento pertence a qual ciclo — BLOCKER-A)      A6 │
│                                                                    │
│ ⚠[DANGEROUS: Confirmar renovação]                             A3 │
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `VALIDATION_ERROR`: nova data igual/anterior à atual sem confirmação explícita.
- `SUBMITTING`: "⏳ renovando…".
- `SUCCESS` (dual claim obrigatório):

```text
┌─ CERTIFICADO DIGITAL A1 — NOVO CICLO ──────────────────────┐
│ ✓ Novo ciclo criado: vence em 30/08/2027                A4│
│ ✓ Ciclo anterior preservado como [RENOVADO]              │
│   (Certificado Digital A1 — venceu em 30/08/2026)         │
└──────────────────────────────────────────────────────────────┘
```
  Nunca representar só uma das duas afirmações — perder qualquer uma quebra o requisito
  "renovar ≠ editar" (§27 do prompt-fonte).
- `CONFLICT`: "este vencimento foi alterado desde que você abriu esta tela — reveja o estado atual
  antes de renovar" + ação de reler, nunca "erro inesperado" (§29).
- `SOURCE_STATE_CHANGED`: "este vencimento não está mais ativo (já foi arquivado/renovado)" — erro
  conhecido, distinto de `CONFLICT`.
- `UNKNOWN_OUTCOME`: "⚠ não foi possível confirmar a renovação — verificando o estado atual…" →
  reconsulta automática é segura aqui (idempotência real existe, diferente de `SURF-004`) —
  estruturalmente a tela pode se autorresolver sem exigir ação manual do usuário além de aguardar.

**Epistemic constraints**: as duas claims de `SUCCESS` são obrigatórias e simultâneas.
**Trust constraints**: renovar ≠ editar precisa aparecer ANTES da confirmação, não só depois.
**Accessibility constraints**: confirmação de ⚠[DANGEROUS] navegável por teclado.
**Backend blockers**: `BLOCKER-A` indireto (continuidade documental).

---

## 19. SURF-006 — Document Context

```
Journeys: J-04 (direto), J-03 (indireto) | Actors: Internal Operator | Priority: P0 | Readiness: BLOCKED — BLOCKER-A
```

**Primary information**: tipo/tamanho de arquivo aceito; estado do envio atual. **Secondary
information**: nenhuma (não há histórico de documentos anteriores observável). **Contextual
information**: nenhuma.

**Primary decision**: nenhuma de risco além de escolher o arquivo certo. **Primary action**:
selecionar e enviar arquivo.

### Base wireframe — estado READY (envio, antes de SCANNING)

```text
┌─ DOCUMENTO — CERTIFICADO DIGITAL A1 ──────── (veio de: Detalhe) ┐
│ [BLOQUEADO: BLOCKER-A]                                       A6 │
│ Não é possível saber hoje se já existe um documento enviado    │
│ para este vencimento (nenhuma rota de leitura) — corrigido,    │
│ Rodada C: "nenhum documento ainda" seria uma afirmação que a   │
│ interface não tem como confirmar, não um vazio genuíno.   A1 │
│ Você pode enviar um novo arquivo abaixo.                        │
│ Formatos aceitos: PDF, JPEG, PNG · até 10 MB                     │
│                                                                    │
│ [ Selecionar arquivo... ]  (também aceita foto da câmera)   A7 │
│                                                                    │
│ [PRIMARY: Enviar]                                             A3│
└──────────────────────────────────────────────────────────────────┘
```

### Wireframe — estado pós-envio (SCANNING em diante, `[BLOQUEADO: BLOCKER-A]`)

```text
┌─ DOCUMENTO — CERTIFICADO DIGITAL A1 ──────────────────────────┐
│ ✓ Upload enviado                                          A4 │
│                                                                  │
│ [BLOQUEADO: BLOCKER-A]                                     A6 │
│ A partir daqui, não é possível consultar o que acontece com     │
│ o arquivo (verificação de segurança, resultado, ou reabri-lo    │
│ depois). Nenhuma rota de leitura existe hoje. Esta seção         │
│ mostrará "Arquivo verificado" ou "Arquivo rejeitado" assim que   │
│ essa capacidade existir — nunca "verificando segurança" como     │
│ fato confirmado até lá.                                          │
│                                                                    │
│ (SECONDARY: Enviar outro arquivo)                                 │
└────────────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `FILE_SELECTED` (client-only, antes do envio): nome/tamanho do arquivo escolhido, erro imediato
  se tipo/tamanho inválido — antes de qualquer tentativa de envio.
- `UPLOADING`: "⏳ enviando… (TTL da reserva: 10 min)".
- `UNKNOWN_OUTCOME` (falha de rede durante o `PUT`): "⚠ não sabemos se o arquivo chegou — envie
  novamente" — nunca assumir sucesso parcial, nova reserva sempre.
- Estado pós-envio: representado uma única vez (acima) como o teto real de observabilidade —
  **nenhuma variante "Arquivo verificado" é desenhada nesta rodada**, porque o domínio não sustenta
  essa afirmação hoje (§20/§22 do prompt-fonte). Quando `BLOCKER-A` for resolvido, este bloco vira
  `[ARQUIVO VERIFICADO]` / `[ARQUIVO REJEITADO PELA VERIFICAÇÃO DE SEGURANÇA]` — nunca "Aprovado".

**Epistemic constraints**: `CLEAN` nunca é representado como "Aprovado"/"Validado"/"Documento
correto" — quando a rota existir, o rótulo aprovado é `[ARQUIVO VERIFICADO]` (§22 do prompt-fonte).
**Trust constraints**: usuário precisa entender que "enviado" ≠ "verificado" mesmo sem ver o
resultado do scan.
**Accessibility constraints**: seleção de arquivo tem alternativa a drag-and-drop; confirmação de
envio é anunciada (não há estado de scanning observável para anunciar além disso, herdado do SSI).
**Backend blockers**: `BLOCKER-A`, representado como bloco de conteúdo, nunca como aviso de bug ao
usuário ("seu documento foi salvo, mas pode não ter sido verificado" — proibido, §72 do
prompt-fonte).

---

## 20. SURF-007 — Alert Configuration

```
Journeys: J-05 | Actors: Internal Operator | Priority: P0 | Readiness: READY (operação) / BLOCKED (outcome) — BLOCKER-B
```

**Primary information**: quando avisar (offset em dias), canal. **Secondary information**: nenhuma.
**Contextual information**: aviso de que a política salva não garante entrega.

**Primary decision**: quando/como quero ser avisado. **Primary action**: salvar política.
**Secondary action**: desabilitar alerta.

### Base wireframe

```text
┌─ ALERTA — CERTIFICADO DIGITAL A1 ─────────── (veio de: Detalhe) ┐
│ Avisar-me                                                    A1 │
│ [ 7 ] dias antes do vencimento                                    │
│ Canal: E-mail (único canal disponível hoje — corrigido, Rodada C:│
│   WhatsApp removido, é LATER sem suporte real, não uma opção      │
│   desabilitada para mostrar)                                       │
│                                                                    │
│ [BLOQUEADO: BLOCKER-B]                                       A6 │
│ Salvar esta política registra sua preferência, mas hoje não      │
│ existe garantia de que o aviso será realmente enviado no          │
│ momento configurado — a geração automática do aviso não está      │
│ conectada. Esta seção nunca afirmará "você será avisado" até       │
│ isso ser corrigido.                                                │
│                                                                      │
│ [PRIMARY: Salvar]   (SECONDARY: Desabilitar alerta)             A3│
└──────────────────────────────────────────────────────────────────────┘
```

**Required state variants**:
- `NO_ALERT` (estado inicial, nenhuma política): "Nenhum alerta configurado para este vencimento" +
  `[PRIMARY: Configurar alerta]`.
- `SUBMITTING`: "⏳ salvando…".
- `POLICY_CONFIGURED` (sucesso, teto real de certeza):

```text
✓ [ALERTA CONFIGURADO] Avisar 7 dias antes · e-mail             A4
  (política salva — ver aviso de BLOCKER-B acima; este estado
   nunca escala para "agendado" ou "entregue")
```
- `VALIDATION_ERROR`: offset inválido, erro junto ao campo.
- Nenhuma variante para `MATERIALIZATION_PENDING`/`OCCURRENCE_SCHEDULED`/`DELIVERED` é desenhada —
  esses estados são `NOT_CURRENTLY_OBSERVABLE` hoje; desenhá-los seria fabricar uma tela para um
  fato que a interface não pode conhecer (herdado, §27 do SSI).

**Epistemic constraints**: "política salva" nunca vira "você será avisado" em nenhum estado desta
superfície — a regra central da tela.
**Trust constraints**: mesmo texto acima.
**Accessibility constraints**: formulário acessível padrão.
**Backend blockers**: `BLOCKER-B`, representado como bloco de conteúdo permanente enquanto não
resolvido — nunca um "warning" que desaparece com uma ação do usuário (§72 do prompt-fonte: não
resolver o bug via copy).

---

# LOTE 2 — Âncora Fornecedor / Requisito

## 21. SURF-008 — Subject Collection

```
Journeys: J-06 | Actors: Internal Operator | Priority: P1 | Readiness: READY
```

**Primary information**: nome, tipo, contagem de requisitos pendentes vs. vinculados. **Secondary
information**: nenhuma agregação "regular/irregular" (não sustentada, `SATISFIED` é snapshot).

**Primary decision**: qual Fornecedor investigar. **Primary action**: abrir detalhe
(→ `SURF-009`). **Secondary action**: criar Fornecedor.

### Base wireframe

```text
┌─ FORNECEDORES ────────────────────────────── (SECONDARY: + Novo) ┐
│ Transportadora Silva Ltda.   2 pendentes · 1 vinculado [PRIMARY: Abrir]│ A1/A3
│ Contabilidade Martins        0 pendentes · 3 vinculados [PRIMARY: Abrir]│
│ João Pereira (Corretor)      1 pendente · 0 vinculados  [PRIMARY: Abrir]│
└─────────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `INITIAL_LOADING`; `EMPTY_TRUE` ("Nenhum fornecedor cadastrado ainda"
+ `[PRIMARY: + Novo fornecedor]`); erro de rede — mesma disciplina de `SURF-002`.

**Epistemic constraints**: nunca "X regular" / "Y irregular" — só contagem MISSING vs. SATISFIED,
herdado de §13.2/§17 da IA aprovada.
**Trust/Accessibility**: nenhuma nova.
**Backend blockers**: nenhum bloqueia a superfície.

---

## 22. SURF-009 — Subject Detail

```
Journeys: J-06 | Actors: Internal Operator | Priority: P1 | Readiness: READY
```

**Primary information**: lista de requisitos com status. **Secondary information**: tipo do
Fornecedor. **Contextual information**: última solicitação enviada por requisito.

**Primary decision**: qual requisito precisa de solicitação. **Primary action**: abrir requisito
(→ `SURF-010`). **Secondary**: criar novo requisito; editar/arquivar Fornecedor.

### Base wireframe

```text
┌─ TRANSPORTADORA SILVA LTDA. ────────── (veio de: Fornecedores) ┐
│ Tipo: Fornecedor                                            A1│
│                                                                  │
│ REQUISITOS                                                       │
│ [PENDENTE]  Apólice de Seguro RC            [PRIMARY: Abrir] A1│
│ [PENDENTE]  Certidão Negativa de Débitos    [PRIMARY: Abrir]     │
│ [VINCULADO A UM VENCIMENTO]  Alvará de Funcionamento [PRIMARY: Abrir]│  A2
│   (vinculado — não confirma que o vencimento ainda está ativo,  │
│    ver detalhe)                                              A6│
│                                                                  │
│ (SECONDARY: + Novo requisito)                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `INITIAL_LOADING`; `EMPTY_TRUE` (nenhum requisito ainda); erro de
rede.
**Epistemic constraints**: `[VINCULADO A UM VENCIMENTO]`, nunca "Em dia"/"Regular"/"Compliant"
(§23 do prompt-fonte) — anotação explícita de que o vínculo não é revalidado automaticamente.
**Backend blockers**: nenhum bloqueia a superfície.

---

## 23. SURF-010 — Requirement Context

```
Journeys: J-06 | Actors: Internal Operator | Priority: P1 | Readiness: READY (operação) / PARTIAL (outcome)
```

**Primary information**: status do requisito; solicitações relacionadas. **Secondary
information**: histórico de solicitações. **Contextual**: vencimento vinculado, se houver.

**Primary decisions**: "preciso reenviar uma solicitação?"; vincular a qual vencimento? **Primary
action**: criar solicitação (→ `SURF-011`). **Secondary**: vincular/desvincular manualmente a um
vencimento existente.

### Base wireframe — requisito pendente

```text
┌─ APÓLICE DE SEGURO RC — Transportadora Silva Ltda. ───────────┐
│ [PENDENTE]                                                  A1│
│                                                                  │
│ SOLICITAÇÕES                                                     │
│ [ENVIADA]  15/08/2026 → prazo 29/08/2026                     A2│
│                                                                  │
│ [PRIMARY: Nova solicitação]                                  A3│
│ (SECONDARY: Vincular a um vencimento existente)                  │
└──────────────────────────────────────────────────────────────────┘
```

### Wireframe — vínculo manual confirmado

```text
│ [VINCULADO A UM VENCIMENTO]  Apólice de Seguro (vencimento)   │  A4
│ Vinculado manualmente em 22/08/2026                              │
│ (SECONDARY: Desvincular)                                          │
```

**Required state variants**: `EMPTY_NOT_READY` (nenhuma solicitação criada ainda); vínculo
manual sempre marcado como ação humana explícita (`CONFIRMED`), nunca aparência automática.

**Epistemic constraints**: `[VINCULADO A UM VENCIMENTO]`, nunca "Em dia".
**Trust constraints**: nenhuma nova.
**Backend blockers**: outcome pleno depende de `BLOCKER-C` para o caminho vindo de coleta externa
(anotado, não escondido) — a operação de link/unlink manual em si é `READY`.

---

## 24. SURF-011 — Document Request Context

```
Journeys: J-06 | Actors: Internal Operator | Priority: P1 | Readiness: READY
```

**Primary information**: status, prazo restante. **Secondary information**: destinatário
(e-mail/nome). **High-consequence action**: revogar.

### Base wireframe

```text
┌─ SOLICITAÇÃO — Apólice de Seguro RC ──────── (veio de: Requisito) ┐
│ [ABERTA PELO FORNECEDOR]                                      A1 │
│ Enviada em 15/08/2026 · Prazo: 29/08/2026 (em 4 dias)      A2 │
│ Enviada para: contato@transportadorasilva.com.br                    │
│                                                                       │
│ ⚠[DANGEROUS: Revogar solicitação]                                A8│
│  (o fornecedor perde acesso ao link imediatamente — irreversível)   │
└───────────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `[ENVIADA]`/`[ABERTA PELO FORNECEDOR]`/`[DOCUMENTO RECEBIDO]`
(SUBMITTED — anotar explicitamente "não significa aceito", ver `SURF-012`)/`[REVOGADA]`.
Confirmação deliberada obrigatória antes de aplicar a revogação (estrutura, não modal — §49 do
prompt-fonte).

**Epistemic constraints**: `[DOCUMENTO RECEBIDO]` nunca implica "requisito atendido" — anotação
obrigatória junto ao rótulo quando este estado ocorrer.
**Trust constraints**: revogação é ação de alta consequência, error-prevention obrigatório.
**Backend blockers**: nenhum bloqueia a superfície em si.

---

## 25. SURF-012 — Submission Review

```
Journeys: J-06 (branch point) | Actors: Internal Operator | Priority: P2 | Readiness: BLOCKED — BLOCKER-C
```

**Esta superfície inteira é `DESIGN REQUIRED / IMPLEMENTATION BLOCKED`** — sua própria existência
depende de uma decisão de produto ainda não tomada (Alternativa A vs. B, `BLOCKER-C`). Duas
variantes estruturais são produzidas para apoiar essa decisão, **nenhuma escolhida aqui** (§40 do
prompt-fonte).

### Variante A — Fechamento automático (nenhuma superfície nova necessária)

```text
Se a Alternativa A for escolhida, SURF-012 DEIXA DE EXISTIR como superfície própria.
O que hoje seria "revisão humana" vira uma transição automática invisível ao usuário:

┌─ APÓLICE DE SEGURO RC — Transportadora Silva Ltda. ────────────┐
│ [VINCULADO A UM VENCIMENTO]  (vínculo automático)                │
│ Vinculado automaticamente a partir do documento recebido em       │
│ 24/08/2026                                                          │
└─────────────────────────────────────────────────────────────────────┘

Impacto estrutural: nenhuma fila de confirmação, nenhuma ação humana obrigatória — mas nenhum
checkpoint antes de gravar o vínculo (`RequirementAssignment.SATISFIED`, que continua significando
só "vinculado a um vencimento", nunca "compliance atual" — corrigido, Rodada C: a versão anterior
desta seção dizia "marcar compliance como satisfeita", reintroduzindo exatamente a equivalência que
a Epistemic Integrity Matrix do SSI proíbe) — risco já registrado no decision brief herdado, não
resolvido aqui.
```

### Variante B — Revisão humana explícita (SURF-012 existe como fila)

```text
┌─ DOCUMENTOS RECEBIDOS AGUARDANDO CONFIRMAÇÃO ─────────────────┐
│ [BLOQUEADO: BLOCKER-C]                                      A6│
│ Esta fila não existe hoje — nenhuma rota permite ao Internal    │
│ Operator ver os documentos recebidos de fornecedores.            │
│                                                                    │
│ Estrutura correta esperada (Alternativa B):                       │
│ ┌────────────────────────────────────────────────────────┐    │
│ │ Transportadora Silva Ltda. — Apólice de Seguro RC        │    │
│ │ Documento recebido em 24/08/2026                          │    │
│ │ (PRIMARY: Vincular a vencimento existente)                 │    │
│ │ (SECONDARY: Criar novo vencimento a partir deste)           │    │
│ │ ⚠[DANGEROUS: Rejeitar]                                     │    │
│ └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants (Variante B, hipotéticas)**: `PENDING_CONFIRMATION`, `LINKED`,
`REJECTED_BY_OPERATOR` — nenhuma implementável hoje, todas herdadas do SSI §28.

**Epistemic constraints**: "documento recebido" ≠ "documento oficial" em ambas as variantes.
**Trust constraints**: nenhuma nova.
**Backend blockers**: `BLOCKER-C` bloqueia literalmente a existência da superfície, não só um
estado dela.
**Open questions**: decisão de produto (Alternativa A vs. B) permanece pendente — este documento
não a resolve, só a instrumenta.

---

## 26. SURF-013 — Requests Collection

```
Journeys: J-06 (suporte à decisão) | Actors: Internal Operator | Priority: P2 | Readiness: BLOCKED
```

**Esta superfície é inteiramente `[BLOQUEADO]`** — sem query tenant-wide de solicitações pendentes,
não há dado algum para popular uma visão global.

### Wireframe

```text
┌─ SOLICITAÇÕES (TODOS OS FORNECEDORES) ────────────────────────┐
│ [BLOQUEADO]                                                  A6│
│ Não existe hoje uma consulta que traga todas as solicitações    │
│ pendentes de todos os fornecedores de uma vez — cada uma só é    │
│ acessível a partir do Requisito/Fornecedor específico            │
│ (Requirement Context, SURF-010).                                  │
│                                                                    │
│ Estrutura correta esperada, quando a query existir: mesma          │
│ estrutura de coleção de SURF-002/SURF-008 (agrupada por urgência  │
│ de prazo, não por fornecedor).                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Epistemic/Trust/Accessibility**: N/A até a superfície existir de fato (herdado do SSI §5).
**Backend blockers**: query tenant-wide inexistente — não um dos 3 blockers nomeados, mas com o
mesmo efeito estrutural de bloquear a superfície inteira.

---

# LOTE 3 — Isoladas / Utility

## 27. SURF-014 — Guest Submission

```
Journeys: J-07 | Actors: External Submitter | Priority: P0 | Readiness: PARTIAL / PARTIAL
```

**Isolamento obrigatório**: nenhum elemento de Overview/Vencimentos/Fornecedores/Configurações
aparece nesta superfície (§35 do prompt-fonte, P6 herdado).

**Primary information**: quem pede (GTR-01, hoje ausente), o que é pedido, prazo, tipos aceitos.
**Primary decision**: "devo confiar nisso?" (bloqueado por GTR-01); "meu arquivo está certo?"
**Primary action**: selecionar e enviar arquivo.

### Base wireframe

```text
┌─ SOLICITAÇÃO DE DOCUMENTO ─────────────────────────────────────┐
│ [BLOQUEADO: GTR-01]                                          A6│
│ Quem está solicitando: não exibido hoje — nenhuma rota expõe     │
│ a identidade da organização requisitante. Estrutura correta       │
│ esperada: "Solicitado por: <organização>" nesta posição.      A5│
│                                                                    │
│ Documento solicitado: Apólice de Seguro RC                    A1│
│ Prazo: até 29/08/2026 (em 4 dias)                                 │
│ Formatos aceitos: PDF, JPEG, PNG · até 10 MB                       │
│                                                                    │
│ [ Selecionar arquivo ]  (ou tirar foto)                       A7│
│                                                                    │
│ [PRIMARY: Enviar documento]                                    A3│
└──────────────────────────────────────────────────────────────────┘
```

### Wireframe — pós-envio (teto real de certeza do guest)

```text
┌─ SOLICITAÇÃO DE DOCUMENTO ─────────────────────────────────────┐
│ ✓ Envio recebido pelo seu navegador                        A4│
│                                                                    │
│ Não é possível confirmar aqui se o arquivo passou pela           │
│ verificação de segurança — esta página não tem essa informação.   │
│ Se necessário, entre em contato com quem solicitou o documento.  │
│   [BLOQUEADO — sem rota pública de status pós-envio]         A6│
└──────────────────────────────────────────────────────────────────┘
```

### Wireframe — pedido indisponível (anti-enumeração)

```text
┌─ SOLICITAÇÃO DE DOCUMENTO ─────────────────────────────────────┐
│ ✕ Este link não está disponível.                            A5│
│                                                                    │
│ (mesma mensagem para link inválido, expirado, revogado ou não     │
│  encontrado — nunca diferenciado, por desenho de segurança)        │
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `FileSelected` (erro imediato de tipo/tamanho antes do envio);
`ReservationPending`/`ReservationAccepted` ("reserva aceita" ≠ "documento enviado" — nunca
comprimidos); `UploadUnknownOutcome` (rede caiu — reenvio do `PUT` é seguro, oferecido diretamente,
diferente de `SURF-004`).

**Epistemic constraints**: nenhum estado nesta superfície chega a "arquivo verificado" — o teto é
sempre "envio recebido pelo navegador" (§38 do prompt-fonte).
**Trust constraints**: `GTR-01` representado como bloco permanente, não omitido (§36 do
prompt-fonte).
**Accessibility constraints**: alternativa a drag-and-drop obrigatória; ver variante mobile abaixo
(§40).
**Backend blockers**: `GTR-01`; ausência de rota pública pós-envio.

---

## 28. SURF-015 — Import Flow

```
Journeys: J-08 | Actors: Internal Operator | Priority: P1 | Readiness: PARTIAL
```

**Primary information**: contagens agregadas (total/aceitas/rejeitadas/duplicadas). **Secondary**:
TTL da URL de upload. **Contextual**: nenhuma — não é um "lugar" revisitado (§59 do prompt-fonte).

**Primary decision**: commitar ou não, após revisar contagens. **Primary action**: iniciar
import → enviar → commitar.

### Base wireframe — fluxo completo (variantes por estágio)

```text
┌─ IMPORTAR PLANILHA (1/4 — selecionar) ─────────────────────────┐
│ [ Selecionar arquivo CSV ]  (até 5 MB)                       A1│
│ [PRIMARY: Continuar]                                          A3│
└──────────────────────────────────────────────────────────────────┘

┌─ IMPORTAR PLANILHA (2/4 — enviando) ────────────────────────────┐
│ ⏳ Enviando planilha_fornecedores.csv…  (TTL: 15 min)         A4│
└──────────────────────────────────────────────────────────────────┘

┌─ IMPORTAR PLANILHA (3/4 — revisar) ─────────────────────────────┐
│ Total de linhas: 42                                          A1│
│ Aceitas: 38 · Rejeitadas: 3 · Duplicadas: 1                  A2│
│                                                                    │
│ [BLOQUEADO — detalhe por linha]                              A6│
│ Não é possível hoje ver quais 3 linhas foram rejeitadas nem       │
│ por quê — só a contagem agregada está disponível.                │
│                                                                    │
│ [PRIMARY: Confirmar importação]  (SECONDARY: Cancelar)        A3│
└──────────────────────────────────────────────────────────────────┘

┌─ IMPORTAR PLANILHA (4/4 — concluído) ───────────────────────────┐
│ ✓ 38 registros criados                                       A4│
│ (PRIMARY: Ver vencimentos/fornecedores importados)                │
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `FAILED` (CSV malformado — erro claro, recomeçar do zero, sem retomar
job morto); `EXPIRED` (job morreu sem commit); `UNKNOWN_OUTCOME` pós-commit (reconsulta segura via
`GET /imports/{jobId}`, idempotente — estruturalmente igual ao caso de `SURF-005`, diferente de
`SURF-004`); re-entry: usuário pode sair durante `PARSING`/`COMMITTING` e retomar exatamente no
estágio 3 ao voltar (`GET /imports/{jobId}` sempre disponível).

**Epistemic constraints**: "commitado" só aparece quando `COMMITTED` de fato — nunca antecipado no
estágio de preview.
**Backend blockers**: erros por linha (`PARTIAL`) anotado explicitamente, nunca fingido como editor
de planilha completo (§42 do prompt-fonte).

---

## 29. SURF-016 — Settings

```
Journeys: apoio a J-05/J-06 | Actors: Internal Operator | Priority: P2 | Readiness: READY
```

### Base wireframe

```text
┌─ CONFIGURAÇÕES ────────────────────────────────────────────────┐
│ NOTIFICAÇÕES                                                  A1│
│ [x] Receber alertas por e-mail                                    │
│ Idioma: [ Português (Brasil)          ▾ ]                        │
│ Não perturbar: [ 20:00 ] até [ 08:00 ]                             │
│                                                                    │
│ ENTREGA DE SOLICITAÇÕES                                            │
│ ( ) Enviar automaticamente por e-mail                              │
│ ( ) Eu mesmo envio o link manualmente                              │
│                                                                    │
│ [PRIMARY: Salvar]                                              A3│
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `SUBMITTING`/`SUCCESS` ("✓ preferências salvas") — sem estados
assíncronos complexos, consistente com sua natureza de utility area.
**Backend blockers**: nenhum.

---

## 30. SURF-017 — Session Recovery

```
Journeys: cross-cutting | Actors: Internal Operator | Priority: P2 | Readiness: BLOCKED — Full BFF
```

Infraestrutura, não um "lugar" que o usuário busca por objetivo próprio — wireframe mínimo,
propositalmente simples, sem redesenhar D-053/D-054 (§33 do prompt-fonte).

### Base wireframe

```text
┌─ SESSÃO EXPIRADA ────────────────────────────────────────────┐
│ Sua sessão expirou.                                          A1│
│ Ao entrar novamente, você voltará exatamente para onde        A2│
│ estava (Certificado Digital A1).                               │
│                                                                    │
│ [PRIMARY: Entrar novamente]                                    A3│
└──────────────────────────────────────────────────────────────────┘
```

**Required state variants**: `SESSION_REFRESHING` (idealmente nunca visível — renovação
transparente, D-054); `REFRESH_FAILED` (mesma estrutura acima).
**Backend blockers**: `Full BFF` (D-053/D-054), zero código — esta superfície representa o
comportamento requerido pelo design aprovado, não o estado real hoje (herdado do SSI §19).
**Accessibility constraints**: interrupção de sessão não pode estranhar usuário de teclado/leitor
de tela — foco previsível ao retornar.

---

# Cobertura consolidada

## 31. State Coverage Matrix

| Surface | Default | Loading | Empty | Error | Async | Conflict | Unknown Outcome | Session | Permission |
|---|---|---|---|---|---|---|---|---|---|
| SURF-001 | REQUIRED | REQUIRED | REQUIRED (TRUE) | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-002 | REQUIRED | REQUIRED | REQUIRED (TRUE+FILTERED) | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-003 | REQUIRED | REQUIRED | N/A | REQUIRED (not found) | BLOCKED (doc/alert) | REQUIRED | N/A | SHARED | N/A |
| SURF-004 | REQUIRED | N/A | N/A | REQUIRED (validation) | REQUIRED (submitting) | N/A | REQUIRED | SHARED | N/A |
| SURF-005 | REQUIRED | N/A | N/A | REQUIRED (validation/source-changed) | REQUIRED (submitting) | REQUIRED | REQUIRED | SHARED | N/A |
| SURF-006 | BLOCKED | REQUIRED (upload) | N/A | REQUIRED (rede) | REQUIRED (então BLOCKED) | N/A | REQUIRED | SHARED | N/A |
| SURF-007 | REQUIRED | N/A | REQUIRED (NO_ALERT) | REQUIRED (validation) | BLOCKED (materialização) | N/A | N/A | SHARED | N/A |
| SURF-008 | REQUIRED | REQUIRED | REQUIRED (TRUE) | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-009 | REQUIRED | REQUIRED | REQUIRED (TRUE) | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-010 | REQUIRED | REQUIRED | REQUIRED (NOT_READY) | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-011 | REQUIRED | REQUIRED | N/A | REQUIRED | N/A | N/A | N/A | SHARED | N/A |
| SURF-012 | BLOCKED | N/A | BLOCKED (UNAVAILABLE) | N/A | BLOCKED | N/A | N/A | SHARED | N/A |
| SURF-013 | BLOCKED | N/A | BLOCKED (UNAVAILABLE) | N/A | N/A | N/A | N/A | SHARED | N/A |
| SURF-014 | REQUIRED | REQUIRED | N/A (unificado em GuestRequestUnavailable) | REQUIRED (anti-enum.) | REQUIRED (então BLOCKED) | N/A | REQUIRED | N/A (sem sessão) | N/A |
| SURF-015 | REQUIRED | REQUIRED | REQUIRED (NOT_READY) | REQUIRED | REQUIRED | REQUIRED (If-Match) | REQUIRED | SHARED | N/A |
| SURF-016 | REQUIRED | N/A | N/A | REQUIRED (validation) | N/A | N/A | N/A | SHARED | N/A |
| SURF-017 | REQUIRED | N/A | N/A | REQUIRED (refresh failed) | REQUIRED (refreshing) | N/A | N/A | REQUIRED (é a própria superfície) | N/A |

`Permission` não aparece como `REQUIRED` em nenhuma linha porque nenhum caso real de `FORBIDDEN`
dentro do próprio tenant existe hoje (single-owner, sem `MEMBER`/`VIEWER` atribuído) — herdado do
SSI §20, não removido do vocabulário, só sem instância observável ainda.

---

## 32. Loading Variants

Aplicadas seletivamente, nunca "spinner genérico" (§16 do SSI, §30 do prompt-fonte):

- `INITIAL_LOADING`: `SURF-001/002/003/008/009/010/011` ao abrir — placeholder de conteúdo, nunca
  lista vazia.
- `BACKGROUND_REFRESH`: `SURF-001/002` ao retornar de uma ação em outra superfície — indicador
  discreto, sem substituir o conteúdo já visível.
- `ACTION_PENDING`: `SURF-004/005/007/015/016` durante submissão — campos desabilitados, "⏳
  [ação]…".
- `ASYNC_POLLING`: `SURF-015` (parse/commit, funcional); `SURF-006/014` (scan, estruturalmente
  presente mas sem resultado observável — o "polling" nunca produz avanço visível hoje).
- `LOAD_MORE`: `SURF-002/008` — dependente de paginação real (`PARTIAL`).

## 33. Empty Variants

- `EMPTY_TRUE`: `SURF-001` (nenhum vencimento), `SURF-002`/`SURF-008` (tenant novo).
- `EMPTY_FILTERED`: `SURF-002` com filtro de status sem resultado.
- `EMPTY_NOT_READY`: `SURF-010` (nenhuma solicitação criada ainda).
- `EMPTY_UNAVAILABLE`: `SURF-012`/`SURF-013` — sempre neste estado hoje, nunca confundido com
  `EMPTY_TRUE` (ausência de query ≠ ausência real de dados).
- `EMPTY_PERMISSION`: nenhuma instância hoje (registrado, não removido do vocabulário — ver §31).

## 34. Error Variants

Cobertos por superfície crítica conforme §18 do SSI (Validation/Network/Conflict/Permission/
Authentication/Processing/Unknown Outcome) — não redesenhados aqui um a um; ver cada wireframe de
superfície (§14-30) para a instância concreta aplicável.

## 35. Unknown Outcome Representation

Dois padrões estruturais distintos, nunca confundidos:

```
Padrão "não reconsultar automaticamente" (SURF-004, CREATE-IDEMPOTENCY-01):
  ⚠ resultado incerto → ação estrutural = ir para a coleção e o usuário decide

Padrão "reconsultar automaticamente é seguro" (SURF-005, SURF-015):
  ⚠ resultado incerto → ação estrutural = reconsulta automática, tela se autorresolve
```

A diferença entre os dois padrões é a existência real de idempotência no backend — nunca
apresentada como a mesma UI (§10/§14/§26 do SSI).

## 36. Async Processing Representation

`SURF-006`/`SURF-014` (scan de documento): representados até o limite real de observabilidade —
"upload enviado" é o teto, nunca uma barra de progresso de "verificando" sem dado real por trás.
`SURF-015` (import): representado ponta a ponta, incluindo re-entry funcional. `SURF-007` (ciclo de
lembrete): representado só até `POLICY_CONFIGURED` — nada além é desenhado como estado alcançável.

## 37. OCC / Conflict Representation

`SURF-003`/`SURF-005` (edição/renovação) e `SURF-015` (commit de import, `If-Match`): mensagem
própria ("isto mudou desde que você abriu"), nunca a mesma estrutura de erro genérico de rede —
ver wireframes individuais (§16, §18, §28).

## 38. Trust Requirements

`GTR-01` (`SURF-014`): bloco permanente enquanto não resolvido, nunca omitido. Anti-enumeração
(`SURF-014`): uma única superfície de "indisponível", nunca variantes visuais por causa interna.
Ações de alta consequência (`SURF-003` arquivar/excluir, `SURF-005` confirmar renovação, `SURF-011`
revogar): sempre `⚠[DANGEROUS]` com confirmação deliberada estrutural.

## 39. Accessibility Requirements

Consolidado de §36 do SSI, aplicado por wireframe: nenhum status só por cor (todo `[LABEL]` é
texto); erro sempre junto ao campo; upload sempre com alternativa a drag-and-drop
(`SURF-006`/`SURF-014`); interrupção de sessão sem estranhar navegação por teclado (`SURF-017`);
conclusão de loading sempre anunciada, nunca presumida pela ausência de spinner.

## 40. Mobile-Relevant Variants

Classificação por superfície:

```
desktop-primary:  SURF-001, 002, 003, 008, 009, 010, 011, 012, 013, 015, 016, 017
mobile-relevant:  SURF-004, 005, 006, 007 (uso ocasional em campo, não hipótese forte)
mobile-critical:  SURF-014 (Guest Submission)
```

**Variante estrutural mobile obrigatória — SURF-014**:

```text
┌─ SOLICITAÇÃO DE DOCUMENTO (mobile) ───────┐
│ [BLOQUEADO: GTR-01]                    A6│
│ Quem pede: não exibido hoje                │
│                                              │
│ Apólice de Seguro RC                        │
│ Prazo: 29/08/2026                            │
│                                              │
│ [ 📷 Tirar foto ]                       A7│
│ [ 📁 Escolher arquivo ]                     │
│                                              │
│ [PRIMARY: Enviar]                       A3│
│                                              │
│ (rede fraca: envio pode ser retomado com    │
│  segurança — reenvio do PUT é idempotente)  │
└──────────────────────────────────────────────┘
```

Considerações: câmera como caminho primário (não só fallback de drag-and-drop, que não existe em
mobile de qualquer forma); viewport pequeno não deve esconder o bloco `GTR-01`/prazo acima da
dobra; interrupção de rede durante envio tratada com o mesmo `UploadUnknownOutcome` do desktop, sem
duplicar lógica.

---

## 41. Journey Walkthroughs

Formato fixo (§55 do prompt-fonte): `Journey → Surface → State → Decision → Action → Next
Surface/State`.

**J-01 — Daily Operational Review**
```
SURF-001 (default) → decisão "o que exige atenção" → seleciona item vencido
→ SURF-003 (default, contexto="veio de Vencidos")
→ decisão "renovar ou verificar documento" → transiciona para J-03 ou J-04
→ (retorno) SURF-001 (BACKGROUND_REFRESH, reflete mudança)
```
Contexto preservado: `expirationId` + origem ("veio de: Vencidos"). Informação suficiente: sim
(status+data bastam para a decisão). Próximo passo claro: sim. Retorno compreensível: sim
(refresh visível, não substituição silenciosa). Feedback suficiente: sim. Estados alternativos
cobertos: `EMPTY_TRUE` (nada pendente — sucesso genuíno).

**J-02 — Create Expiration**
```
SURF-002 ou SURF-001 (SECONDARY: + Novo) → SURF-004 (INITIAL)
→ EDITING → VALIDATION_ERROR (se aplicável, dados preservados)
→ SUBMITTING → CREATED → SURF-003 (novo item) ou SURF-002
   [ramo alternativo: UNKNOWN_OUTCOME → SURF-002, usuário confirma manualmente]
```
Contexto preservado: nenhum necessário (journey curta). Informação suficiente: sim (progressive
complexity permite mínimo). Estados alternativos cobertos: `UNKNOWN_OUTCOME` com recovery seguro
explícito.

**J-03 — Renew Expiration**
```
SURF-003 (default) → SURF-005 (INITIAL, contexto="veio de: Detalhe")
→ EDITING_NEW_DUE_DATE → SUBMITTING
→ SUCCESS (dual claim) → SURF-003 (novo item, "Novo ciclo")
   [ramos: CONFLICT → reler estado; SOURCE_STATE_CHANGED → erro conhecido;
    UNKNOWN_OUTCOME → reconsulta automática segura]
```
Ver exemplo conceitual do prompt-fonte (§56) — coberto integralmente, incluindo os 5 critérios de
avaliação lá listados (contexto preservado: sim, `renewedFromId`; informação suficiente: sim;
próximo passo claro: sim; retorno compreensível: sim, "Novo ciclo" no título; feedback suficiente:
sim, dual claim; estados alternativos: sim, 3 ramos cobertos).

**J-04 — Maintain Document Evidence**
```
SURF-003 (seção Documento) → SURF-006 (READY, selecionar+enviar)
→ UPLOADING → "✓ upload enviado"
→ [BLOQUEADO: BLOCKER-A] — journey não tem exit de sucesso pleno alcançável hoje
```
Cobertura honesta: a journey é representada até o limite real de observabilidade, sem inventar um
"exit" que o domínio não sustenta (`LFW-G3` verificado, §48).

**J-05 — Reminder-Driven Action**
```
SURF-003 (seção Alerta) → SURF-007 (NO_ALERT → EDITING)
→ SUBMITTING → POLICY_CONFIGURED
→ [BLOQUEADO: BLOCKER-B] — journey não avança além da configuração salva
```

**J-06 — External Document Collection**
```
SURF-009 (Subject Detail) → SURF-010 (requisito MISSING)
→ SURF-011 (criar solicitação, acompanhar REQUESTED→OPENED→SUBMITTED)
→ [BRANCH POINT — BLOCKER-C, ver SURF-012 Variante A/B, nenhuma escolhida]
```

**J-07 — Guest Submission**
```
SURF-014 (RequestLoaded, GTR-01 incompleto) → FileSelected → ReservationAccepted
→ UploadAcceptedByBrowser → fim da journey (não retorna ao app — P6)
   [ramo: GuestRequestUnavailable — token inválido/expirado/revogado/não encontrado, mensagem única]
```

**J-08 — Bulk Import**
```
SURF-015 (INITIAL) → FILE_SELECTED → UPLOADING → PARSING (re-entry possível)
→ PREVIEW_READY (contagens) → COMMITTING → COMMITTED
→ SURF-002/SURF-008 (registros visíveis nas listas já existentes)
   [ramos: FAILED, EXPIRED, UNKNOWN_OUTCOME com reconsulta segura]
```

---

## 42. Cross-Journey Walkthroughs

**J-01 → J-03 → retorno a J-01**:
```
SURF-001 → SURF-003 → SURF-005 → SURF-003 (novo item) → SURF-001 (BACKGROUND_REFRESH)
```
Contexto preservado: o item novo (`newItemId`) substitui o antigo na Overview após refresh; nenhuma
referência órfã ao item de origem (que agora aparece como `[RENOVADO]` se ainda buscado
diretamente).

**J-06 → J-07 → retorno ao estado interno de J-06**:
```
SURF-011 (aguardando resposta do fornecedor)
  → [fora do app] SURF-014 (External Submitter, isolado)
  → UploadAcceptedByBrowser (fim da journey guest, sem retorno ao app)
  → [assíncrono, fora do controle do usuário interno] evento de scan
  → SURF-011 (se reconsultada) reflete `[DOCUMENTO RECEBIDO]`
  → SURF-012 (branch point, ainda não resolvido)
```
Nenhum contexto é literalmente "transferido" entre as duas superfícies — são dois atores, dois
dispositivos, duas sessões completamente distintas (herdado, J-06/J-07 nunca fundidas, §41 do SSI).
O que conecta as duas é só o estado persistido do `DocumentRequest`/`DocumentSubmission`, nunca
navegação direta.

---

## 43. Backend Blocker Annotations

Consolidado (ver Engineering Blocker Matrix completa em `interface-screen-and-state-inventory.md`
§41 — não duplicada aqui):

| Blocker | Superfícies com `[BLOQUEADO: ...]` visível |
|---|---|
| BLOCKER-A | SURF-003 (seção Documento), SURF-005 (aviso de continuidade), SURF-006 (bloco inteiro pós-envio) |
| BLOCKER-B | SURF-001 (ausência de resumo), SURF-003 (seção Alerta, aviso), SURF-007 (bloco inteiro) |
| BLOCKER-C | SURF-010 (nota no vínculo), SURF-011 (nota em DOCUMENTO RECEBIDO), SURF-012 (superfície inteira) |
| GTR-01 | SURF-014 (bloco de identidade do solicitante) |
| CREATE-IDEMPOTENCY-01 | SURF-004 (estado UNKNOWN_OUTCOME) |
| Full BFF (D-053/D-054) | SURF-017 (superfície inteira representa o design ainda não implementado) |
| Query tenant-wide de solicitações | SURF-013 (superfície inteira) |
| Guest sem rota pública pós-envio | SURF-014 (bloco pós-envio) |

---

## 44. Assumptions

- Agrupamento temporal simplificado a "Vencidos"/"Vence em breve" (não os 5 grupos hipotéticos do
  IA doc — Vencidos/Hoje/7 dias/30 dias/Depois) é suficiente para o wireframe de baixa fidelidade;
  a granularidade exata dos grupos é uma decisão de apresentação, não estrutural — `HYPOTHESIS`,
  revisável na prototipação.
- Lista simples (não tabela) é adequada para `SURF-002`/`SURF-008` na escala atual — decisão
  registrada com evidência em §15, não arbitrária.
- Seções Documento/Alerta embutidas em `SURF-003` (não superfícies próprias de navegação) refletem
  corretamente a obrigação de informação/decisão herdada — `STRONG INFERENCE` a partir do SSI §5.

## 45. Open Questions

Herdadas do SSI (§42), ainda sem resposta nesta etapa:
1. Branch point de `BLOCKER-C` (Alternativa A vs. B) — `SURF-012` representada em duas variantes,
   nenhuma escolhida.
2. Semântica de "documento vigente" — afeta como `SURF-006` evoluirá quando `BLOCKER-A` for
   resolvido (hoje a tela não precisa decidir isso, porque não há nada para mostrar).
3. Nome final de `Subject`/`Fornecedor` por vertical — usado "Fornecedores" como working label em
   todos os wireframes, sem cristalizar.
4. Necessidade real de "reenviar" solicitação — `SURF-011` não tem essa ação hoje; se confirmada,
   seria uma `(SECONDARY)` adicional, não uma nova superfície.
5. Query tenant-wide de solicitações — determina se `SURF-013` sai de `[BLOQUEADO]`.

**Nova desta etapa**: os 5 grupos temporais completos (Vencidos/Hoje/7 dias/30 dias/Depois) vs. os
2 usados nos wireframes (Vencidos/Vence em breve) — qual granularidade real o Interaction Prototype
deve testar? Registrado para validação, não decidido aqui.

## 46. Rejected Wireframe Assumptions

- **"Toda superfície `BLOCKED` deve ser omitida do wireframe"** — rejeitado: `SURF-006`, `SURF-007`,
  `SURF-012`, `SURF-013`, `SURF-017` foram todas desenhadas com bloco `[BLOQUEADO: ...]` explícito
  (§71 do prompt-fonte).
- **"Um aviso de UI resolve um blocker técnico"** — rejeitado: nenhum wireframe usa copy do tipo
  "pode não funcionar" como substituto de correção de backend (§72 do prompt-fonte) — o bloco
  `[BLOQUEADO]` nomeia a dependência real, nunca minimiza o problema.
- **"500 registros = tabela"** — rejeitado explicitamente em `SURF-002`/`SURF-008` (§15, decisão
  registrada com evidência de escala real, não de volume hipotético).
- **"Toda diferença de estado exige um wireframe novo"** — rejeitado: variantes documentadas como
  `BASE + STATE VARIANTS` (§59 do prompt-fonte), nunca um arquivo por estado trivial.
- **"Guest pode ver um resumo de progresso do scan enquanto aguarda"** — rejeitado: nenhum
  wireframe de `SURF-014` implica progresso de verificação observável, mesmo como "aguardando" —
  o teto é sempre "envio recebido" (§38 do prompt-fonte).
- **"OCC é só mais um tipo de erro de rede"** — rejeitado em `SURF-003`/`SURF-005`/`SURF-015`, cada
  um com mensagem própria de conflito.

---

## 47. Codex Review

Revisão adversarial independente (Codex, sandbox read-only, código real e documentos aprovados
verificados — não confiando no texto da Rodada A), respondendo aos 30 pontos de crítica do
prompt-fonte mais verificações factuais pontuais. Veredito: **5 furos reais + 1 divergência
factual adicional sobre `Dependencies`** — nenhum exige redesenhar a arquitetura de wireframes;
todos pontuais/textuais, exceto o ajuste de `SURF-006` (estrutural dentro daquela superfície).

**24 pontos sem furo** (verificados e confirmados corretos): as 17 superfícies aparecem, nenhuma
inventada (1-2); walkthrough cobre J-01 a J-08 (3); nenhum wireframe é só happy path (4);
Decision Inventory essencial presente (5); ações de alta consequência com `⚠[DANGEROUS]` e
confirmação deliberada (7); nenhum campo técnico de backend exposto sem necessidade (8);
loading/empty/error/async não comprimidos (9); `CLEAN` nunca vira aprovação (11);
`UNKNOWN_OUTCOME` nunca vira `FAILED` (13); `SURF-004` sem retry automático — confirmado contra
`expiration-service.ts:80-114` (14); `BLOCKER-B` explícito, nunca "você será avisado" (16);
`BLOCKER-C` não decidido silenciosamente, A/B lado a lado (17); `GTR-01` presente no Guest
Submission, inclusive mobile (18); guest nunca recebe claim de verificação de segurança (19);
anti-enumeração preservada, confirmado contra `guest-handlers.ts` (20); loading≠empty (21);
`EMPTY_TRUE`≠`EMPTY_FILTERED` (22); OCC como `CONFLICT` próprio (23); contexto preservado nas
transições principais (24); guest isolado da navegação do SaaS (25); variante mobile guest viável
(26); status nunca só por cor (27); labels visíveis nos formulários principais (28); nenhuma
decisão visual prematura (29).

**5 furos reais + 1 divergência factual**:

6. **Ação primária ambígua em superfícies de coleção**: `SURF-001`/`SURF-002`/`SURF-008`/`SURF-009`
   descreviam a ação primária ("abrir item") em prosa, mas as linhas de lista não traziam
   `[PRIMARY: Abrir]` explícito. **Correção**: affordance primária adicionada a cada linha clicável
   nas 4 superfícies.
10/15. **`SURF-006` mascarava `BLOCKER-A` no próprio estado inicial**: "Nenhum documento enviado
   ainda para este vencimento" é uma afirmação que a interface não tem como confirmar (nenhuma
   rota de leitura existe, nem mesmo para saber se já existe algo) — não é um vazio genuíno, é
   `NOT_CURRENTLY_OBSERVABLE` desde o primeiro render. **Correção**: estado inicial reescrito para
   declarar a incerteza explicitamente, com bloco `[BLOQUEADO: BLOCKER-A]`.
12. **`SATISFIED` reaproximado de "compliance atual" na Variante A de `SURF-012`**: a frase
   "marcar compliance como satisfeita" reintroduzia exatamente a equivalência que a Epistemic
   Integrity Matrix do SSI proíbe. **Correção**: reescrito para "gravar o vínculo... nunca
   'compliance atual'".
30. **Product creep — WhatsApp em `SURF-007`**: a opção de canal "WhatsApp (indisponível)" não
   tem lastro (`interface-context-and-critical-tasks.md` rejeita WhatsApp explicitamente como
   assumption do MVP). **Correção**: removido; só "Canal: E-mail" permanece.
Adicional. **`Dependencies` incompletas na tabela de priorização**: `Full BFF` só aparecia anotado
   em `SURF-017`, quando na verdade é dependency herdada de toda superfície autenticada (SSI
   §5/§40/§41). **Correção**: nota explícita adicionada antes da tabela.

## 48. Reconciliation

Os 5 furos reais + 1 divergência factual foram aceitos e corrigidos:

| Finding | Evidence | Accepted/Rejected | Change |
|---|---|---|---|
| #6 Ação primária ambígua em coleções | SURF-001/002/008/009, linhas de lista sem affordance | **Accepted** | `[PRIMARY: Abrir]` adicionado a cada linha nas 4 superfícies |
| #10/#15 SURF-006 mascara BLOCKER-A no estado inicial | comparado com SSI §5 (BLOCKER-A bloqueia toda leitura, não só pós-scan) | **Accepted** | Estado inicial reescrito, bloco `[BLOQUEADO: BLOCKER-A]` desde o primeiro render |
| #12 SATISFIED≈compliance na Variante A de SURF-012 | comparado com Epistemic Integrity Matrix, SSI §31 | **Accepted** | Reescrito para preservar "vinculado", nunca "compliance atual" |
| #30 WhatsApp em SURF-007 (product creep) | `interface-context-and-critical-tasks.md` rejeita WhatsApp no MVP | **Accepted** | Opção removida, só e-mail permanece |
| Dependencies incompletas (Full BFF) | SSI §5/§40/§41 lista Full BFF em toda superfície autenticada | **Accepted** | Nota explícita adicionada antes da tabela de priorização |

Nenhuma divergência estrutural remanescente — as 17 superfícies, os 8 walkthroughs de journey, os
3 blockers nomeados, `GTR-01`, `CREATE-IDEMPOTENCY-01` e a arquitetura de informação herdada
permanecem intactos. O amendment desta rodada foi inteiramente sobre precisão de affordance
(ação primária visível), disciplina de Epistemic Integrity em dois pontos residuais, e remoção de
uma opção sem lastro — não sobre reabrir decisões estruturais de superfície ou de journey.

## 49. Quality Evaluation

| Eixo | Aplicável? | Avaliação |
|---|---|---|
| TaskSuitability | Sim | Toda journey T0 tem walkthrough completo (§41); nenhum exit inventado além do que o domínio sustenta |
| InformationArchitecture | Sim | Navegação conceitual (§9) consistente com a IA já aprovada; nenhuma área nova |
| InformationPresentation | Sim | Hierarquia primary/secondary/contextual explícita por superfície (§14-30) |
| SystemFeedback | Sim | Feedback obligation materializada em símbolo+texto pareado (§5, §32) |
| ErrorRobustness | Sim | Taxonomia de erro do SSI aplicada por wireframe (§34); OCC/Unknown Outcome tratados como estados próprios (§35, §37) |
| Forms | Sim | `SURF-004/005/007/011/016` com label visível, obrigatório/opcional explícito, erro por campo |
| DataOperations | Sim | Decisão estrutural registrada para list vs. table (§15), com evidência, não arbitrária |
| Accessibility | Sim | Requisitos consolidados por wireframe (§39); variante mobile crítica produzida (§40) |
| Consistency | Sim | Convenções estruturais (§5) aplicadas identicamente nas 17 superfícies |
| Content | Sim | Vocabulário epistemicamente correto (`[ARQUIVO VERIFICADO]`, `[VINCULADO A UM VENCIMENTO]`) em todo wireframe onde aplicável |
| Trust | Sim | GTR-01, anti-enumeração, ações de alta consequência tratados estruturalmente (§38) |
| Responsiveness | Parcial | Classificação desktop/mobile feita (§40); breakpoints detalhados ficam para fase visual |

## 50. Final Status

**`APPROVED AS INPUT FOR INTERACTION PROTOTYPE`**

Motivo: revisão adversarial independente (Codex, 2 rodadas — B e D) encontrou 5 furos reais + 1
divergência factual adicional (ação primária ambígua em 4 coleções; `BLOCKER-A` mascarado no
estado inicial de `SURF-006`; `SATISFIED` reaproximado de compliance atual na Variante A de
`SURF-012`; product creep de canal WhatsApp em `SURF-007`; `Dependencies` de `Full BFF`
incompletas na tabela de priorização) — todos corrigidos e confirmados na Rodada D, nenhum
estrutural. Nenhum dos 12 gates (`LFW-G1` a `LFW-G12`) foi violado: nenhuma informação crítica
para decisão T0/P0 ausente (`LFW-G1`); nenhum estado material aprovado sem representação
(`LFW-G2`); nenhuma claim de UI excede o domínio, depois das correções da Rodada C (`LFW-G3`);
toda ação de alta consequência tem prevenção estrutural (`LFW-G4`); toda falha previsível tem
caminho de recuperação compreensível (`LFW-G5`); `UNKNOWN_OUTCOME` nunca vira retry automático
inseguro (`LFW-G6`); `GTR-01`/guest trust tratados como requisito central, não nota de rodapé
(`LFW-G7`); anti-enumeração preservada em toda variante (`LFW-G8`); nenhuma estrutura exige
interação inacessível sem alternativa (`LFW-G9`); contexto preservado nas transições principais e
cross-journey (`LFW-G10`); nenhuma decisão cosmética domina a fase — grayscale conceitual mantido
em todo o documento (`LFW-G11`); nenhuma funcionalidade sem lastro em outcome/journey aprovada,
inclusive depois de remover o WhatsApp sem lastro (`LFW-G12`).

Respondendo às 30 perguntas obrigatórias (§80 do prompt-fonte): cada journey tem entry point e
walkthrough completo (§41); a informação que aparece primeiro segue Attention First (urgência antes
de metadado administrativo, §14 do prompt-fonte, aplicado em `SURF-001`/`SURF-002`); ação primária
sempre `[PRIMARY]`, nunca ambígua (corrigido na Rodada C); ações perigosas sempre `⚠[DANGEROUS]`
com confirmação deliberada; processamento/conclusão/falha/resultado desconhecido têm representação
distinta em toda superfície assíncrona (§35-37); recuperação de erro é sempre específica, nunca
genérica (§34); loading≠empty≠filtered-empty em toda coleção (§32-33); OCC tem estado `CONFLICT`
próprio (§37); sessão expirada preserva superfície/identificador de retorno (`SURF-017`, §30);
datas sempre absolutas+relativas (§50 do prompt-fonte, aplicado em todo wireframe com data);
nenhum estado depende só de cor (§39); guest sabe quem pede só quando `GTR-01` for resolvido (hoje
anotado como bloqueado, nunca fingido) e nunca recebe claim de verificação que a API não sustenta
(§27, §38); `BLOCKER-A`/`BLOCKER-B` anotados onde materialmente relevantes (§43); `BLOCKER-C`
permanece sem decisão silenciosa, representado em duas variantes (`SURF-012`, §25);
`CREATE-IDEMPOTENCY-01` reflete-se na ausência estrutural de retry automático em `SURF-004` (§17);
arquitetura dual-anchor permanece coerente nos dois lotes de produção (§14-26); nenhum campo
técnico vazou; nenhuma feature foi inventada (WhatsApp removido na reconciliação); as 17
superfícies aprovadas têm wireframe; nenhuma journey T0/P0 ficou sem caminho completo (J-04/J-05/
J-06 representadas honestamente até o limite real de observabilidade, não além). Pronto para a
próxima etapa (Interaction Prototype), carregando os 17 wireframes, a State Coverage Matrix (§31),
os walkthroughs de journey (§41-42) e as Open Questions (§45) como input de entrada.

---

*Documento produzido a partir da leitura integral de `interface-screen-and-state-inventory.md`
(fonte imediata de verdade) — as três etapas anteriores foram consumidas por herança através dela,
não relidas do zero, conforme instrução da missão.*
