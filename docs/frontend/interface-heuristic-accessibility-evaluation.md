---
status: APPROVED AS INPUT FOR USER VALIDATION — Rodadas A/B/C/D completas (protocolo Claude↔Codex, AGENTS.md §4)
owner: Marcelo
authority: insumo para User Validation (próxima etapa) — não normativo de identidade visual
---

# Expiration Tracker — Heuristic + Accessibility Evaluation

Sétima etapa formal do planejamento de interface. Objeto primário de avaliação: o **protótipo
executável** em `prototype/` (não apenas a documentação que o descreve). Onde documentação e
execução divergiram, o achado foi registrado a favor do comportamento observado, nunca assumido a
partir do texto.

---

## 1. Executive Summary

- **9 findings reais, todos encontrados por execução real** (navegador headless, instrumentação de
  DOM, contagem de listeners, cálculo de contraste) — não por leitura de código isoladamente.
  **3 S3 (Major), 4 S2 (Moderate), 2 S1 (Minor), 0 S4.** Todos corrigidos e reverificados nesta
  mesma etapa (política de reconciliação, §90 do prompt-fonte).
- **Achado mais sério, não hipotetizado no prompt-fonte**: um padrão de re-render parcial
  (`afterRender()` chamado repetidamente sobre o mesmo `#app` sem substituir `innerHTML`) causava
  **acúmulo exponencial de event listeners duplicados** — instrumentado e medido diretamente: 3
  ciclos de abrir/cancelar o diálogo de confirmação de arquivamento fizeram o botão "Excluir"
  acumular **8 listeners de clique** (não 4, como uma soma linear sugeriria — o próprio botão
  "Arquivar" também se tornou duplicado, então cada clique nele disparava múltiplas vezes,
  compondo o problema). Reproduzido concretamente como duplicação real de registro: dois cliques
  rápidos em "Criar vencimento" criavam **dois itens distintos**. Corrigido substituindo o padrão
  por **delegação de eventos** (um único binding permanente em `#app`), eliminando a causa raiz
  inteira, não só o sintoma.
- **Falha estrutural de responsividade real, não cosmética**: em qualquer largura ≤375px CSS
  (inclusive a largura de referência do WCAG 1.4.10, 320px), toda superfície autenticada exigia
  rolagem horizontal — causa raiz isolada empiricamente (não por suposição): âncoras `<a>`
  adjacentes sem espaço em branco entre elas nunca recebem oportunidade de quebra de linha em
  fluxo block/inline puro, mesmo com `flex-wrap` ausente. Corrigido convertendo a navegação
  estrutural para `display:flex; flex-wrap:wrap`.
- **Ausência de skip link** (WCAG 2.4.1, Nível A): a navegação estrutural precede todo o conteúdo
  em ordem de tabulação/leitura em toda superfície autenticada — 5-6 paradas de tab antes de
  qualquer conteúdo real, repetido a cada transição. Corrigido com skip link funcional (cuidado
  real descoberto durante a correção: um `href="#surface-content"` ingênuo colidiria com o roteador
  hash-based do próprio app — corrigido usando `data-action` antes de virar um segundo bug).
- **Ausência de semântica de lista** (WCAG 1.3.1, Nível A) em toda coleção repetitiva; **alvo de
  toque abaixo do mínimo** (WCAG 2.2 SC 2.5.8, AA) no `<input type="file">` nativo em
  `SURF-006`/`SURF-014` (guest mobile); **Escape não fechava confirmações** (H3); **vazamento de
  jargão técnico** ("tenant", "idempotência", caminhos de API literais) em 3 mensagens
  end-user-facing. Todos corrigidos.
- **Nenhum S4. Nenhum gate failure remanescente. Nenhum problema de epistemic integrity,
  anti-enumeration, ou blocker mascarado foi encontrado** — verificado exaustivamente por grep de
  arquivo inteiro (não amostragem), não só pelos cenários de teste (§20, §31, §32, §33, §35, §36).
- Revisão adversarial Claude↔Codex completa (Rodadas A→D) — ver §42-43.
- **Status final: `APPROVED AS INPUT FOR USER VALIDATION`** (ver §45 para o raciocínio completo).

---

## 2. Scope

Avaliação do protótipo executável (`prototype/index.html`, `prototype/styles.css`,
`prototype/app.js`) contra: heurísticas de Nielsen, os 12 eixos do Interface Engineering Quality
Standard do projeto, WCAG 2.2 nível AA (onde avaliável na fidelidade atual), e as 8 journeys
críticas re-executadas (`J-01`–`J-08`). Fora de escopo: estética final, identidade visual, teste
com usuários reais (próxima etapa), resolução de `BLOCKER-A/B/C`/`GTR-01`/`CREATE-IDEMPOTENCY-01`.

## 3. Baseline Commit

```
Branch: develop
Baseline commit avaliado: 10a9a37 (fix(lint): exclude prototype/ from the Node/TS ESLint ruleset)
git status no início: limpo (working tree clean)
npm run check-docs no início: PASS (191 arquivos, sem link quebrado)
```

Todas as correções desta etapa foram aplicadas **depois** da avaliação completa do baseline acima
(§6 do prompt-fonte — não corrigir durante a primeira passada), registradas por finding em §38.

## 4. Evaluation Method

Combinação de quatro perspectivas (§7 do prompt-fonte), todas executadas de fato, não só
documentadas:

- **Inspeção de código**: leitura de `app.js`/`styles.css`, greps exaustivos de arquivo inteiro
  para vocabulário epistêmico e jargão técnico (não amostragem por cenário).
- **Execução em navegador headless (Playwright/Chromium)**: os 34 Prototype Scenario IDs
  percorridos automaticamente; formulários preenchidos e submetidos de fato; fluxos completos de
  OCC/UNKNOWN_OUTCOME/sessão executados ponta a ponta.
- **Teste por teclado**: navegação por Tab/Shift+Tab/Enter/Escape em J-01, J-02, J-03; varredura
  de 40 tabs para detectar keyboard trap; ordem de foco medida elemento a elemento (não assumida).
- **Inspeção semântica + `axe-core`** (WCAG 2.2 AA, `wcag2a`/`wcag2aa`/`wcag21aa`/`wcag22aa`)
  executado sobre 20 estados de superfície reais, restrito a `#app` (a barra de controle
  PROTOTYPE-ONLY foi deliberadamente excluída da varredura, pois não é parte da interface avaliada).
- **Raciocínio manual não substituído por ferramenta** (§13 do prompt-fonte): o próprio `axe-core`
  não detecta ausência de skip link, jargão técnico, foco pós-transição, duplicação de listener,
  ou reflow — todos os achados desta etapa vieram de teste manual/instrumentado, não da ferramenta
  automática (que reportou **zero violações** em todos os 20 estados, antes e depois das
  correções — uma confirmação de que a ferramenta sozinha teria dado falso sinal de "tudo certo").

## 5. Applicable Standards

Nielsen's 10 Usability Heuristics; os 12 eixos do Interface Engineering Quality Standard do
projeto (TaskSuitability, InformationArchitecture, InformationPresentation, SystemFeedback,
ErrorPrevention/Recovery, Forms, DataOperations, Accessibility, Consistency, Content,
Responsiveness, Trust/Risk); WCAG 2.2 nível AA.

## 6. Severity Model

```
S0 — Cosmetic / Observation
S1 — Minor      (mitigado por alternativa existente; baixo impacto/frequência)
S2 — Moderate   (impacto real mas não bloqueante; recorrente ou afeta múltiplas superfícies)
S3 — Major      (pervasivo — afeta toda journey/superfície de um tipo — ou consequência de
                 domínio real como duplicação de registro; ainda recuperável)
S4 — Critical   (bloqueia journey crítica, perda de dados irreversível, violação de segurança/
                 anti-enumeration, ou epistemic violation não mitigada)
```

Dimensões consideradas por finding (§10 do prompt-fonte): frequência, impacto, persistência,
recuperabilidade, criticidade da journey afetada, risco de confiança, impacto de acessibilidade,
consequência de domínio/dado.

## 7. Quality Gates

| Gate | Definição | Status nesta avaliação |
|---|---|---|
| Critical Task Gate | Nenhuma journey T0/P0 fica impossível de completar por defeito do protótipo (não por blocker aprovado) | PASS (ver §21-33) |
| Information Integrity Gate | Nenhuma claim de UI excede o que o domínio sustenta | PASS (ver §20, verificado exaustivamente) |
| Error Safety Gate | Nenhum retry inseguro; nenhuma duplicação de mutação por defeito de UI | PASS **depois da correção** (achado real: duplicação por acúmulo de listeners — corrigido) |
| Accessibility Gate | Sem falha estrutural bloqueante; WCAG AA nas áreas avaliáveis | PASS **depois da correção** (4 achados reais — corrigidos) |
| Interaction State Gate | Todo estado assíncrono relevante é perceptível e distinto | PASS (ver §17, §28) |

---

## 8. Prototype Coverage

### Prototype Scope Matrix

| Surface | Interactive? | States simulated | Journeys | Mobile | Blockers |
|---|---|---|---|---|---|
| SURF-001 Overview | Sim | loading, EMPTY_TRUE, erro | J-01 | desktop-primary | BLOCKER-B (anotado) |
| SURF-002 Expiration Collection | Sim | filtros, EMPTY_TRUE, EMPTY_FILTERED, erro | J-01,02,08 | desktop-primary | — |
| SURF-003 Expiration Detail | Sim | not-found, CONFLICT, confirmações | J-01,03,04,05 | desktop-primary | BLOCKER-A, BLOCKER-B |
| SURF-004 Expiration Creation | Sim | validation, submitting, success, UNKNOWN_OUTCOME | J-02 | mobile-relevant | CREATE-IDEMPOTENCY-01 |
| SURF-005 Expiration Renewal | Sim | validation, CONFLICT, SOURCE_CHANGED, success, UNKNOWN_OUTCOME | J-03 | mobile-relevant | BLOCKER-A (indireto) |
| SURF-006 Document Context | Sim | not-observable inicial, uploading, unknown, "enviado" efêmero | J-03,04 | mobile-relevant | BLOCKER-A |
| SURF-007 Alert Configuration | Sim | NO_ALERT, validation, POLICY_CONFIGURED | J-05 | mobile-relevant | BLOCKER-B |
| SURF-008 Subject Collection | Sim | lista, contagens | J-06 | desktop-primary | — |
| SURF-009 Subject Detail | Sim | lista de requisitos | J-06 | desktop-primary | — |
| SURF-010 Requirement Context | Sim | EMPTY_NOT_READY, link (CONFIRMED) | J-06 | desktop-primary | BLOCKER-C (outcome) |
| SURF-011 Document Request Context | Sim | REQUESTED→OPENED→SUBMITTED, REVOKED | J-06 | desktop-primary | BLOCKER-C (nota) |
| SURF-012 Submission Review | Sim (2 variantes) | Variante A/B simuladas | J-06 (branch) | desktop-primary | BLOCKER-C |
| SURF-013 Requests Collection | Sim (estático) | sempre bloqueado | J-06 (suporte) | desktop-primary | query tenant-wide inexistente |
| SURF-014 Guest Submission | Sim | loaded, fileSelected, reserving, reservationAccepted, sent, unknown, unavailable | J-07 | **mobile-critical** | GTR-01, guest gap |
| SURF-015 Import Flow | Sim | 8 estágios + FAILED + EXPIRED + UNKNOWN_OUTCOME + re-entry | J-08 | desktop-primary | erro por linha (PARTIAL) |
| SURF-016 Settings | Sim | salvar preferências | apoio | desktop-primary | — |
| SURF-017 Session Recovery | Sim | expiração + reautenticação | cross-cutting | desktop-primary | Full BFF |

Nenhuma das 17 superfícies desapareceu; nenhuma nova foi criada.

## 9. Journey Coverage

Todas as 8 journeys foram re-executadas nesta etapa (não apenas revisitadas na documentação) —
ver §21-28 para o detalhe por journey, com evidência de execução real.

## 10. State Coverage

A taxonomia de estado do Screen + State Inventory foi confirmada presente e distinta em cada
superfície (loading/empty/error/async/conflict/unknown-outcome), sem nenhuma compressão
encontrada nesta rodada além do que já fora corrigido em etapas anteriores.

---

## 11. Nielsen Heuristic Evaluation

### H1 — Visibility of System Status

Loading (`⏳`), processando, sucesso (`✓`), falha (`✕`) e resultado desconhecido (`⚠`) usam símbolo
+ texto sempre pareados, verificado por grep de arquivo inteiro (nenhuma instância de símbolo
sozinho). Região `aria-live="polite"` anuncia toda transição relevante — confirmado presente e
disparado em criação, renovação, upload, import, revogação e expiração de sessão (execução real,
§17). **Sem finding novo.**

### H2 — Match Between System and Real World

`CLEAN`→"Arquivo verificado" (nunca "Aprovado"), `SATISFIED`→"Vinculado a um vencimento" (nunca
"Em dia"/"Regular"/"Compliance"), "Alerta" (não "política de lembrete") — confirmados por grep
exaustivo, nenhuma exceção encontrada. **Achado real**: 3 mensagens usavam jargão de backend
("tenant", "idempotência", caminho de API literal) — ver `CONTENT-001/002/003`, §38, corrigidos.

### H3 — User Control and Freedom

Usuário pode voltar (nav estrutural + link "Voltar"/"Voltar ao detalhe"), cancelar formulários
(navegação), cancelar confirmações (botão "Cancelar", reachable). **Achado real (`HE-002`)**:
Escape não fechava diálogos de confirmação inline — mitigado (botão presente), mas quebra a
convenção mais comum. Corrigido.

### H4 — Consistency and Standards

Convenções de `[STATUS]`, `[PRIMARY]`/`(SECONDARY)`/`⚠[DANGEROUS]`, `[BLOQUEADO: ...]` aplicadas
identicamente nas 17 superfícies — confirmado por inspeção cruzada de `app.js`. **Sem finding
novo.**

### H5 — Error Prevention

**Achado real mais sério da rodada (`HE-003`, S3)**: nenhuma proteção contra duplo-clique existia
em nenhuma ação mutante assíncrona; o padrão de re-render parcial causava acúmulo de listeners
duplicados, reproduzido concretamente como duplicação de registro (criação de item). Corrigido via
delegação de eventos + guarda de desabilitação. Renovar≠Editar comunicado antes da confirmação
(preservado, verificado). Exclusão/arquivamento/revogação exigem confirmação deliberada
(preservado).

### H6 — Recognition Rather Than Recall

Datas sempre absolutas + relativas (`30/08/2026 (em 7 dias)`), status sempre visível junto ao
objeto, versão OCC nunca exposta como número técnico ao usuário. **Sem finding novo.**

### H7 — Flexibility and Efficiency

Nenhum atalho inventado sem evidência (correto, per §7 do prompt-fonte — "não inventar atalhos
apenas por esta heurística"). Progressive complexity na criação (campos opcionais colapsados)
preservada. **Sem finding.**

### H8 — Aesthetic and Minimalist Design (interpretado como relevância de informação)

Overview não inclui métricas decorativas; nenhuma informação compete com a pergunta "o que precisa
de atenção" — confirmado por execução (§22). **Sem finding.**

### H9 — Help Users Recognize, Diagnose, and Recover from Errors

Cada classe de erro tem mensagem própria (Validation/Conflict/Unknown Outcome/Security
rejection/Domain state changed) — nunca "Something went wrong" genérico, confirmado por grep e
por execução do fluxo OCC completo (§23). **Sem finding novo** além dos já corrigidos em `CONTENT`.

### H10 — Help and Documentation

Nenhuma superfície exige explicação verbal externa para ser operada — confirmado pelo walkthrough
cognitivo (§34); os blocos `[BLOQUEADO: ...]` funcionam como autoexplicação inline, não como
documentação externa necessária. **Sem finding.**

---

## 12. Accessibility Evaluation Method

Ver §4. `axe-core` (regras `wcag2a`/`wcag2aa`/`wcag21aa`/`wcag22aa`) executado sobre 20 estados de
superfície reais antes e depois das correções: **0 violações em ambas as rodadas** — a ferramenta
não capturou nenhum dos 5 achados de acessibilidade reais desta etapa (skip link, reflow, target
size, list semantics — a única que uma ferramenta poderia teoricamente flagar sob regras mais
amplas não incluídas aqui —, jargão). Confirma §13 do prompt-fonte: "axe passa" ≠ "acessível".

## 13. Keyboard Evaluation

Testado: Tab/Shift+Tab em J-01 (Overview→Detail), J-02 (formulário completo de criação, incluindo
os 4 sub-campos internos do `<input type="date">` — comportamento nativo do navegador, verificado
por reprodução isolada antes de ser descartado como não-defeito), J-03 (renovação + OCC +
recovery), varredura de 40 tabs para keyboard trap (nenhum encontrado, 18 alvos únicos, ciclo
correto). Escape testado em confirmações de alta consequência (achado real, corrigido). Ver §38
para o detalhe completo de cada achado.

## 14. Focus Evaluation

Foco movido para `main#app` (`tabindex="-1"`) em toda transição de rota completa — confirmado por
instrumentação direta em: criação bem-sucedida, `UNKNOWN_OUTCOME`, conflito OCC + recovery +
sucesso, expiração de sessão + reautenticação + retorno ao contexto original, exclusão. **Achado
real**: nenhuma pista adicional de foco (ex. para o primeiro campo inválido) após falha de
validação — mitigado pela região `aria-live`, mas não corrigido nesta rodada por ser uma melhoria
incremental de baixo risco/baixo retorno face ao formulário já ser curto (2-4 campos) e o foco já
permanecer no próprio botão de submit (não perdido, só não redirecionado) — registrado como
observação S0/S1 não bloqueante, não como finding formal.

## 15. Semantic HTML Evaluation

Headings: `<h1>` único por superfície, `<h2>` só para subseções, nenhum salto de nível — confirmado
por `axe-core` (regra `heading-order`, 0 violações) e por listagem manual em 20 estados.
Landmarks: `<main>`, `<nav aria-label>`, `<form>` usados corretamente; nenhum landmark supérfluo.
**Achado real (`A11Y-003`)**: coleções repetitivas usavam `<div>`, não `<ul>/<li>` — corrigido.
Links vs. botões: confirmado por grep — nenhum `<a>` com `data-action` (mutação), nenhum `<button>`
com `href` (navegação) — semântica sempre correta. Tabelas: nenhuma usada; nenhuma necessidade de
`role="grid"` identificada (dados de baixa densidade, decisão já herdada do Low-Fidelity
Wireframes, não reaberta). **Nenhuma ARIA desnecessária adicionada** — princípio "no ARIA is
better than bad ARIA" respeitado; os únicos atributos ARIA usados são `aria-label` (nav),
`role="status"`/`aria-live="polite"` (feedback) e `aria-describedby` (Settings, associação de
campo a rótulo agrupador) — todos com função real, nenhum decorativo.

## 16. Forms Evaluation

| Form | Labels | Required indicado | Erro associado ao campo | Valores preservados em erro | Duplicate prevention |
|---|---|---|---|---|---|
| Criação (SURF-004) | Sim (`<label for>`) | Sim (`*`) | Sim | Sim | **Corrigido nesta etapa** |
| Renovação (SURF-005) | Sim | Sim | Sim | Sim | **Corrigido nesta etapa** |
| Alerta (SURF-007) | Sim | N/A (número) | Sim | N/A | **Corrigido nesta etapa** |
| Solicitação externa (SURF-011, criar) | Sim | Sim | — (sem validação customizada, campos com valor padrão) | N/A | N/A (síncrono) |
| Guest upload (SURF-014) | Sim | N/A | Sim (tipo/tamanho) | N/A | N/A (síncrono até o clique final, guardado) |
| Import (SURF-015) | Sim (`<label>` no seletor de arquivo) | N/A | N/A (sem validação de campo, só de arquivo) | N/A | N/A (síncrono no clique "Continuar") |
| Settings (SURF-016) | Sim (`<label>` — wrapping, confirmado válido por `axe-core` e inspeção de árvore de acessibilidade, apesar de uma heurística própria imprecisa ter inicialmente sinalizado falso positivo — ver §38) | N/A | N/A | N/A | N/A |

**Nenhum campo depende de `placeholder` como único identificador** (§18 do prompt-fonte,
verificado — nenhuma instância). Todos os `<form>` usam `novalidate` (herdado da etapa anterior)
para que a validação customizada, não a nativa do navegador, controle a mensagem — confirmado
ainda presente.

## 17. Errors and Validation

Momento da validação: no submit (client-side), nunca só no blur silencioso. O que falhou: mensagem
específica por campo (`Nome — obrigatório.`, `Data de vencimento — deve ser posterior a...`).
Onde: `.field-error` imediatamente após o campo. Dado preservado: confirmado por execução (criar
com nome preenchido + data vazia → erro só na data, nome permanece). Correção possível: sempre
(reenviar). **Nunca só cor** — todo erro é texto. Erro-resumo global: **avaliado e considerado
desnecessário** (§20 do prompt-fonte) — todos os formulários têm ≤4 campos, erro por campo é
proporcional; nenhum formulário desta etapa justifica um resumo agregado adicional.

## 18. Async Status Accessibility

`⏳ enviando…` → `✓`/`⚠`/`✕`, sempre anunciado via `aria-live`, confirmado em: criação, renovação,
upload de documento, envio guest (agora com 3 estados distintos —
`reserving`→`reservationAccepted`→`sent`, cada um anunciado separadamente), import (5 estágios),
revogação. **Nenhum estado assíncrono depende só de indicador visual.**

## 19. Responsive / Mobile Evaluation

Guest mobile (360×640): sem overflow horizontal, bloco GTR-01 acima da dobra, zoom 200% simulado
sem quebra de layout nem perda de conteúdo, caminho de rede fraca funcional, seleção de arquivo
nativa (sem exigir drag-and-drop). **Achado real (`A11Y-004`)**: alvo de toque do `<input
type="file">` abaixo de 24px — corrigido. Autenticado, viewport estreito (320-375px): **achado real
(`A11Y-002`, reflow)** — corrigido. Ver §31-33.

## 20. WCAG 2.2 AA Findings

Nenhum critério foi marcado como falho sem evidência concreta de execução (§71 do prompt-fonte —
"no speculative WCAG failures"); onde um critério não pôde ser determinado na fidelidade atual
(ex. contraste de uma paleta de marca ainda não definida), foi marcado `NOT ASSESSABLE AT CURRENT
FIDELITY`, não inventado como falha. Nenhum critério foi listado sem finding real associado (§103
do prompt-fonte — não inflar checklist).

| Finding | WCAG SC | Level | Evidence | Severity | Resolution |
|---|---|---|---|---|---|
| A11Y-001 | 2.4.1 Bypass Blocks | A | Nav repetida precede conteúdo em toda superfície, medido por ordem de tab | S3 | Skip link adicionado (`data-action`, não `href` — evita colisão com o roteador hash-based) |
| A11Y-002 | 1.4.10 Reflow | AA | `scrollWidth` > `clientWidth` em 320px e 375px, medido | S3 | `.nav-structural` convertida para `display:flex; flex-wrap:wrap` |
| A11Y-003 | 1.3.1 Info and Relationships | A | Nenhum `<ul>/<li>` em coleções repetitivas, grep confirmado | S2 | Convertido para `<ul class="plain-list"><li class="list-item">`, CSS reset preserva aparência |
| A11Y-004 | 2.5.8 Target Size (Minimum) | AA | Altura de 21px medida em `<input type="file">`, SURF-006 e SURF-014 | S2 | `.field input, .field select { min-height:24px; padding:6px; box-sizing:border-box }` |
| — (contraste) | 1.4.3 Contrast (Minimum) | AA | Calculado: texto secundário 7.46:1, texto primário 18.88:1, borda 3.54:1 — todos acima do mínimo | N/A (sem falha) | Nenhuma ação necessária |
| — (paleta final) | 1.4.3 / 1.4.11 | AA | Identidade visual final ainda não decidida (fase futura) | NOT ASSESSABLE AT CURRENT FIDELITY | Reavaliar na fase de Visual Language/Design System |
| — (drag-and-drop) | 2.5.7 Dragging Movements | AA | `<input type="file">` nativo, sem gesto de arrastar exigido, confirmado em desktop e mobile | N/A (sem falha) | Nenhuma ação necessária |
| — (motion) | 2.3.3 Animation from Interactions | AAA (não exigido em AA, avaliado por completude) | Nenhuma animação no protótipo | N/A (sem falha) | Nenhuma ação necessária |

## 21. Epistemic Integrity Evaluation

Rodada dedicada, full-file grep (não amostragem): `CLEAN`/`aprovad` só aparecem dentro da própria
negação explícita ("nunca Aprovado"); `verificad` (particípio "verificado(a)") nunca aparece fora
dessa mesma negação — confirmado que nenhum estado guest-facing ou operator-facing chega a
"verificado" como fato. `SATISFIED`/"em dia"/"regular"/"compliance" só aparecem dentro de negações
explícitas. `você será avisado`/`garante`/`garantia` idem. **Nenhuma divergência entre o que o
usuário veria e o que o domínio sabe foi encontrada** — a única correção desta categoria já havia
sido feita na etapa anterior (Interaction Prototype, Rodada C) e permanece estável.

## 22. Trust / Risk Evaluation

GTR-01: bloco de identidade do solicitante presente e proeminente (acima da dobra em mobile,
confirmado). Ações destrutivas: entidade afetada sempre nomeada no texto de confirmação
(`"Excluir "Apólice de Seguro"?"`), consequência explicada (`"não pode ser desfeita pela
interface"`, `"perde acesso ao link imediatamente"`), confirmação deliberada exigida — nunca
irreversível "parecendo" reversível. "Informação foi aceita ou apenas recebida?" — distinção
`ReservationAccepted`/`UploadAcceptedByBrowser` preservada e agora estruturalmente distinta (não
comprimida, ver `A11Y`/state-granularity herdado da etapa anterior). **Sem finding novo.**

---

## 23. J-01 Evaluation

Executado: Overview → identificar vencido → abrir detalhe (`?from=overview` preservado) → decidir
→ voltar (background refresh). `EMPTY_TRUE` distinto de erro de carga (mensagens e estruturas
diferentes, confirmado). Navegação por teclado completa (skip link → conteúdo → item). **Achados
aplicáveis**: `A11Y-001` (skip link), `A11Y-002` (reflow), `A11Y-003` (list semantics) — todos
corrigidos.

## 24. J-02 Evaluation

Happy path (criação completa via clique e via teclado), validação (2 erros de campo, dados
preservados), `UNKNOWN_OUTCOME` (mensagem correta, sem retry automático, confirmado por leitura do
texto exato), interrupção de sessão (contexto de retorno preservado, dado do formulário
corretamente não preservado — journey curta, comportamento aprovado). **Achado aplicável**:
`HE-003` (duplo-clique criava item duplicado) — corrigido e reverificado (1 item, não 2).

## 25. J-03 Evaluation

Happy path com dual claim confirmado textualmente ("Novo ciclo criado" + "[RENOVADO]"), validação,
OCC/`CONFLICT` (mensagem específica, recovery por "Reler estado atual", sucesso subsequente),
`SOURCE_STATE_CHANGED` (mensagem distinta de `CONFLICT`), `UNKNOWN_OUTCOME` (reconsulta automática
segura, comportamento distinto e correto em relação a J-02). **Achados aplicáveis**: `HE-003`
(mesma causa raiz de duplicação, aqui mitigada por ser uma ação idempotente no backend real, mas o
bug de listener duplicado ainda existia estruturalmente) — corrigido; `CONTENT-003` (jargão em
mensagem de unknown-outcome) — corrigido.

## 26. J-04 Evaluation

Upload até o teto real de observabilidade confirmado; **re-entry testado e confirmado
corretamente quebrado** (sair e voltar apaga o "upload enviado" — comportamento intencional que
demonstra `BLOCKER-A` de forma honesta, não um defeito). `BLOCKER-A` nunca mascarado — bloco
explícito presente em todos os estados relevantes. **Achado aplicável**: `A11Y-004` (alvo de toque
do input de arquivo) — corrigido.

## 27. J-05 Evaluation

`POLICY_CONFIGURED` é o teto real, confirmado — nenhum estado além dele é renderizado.
`BLOCKER-B` nunca mascarado; nenhuma copy defensiva do tipo "talvez você receba" encontrada (grep
exaustivo). **Sem finding novo.**

## 28. J-06 Evaluation

Ambas as variantes do branch point executadas independentemente: Variante A (vínculo automático
simulado, anotado `SIMULATED FOR UX VALIDATION`) e Variante B (fila humana simulada, decisão de
vincular/rejeitar). Nenhuma das duas foi silenciosamente escolhida como "a" resposta — ambas
coexistem, acessíveis pelo mesmo ponto de entrada. Revogação de solicitação com confirmação
deliberada, testada e confirmada.

## 29. J-07 Evaluation

Desktop e mobile (360×640) executados. Arquivo inválido rejeitado antes de qualquer envio (estado
`fileSelected` com erro, distinto). Arquivo grande — validação por tamanho confirmada no código
(10MB), mesmo caminho de erro. Link indisponível (3 causas internas → 1 mensagem externa,
confirmado byte-idêntico). Interrupção de rede — reenvio seguro oferecido. Confirmação de
recebimento — nunca excede "recebido pelo navegador". **Achado aplicável**: `A11Y-004` (alvo de
toque) — corrigido.

## 30. J-08 Evaluation

Happy path completo (seleção→upload→parse→preview→commit→concluído), falha de parse (distinta de
`EXPIRED`, que também foi testada), problemas de validação (contagem agregada, detalhe por linha
corretamente ausente e anotado como `PARTIAL`), `UNKNOWN_OUTCOME` pós-commit (reconsulta
automática segura), re-entry (sair durante `PARSING` e voltar recupera o estágio real —
contrastado deliberadamente com o re-entry quebrado de `BLOCKER-A`). **Achado aplicável**:
`CONTENT-003` (jargão em 2 mensagens) — corrigido.

---

## 31. UNKNOWN_OUTCOME Evaluation

Dois padrões distintos confirmados por execução, nunca confundidos: **criação** (nenhuma
reconsulta automática — `CREATE-IDEMPOTENCY-01`, usuário decide manualmente) vs. **renovação/
import** (reconsulta automática seguro — idempotência real existe no domínio para essas
operações). Nenhum `UNKNOWN_OUTCOME` foi encontrado tratado como `FAILED` (mensagens sempre usam
"incerto"/"não foi possível confirmar", nunca "falhou").

## 32. Anti-Enumeration Evaluation

Verificado programaticamente, não só por leitura: três tokens ruins internamente distintos
(`tok-expired`, `tok-revoked`, um token inexistente) produzem **`outerHTML` byte-idêntico**
(comparação de string completa, não apenas texto visível) tanto antes quanto depois de todas as
correções desta etapa. `resolveGuestToken()` é o único caminho de código que decide "disponível vs.
indisponível" — estruturalmente impossível divergir por acidente (§48 do prompt-fonte: o requisito
de segurança é semântico, não a coincidência de byte-identidade — mas aqui a implementação
estrutural garante ambos).

## 33. BLOCKER-A Evaluation

`SCANNING` confirmado `PERSISTED` + `NOT_CURRENTLY_OBSERVABLE` (nenhuma rota `GET` simulada como
existente). Nenhuma superfície transforma a ausência de observabilidade em afirmação falsa — grep
exaustivo confirma que "verificando segurança" nunca aparece como fato confirmado; o teto real é
sempre "upload enviado". Re-entry honestamente quebrado, testado e confirmado (§26).

## 34. BLOCKER-B Evaluation

Nenhuma copy do tipo "seu alerta foi salvo, talvez você receba uma notificação" existe (grep
exaustivo, proibição do §23 do prompt-fonte respeitada). O teto real (`POLICY_CONFIGURED`) é o
único estado alcançável, sempre acompanhado do aviso de que não garante entrega.

## 35. BLOCKER-C Variant Evaluation

Ambas as variantes (A automática, B revisão humana) permanecem lado a lado, nenhuma promovida a
"a" solução. `FILE_VERIFIED`/documento recebido nunca vira `SATISFIED`/requisito atendido sem uma
ação explícita (automática-simulada ou humana-simulada) — nunca silenciosamente. O Decision Brief
da etapa anterior (recomendando Variante B) não foi alterado nem incorporado ao modelo aprovado
nesta etapa — permanece uma recomendação, não uma decisão (§92 do prompt-fonte).

## 36. GTR-01 Evaluation

Bloco de identidade do solicitante presente, com proeminência confirmada (acima da dobra em
mobile, primeiro bloco de conteúdo após o cabeçalho em desktop). Não está "escondido" — é o
primeiro elemento de conteúdo real do guest, antes até da descrição do documento solicitado.

## 37. CREATE-IDEMPOTENCY-01 Evaluation

Reproduzido: submit → timeout simulado → `UNKNOWN_OUTCOME`. Confirmado: nenhum auto-retry; nenhum
CTA inseguro (as duas ações oferecidas são "ver lista e confirmar manualmente" ou "preencher
novamente", nunca um botão único "tentar de novo"); usuário recebe texto explícito de incerteza;
UI nunca diz que falhou; recovery não presume duplicação (a orientação é para o usuário verificar,
não para o sistema reenviar sozinho).

---

## 38. Baseline Findings

Encontrados por execução real do baseline (commit `10a9a37`), antes de qualquer correção:

| ID | Surface(s) | Journey(s) | Heurística/Eixo | WCAG SC | Evidência | Severidade | Gate |
|---|---|---|---|---|---|---|---|
| A11Y-001 | Todas autenticadas | Todas | H1/H7, Accessibility | 2.4.1 (A) | Nav precede conteúdo em ordem de tab; instrumentado, 5-6 paradas antes do 1º link "Abrir" | S3 | Accessibility Gate |
| A11Y-002 | Todas autenticadas | Todas | Responsiveness | 1.4.10 (AA) | `scrollWidth` 482px vs. `clientWidth` 320/375px, medido; causa raiz isolada em reprodução mínima isolada (âncoras adjacentes sem espaço não quebram linha em Chromium) | S3 | Accessibility Gate |
| HE-003 | SURF-003,004,005,010 | J-02,03,06 | H5 Error Prevention | — | Instrumentação de `addEventListener` mostrou 8 listeners acumulados em "Excluir" após 3 ciclos de abrir/cancelar confirmação; reproduzido como duplicação real (2 cliques → 2 itens) | S3 | Error Safety Gate |
| A11Y-003 | SURF-001,002,008,009,010 | J-01,06 | Accessibility, Consistency | 1.3.1 (A) | `grep -c "<ul\|<li"` = 0 antes da correção; coleções usavam `<div class="list-item">` | S2 | Accessibility Gate |
| A11Y-004 | SURF-006, SURF-014 | J-04,07 | Accessibility | 2.5.8 (AA) | `getBoundingClientRect()` do `<input type="file">`: 21px de altura, medido em mobile (360px) e desktop | S2 | Accessibility Gate |
| HE-002 | SURF-003, SURF-011 | J-03,06 | H3 User Control | 2.1.1 (mitigado) | Escape não fechava `.confirm-row`; botão "Cancelar" reachable, mas convenção quebrada | S1 | — |
| CONTENT-001 | SURF-003 | J-01,03 | H2, Content | — | Mensagem de item-não-encontrado citava "outro tenant" e "§20 SSI" (jargão + citação de doc interno) | S2 | — |
| CONTENT-002 | SURF-013 | J-06 | Content | — | Tag de bloqueio "Query tenant-wide inexistente" renderizada ao usuário | S1 | — |
| CONTENT-003 | SURF-005, SURF-015 | J-03,08 | H2, Content | — | "idempotência"/"idempotente" + `GET /imports/{jobId}` literal em 3 mensagens de feedback ao usuário | S2 | — |

Nenhum S4 encontrado. 3 S3, 4 S2, 2 S1.

## 39. Remediation

Todas as 9 findings foram corrigidas nesta mesma etapa (política §90 — S3/S4 sempre; S1/S2 quando
claro/pequeno/baixo risco, o que se aplicou a todos os 6 S1/S2 desta rodada):

| Finding | Correção aplicada | Arquivo(s) |
|---|---|---|
| A11Y-001 | Skip link `data-action="skipToContent"`, foco movido para `#surface-content` (`tabindex="-1"`) | `app.js` (`shell()`, novo `actions.skipToContent`), `styles.css` (`.skip-link`) |
| A11Y-002 | `.nav-structural { display:flex; flex-wrap:wrap; gap:4px 12px }` | `styles.css` |
| HE-003 | Delegação de eventos (bind único em `#app`, nunca por render); guarda de desabilitação em ações mutantes assíncronas (`ASYNC_MUTATING_ACTIONS`/`FORMS`) | `app.js` (`bindDelegatedListeners`, `afterRender` simplificado, 8 chamadas parciais de `afterRender` removidas) |
| A11Y-003 | `<div class="list-item">` → `<li class="list-item">` dentro de `<ul class="plain-list">` em 5 locais | `app.js`, `styles.css` (`.plain-list`) |
| A11Y-004 | `.field input, .field select { min-height:24px; padding:6px; box-sizing:border-box }` | `styles.css` |
| HE-002 | `keydown` global para `Escape`, limpa `#confirm-slot`/`#revoke-slot` | `app.js` |
| CONTENT-001 | Mensagem reescrita sem "tenant"/citação de documento interno | `app.js` (rota `/items/:id`) |
| CONTENT-002 | Tag renomeada para "Consulta entre fornecedores indisponível" | `app.js` (rota `/requests-collection`) |
| CONTENT-003 | 3 mensagens reescritas sem "idempotência"/"idempotente"/caminho de API literal | `app.js` (`submitRenew`, rota `/import` ×2) |

## 40. Regression Verification

*(Esta seção documenta a regressão da Rodada A, sobre as 9 correções iniciais. As 6 correções da
Rodada C e as 2 do fechamento pós-Rodada-D, com sua própria regressão completa, estão em §44 —
não repetidas aqui.)*

Após as 9 correções, toda a suíte de verificação funcional foi reexecutada (navegador headless,
não apenas leitura de código):

- **34 Prototype Scenario IDs**: todos navegam para a superfície esperada, **zero erros de
  console** (antes e depois).
- **Fluxos profundos completos** (criação, validação, `UNKNOWN_OUTCOME`, OCC+recovery+sucesso,
  re-entry de documento honestamente quebrado, J-06 simulate-open/submit, anti-enumeração,
  guest+GTR-01, import completo, sessão+reautenticação+retorno): **todos re-executados, todos
  passam**.
- **`axe-core` (20 estados)**: 0 violações antes e depois — confirmação de que nenhuma correção
  introduziu uma regressão de acessibilidade automática detectável.
- **Duplo-clique em "Criar vencimento"**: antes = 2 itens criados; depois = exatamente 1 item
  criado (botão desabilitado imediatamente, confirmado por leitura de `disabled` no DOM).
- **Acúmulo de listeners**: instrumentação de `addEventListener` refeita após a correção — 3
  ciclos de abrir/cancelar confirmação agora resultam em **zero** listeners adicionais bindados
  por elemento (delegação confirmada funcionando).
- **Reflow**: `scrollWidth === clientWidth` em 320px e 375px, confirmado, em 5 superfícies
  autenticadas testadas.
- **Skip link**: primeiro tab-stop é o skip link; ativá-lo move o foco para `#surface-content` sem
  alterar `location.hash` (o roteador não é afetado — verificado explicitamente após um cuidado
  real: a primeira implementação ingênua teria colidido com o roteador).
- **Alvo de toque**: `<input type="file">` mede 39px de altura (era 21px) em ambas as superfícies
  afetadas.
- **Escape**: fecha a confirmação; item permanece no estado original (nenhuma mutação acidental
  disparada pelo próprio Escape).
- **Jargão**: grep de arquivo inteiro pós-correção confirma zero ocorrências de "tenant"/
  "§20 SSI"/"idempot" em texto renderizado ao usuário (a única ocorrência remanescente de
  "idempotente" está no `desc` de um Prototype Scenario ID — texto da barra de controle
  PROTOTYPE-ONLY, nunca visível na interface avaliada).

`npm run check-docs`: **PASS** (191 arquivos, sem link quebrado, sem referência `AGENTS.md §N`
obsoleta) — confirmado ao final desta etapa.

## 41. Remaining Known Issues

Itens deliberadamente **não** corrigidos nesta rodada, por serem de baixo risco/baixo retorno ou
por dependerem de uma fase futura — nenhum é gate failure, nenhum é S2+:

- **Foco não redirecionado ao primeiro campo inválido após falha de validação** (§14): o foco
  permanece no botão de submit (não é perdido, só não é redirecionado); mitigado pela região
  `aria-live` para usuários de leitor de tela. Registrado como melhoria incremental candidata, não
  como finding formal — formulários têm ≤4 campos, o custo de localizar o erro visualmente é baixo.
- **Teste real com leitor de tela não realizado** — a avaliação usou inspeção semântica +
  `axe-core` + raciocínio manual sobre a árvore de acessibilidade, mas não uma sessão real com
  NVDA/JAWS/VoiceOver. Fica para a etapa de Accessibility Evaluation com usuários reais, se
  distinta de User Validation, ou para a própria User Validation se incluir participantes que
  usam tecnologia assistiva.
- **Contraste de identidade visual final** — `NOT ASSESSABLE AT CURRENT FIDELITY` (§20); a paleta
  atual (grayscale estrutural) passa com folga, mas isso não prediz o resultado após a fase de
  Visual Language/Design System.
- **Densidade de dados não estressada** — o seed do protótipo usa poucos itens/fornecedores; scan
  efficiency/comparação em volumes maiores (centenas de itens) não foi exercitada nesta rodada
  (a decisão de lista vs. tabela já foi fechada com evidência na etapa de Low-Fidelity Wireframes,
  não reaberta aqui sem novo dado).
- **Erros por linha de import permanecem agregados** (herdado — não é um defeito desta etapa, é uma
  limitação de capacidade já registrada como gap menor em etapas anteriores; o rótulo exibido ao
  usuário foi simplificado para "Erro por linha" na Rodada C, removendo o termo interno `PARTIAL`
  que vazava para a tela).
- **Botão "Desabilitar alerta" não aparece imediatamente após o primeiro "Salvar" bem-sucedido**
  (só aparece numa navegação/renderização completa seguinte) — descoberto na Rodada D como efeito
  colateral menor da correção do travamento de `submitAlert`; não bloqueia a tarefa (o usuário pode
  salvar de novo com outro valor, o que é o caso de uso testado), registrado como melhoria
  incremental candidata, não como finding formal (S0, não afeta nenhuma journey crítica).

## 42. User Validation Readiness

**O protótipo está pronto para ser entregue a pessoas sem treinamento prévio**, com as seguintes
tarefas candidatas (derivadas de outcomes, sem instruir onde clicar):

```
"Descubra o que precisa da sua atenção hoje."
"Cadastre um novo vencimento."
"Renove o certificado que está próximo do vencimento."
"Envie o documento solicitado usando o link que você recebeu." (tarefa do External Submitter)
"Solicite um documento a um fornecedor." (tarefa J-06, até o branch point)
"Importe uma planilha com vencimentos." (tarefa J-08)
```

**Limitações conhecidas do protótipo a comunicar ao facilitador da próxima etapa** (não impedem a
aprovação, per §110 do prompt-fonte — o que impediria é o mock levar a uma conclusão incorreta, o
que foi verificado que não ocorre):

- J-04, J-05 e a Variante escolhida de J-06 terminam de forma honestamente incompleta
  (`BLOCKER-A/B/C`) — o participante pode perceber isso como "o produto não faz nada depois" e essa
  reação **é o dado esperado**, não um erro de teste.
- A barra de controle amarela (PROTOTYPE-ONLY) deve ser explicada como "não faz parte do produto"
  antes da sessão, para não contaminar a percepção do participante sobre a interface real.
- Import/upload usam tempos artificiais curtos (400-800ms) para tornar a transição perceptível —
  não representam a latência real esperada em produção.

**Observações a capturar durante a próxima fase** (hesitação, retrocesso, ação errada,
interpretação equivocada de `[VINCULADO A UM VENCIMENTO]`/`[ARQUIVO VERIFICADO]`, dificuldade de
recuperação, incapacidade de explicar o que aconteceu) — roteiro formal de entrevista **não**
produzido aqui, fica para `User Validation Planning` (§113 do prompt-fonte).

## 43. Claude↔Codex Review

Protocolo completo de 4 rodadas (AGENTS.md §4), Codex rodando em sandbox read-only contra o código
real e os documentos aprovados, não contra o texto do relatório.

**Rodada B** — Codex revisou o rascunho da Rodada A (as 9 correções já aplicadas + o relatório)
contra 25 pontos de verificação adversarial (heurísticas não avaliadas, severidade sub/superestimada,
falhas não detectadas, blockers mascarados, regressões, jargão residual, product creep). Resultado:
14 pontos `SEM FURO`, **11 pontos com `FURO REAL`, agrupados em 6 problemas-raiz distintos**:

| # | Problema-raiz | Evidência (pré-correção) | Severidade (Codex) |
|---|---|---|---|
| 1 | Guarda anti-duplo-submit desabilita o botão antes da validação, mas `submitCreate`/`submitRenew`/`submitAlert` nunca reabilitam nas branches de erro (validação e, em `submitRenew`, também conflito OCC) — quebra recovery completo, teclado e mouse | `app.js:249-254`, `537-540`, `594-597`, `698` | S3 residual |
| 2 | `SURF-012` Variante B usa `<div class="list-item">` fora de `<ul>/<li>`, inconsistente com a correção declarada para as demais coleções | `app.js:875-881` | S1-S2 (consistência) |
| 3 | `submitAlert` renderiza "Salvando…" sem chamar `announce()` — só o resultado final é anunciado | `app.js:700-705` | S1-S2 |
| 4 | `actions.editItem` (ação fora de escopo) só usa `announce()` em região live invisível, sem qualquer mudança visível para usuário vidente | `app.js:469` | S2 |
| 5 | Jargão técnico remanescente em texto renderizado: "backend"/"PARTIAL" e "anti-enumeração" vazando para a página pública de guest | `app.js:414`, `925`, `937` | S1-S2 (trust/content, mais grave por ser em superfície pública) |
| 6 | Violação epistêmica: `reconcileImport()` marca o job como `COMMITTED` e a tela afirma "N registros criados", mas nunca materializa os itens em `DB.items` (ao contrário do caminho normal `commitImport`) | `app.js:1088-1092` vs. `1080-1083` | S3/S2 alto — a mais grave das 6 |

Veredito da Rodada B (verbatim): *"Há 5 furos reais únicos, aparecendo em 11 dos 25 checks. O mais
grave é S3: a correção de duplo-submit quebrou recovery de validação. O segundo mais sério é S3/S2
alto: `UNKNOWN_OUTCOME` de import confirma registros sem materializá-los no fake backend. Esses
dois invalidam, por enquanto, `APPROVED AS INPUT FOR USER VALIDATION`; eu recomendaria `CHANGES
REQUESTED` até corrigir e reexecutar J-02/J-05/J-08."* (Codex agrupou os problemas 2-5 acima como
parte dos "5 furos únicos"; este relatório os trata individualmente por rastreabilidade, sem
divergir da contagem substantiva de Codex.)

Os 14 pontos `SEM FURO` confirmaram, entre outros: as 10 heurísticas de Nielsen realmente avaliadas
com evidência; J-01–J-08 com avaliação própria; os 4 achados WCAG genuínos; nenhum blocker
mascarado pelas correções de conteúdo; anti-enumeração preservada estruturalmente; nenhum retry
inseguro introduzido; `UNKNOWN_OUTCOME` nunca tratado como `FAILED`; nenhuma regressão de CSS no
guest mobile; a refatoração de delegação de eventos preserva corretamente o elemento correto via
`ev.target.closest(...)`; nenhuma decisão prematura de identidade visual; nenhum product creep.

**Rodada D** (após as correções da Rodada C, abaixo) — Codex releu o código já corrigido e
reexecutou mentalmente J-02/J-05/J-08. Confirmou 5 das 6 correções como `CONFIRMADO CORRIGIDO` e
encontrou uma correção incompleta nova: `submitAlert` reabilitava o botão na branch de validação,
mas **não na branch de sucesso** — depois de salvar um alerta, o botão "Salvar" ficava travado,
impedindo salvar uma nova alteração sem navegar/recarregar. Também discordou explicitamente da
decisão de manter o texto "SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND" em 4
locais, por um deles (`app.js:972`, à época) estar em superfície de guest externo não-técnico.
Ambos os pontos foram corrigidos nesta mesma etapa (ver §44) e reverificados; nenhum outro problema
novo foi encontrado na re-execução de J-02/J-05/J-08 nem nos 25 pontos originais da Rodada B.

## 44. Reconciliation

Cada problema-raiz da Rodada B, respondido no formato exigido (Finding / Evidência / Aceito-
Rejeitado-Parcial / Raciocínio / Ajuste de severidade / Mudança aplicada):

**1. Guarda de duplo-submit quebra recovery de validação — ACEITO, S3 confirmado**
Evidência: `grep -n "submitBtn.disabled = false"` no código pré-Rodada-C retornava vazio — a
reabilitação planejada nunca tinha sido implementada, apenas meu próprio raciocínio prévio. Confirmado
também por reprodução em navegador real (Playwright): botão permanecia `disabled` após erro de
validação, segundo clique impossível. Raciocínio: este é exatamente o tipo de furo que a Rodada B
existe para pegar — uma correção real (prevenção de duplo-submit) implementada de forma incompleta
(faltou o caminho de recovery). Mudança aplicada: `submitCreate` (branch de validação),
`submitRenew` (branch de validação E branch de conflito OCC) e `submitAlert` (branch de validação)
agora reabilitam o botão de submit correspondente antes do `return`. Reverificado em navegador:
usuário consegue corrigir e reenviar em todos os 3 formulários.

**2. `SURF-012` Variante B com `<div>` em vez de `<li>` — ACEITO, S1**
Raciocínio: embora seja um único item de demonstração estático (não uma coleção iterada como as
demais), a distinção não estava clara no relatório, que afirmava genericamente "todas as coleções
convertidas". Mais simples e sem risco converter para consistência total do que manter a exceção e
documentá-la. Mudança aplicada: envolvido em `<ul class="plain-list"><li class="list-item">`.

**3. `submitAlert` não anuncia o estado pendente — ACEITO, S1**
Raciocínio: inconsistente com `submitCreate`/`submitRenew`, que anunciam tanto o estado pendente
quanto o final. Mudança aplicada: `announce('Salvando política de alerta…')` adicionado antes do
`setTimeout`.

**4. Feedback não-perceptível para usuário vidente — PARCIALMENTE ACEITO**
Codex citou duas linhas (`app.js:469` e `721-724`). Investigação própria: `app.js:469` (`editItem`)
de fato só chamava `announce()` — nenhuma mudança visível na tela, um usuário vidente clicando
"Editar" veria absolutamente nada acontecer. **Aceito, S2.** `app.js:721-724`
(`disableAlert`) já chamava `render()` — uma mudança de DOM real e visível (o botão "Desabilitar
alerta" desaparece, o formulário reflete o estado sem política) — **rejeitado como furo**, a
citação de Codex agrupou os dois pontos sob o mesmo número, mas só um é real; Codex confirmou essa
distinção na Rodada D ("concordo que não era furo real"). Mudança aplicada: `editItem` agora
escreve uma mensagem visível em `#confirm-slot`, além de manter o `announce()` para leitor de tela.

**5. Jargão técnico remanescente — PARCIALMENTE ACEITO**
Codex citou `app.js:414` ("backend"/"PARTIAL"), `app.js:1039` (tag "(PARTIAL)"), `app.js:925/937`
("anti-enumeração" na página pública de guest), e também os 4 usos de "SIMULATED FOR UX VALIDATION
— NOT CURRENTLY SUPPORTED BY BACKEND". Raciocínio inicial (Rodada C): os 3 primeiros são jargão de
engenharia genuíno vazando para texto de usuário — **aceito e corrigido**. Os 4 banners
"SIMULATED..." foram inicialmente julgados como convenção deliberada e já estabelecida de
transparência de limitação (análoga aos rótulos `(EMPTY_TRUE)`/`(EMPTY_FILTERED)` já usados neste
mesmo documento), e mantidos sem alteração na Rodada C. **Codex discordou explicitamente na Rodada
D**, apontando que um desses 4 usos está em superfície de guest externo não-técnico
(`app.js:972` à época), onde o argumento de "convenção para avaliadores internos" não se sustenta —
um fornecedor externo enviando um documento não tem nenhum contexto para interpretar "BACKEND".
**Aceito na Rodada D** (reversão da decisão da Rodada C, com o raciocínio de Codex prevalecendo por
ser mais forte que o original: a diferença entre uma anotação de estado técnico revisável só por
avaliadores internos, tipo `(EMPTY_TRUE)`, e um texto que aparece dentro do corpo de uma mensagem
lida por um usuário externo real durante a própria User Validation, é material). Mudança aplicada:
`app.js:414` reescrito sem "backend"/"PARTIAL"; `app.js:1039`, tag renomeada de "Erro por linha
(PARTIAL)" para "Erro por linha"; `app.js:925` (rota `/guest/:token`, mensagem de link
indisponível), removida a palavra "anti-enumeração" mantendo a explicação em linguagem comum; os 4
usos de "SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND" substituídos por
"SIMULADO PARA VALIDAR A EXPERIÊNCIA — CAPACIDADE AINDA NÃO DISPONÍVEL." (mesmo papel, sem jargão
técnico, sem inglês).

**6. `reconcileImport()` não materializa os itens que afirma ter criado — ACEITO, S3 (elevado de
não classificado) — a mais grave das 6, concordando com a Rodada B**
Evidência: reproduzido em navegador — fluxo completo `PROTO-J08-UNKNOWN` → "Reconsultar agora"
mostrava "38 registros criados" na tela, mas `/items` continuava sem nenhum dos 38 itens (a versão
anterior só existia no caminho normal `commitImport`, nunca no caminho de reconciliação manual).
Raciocínio: isto é uma violação epistêmica real, não cosmética — a interface afirmou um fato sobre
o estado dos dados que era falso dentro do próprio modelo de dados do protótipo, o tipo de erro que
esta etapa existe justamente para impedir. Mudança aplicada: `reconcileImport()` agora executa o
mesmo laço de materialização de `commitImport` antes de marcar `COMMITTED`. Reverificado em
navegador: contagem afirmada (38) agora bate exatamente com o número de linhas "Item importado"
visíveis em `/items`. Codex confirmou na Rodada D que um segundo clique em "Reconsultar agora" não
duplica os itens (o botão desaparece do DOM após o primeiro `render()`, e a delegação de eventos
ignora elementos que não estão mais contidos em `#app`).

**Achado adicional da Rodada D (fora dos 6 originais, encontrado na re-execução) — ACEITO, S2**
`submitAlert` reabilitava o botão na branch de validação (correção do item 1), mas a branch de
**sucesso** nunca reabilitava nem chamava `render()` — após salvar um alerta com sucesso, o botão
"Salvar" ficava permanentemente desabilitado, impedindo salvar uma segunda alteração (ex.: trocar
de "7 dias antes" para "10 dias antes") sem navegar para outra tela e voltar. Raciocínio: mesma
classe de bug do item 1 (guarda de duplo-submit sem caminho de recovery), desta vez no caminho de
sucesso em vez do de erro — confirma que a auditoria linha-a-linha de todas as branches de retorno
antecipado de todas as 3 funções mutantes deveria ter sido feita na Rodada C, não apenas das
branches de erro. Mudança aplicada: `alertBtn.disabled = false` adicionado ao final do `setTimeout`
de sucesso. Reverificado em navegador: salvar duas vezes seguidas com valores diferentes funciona,
o segundo feedback reflete o novo valor.

**Regressão verificada após todas as correções da Rodada C+D**: suíte completa headless
reexecutada — 20 estados via `axe-core` (incluindo as 7 superfícies tocadas nesta reconciliação:
Criação, Renovação, Alerta, Import em revisão, Guest indisponível, Submission Review Variante B,
Detalhe do item) com **0 violações**; os 34 Prototype Scenario IDs navegam sem erro de console;
fluxos profundos (`smoke.mjs`, `deep.mjs`, `deep2.mjs`, `deep3.mjs`) recorridos, todos passam;
teclado, foco, mobile guest e anti-enumeração recorridos, sem regressão; `npm run check-docs`: PASS
(192 arquivos). Nenhum novo problema introduzido pelas correções da reconciliação.

## 45. Quality Score

Notas revisadas **após** as Rodadas B/C/D (§43-44) — não são as notas otimistas da Rodada A. Cada
ajuste abaixo aponta para um achado real e específico que só a revisão adversarial encontrou,
mesmo já tendo sido corrigido e reverificado:

| Eixo | Nota | Justificativa |
|---|---|---|
| Task Suitability | 9.2 | Todas as journeys executáveis após reconciliação; J-08 teve um defeito real de correção de dados (achado 6) antes de ser corrigido |
| Information Architecture | 9.5 | Dual-anchor preservado, nenhuma área nova, navegação consistente — não afetado pelos achados da revisão |
| Information Presentation | 9.1 | Hierarquia clara; `SURF-012` Variante B tinha uma inconsistência de semântica de lista não pega na Rodada A (achado 2) |
| System Feedback | 9.0 | 3 defeitos reais de feedback assíncrono/perceptível escaparam da Rodada A (achados 3, 4, e o achado adicional da Rodada D em `submitAlert`) |
| Error Prevention / Recovery | 8.9 | O eixo mais penalizado: a própria correção de duplo-submit da Rodada A quebrou recovery de validação (achado 1, S3) — e a correção dessa correção ainda tinha uma segunda lacuna (branch de sucesso de `submitAlert`), só pega na Rodada D |
| Forms | 9.0 | Mesma causa raiz do achado 1 — a guarda de duplo-envio, adicionada para prevenir um problema real, quase criou um problema pior |
| Data Operations | 8.8 | A nota mais baixa: `reconcileImport()` afirmava ter criado registros sem realmente materializá-los (achado 6) — uma inconsistência real entre o que a UI declara e o estado dos dados, exatamente o tipo de falha que este projeto trata como grave |
| Accessibility | 9.0 | 0 violações `axe-core` mantido em todas as rodadas; `editItem` sem feedback visível (achado 4) mostra que verificação automática não substitui leitura manual de cada ação |
| Consistency | 9.1 | Convenções quase todas aplicadas identicamente; a exceção de `SURF-012` Variante B (achado 2) não tinha sido notada nem documentada como exceção deliberada |
| Content | 8.9 | Vazamento de jargão em superfície pública de guest (achado 5) é mais grave que o mesmo vazamento em telas internas; a própria Rodada C errou ao manter os banners "SIMULATED...BACKEND", corrigido só na Rodada D |
| Responsiveness | 9.0 | Guest mobile e reflow autenticado corrigidos e verificados; nenhum achado novo de Rodada B/C/D nesta área |
| Trust / Risk | 9.0 | GTR-01 e anti-enumeração seguem estruturalmente corretos, mas dois achados desta rodada (5 e 6) eram especificamente de confiança/integridade epistêmica e escaparam da autoavaliação da Rodada A |

**Cálculo, sem arredondamento**: soma das 12 notas = 108.5 → 108.5 / 12 = **9.04**.

**Overall: 9.04** — acima do threshold de 9.0 (§107 do prompt-fonte), mas por margem pequena e
real, não confortável. Isto é deliberado: a Rodada A, sozinha, teria produzido um 9.2 infundado —
6 achados reais (um deles S3, dois deles epistêmicos/trust) só vieram à tona pela revisão
adversarial externa, incluindo um caso em que a própria correção de um achado real introduziu uma
lacuna nova (achado 1) e outro em que a Rodada C tomou uma decisão de conteúdo que a Rodada D
reverteu com razão (achado 5). A nota final reflete esse histórico real, não apenas o estado
final do código — nenhuma nota individual foi ajustada para cima para atingir ou confortavelmente
superar o threshold.

## 46. Final Status

**`APPROVED AS INPUT FOR USER VALIDATION`**

Histórico de gate honesto, por rodada (nenhuma etapa pulada nem suavizada):

- **Rodada A** (Claude, autoavaliação): 9 achados reais encontrados e corrigidos. Concluiu (de
  forma equivocada, como a Rodada B mostrou) `APPROVED AS INPUT FOR USER VALIDATION`.
- **Rodada B** (Codex, adversarial): `CHANGES REQUESTED` — 6 problemas-raiz reais, um deles (guarda
  de duplo-submit quebrando recovery) S3, outro (`reconcileImport`) uma violação epistêmica real.
- **Rodada C** (Claude, reconciliação): todos os 6 corrigidos e reverificados em navegador; uma das
  6 decisões (manter os banners "SIMULATED...BACKEND") foi um julgamento equivocado, mantido nesta
  rodada.
- **Rodada D** (Codex, re-revisão adversarial do código corrigido): `CHANGES REQUESTED` —
  confirmou 5 das 6 correções, encontrou uma correção incompleta nova (`submitAlert` travava após
  **sucesso**, não só após erro) e reverteu com razão a decisão da Rodada C sobre os banners
  "SIMULATED...BACKEND" (jargão inaceitável especificamente na superfície pública de guest).
- **Fechamento** (Claude, mesma etapa): os 2 itens exatos listados pela Rodada D ("falta
  exatamente: 1. reabilitar `submitAlert` após sucesso; 2. trocar os 4 textos `SIMULATED...` por
  linguagem não técnica") foram corrigidos e reverificados individualmente em navegador (evidência
  em §44) — button `disabled: false` confirmado após duas gravações sucessivas com valores
  diferentes; `grep` confirma zero ocorrências residuais de "SIMULATED FOR UX" ou "BACKEND" em
  texto renderizado. Suíte de regressão completa (`axe-core` nas 7 superfícies tocadas, teclado,
  foco, mobile guest, anti-enumeração, os 34 Prototype Scenario IDs, `smoke`/`deep`/`deep2`/`deep3`)
  recorrida do zero após este fechamento: **zero regressões**. Uma 5ª rodada formal de Codex não foi
  aberta para este fechamento — a lista da Rodada D era fechada e específica (2 itens, sem
  ambiguidade), e a evidência de correção é objetiva e verificável por qualquer leitor
  (comportamento em navegador + grep), não uma alegação não verificada; isto é registrado aqui
  explicitamente, não omitido, para que o leitor pese essa diferença de evidência.

Resposta à pergunta final obrigatória (§120 do prompt-fonte): **existe algum problema que já
descobrimos por análise especializada e estaríamos indevidamente transferindo para os usuários
descobrirem por nós?** Não, no estado final. Mas a resposta honesta sobre o processo é que **isto
quase aconteceu duas vezes** — a Rodada A concluiu aprovação com 6 problemas reais não descobertos
(um deles S3, um deles uma violação epistêmica), e a própria Rodada C cometeu um erro de julgamento
de conteúdo que só a Rodada D corrigiu. É exatamente para isto que o protocolo de 4 rodadas existe,
e é por isto que a Nota de Qualidade (§45) reflete esse histórico em vez de só o resultado final.
No estado atual, verificado: nenhum S4. Nenhum S3 não resolvido em journey crítica. Nenhuma falha
estrutural de acessibilidade remanescente. Nenhum gate falhou ao final.

Critérios de aprovação (§78 do prompt-fonte) verificados: J-01–J-08 executáveis (§23-30); as 17
superfícies com cobertura (§8); happy paths completos; alternates críticos representados; failure/
recovery testáveis (incluindo o recovery de validação restaurado no fechamento desta etapa); re-
entry coberto onde aprovado (e honestamente quebrado onde `BLOCKER-A` exige); interrupção de sessão
coerente; OCC com recovery específico; `UNKNOWN_OUTCOME` corretamente representado (dois padrões
distintos, nunca confundido com `FAILED`, e agora com materialização de dados consistente em ambos
os caminhos de import); nenhum retry inseguro; epistemic integrity preservada (o achado 6 era
justamente uma violação epistêmica real, corrigida); guest trust preservado (`GTR-01` proeminente,
jargão técnico removido inclusive da superfície pública); anti-enumeração preservada (byte-
idêntico, programático, reverificado após todas as correções); blockers explícitos (`BLOCKER-A/B/C`,
nunca mascarados); guest mobile viável (verificado estruturalmente); nenhum gate de acessibilidade
estrutural remanescente; protótipo não virou high-fidelity prematuramente (grayscale preservado,
nenhuma decisão de marca tomada); nenhuma feature nova inventada sem evidência (todas as correções,
das 3 rodadas, removeram jargão ou corrigiram comportamento — nenhuma adicionou capacidade nova).

---

### Nota de transparência — falsos positivos descartados durante a própria avaliação

Registrados aqui (não como achado real) por auditabilidade — §71 do prompt-fonte ("no speculative
failures") aplicado também às minhas próprias hipóteses de defeito, não só aos critérios WCAG:

- **"`c-due` trava o foco"** — investigado com reprodução isolada mínima (HTML puro, sem app):
  confirmado ser comportamento nativo do `<input type="date">` (sub-campos dia/mês/ano
  navegáveis por Tab), presente em qualquer site que use esse tipo de input — não é um defeito do
  protótipo.
- **"Checkbox/radio de Configurações sem label"** — meu próprio script de verificação automatizada
  usava uma heurística que só reconhecia `label[for=id]`; o padrão real usado
  (`<label><input>texto</label>`, wrapping) é válido e foi confirmado por `axe-core` (0 violações)
  e inspeção direta do HTML. Corrigido o entendimento, não o código.
- **"3 itens duplicados"** no teste inicial de duplo-clique — um `text=` locator do Playwright
  conta substrings em múltiplos níveis de aninhamento; a contagem exata via `<strong>` confirmou 2
  itens reais (ainda um bug real, mas com número correto).
- **`UNKNOWN_OUTCOME` "não disparou"** em um teste inicial — checagem de string com capitalização
  incorreta (`'não'` minúsculo vs. `'Não'` no texto real); comportamento do app confirmado correto
  ao corrigir o teste.

---

*Documento produzido a partir da execução real do protótipo (`prototype/`) em navegador headless
(Playwright/Chromium) com `axe-core`, instrumentação de DOM, e testes de teclado — não apenas da
leitura de `interface-interaction-prototype.md`. Todas as 9 correções foram verificadas por
regressão funcional completa antes de considerar esta etapa concluída.*
