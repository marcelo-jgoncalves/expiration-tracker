---
status: APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES (Claude↔Codex, 2 rodadas — B e D; 3 furos reais de mesma causa raiz + 1 residual textual, todos corrigidos)
owner: Marcelo
authority: insumo para Low-Fidelity Wireframes (próxima etapa) — não normativo de arquitetura de sistema
---

# Expiration Tracker — Screen + State Inventory

Quarta etapa formal do planejamento de interface. Entradas, lidas integralmente, não refeitas:
`interface-context-and-critical-tasks.md`, `interface-conceptual-model-and-information-architecture.md`,
`interface-critical-user-journeys.md` (todos `APPROVED`). Constraints adicionais confirmadas:
D-053/D-054 (`decisions-log.md`), `NEXT_SESSION_PROMPT.md`. Nenhuma decisão aprovada anterior é
reaberta sem evidência nova.

Sem wireframes, componentes visuais, layout ou implementação. Disciplina de evidência mantida:
`FACT` · `STRONG INFERENCE` · `HYPOTHESIS` · `OPEN QUESTION`.

---

## 1. Executive Summary

- **17 Interaction Surfaces** derivadas das 8 journeys aprovadas — nenhuma criada por existir
  entidade/endpoint de backend sem journey correspondente (`SSI-G2`/rejeitada em §43). Nenhum
  outcome T0 ficou sem superfície de suporte (ver §38).
- **Taxonomia de estado compartilhada** (§12-14) evita repetir o erro já corrigido nas etapas
  anteriores: loading/empty/error não são categorias únicas — cada uma tem subtipos semanticamente
  distintos (`INITIAL_LOADING`≠`BACKGROUND_REFRESH`; `EMPTY_TRUE`≠`EMPTY_FILTERED`≠`EMPTY_UNAVAILABLE`).
- **`CREATE-IDEMPOTENCY-01` aplicado explicitamente** à Expiration Creation (SURF-004, §24): o
  estado `UNKNOWN_OUTCOME` pós-timeout nunca dispara reenvio automático — a única recuperação
  segura é reconsultar a coleção e deixar o usuário decidir.
- **Guest verification visibility gap modelado como ausência estrutural de estado**: o
  `External Submitter` nunca alcança um estado "arquivo verificado" (§29) — não porque a interface
  esconda essa informação, mas porque nenhuma rota pública a expõe (`NOT_CURRENTLY_OBSERVABLE`
  guest-side). A distinção "enviei" ≠ "foi aceito" é preservada em todo o inventário.
- **Anti-enumeração preservada em nível de estado**: quatro causas internas distintas de falha de
  token (`INVALID`/`EXPIRED`/`REVOKED`/`NOT_FOUND`) mapeiam para um único estado externo,
  `GuestRequestUnavailable` (§29) — nenhuma superfície ou mensagem nova reverte essa decisão de
  segurança já tomada no domínio.
- **Os 3 blockers técnicos + GTR-01 aparecem como estados/superfícies explicitamente `BLOCKED`**,
  nunca mascarados por copy defensivo: Document Context (SURF-006, BLOCKER-A), Alert Configuration
  (SURF-007, BLOCKER-B), Submission Review (SURF-012, BLOCKER-C) e Guest Submission (SURF-014,
  GTR-01). O branch point de `BLOCKER-C` (fechamento automático vs. revisão humana) é representado
  sem decidir qual alternativa vence (§28, §42).
- **OCC modelado como estado de primeira ordem** (`CONFLICT`, §22), nunca como erro genérico, em
  toda superfície que edita/renova/arquiva/exclui/commita.
- Nenhuma decisão de componente/layout foi tomada (verificado contra §6/§43 desta mesma etapa —
  `Type` de superfície usa só `GLOBAL/CONTEXTUAL/GUEST/UTILITY`, nunca `PAGE/MODAL/DRAWER`).
- **Achado real da revisão adversarial (Codex, §44), corrigido**: a fronteira de observabilidade de
  `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN` — nenhuma rota de leitura existe desde o
  momento em que o evento S3 dispara o scan, então a interface nunca pode afirmar "verificando
  segurança" como fato confirmado, só "upload enviado". Três células de classificação
  Persistência/Visibilidade foram corrigidas (§15, §26, §28, §30) — nenhuma reformulação estrutural
  foi necessária.

---

## 2. Inputs and Scope

- **Entradas primárias, lidas integralmente**: `interface-context-and-critical-tasks.md`,
  `interface-conceptual-model-and-information-architecture.md`, `interface-critical-user-journeys.md`
  — todos `APPROVED`, nenhuma fase anterior refeita.
- **Entradas de constraint**: D-053/D-054 (Full BFF, design fechado, zero código),
  `NEXT_SESSION_PROMPT.md` (estado vigente: M0-M11 implementados, M12/M13 gated, 3 blockers + GTR-01
  não resolvidos).
- **Fora de escopo**: wireframes, componentes, layout, modais/drawers/wizards, paleta, stack de
  frontend, código, resolução dos blockers/GTR-01, decisão do branch point de BLOCKER-C (§28).
- **`docs/frontend/interface-quality-standard.md` continua não existindo como arquivo formal**
  (mesma nota das 3 etapas anteriores) — eixos do §61 usados diretamente do prompt-fonte.

---

## 3. Source Journeys

Recapitulação de referência (não redefinida — ver `interface-critical-user-journeys.md` para o
detalhe completo por journey):

| Journey | Actor | Outcome | Criticality | Readiness |
|---|---|---|---|---|
| J-01 | Internal Operator | Saber o que exige atenção agora | T0 | PARTIAL |
| J-02 | Internal Operator | Colocar algo novo sob acompanhamento | T0 (inferência) | READY |
| J-03 | Internal Operator | Iniciar novo ciclo sem perder rastreabilidade | T0 | PARTIAL |
| J-04 | Internal Operator | Manter evidência documental acessível | T0 | BLOCKED (A) |
| J-05 | Internal Operator | Ser avisado antes do vencimento | T0 | BLOCKED (B) |
| J-06 | Internal Operator (+ External Submitter) | Obter documentação de terceiros | T0 | BLOCKED (C) |
| J-07 | External Submitter | Enviar documento com confiança | T0 (submitter) | PARTIAL/PARTIAL |
| J-08 | Internal Operator | Trazer dados existentes sem cadastro manual | T1 | READY |

---

## 4. Interaction Surface Definition

Uma **Interaction Surface** é onde o usuário recebe informação, entende contexto/estado, toma
decisão, executa ação e recebe feedback. Não é `URL`, não é `Page`, não é `Modal`. A mesma Surface
pode futuramente virar página, painel, dialog, drawer ou seção inline — essa decisão pertence à
etapa de Low-Fidelity Wireframes, não a esta.

Proibições desta etapa (verificadas ao final, §43/§46): nenhuma decisão de modal/drawer/sidebar/
tabela/posição de botão/hierarquia visual/cor/tipografia/espaçamento/responsividade/framework/
biblioteca de componente.

---

## 5. Surface Inventory

### Tabela mínima (§64)

| ID | Surface | Actors | Journeys | Purpose | Type | Readiness | Dependencies |
|---|---|---|---|---|---|---|---|
| SURF-001 | Overview | Internal Operator | J-01 | Responder "o que precisa de mim agora, em tudo" | GLOBAL | PARTIAL | Full BFF |
| SURF-002 | Expiration Collection | Internal Operator | J-01, J-02 (destino), J-08 (destino) | Listar/filtrar vencimentos | GLOBAL | PARTIAL | Full BFF |
| SURF-003 | Expiration Detail | Internal Operator | J-01, J-03, J-04, J-05 | Ver um vencimento e agir sobre ele | CONTEXTUAL | PARTIAL | Full BFF; BLOCKER-A/B indiretos |
| SURF-004 | Expiration Creation | Internal Operator | J-02 | Criar novo vencimento | GLOBAL | READY | Full BFF; CREATE-IDEMPOTENCY-01 |
| SURF-005 | Expiration Renewal | Internal Operator | J-03 | Iniciar novo ciclo preservando o anterior | CONTEXTUAL | PARTIAL | Full BFF; BLOCKER-A indireto |
| SURF-006 | Document Context | Internal Operator | J-04 (direto), J-03 (indireto) | Upload e consulta do documento do vencimento | CONTEXTUAL | **BLOCKED** | **BLOCKER-A** |
| SURF-007 | Alert Configuration | Internal Operator | J-05 | Configurar quando ser avisado | CONTEXTUAL | READY (operação) / **BLOCKED** (outcome) | **BLOCKER-B** |
| SURF-008 | Subject Collection | Internal Operator | J-06 | Listar Fornecedores/Subjects | GLOBAL | READY | Full BFF |
| SURF-009 | Subject Detail | Internal Operator | J-06 | Ver requisitos e status de um Fornecedor | CONTEXTUAL | READY | Full BFF |
| SURF-010 | Requirement Context | Internal Operator | J-06 | Ver um requisito, suas solicitações, link/unlink | CONTEXTUAL | READY (operação) / PARTIAL (outcome) | Full BFF |
| SURF-011 | Document Request Context | Internal Operator | J-06 | Acompanhar/revogar uma solicitação específica | CONTEXTUAL | READY | Full BFF |
| SURF-012 | Submission Review | Internal Operator | J-06 (branch point) | Ver documento recebido e decidir vínculo (se Alternativa B) | CONTEXTUAL | **BLOCKED** | **BLOCKER-C**; decisão de produto pendente |
| SURF-013 | Requests Collection | Internal Operator | J-06 (suporte à decisão) | Ver solicitações pendentes em todos os Fornecedores | GLOBAL (conceitual) | **BLOCKED** | query tenant-wide inexistente |
| SURF-014 | Guest Submission | External Submitter | J-07 | Ver pedido e enviar documento sem conta | GUEST | PARTIAL / PARTIAL | **GTR-01**; sem rota pós-envio |
| SURF-015 | Import Flow | Internal Operator | J-08 | Importar planilha CSV | GLOBAL (ação + acompanhamento transiente) | PARTIAL | Full BFF |
| SURF-016 | Settings | Internal Operator | apoio a todas (config) | Preferências de notificação/entrega | UTILITY | READY | Full BFF |
| SURF-017 | Session Recovery | Internal Operator | cross-cutting (todas autenticadas) | Recuperar sessão preservando contexto | UTILITY | **BLOCKED** | **Full BFF** (zero código) |

### Blocos detalhados (§8: Purpose, Actors, Journeys, Outcomes, Concepts, obrigações, Readiness, Dependencies, Trust, Accessibility)

**SURF-001 — Overview**
```
Purpose: visão transversal de tudo que exige atenção, sem forçar o usuário a visitar 2 áreas
Actors: Internal Operator
Journeys: J-01 (principal)
Outcomes: OUTCOME-001
Concepts: C1 (Vencimento), C7 (Alerta, se/quando observável), C5 (Solicitação, se/quando observável)
Information obligations: contagem por urgência (vencido/vencendo/em dia); nenhuma métrica de
  alerta enquanto BLOCKER-B não for resolvido (não fingir resumo de algo não observável)
Decision obligations: "o que exige minha atenção agora?"
Action obligations: navegar para um item específico (→ SURF-003)
Feedback obligations: distinguir "sem pendências" (sucesso genuíno) de "erro ao carregar"
Readiness: PARTIAL — API existe, sem paginação/ordenação real aplicada
Dependencies: Full BFF (direto)
Trust implications: nenhuma além de sessão válida
Accessibility implications: contagem/urgência nunca só por cor; loading/erro anunciados
```

**SURF-002 — Expiration Collection**
```
Purpose: listar, filtrar e priorizar todos os vencimentos do tenant
Actors: Internal Operator
Journeys: J-01 (uso diário); recebe o resultado de J-02 (criação) e J-08 (import)
Outcomes: OUTCOME-001
Concepts: C1, C8 (Responsável)
Information obligations: nome, status, dias restantes (Primary); responsável, fornecedor associado
  (Secondary)
Decision obligations: qual item investigar/priorizar
Action obligations: abrir detalhe (→ SURF-003); iniciar criação (→ SURF-004)
Feedback obligations: distinguir lista vazia genuína de erro de rede
Readiness: PARTIAL — filtro por status (GSI1) suportado; busca textual não confirmada no backend
Dependencies: Full BFF
Trust implications: nenhuma
Accessibility implications: ordenação/agrupamento temporal perceptível sem depender só de posição visual
```

**SURF-003 — Expiration Detail**
```
Purpose: hub contextual de um vencimento específico — ver e decidir a próxima ação
Actors: Internal Operator
Journeys: J-01 (destino da investigação), J-03 (ponto de partida), J-04 (contém Document Context),
  J-05 (contém Alert Configuration)
Outcomes: OUTCOME-001, OUTCOME-004 (parcial, via ação)
Concepts: C1, C2 (via SURF-006), C7 (via SURF-007), C8, C4 (se vinculado)
Information obligations: nome, status, data, responsável, requisito vinculado (se houver); versão
  OCC atual disponível para próximas mutações
Decision obligations: "devo renovar isso?"; "devo agir agora?"
Action obligations: editar; iniciar renovação (→ SURF-005); iniciar upload (→ SURF-006);
  configurar alerta (→ SURF-007); arquivar; excluir
Feedback obligations: mudança de estado refletida imediatamente após qualquer ação contextual
Readiness: PARTIAL — CRUD funciona; seções de Documento/Alerta herdam BLOCKED de suas superfícies
Dependencies: Full BFF (direto); BLOCKER-A e BLOCKER-B (indiretos, via seções contextuais)
Trust implications: "arquivo verificado" ≠ "documento correto" quando a seção de documento é exibida
Accessibility implications: ações de alta consequência (arquivar/excluir) navegáveis por teclado,
  com confirmação deliberada
```

**SURF-004 — Expiration Creation**
```
Purpose: colocar algo novo sob acompanhamento, com o menor caminho possível (progressive complexity)
Actors: Internal Operator
Journeys: J-02
Outcomes: nenhum outcome T0 nomeado no Context/Task Model — T0 por inferência (herdado, §39 da
  etapa anterior, não resolvido aqui)
Concepts: C1 (obrigatório); C2/C3/C4/C7 (opcionais, não forçados)
Information obligations: campos mínimos exigidos pelo schema (name/category/dueDate)
Decision obligations: nenhuma de alto risco — só entrada de dados
Action obligations: confirmar criação; opcionalmente associar Fornecedor/Requisito existente
Feedback obligations: **CREATE-IDEMPOTENCY-01**: confirmação explícita de criação OU
  `UNKNOWN_OUTCOME` claramente distinto de `FAILED` — nunca reenvio automático (§24)
Readiness: READY (operação); risco de duplicata sob timeout não mitigado no backend
Dependencies: Full BFF; CREATE-IDEMPOTENCY-01 (gap de backend, não blocker nomeado)
Trust implications: usuário precisa confiar que um "não sei o que aconteceu" não vira duplicata
  automática
Accessibility implications: erro de validação por campo, não mensagem genérica única
```

**SURF-005 — Expiration Renewal**
```
Purpose: iniciar corretamente um novo ciclo sem perder rastreabilidade do anterior (renew ≠ edit)
Actors: Internal Operator
Journeys: J-03
Outcomes: OUTCOME-004
Concepts: C1 (dois — origem e novo), C2 (continuidade bloqueada por BLOCKER-A)
Information obligations: data atual, versão OCC atual, (idealmente) documento vigente — bloqueado
Decision obligations: "devo renovar isso?"; nova data é a correta?
Action obligations: confirmar renovação com `expectedVersion`
Feedback obligations: as DUAS mudanças — novo item criado E origem virou RENEWED — nunca só uma
Readiness: PARTIAL — operação OCC-safe e idempotente (`sourceItemId|sourceVersion|cycle`);
  continuidade documental depende de BLOCKER-A
Dependencies: Full BFF; BLOCKER-A (indireto)
Trust implications: usuário precisa entender que isto cria um registro novo, não edita o existente
  (risco de terminologia herdado)
Accessibility implications: confirmação de ação de alta consequência não pode depender só de
  posição/cor de botão
```

**SURF-006 — Document Context**
```
Purpose: manter, a qualquer momento, a prova documental correta associada ao vencimento certo
Actors: Internal Operator
Journeys: J-04 (outcome inteiro); J-03 (continuidade entre ciclos)
Outcomes: OUTCOME-002
Concepts: C2 (Documento)
Information obligations: tipo/tamanho aceito antes do envio; estado atual reconsultável — **hoje
  impossível, BLOCKER-A**
Decision obligations: "esse documento está correto?" — inatingível hoje sem rota de leitura
Action obligations: selecionar arquivo; confirmar envio
Feedback obligations: progresso de upload; confirmação de "upload enviado" — **nunca "verificando
  segurança" como fato confirmado** (corrigido, Rodada D: a observabilidade quebra a partir de
  `SCANNING`, não só no resultado final — ver §26/§32); nenhum resultado pós-envio é reconsultável
Readiness: **BLOCKED — BLOCKER-A**. Reserva/envio funcionam; a partir de `SCANNING`, nada é
  observável (a leitura pós-scan não existe)
Dependencies: Full BFF; **BLOCKER-A (direto, bloqueante)**
Trust implications: "arquivo verificado" (CLEAN) é segurança técnica, nunca validação de conteúdo
  (Epistemic Integrity)
Accessibility implications: upload precisa de alternativa a drag-and-drop; a confirmação de envio
  precisa ser anunciada — **não há estado de scanning observável para anunciar hoje** (corrigido,
  Rodada D — BLOCKER-A)
```

**SURF-007 — Alert Configuration**
```
Purpose: garantir que o usuário será avisado antes do vencimento, sem depender da própria memória
Actors: Internal Operator
Journeys: J-05
Outcomes: OUTCOME-003
Concepts: C7 (Alerta)
Information obligations: confirmação de que a política foi salva — **explicitamente insuficiente
  para provar entrega** (Epistemic Integrity)
Decision obligations: quando/como quero ser avisado
Action obligations: criar/editar/desabilitar política
Feedback obligations: nunca comunicar "você será avisado" como fato — só "política salva"
Readiness: READY (operação, `PUT /reminders/policies`) / **BLOCKED (outcome) — BLOCKER-B**
Dependencies: Full BFF; **BLOCKER-B (direto, bloqueante do outcome)**
Trust implications: "política salva" ≠ "aviso garantido" — regra central desta superfície
Accessibility implications: nenhuma além de formulário acessível padrão
```

**SURF-008 — Subject Collection**
```
Purpose: listar Fornecedores/Subjects (Subject Area, working label "Fornecedores")
Actors: Internal Operator
Journeys: J-06 (entrada)
Outcomes: OUTCOME-006 (suporte)
Concepts: C3
Information obligations: nome, tipo, contagem de requisitos pendentes vs. vinculados (nunca
  "regular/irregular" sem a ressalva de §13.2 da etapa anterior)
Decision obligations: qual Fornecedor investigar
Action obligations: abrir detalhe (→ SURF-009); criar Fornecedor
Feedback obligations: distinguir lista vazia genuína de erro
Readiness: READY
Dependencies: Full BFF
Trust implications: nenhuma
Accessibility implications: nenhuma além de padrão de lista
```

**SURF-009 — Subject Detail**
```
Purpose: ver todos os requisitos de um Fornecedor e seu status
Actors: Internal Operator
Journeys: J-06
Outcomes: OUTCOME-006
Concepts: C3, C4
Information obligations: lista de requisitos com status (MISSING/SATISFIED — nunca "regular" sem
  ressalva)
Decision obligations: qual requisito precisa de solicitação
Action obligations: abrir requisito (→ SURF-010); editar/arquivar Fornecedor
Feedback obligations: nenhum resumo agregado que implique garantia temporal não sustentada
Readiness: READY
Dependencies: Full BFF
Trust implications: mesmo cuidado de "SATISFIED ≠ em dia agora" (snapshot, não recalculado)
Accessibility implications: nenhuma além de padrão de lista
```

**SURF-010 — Requirement Context**
```
Purpose: ver um requisito específico, suas solicitações relacionadas, vincular/desvincular
Actors: Internal Operator
Journeys: J-06
Outcomes: OUTCOME-006
Concepts: C4, C5 (lista), C1 (se vinculado)
Information obligations: status do requisito; histórico de solicitações relacionadas
Decision obligations: "preciso reenviar uma solicitação?"; vincular a qual vencimento?
Action obligations: criar solicitação (→ SURF-011); link/unlink manual a um Vencimento existente
Feedback obligations: vínculo manual é sempre `CONFIRMED` (ação humana explícita), nunca inferido
Readiness: READY (operação — só MISSING↔SATISFIED); outcome pleno depende de BLOCKER-C para o
  caminho vindo de coleta externa
Dependencies: Full BFF
Trust implications: "SATISFIED" = "vinculado", não "em dia agora"
Accessibility implications: nenhuma além de padrão de formulário/lista
```

**SURF-011 — Document Request Context**
```
Purpose: acompanhar e revogar uma solicitação específica enviada a um Fornecedor
Actors: Internal Operator
Journeys: J-06
Outcomes: OUTCOME-006
Concepts: C5
Information obligations: status (REQUESTED/OPENED/SUBMITTED/REVOKED); prazo restante
Decision obligations: revogar? aguardar?
Action obligations: revogar solicitação (alta consequência)
Feedback obligations: revogação é imediata e irreversível — fornecedor perde acesso ao link na hora
Readiness: READY
Dependencies: Full BFF
Trust implications: nenhuma nova além do já registrado
Accessibility implications: confirmação deliberada antes de revogar, navegável por teclado
```

**SURF-012 — Submission Review**
```
Purpose: ver o documento recebido de um Fornecedor e decidir o vínculo — **só existe de fato se a
  Alternativa B (revisão humana) do branch point de BLOCKER-C for a escolhida**
Actors: Internal Operator
Journeys: J-06 (branch point, §28/§42)
Outcomes: OUTCOME-006
Concepts: C6 (Documento recebido), C2/C4 (destino do vínculo)
Information obligations: hoje, nenhuma — não existe rota de leitura de `DocumentSubmission`
  (`BLOCKER-C`)
Decision obligations: "esse documento recebido já virou o documento oficial?" — inatingível hoje
Action obligations: (produto correto, Alternativa B) vincular a Vencimento existente OU criar novo
Feedback obligations: nenhuma hoje — falha silenciosa mais séria já registrada na auditoria original
Readiness: **BLOCKED — BLOCKER-C**. Esta superfície inteira depende de uma decisão de produto ainda
  não tomada (§28) antes mesmo de depender de implementação
Dependencies: Full BFF; **BLOCKER-C (direto, bloqueante)**; decisão de produto (Alternativa A vs. B)
Trust implications: "documento recebido" ≠ "documento oficial" — regra central
Accessibility implications: N/A até a superfície existir de fato
```

**SURF-013 — Requests Collection**
```
Purpose: ver todas as solicitações pendentes/expirando em todos os Fornecedores (view global)
Actors: Internal Operator
Journeys: J-06 (suporte à decisão "preciso reenviar?", "quem está pendente?")
Outcomes: OUTCOME-006 (suporte)
Concepts: C5
Information obligations: hoje, nenhuma agregada — só via SURF-010/SURF-011 individualmente
Decision obligations: mesma decisão de SURF-010, mas cross-subject
Action obligations: nenhuma nova além de navegar para uma solicitação específica
Feedback obligations: N/A
Readiness: **BLOCKED** — sem query tenant-wide no backend (achado menor, não um dos 3 blockers
  nomeados, mas registrado desde o Context/Task Model)
Dependencies: query tenant-wide de solicitações pendentes (não implementada)
Trust implications: nenhuma nova
Accessibility implications: N/A até a superfície existir de fato
```

**SURF-014 — Guest Submission**
```
Purpose: entender quem pede, o que é pedido, e enviar o documento com segurança, sem criar conta
Actors: External Submitter
Journeys: J-07
Outcomes: OUTCOME-005
Concepts: C5, C6
Information obligations: requirementName, deadline, tipos/tamanho aceitos — **identidade do
  solicitante ausente, GTR-01**
Decision obligations: "devo confiar nisso?" (bloqueado por GTR-01); "meu arquivo está certo?"
Action obligations: selecionar arquivo; confirmar envio
Feedback obligations: confirmação de que a reserva foi aceita (distinta de "arquivo enviado", que é
  distinta de "arquivo verificado" — nunca alcançável pelo guest, §29)
Readiness: PARTIAL (técnico — fluxo de envio funciona, sem confirmação pós-envio) / PARTIAL
  (trust — GTR-01)
Dependencies: **GTR-01** (não resolvido); ausência de rota pública pós-envio (achado registrado,
  não elevado a blocker nomeado)
Trust implications: **GTR-01 formal** — submitter precisa saber quem pede antes de enviar
Accessibility implications: forte hipótese de mobile (foto JPEG/PNG); sem depender só de
  drag-and-drop
```

**SURF-015 — Import Flow**
```
Purpose: trazer dados existentes via planilha CSV sem cadastro manual um a um
Actors: Internal Operator
Journeys: J-08
Outcomes: TASK-008
Concepts: C9 (transiente — não é um "lugar" revisitado)
Information obligations: TTL da URL de upload; contagens agregadas (total/aceitas/rejeitadas/
  duplicadas) — **sem detalhe por linha, PARTIAL**
Decision obligations: commitar ou não, após revisar contagens
Action obligations: iniciar import; enviar arquivo; commitar
Feedback obligations: quantos registros foram efetivamente criados
Readiness: PARTIAL — reserve/parse/commit funcionam; erros por linha só em contagem agregada
Dependencies: Full BFF
Trust implications: "commitado" precisa significar realmente criado — único estado que sustenta isso
Accessibility implications: erros de linha (quando existirem) em texto claro, não só destaque visual
```

**SURF-016 — Settings**
```
Purpose: configurar preferências de notificação e de entrega de convite (utility, baixa frequência)
Actors: Internal Operator
Journeys: apoio a J-05 (preferência de canal) e J-06 (preferência de entrega)
Outcomes: TASK-010, TASK-012
Concepts: nenhum concept primário — só preferências
Information obligations: estado atual das preferências
Decision obligations: nenhuma de alto risco
Action obligations: salvar preferências
Feedback obligations: confirmação de que a preferência foi salva
Readiness: READY
Dependencies: Full BFF
Trust implications: nenhuma
Accessibility implications: formulário acessível padrão
```

**SURF-017 — Session Recovery**
```
Purpose: recuperar uma sessão perdida/expirada sem perder o contexto de onde o usuário estava
Actors: Internal Operator
Journeys: cross-cutting — todas as journeys autenticadas (J-01 a J-06, J-08)
Outcomes: nenhum outcome próprio — é infraestrutura de todos os outcomes autenticados
Concepts: nenhum concept de domínio
Information obligations: que a sessão precisa ser renovada
Decision obligations: nenhuma do usuário (refresh deveria ser transparente, per D-054)
Action obligations: reautenticar quando refresh falha
Feedback obligations: 401 claro → reautenticação, sem perda de trabalho não confirmado
Readiness: **BLOCKED — Full BFF (D-053/D-054) tem design aprovado, zero código implementado**
Dependencies: **Full BFF**
Trust implications: nenhuma além da própria segurança de sessão (fora de escopo redesenhar aqui)
Accessibility implications: interrupção de sessão não pode estranhar usuário de teclado/leitor de tela
```

---

## 6. Surface → Journey Mapping

| Surface | Journeys |
|---|---|
| SURF-001 Overview | J-01 |
| SURF-002 Expiration Collection | J-01, J-02, J-08 |
| SURF-003 Expiration Detail | J-01, J-03, J-04, J-05 |
| SURF-004 Expiration Creation | J-02 |
| SURF-005 Expiration Renewal | J-03 |
| SURF-006 Document Context | J-03, J-04 |
| SURF-007 Alert Configuration | J-05 |
| SURF-008 Subject Collection | J-06 |
| SURF-009 Subject Detail | J-06 |
| SURF-010 Requirement Context | J-06 |
| SURF-011 Document Request Context | J-06 |
| SURF-012 Submission Review | J-06 |
| SURF-013 Requests Collection | J-06 (suporte) |
| SURF-014 Guest Submission | J-07 |
| SURF-015 Import Flow | J-08 |
| SURF-016 Settings | apoio (J-05, J-06) |
| SURF-017 Session Recovery | todas autenticadas |

Nenhuma superfície sem journey (`SSI-G2` verificado). SURF-013 e SURF-016 não têm journey T0 própria
— existem como suporte de decisão real (Decision Inventory herdado) e como utility, não como
invenção sem lastro.

---

## 7. Surface → Concept Mapping

| Surface | Concepts |
|---|---|
| SURF-001 Overview | C1, C7*, C5* (* só quando observável) |
| SURF-002 Expiration Collection | C1, C8 |
| SURF-003 Expiration Detail | C1, C2, C4, C7, C8 |
| SURF-004 Expiration Creation | C1 (+ opcionalmente C2, C3, C4, C7) |
| SURF-005 Expiration Renewal | C1, C2 |
| SURF-006 Document Context | C2 |
| SURF-007 Alert Configuration | C7 |
| SURF-008 Subject Collection | C3 |
| SURF-009 Subject Detail | C3, C4 |
| SURF-010 Requirement Context | C4, C5, C1 |
| SURF-011 Document Request Context | C5 |
| SURF-012 Submission Review | C6, C2, C4 |
| SURF-013 Requests Collection | C5 |
| SURF-014 Guest Submission | C5, C6 |
| SURF-015 Import Flow | C9 (cria C1/C3) |
| SURF-016 Settings | nenhum concept primário |
| SURF-017 Session Recovery | nenhum concept de domínio |

Nenhuma superfície mistura conceitos sem necessidade (`SSI` correlato ao product creep) — SURF-006
e SURF-012 deliberadamente não compartilham a mesma superfície (C2 vs. C6 continuam distintos,
herdado da IA).

---

## 8. Global Surfaces

`GLOBAL` = superfície cuja entrada não depende de um objeto previamente selecionado. Ligadas a
contexto de tenant, não a um objeto específico: **Overview** (SURF-001), **Expiration Collection**
(SURF-002), **Expiration Creation** (SURF-004), **Subject Collection** (SURF-008), **Requests
Collection** (SURF-013 — conceitualmente global, tecnicamente `BLOCKED`), **Import Flow**
(SURF-015, ação global com acompanhamento transiente, não um destino revisitado).

---

## 9. Contextual Surfaces

Só existem dentro de outro objeto: **Expiration Detail** (SURF-003), **Expiration Renewal**
(SURF-005), **Document Context** (SURF-006), **Alert Configuration** (SURF-007), **Subject Detail**
(SURF-009), **Requirement Context** (SURF-010), **Document Request Context** (SURF-011),
**Submission Review** (SURF-012). Nenhuma foi promovida a top-level sem journey que o exija.

---

## 10. Guest Surfaces

**Guest Submission** (SURF-014) é a única superfície guest — totalmente separada da navegação
autenticada, per P6 (`interface-critical-user-journeys.md` §5): nenhum elemento de Overview/
Vencimentos/Fornecedores aparece aqui, e o guest nunca é convertido em usuário do SaaS dentro
desse fluxo. Isolamento reforçado pelo backend real: rota pública (`authorization_type=NONE`),
sem `RequestContext`/`authorize()`.

---

## 11. Utility Surfaces

**Settings** (SURF-016) — baixa frequência, sem outcome T0 próprio, mantida como `UTILITY AREA`
(não anchor operacional, herdado da IA). **Session Recovery** (SURF-017) — infraestrutura
cross-cutting, não um "lugar" que o usuário visita por objetivo próprio.

---

## 12. State Taxonomy

Taxonomia compartilhada mínima, aplicada seletivamente por superfície (não todas as superfícies
usam todas as categorias):

```
Loading      — dado está sendo buscado; subtipos em §16
Empty        — nenhum dado a mostrar; subtipos em §17 (nunca uma categoria única)
Error        — algo impediu a operação; subtipos em §18 (taxonomia de falha compartilhada)
Validation   — dado informado não passa em regra conhecida
Authentication — sessão ausente/expirada/em renovação (§19)
Permission   — ação negada pela matriz de autorização, ou objeto fora do escopo do tenant (§20)
Conflict     — OCC: o registro mudou desde a última leitura (§22)
Async Processing — processamento em andamento fora do request imediato (§23)
Success      — operação concluída com resultado confirmado
Unknown Outcome — nem cliente nem, por vezes, o próprio backend sabem se a operação foi aplicada (§21)
Blocked      — a funcionalidade não pode ser oferecida hoje por dependência de backend não resolvida
Unavailable  — o dado existe ou pode existir, mas não pode ser obtido agora (rede, timeout, backend)
```

---

## 13. Persistence Taxonomy

```
EPHEMERAL     — existe só na interação atual (ex.: rascunho de formulário de criação não confirmado)
PERSISTED     — existe no backend como estado gravado (ex.: ExpirationItem.status)
DERIVED       — calculado a partir de outros dados (ex.: "vencendo em 7 dias" a partir de dueDate)
REMOTE_ASYNC  — o PRÓXIMO valor ainda não foi determinado por ninguém, nem o backend o gravou —
                reservado para o intervalo antes de qualquer escrita (ex.: e-mail "em trânsito" no
                provedor externo, antes do callback assíncrono atualizar `NotificationAttempt`)
```

**Correção (Rodada C, achado real do Codex — §44)**: `REMOTE_ASYNC` não é sinônimo de "processo
assíncrono em andamento" — é sobre ONDE o valor mora, não sobre o quão rápido ele muda. Um status
já gravado no backend (mesmo que sujeito a nova transição assíncrona logo em seguida, como
`Document.SCANNING` ou `ImportJob.PARSING`) é **`PERSISTED`**, não `REMOTE_ASYNC` — o registro existe
e tem um valor atual, mesmo que esse valor mude de novo em breve. A versão anterior desta etapa
usava `REMOTE_ASYNC` incorretamente para vários status já persistidos (§15, §26, §28, §30),
confundindo o eixo de armazenamento com o eixo de processamento — corrigido em todas as ocorrências.

---

## 14. Visibility Taxonomy

```
USER_KNOWN               — usuário possui evidência direta (ex.: viu a confirmação de upload aceito)
SYSTEM_ONLY               — backend conhece, UI não expõe (ex.: resultado do scan para o guest)
USER_INFERRED             — UI deduz a partir de dados, sem garantia do backend (ex.: "documento
                            mais recente" como vigente)
NOT_CURRENTLY_OBSERVABLE  — o estado existe, mas o contrato/API atual não permite consultá-lo
                            (ex.: qualquer coisa atrás de BLOCKER-A/B/C)
```

---

## 15. Persistence × Visibility Matrix

| State | Persistence | Visibility |
|---|---|---|
| Formulário de criação (não confirmado) | EPHEMERAL | USER_KNOWN |
| `ExpirationItem.status` | PERSISTED | USER_KNOWN |
| "Vencendo em N dias" | DERIVED | USER_INFERRED |
| Upload em progresso (S3) | EPHEMERAL | USER_KNOWN |
| `Document.PENDING_UPLOAD` (reserva) | **PERSISTED** (corrigido, Rodada C) | USER_KNOWN (confirmado pela resposta síncrona da própria reserva) |
| `Document.SCANNING` (pós-evento S3) | **PERSISTED** (corrigido, Rodada C) | **NOT_CURRENTLY_OBSERVABLE** (corrigido, Rodada C — sem rota GET; no máximo `USER_INFERRED` na mesma sessão, logo após um `PUT` bem-sucedido, nunca confirmado) |
| `Document.CLEAN` (leitura pós-scan) | PERSISTED | **NOT_CURRENTLY_OBSERVABLE** (Internal Operator, BLOCKER-A) |
| `Document.CLEAN` (resultado ao guest) | PERSISTED | **NOT_CURRENTLY_OBSERVABLE** (guest, gap registrado) |
| `RequirementAssignment.SATISFIED` | PERSISTED | USER_KNOWN (mas snapshot, ver §31) |
| `DocumentSubmission` recebida | PERSISTED | **NOT_CURRENTLY_OBSERVABLE** (Internal Operator, BLOCKER-C) |
| `ReminderPolicy` salva | PERSISTED | USER_KNOWN |
| `ReminderOccurrence` materializada | PERSISTED (quando ocorre) | **NOT_CURRENTLY_OBSERVABLE** (caminho normal, BLOCKER-B) |
| `NotificationAttempt` (entrega de e-mail) | PERSISTED | SYSTEM_ONLY (sem rota GET) |
| `ImportJob.status` | PERSISTED | USER_KNOWN (`GET /imports/{jobId}` sempre disponível) |
| Documento vigente (qual dos N pertence ao ciclo atual) | DERIVED (client-side, sem garantia) | USER_INFERRED (quando A/B decidido) — hoje `NOT_CURRENTLY_OBSERVABLE` (BLOCKER-A) |
| Resultado de rede pós-timeout (criação/upload) | — | **UNKNOWN** — nem cliente nem, até reconsulta, o próprio usuário sabem |

---

## 16. Shared Loading States

```
INITIAL_LOADING   — primeira carga da superfície (Overview, Collection, Detail ao abrir)
BACKGROUND_REFRESH — dado já exibido sendo atualizado sem bloquear a tela (Overview ao voltar de
                     uma ação em outra superfície)
ACTION_PENDING     — uma mutação do usuário está em voo (confirmar criação/renovação/commit)
ASYNC_POLLING      — aguardando um processo de backend fora do request imediato (scan de documento
                     — bloqueado hoje; parse/commit de import — funcional)
LOAD_MORE          — paginação incremental de uma coleção (Expiration Collection, Subject Collection
                     — dependente de paginação real do backend, hoje `PARTIAL`)
```

Nenhuma superfície trata todos esses como "spinner genérico" — cada um exige feedback distinto
(§32).

---

## 17. Shared Empty States

```
EMPTY_TRUE        — não existem dados (tenant novo: 0 itens, 0 subjects — SURF-002/SURF-008)
EMPTY_FILTERED    — existem dados, mas nenhum corresponde ao filtro aplicado (SURF-002 com filtro
                    de status ativo)
EMPTY_NOT_READY   — processo ainda não gerou resultado (Import Flow entre UPLOADED e PREVIEW_READY,
                    §30; Requirement Context antes de qualquer solicitação ser criada)
EMPTY_UNAVAILABLE — dados não puderam ser obtidos (Requests Collection, SURF-013 — sempre neste
                    estado hoje, não por ausência real de dados, mas por ausência de query;
                    Submission Review, SURF-012 — mesma causa, BLOCKER-C)
EMPTY_PERMISSION  — dados existem ou podem existir, mas o usuário não pode vê-los (hoje sem caso
                    real confirmado — single-owner, `MEMBER`/`VIEWER` sem atribuição; registrado
                    como caso latente para quando Membership existir, não removido do vocabulário)
```

Nenhum caso acima é fundido com outro.

---

## 18. Shared Error States

Herdada e estendida da taxonomia de journeys (`interface-critical-user-journeys.md` §20-21):

| Erro | O que o sistema sabe | O que o usuário pode saber | Retry? | Corrigir? | Reiniciar? | Retorna depois? | Input preservado? |
|---|---|---|---|---|---|---|---|
| Validation | dado não passa em regra conhecida | qual campo e por quê | Sim | Sim | Não | N/A | Sim (P3) |
| Conflict (OCC) | registro mudou desde a leitura | que houve mudança concorrente, não o quê exatamente | Sim, após reconsulta | Sim | Não (relê) | N/A | Depende do formulário |
| Permission | ação negada / objeto fora do tenant | acesso negado (nunca distinguir "não existe" de "não autorizado" entre tenants) | Não | N/A | N/A | N/A | N/A |
| Authentication | sessão ausente/expirada | precisa reautenticar | Sim, após reautenticar | N/A | Não, se P5 respeitado | Sim | Depende — ver §19 |
| Network (pré-resposta) | nenhuma chamada foi feita ou resposta não chegou | tentar de novo | Sim | N/A | Não | Sim | Sim |
| Network (pós-envio de mutação) | **desconhecido — `UNKNOWN_OUTCOME`** | que o resultado é incerto, nunca que falhou | Só após reconsulta seletiva (nunca reenvio cego, §21) | N/A | Não | Sim | N/A |
| Processing (assíncrono) | falha de um worker (scan/parse/materialização) | depende de a rota de leitura existir (`NOT_CURRENTLY_OBSERVABLE` em vários casos) | N/A | N/A | Depende | Sim (P5, quando observável) | N/A |
| Security rejection | malware/formato inválido | rejeitado por segurança, nunca "documento incorreto" | Sim, com arquivo novo | N/A | Sim (novo upload) | Sim | N/A |
| External dependency | falha de provedor (SES/S3) | hoje, nada — gap registrado | Depende | N/A | N/A | Sim | Hoje, não |
| Domain state changed | precondição não é mais válida (item não é mais ACTIVE) | estado atual, não genérico | Não da mesma forma | Sim, com dado atual | Sim | N/A | N/A |

---

## 19. Authentication / Session States

```
AUTHENTICATED       — sessão válida, rotas de recurso acessíveis
SESSION_MISSING      — nenhuma sessão (primeiro acesso, ou logout explícito)
SESSION_REFRESHING   — renovação em andamento — deveria ser transparente ao usuário (D-054)
SESSION_EXPIRED      — sessão existiu e não é mais válida (idle timeout ou absoluteExpiresAt)
REFRESH_FAILED       — renovação falhou (rotation replay detectado, ou erro real)
REAUTH_REQUIRED      — usuário precisa passar pelo Hosted UI novamente
```

**O que sobrevive ao re-login (§28 do prompt-fonte)**, por processo:

| Processo | Contexto que precisa sobreviver | Onde vive |
|---|---|---|
| Criação (SURF-004) | nada — formulário curto, não confirmado é aceitável perder (herdado, J-02) | EPHEMERAL, browser |
| Renovação (SURF-005) | nada, mesma lógica | EPHEMERAL, browser |
| Import (SURF-015) | `jobId` e progresso | PERSISTED, backend — recuperável via `GET /imports/{jobId}` |
| Processamento de documento (SURF-006) | qual item estava sendo consultado — mas o resultado em si é
  `NOT_CURRENTLY_OBSERVABLE` mesmo reautenticado (BLOCKER-A não é resolvido por sessão) | PERSISTED
  (parcialmente, no backend) + gap |
| Acompanhamento de solicitação externa (SURF-011) | qual solicitação estava sendo acompanhada | PERSISTED, backend |

**Nota**: hoje, `Full BFF` tem zero código — todo este bloco descreve o comportamento requerido
pelo design aprovado (D-053/D-054), não o estado real (`SESSION_MISSING` é, na prática, o único
estado hoje possível para um SPA sem `Authorization: Bearer` manual).

---

## 20. Permission States

```
NOT_FOUND — objeto não existe, OU existe em outro tenant (as duas causas produzem o MESMO estado
            externo — isolamento multi-tenant já funciona assim por design, mesmo princípio de
            anti-enumeração aplicado ao guest flow, §29)
FORBIDDEN — ação negada pela matriz de autorização dentro do PRÓPRIO tenant (hoje, teoricamente
            possível só para MEMBER/VIEWER tentando ação ADMIN_ROLES — sem caminho real de
            atribuição hoje, caso latente, não removido do vocabulário)
```

Onde a política de segurança permite revelar a diferença (dentro do mesmo tenant, RBAC real), os
dois estados podem ser distintos. Entre tenants, nunca — sempre `NOT_FOUND` unificado.

---

## 21. Unknown Outcome States

```
FAILED          — o domínio SABE que a operação não foi aplicada
UNKNOWN_OUTCOME — nem cliente nem (em alguns casos) o backend sabem se a operação foi aplicada —
                  nunca convertido automaticamente para FAILED
```

Aplicações concretas:

| Superfície | Cenário | Por que é `UNKNOWN_OUTCOME`, não `FAILED` | Recovery seguro |
|---|---|---|---|
| SURF-004 (Criação) | timeout após `POST /items` | **CREATE-IDEMPOTENCY-01**: sem proteção de idempotência, um reenvio automático criaria duplicata real | Reconsultar a coleção; deixar o usuário confirmar se o item já existe; nunca reenviar sozinho |
| SURF-005 (Renovação) | timeout após `POST .../renew` | idempotência REAL existe (`sourceItemId\|sourceVersion\|cycle`) — reconsulta segura, diferente de SURF-004 | Reconsultar o item de origem; se `RENEWED`, a renovação ocorreu |
| SURF-006 (Documento) | falha de rede durante `PUT` ao S3 | não se sabe se parte do arquivo chegou | Nova reserva, nunca assumir sucesso parcial |
| SURF-014 (Guest) | rede fraca durante `PUT` ao S3 | mesma causa de SURF-006, ambiente mobile agrava | `PUT` de objeto S3 é reenviável com segurança (idempotente por natureza), mas o RESULTADO do scan permanece `NOT_CURRENTLY_OBSERVABLE` de qualquer forma |
| SURF-015 (Import) | timeout após `POST .../commit` | idempotência real via `If-Match` + dedupe por `externalId` | Reconsultar `GET /imports/{jobId}` |

---

## 22. OCC / Concurrency States

```
CONFLICT — o recurso mudou desde que a versão atual foi lida pelo usuário
```

Aplicado explicitamente em: edição/renovação/arquivamento/exclusão de vencimento (SURF-003,
SURF-005), commit de import (SURF-015, via `If-Match`). Nunca mapeado para erro genérico — mensagem
própria ("este item foi alterado desde que você o abriu"), recovery = reler o estado atual e
permitir nova tentativa, nunca sobrescrever silenciosamente.

---

## 23. Async Processing States

| Processo | Superfície | Inicial | Em andamento | Concluído | Falho | Timeout | Re-entry | Observabilidade |
|---|---|---|---|---|---|---|---|---|
| Scan de documento (interno) | SURF-006 | `PENDING_UPLOAD` | `SCANNING` | `CLEAN` | `REJECTED`/`UNSUPPORTED` | `TIMEOUT` (~10-25min) | Backend persiste, mas **rota de leitura não existe** — re-entry estruturalmente quebrado (`BLOCKER-A`) | `NOT_CURRENTLY_OBSERVABLE` (Internal Operator) |
| Scan de documento (guest) | SURF-014 | `PENDING_UPLOAD` | `SCANNING` | `CLEAN` | `REJECTED`/`UNSUPPORTED` | `TIMEOUT` | Sem sessão/rota — guest não reconsulta | `NOT_CURRENTLY_OBSERVABLE` (guest); `SYSTEM_ONLY` (backend) |
| Parse de import | SURF-015 | `UPLOADED` | `PARSING` | `PREVIEW_READY` | `FAILED` | `EXPIRED` (job) | `GET /imports/{jobId}` sempre disponível — funcional | `USER_KNOWN` |
| Commit de import | SURF-015 | `PREVIEW_READY` | `COMMITTING` | `COMMITTED` | `FAILED` | N/A | mesma rota | `USER_KNOWN` |
| Ciclo de lembrete | SURF-007 | `POLICY_CONFIGURED` | `MATERIALIZATION_PENDING` (nunca avança no caminho normal) | `OCCURRENCE_SCHEDULED`/`DELIVERED` | `FAILED` | N/A observável | Estruturalmente quebrado — nada a re-entrar (`BLOCKER-B`) | `NOT_CURRENTLY_OBSERVABLE` além da política salva |
| Notificação (entrega) | nenhuma superfície própria hoje | — | — | `CONFIRMED` (esperado) | `FAILED` (esperado) | — | N/A | `SYSTEM_ONLY` — sem rota GET |

---

## 24. Creation States

Aplicado a **SURF-004**.

| State | Persistence | Visibility | User claim allowed | Recovery | Readiness |
|---|---|---|---|---|---|
| `INITIAL` | EPHEMERAL | USER_KNOWN | — | — | READY |
| `EDITING` | EPHEMERAL | USER_KNOWN | dados ainda não enviados | preservar em erro de validação (P3) | READY |
| `VALIDATION_ERROR` | EPHEMERAL | USER_KNOWN | campo específico inválido | corrigir e reenviar | READY |
| `SUBMITTING` | EPHEMERAL→PENDING | USER_KNOWN | "enviando", nunca "criado" | — | READY |
| `CREATED` | PERSISTED | USER_KNOWN | "item criado" (confirmado pelo backend) | navegar ao item novo | READY |
| `FAILED` | — | USER_KNOWN | "não foi criado" (erro conhecido, ex. validação server-side) | corrigir e reenviar | READY |
| `UNKNOWN_OUTCOME` | — | **não determinável sem reconsulta** | **nunca "criado" nem "falhou"** — só "resultado incerto" | reconsultar a coleção; usuário decide se reenvia manualmente | **BLOCKED por CREATE-IDEMPOTENCY-01**: nenhuma automação de retry é segura |

Regra explícita (§18 do prompt-fonte): enquanto `POST /items` não for idempotente, `UNKNOWN_OUTCOME`
nesta superfície nunca oferece retry automático como ação seguro-por-padrão.

---

## 25. Renewal States

Aplicado a **SURF-005**.

| State | Persistence | Visibility | User claim allowed | Recovery | Readiness |
|---|---|---|---|---|---|
| `INITIAL` | PERSISTED (item de origem já existe) | USER_KNOWN | dados atuais do item de origem | — | READY |
| `EDITING_NEW_DUE_DATE` | EPHEMERAL | USER_KNOWN | rascunho não enviado | preservar em erro (P3) | READY |
| `VALIDATION_ERROR` | EPHEMERAL | USER_KNOWN | campo específico | corrigir | READY |
| `SUBMITTING` | EPHEMERAL→PENDING | USER_KNOWN | "renovando", nunca "renovado" | — | READY |
| `SUCCESS` | PERSISTED | USER_KNOWN | **as duas coisas juntas**: "novo ciclo criado" + "ciclo anterior preservado como RENEWED" | navegar ao item novo | PARTIAL (continuidade documental bloqueada) |
| `CONFLICT` | — | USER_KNOWN (mudança detectada, não o quê) | "este item mudou desde que você o abriu" | reler estado atual, tentar de novo | READY |
| `SOURCE_STATE_CHANGED` | — | USER_KNOWN | item de origem não está mais `ACTIVE` (já `ARCHIVED`/`RENEWED`) | erro conhecido, não genérico | READY |
| `FAILED` | — | USER_KNOWN | erro conhecido | corrigir e reenviar | READY |
| `UNKNOWN_OUTCOME` | — | determinável **por reconsulta segura** (idempotência real existe) | "resultado incerto, verificando" | reconsultar o item de origem — diferente de SURF-004, aqui a reconsulta É a recuperação segura | READY (idempotência real via `sourceItemId\|sourceVersion\|cycle`) |

---

## 26. Document States

Aplicado a **SURF-006** (lado interno).

| State | Meaning | Persistence | Visibility | User claim allowed | Recovery | Readiness |
|---|---|---|---|---|---|---|
| `NO_DOCUMENT` | nenhum documento ainda associado ao item | — | USER_KNOWN | "nenhum documento" | iniciar upload | READY |
| `PENDING_UPLOAD` | reserva feita, arquivo ainda não chegou ao S3 | **PERSISTED** (corrigido, Rodada C) | USER_KNOWN (resposta síncrona da própria reserva) | "reserva aceita, aguardando envio" | reenviar dentro do TTL (10 min) | READY |
| `UPLOADING` | transferência em progresso (client→S3) | EPHEMERAL | USER_KNOWN | "enviando" | nova reserva se falhar | READY |
| `SCANNING` | arquivo chegou, verificação de segurança em andamento (evento S3 assíncrono) | **PERSISTED** (corrigido, Rodada C) | **NOT_CURRENTLY_OBSERVABLE** (corrigido, Rodada C — sem rota GET; a transição em si não é consultável) | **"upload enviado" — nunca "verificando segurança" como fato confirmado (achado real do Codex, §44: essa claim excedia o que a API atual sustenta)** | aguardar (P5) — mas re-entry já quebrado a partir daqui, não só em CLEAN | **PARTIAL** (corrigido — a transição ocorre no backend, mas deixa de ser confirmável ao usuário a partir daqui; `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN`) |
| `FILE_VERIFIED` (`CLEAN`) | passou na validação estrutural + scan de malware — **nunca "aprovado"** | PERSISTED | **NOT_CURRENTLY_OBSERVABLE** (sem rota de leitura) | nenhum, hoje — mesmo quando o backend sabe | **BLOCKED — nenhuma, é o próprio BLOCKER-A** | **BLOCKED** |
| `FILE_BLOCKED` (`REJECTED`/`UNSUPPORTED`) | malware ou formato inválido | PERSISTED | `NOT_CURRENTLY_OBSERVABLE` (mesma causa) | nenhum hoje | novo upload — mas usuário não é avisado proativamente | **BLOCKED** |
| `VERIFICATION_TIMEOUT` | nem upload nem scan produziram evidência a tempo | PERSISTED | `NOT_CURRENTLY_OBSERVABLE` | nenhum hoje | nova reserva | **BLOCKED** |
| `UNKNOWN_OUTCOME` | falha de rede durante `PUT`, não se sabe se chegou | — | USER_KNOWN só do lado do browser | "não sei se enviou" | nova reserva, nunca assumir sucesso parcial | READY (esta parte específica) |

**Nota herdada (§9 da etapa 2, Open Question aberta)**: "documento vigente" não tem ponteiro
funcional no backend hoje (nem do lado do item, nem do requisito). Esta seção não resolve isso —
os estados acima descrevem o ciclo de UM documento; qual documento é "o vigente" entre vários
permanece Open Question (§42).

---

## 27. Reminder States

Aplicado a **SURF-007**.

```
NO_ALERT                 — nenhuma política configurada [PERSISTED, USER_KNOWN]
POLICY_CONFIGURED         — política salva (offset, canal) [PERSISTED, USER_KNOWN] — único estado
                            REALMENTE alcançável hoje no caminho normal
MATERIALIZATION_PENDING   — deveria gerar uma ReminderOccurrence futura — HOJE NUNCA OCORRE no
                            caminho normal [REMOTE_ASYNC, NOT_CURRENTLY_OBSERVABLE — BLOCKER-B]
OCCURRENCE_SCHEDULED       — ocorrência futura existe — hoje só via worker de reconciliação de DST,
                            caso de borda [PERSISTED quando ocorre, NOT_CURRENTLY_OBSERVABLE no
                            caminho normal]
DELIVERY_PENDING           — ocorrência aguardando disparo [REMOTE_ASYNC, NOT_CURRENTLY_OBSERVABLE]
DELIVERED                  — notificação enviada com sucesso [PERSISTED, SYSTEM_ONLY — sem rota GET]
FAILED                     — falha de envio (SES) [PERSISTED, SYSTEM_ONLY — gap adicional registrado]
```

**Regra desta superfície**: `POLICY_CONFIGURED` é o teto real de certeza que a interface pode
comunicar hoje. Nenhum estado a partir de `MATERIALIZATION_PENDING` deve ser apresentado como
"em andamento" — apresentá-lo assim seria exatamente o anti-padrão do §"Regra para funcionalidade
BLOCKED" (herdado do Context/Task Model): mascarar `BLOCKED` com um estado que sugere progresso.

---

## 28. External Collection States

Aplicado a **SURF-010/SURF-011/SURF-012**.

```
REQUIREMENT_PENDING    (MISSING)                         [PERSISTED, USER_KNOWN]
REQUEST_CREATING                                          [EPHEMERAL→PENDING]
REQUEST_SENT           (REQUESTED)                        [PERSISTED, USER_KNOWN]
REQUEST_OPENED         (OPENED)                           [PERSISTED, USER_KNOWN]
SUBMISSION_STARTED     (SUBMITTED / DocumentSubmission PENDING_UPLOAD) [PERSISTED, USER_KNOWN —
                        só que "enviado", nunca "aceito"]
FILE_UPLOADED                                             [PERSISTED (corrigido, Rodada C — ver §13)]
SECURITY_CHECK_PENDING (SCANNING)                         [PERSISTED (corrigido, Rodada C),
                        NOT_CURRENTLY_OBSERVABLE para o Internal Operator — mesma causa de
                        BLOCKER-A/C combinadas]
FILE_VERIFIED          (CLEAN)                            [PERSISTED, NOT_CURRENTLY_OBSERVABLE —
                        BLOCKER-C: nenhuma rota expõe isso ao Internal Operator hoje]
FILE_BLOCKED           (REJECTED/UNSUPPORTED)             [PERSISTED, NOT_CURRENTLY_OBSERVABLE]
BLOCKER_C_BOUNDARY     — ponto em que a implementação atual para, independente do resultado do scan
```

**Branch point (não decidido, formalizado sem escolher)**:

```
FILE_VERIFIED (CLEAN)
        ↓
        ?
   ┌────┴─────────────┐
   ↓                   ↓
Alternativa A       Alternativa B
Automatic            Human Review
Completion           (introduz SURF-012 como superfície real,
(nenhuma nova         com estados PENDING_CONFIRMATION →
 superfície           LINKED / REJECTED_BY_OPERATOR)
 necessária —
 RequirementAssignment
 vai a SATISFIED
 sem passo humano)
```

Nenhum estado além de `FILE_VERIFIED`/`BLOCKER_C_BOUNDARY` é modelado como certo até a decisão de
produto ser tomada (§42). `RequirementAssignment.SATISFIED` **nunca** é alcançado automaticamente
por este caminho hoje — só por `link` manual pré-existente (SURF-010).

---

## 29. Guest States

Aplicado a **SURF-014**. Vocabulário deliberadamente mais coarse do que o vocabulário interno —
não porque o guest "não precisa saber", mas porque (a) nenhuma rota pública expõe mais granularidade
e (b) anti-enumeração exige unificar causas de falha de token.

```
GuestRequestUnavailable  — unifica INVALID/EXPIRED/REVOKED/NOT_FOUND (nunca diferenciado — §29 do
                           prompt-fonte, herdado de J-07/anti-enumeração)
RequestLoaded             — token válido; requirementName/deadline/tipos visíveis; **identidade do
                           solicitante ausente (GTR-01)** — estado incompleto por design atual, não
                           por escolha desta etapa
FileSelected               — validação client-side de tipo/tamanho concluída [EPHEMERAL]
ReservationPending          — `POST .../uploads` em voo [EPHEMERAL→PENDING]
ReservationAccepted          — reserva aceita, URL pré-assinada obtida — **NUNCA rotulado como
                             "documento enviado"** [PERSISTED do lado do backend, USER_KNOWN]
UploadInFlight                — `PUT` ao S3 em progresso [EPHEMERAL, USER_KNOWN só client-side]
UploadAcceptedByBrowser         — o `PUT` retornou sucesso ao navegador — **este é o teto real de
                             certeza do guest** [USER_KNOWN, só client-side; backend não confirma
                             de volta nesta rota]
UploadUnknownOutcome              — rede caiu durante o `PUT` [UNKNOWN — reenvio do PUT é seguro,
                             ver §21]
```

**Estado que deliberadamente NÃO existe nesta superfície**: nenhum equivalente guest-facing de
`FILE_VERIFIED`/`CLEAN`. O guest sai da journey sabendo só `UploadAcceptedByBrowser` — o resultado
do scan é `SYSTEM_ONLY`/`NOT_CURRENTLY_OBSERVABLE` para ele, sempre (gap registrado, não uma
omissão desta etapa).

---

## 30. Import States

Aplicado a **SURF-015**.

| State | Meaning | Persistence | Visibility | Readiness |
|---|---|---|---|---|
| `INITIAL` | nenhum import iniciado | — | USER_KNOWN | READY |
| `FILE_SELECTED` | arquivo escolhido, validação client-side | EPHEMERAL | USER_KNOWN | READY |
| `UPLOADING` | envio ao S3 em progresso | EPHEMERAL | USER_KNOWN | READY |
| `UPLOADED` | S3 recebeu (não confirmado síncrono) | **PERSISTED** (corrigido, Rodada C — ver §13) | USER_KNOWN (assumido) | READY |
| `PARSING` | parse assíncrono em andamento | **PERSISTED** (corrigido, Rodada C) | USER_KNOWN (via polling, `GET /imports/{jobId}` sempre disponível) | READY |
| `PREVIEW_READY` | contagens agregadas disponíveis | PERSISTED | USER_KNOWN | READY |
| `VALIDATION_ISSUES` | linhas rejeitadas existem | PERSISTED | USER_KNOWN **só em contagem agregada** — detalhe por linha `NOT_CURRENTLY_OBSERVABLE` | **PARTIAL** |
| `COMMITTING` | commit em andamento | **PERSISTED** (corrigido, Rodada C) | USER_KNOWN (via polling) | READY |
| `COMMITTED` | registros efetivamente criados | PERSISTED | USER_KNOWN | READY |
| `FAILED` | job falhou (CSV malformado, etc.) | PERSISTED | USER_KNOWN | READY |
| `EXPIRED` | job morreu sem commit | PERSISTED | USER_KNOWN | READY |
| `UNKNOWN_OUTCOME` | timeout pós-commit | — | determinável por reconsulta (`GET /imports/{jobId}`, idempotente) | READY |

---

## 31. Epistemic Integrity Matrix

| Domain/System State | System knows | Internal operator knows | Guest knows | Allowed UI claim |
|---|---|---|---|---|
| Document upload aceito (reserva) | reserva criada | sim, se ele mesmo fez | sim, se ele mesmo fez | "reserva aceita" — nunca "documento recebido" |
| Document `CLEAN` | passou em checksum/tipo/malware, nada sobre conteúdo | **não** (BLOCKER-A) | **não**, nunca (gap) | "arquivo verificado" — nunca "aprovado"; só exibível quando BLOCKER-A resolvido |
| `DocumentSubmission` recebida | arquivo chegou, resultado do scan | **não** (BLOCKER-C) | sabe que enviou, não o resultado | "documento recebido" ≠ "documento oficial" |
| `RequirementAssignment.SATISFIED` | vínculo manual gravado uma vez, nunca revalidado | sim (é quem vinculou) | N/A | "vinculado a um vencimento" — nunca "em dia agora" |
| `ReminderPolicy` persistida | configuração salva | sim | N/A | "política salva" — nunca "você será avisado" |
| `ReminderOccurrence` | não existe no caminho normal (BLOCKER-B) | **não** (nada a saber) | N/A | nenhuma claim de agendamento até BLOCKER-B ser resolvido |
| `NotificationAttempt` | tentativa de envio, sucesso/falha | **não** (sem rota GET) | N/A | nenhuma claim — gap registrado |
| `ImportJob` | contagens, status | sim (rota funcional) | N/A | "N registros commitados" — claim sustentada pelo próprio estado `COMMITTED` |

---

## 32. Feedback Obligations

| Ação | Obrigação mínima de feedback |
|---|---|
| Create (SURF-004) | "item criado" (confirmado) OU "resultado incerto, verifique a lista" (`UNKNOWN_OUTCOME`) — nunca silêncio, nunca falso positivo |
| Renew (SURF-005) | novo ciclo criado + nova data + ciclo anterior preservado (RENEWED) — os três, nunca só um |
| Upload (SURF-006/SURF-014) | "reserva aceita, upload enviado" — **nunca "verificando segurança" como fato confirmado** (corrigido, Rodada C: a própria transição para `SCANNING` já não é consultável hoje, não só o resultado final); qualquer estado de verificação só vira claim quando `BLOCKER-A` tornar a rota observável |
| Guest submit (SURF-014) | "envio aceito pelo navegador" — nunca "documento verificado" |
| Import commit (SURF-015) | quantos registros foram efetivamente criados (`COMMITTED`), distinto de quantos foram só previstos (`PREVIEW_READY`) |
| Revoke request (SURF-011) | confirmação de que o link foi invalidado imediatamente |
| Configure alert (SURF-007) | "política salva" — explicitamente marcado como insuficiente para "você será avisado" |
| Link/unlink requirement (SURF-010) | confirmação explícita de vínculo humano (`CONFIRMED`), nunca implícito |

---

## 33. Re-entry Requirements

Pergunta aplicada por processo assíncrono (§39 do prompt-fonte): "se o usuário fechar o browser e
voltar amanhã, o estado ainda pode ser recuperado corretamente?"

| Processo | Recuperável hoje? | Motivo |
|---|---|---|
| Import (SURF-015) | **Sim** | `GET /imports/{jobId}` sempre disponível, estado persistido no backend |
| Document scan, lado interno (SURF-006) | **Não** — `DEPENDENCY/GAP` | `BLOCKER-A`: nenhuma rota de leitura, mesmo que o scan tenha terminado com sucesso |
| Document scan, lado guest (SURF-014) | **Não** — `DEPENDENCY/GAP` | mesma causa técnica, ator diferente; guest também não tem "sessão" para retomar, é um link, não um progresso salvo |
| Reminder lifecycle (SURF-007) | **Não** — `DEPENDENCY/GAP` | `BLOCKER-B`: nada além da política em si é persistido no caminho normal |
| Coleta externa / submissão (SURF-010/SURF-011/SURF-012) | **Parcial** | status da Solicitação (`REQUESTED`/`OPENED`/`SUBMITTED`) é recuperável via SURF-011; o que vem depois (`SUBMITTED`→vínculo) não é — `BLOCKER-C` |
| Criação/Renovação (SURF-004/SURF-005) | **N/A** | journeys curtas, sem necessidade de draft (herdado, aceitável perder) |

---

## 34. Persistent vs Ephemeral Requirements

| Informação | Refresh | Fechar browser | Logout/login | Novo dispositivo | Dia seguinte |
|---|---|---|---|---|---|
| Rascunho de criação (SURF-004) | pode perder | pode perder | pode perder | N/A | N/A |
| Rascunho de renovação (SURF-005) | pode perder | pode perder | pode perder | N/A | N/A |
| Progresso de import (SURF-015) | precisa sobreviver | precisa sobreviver | precisa sobreviver | precisa sobreviver | precisa sobreviver |
| Estado de documento pós-upload (SURF-006) | deveria sobreviver | deveria sobreviver | deveria sobreviver | deveria sobreviver | deveria sobreviver — **hoje não sobrevive a nada, porque não é nem consultável** (BLOCKER-A) |
| Sessão de guest (SURF-014) | é o próprio link, não uma sessão — reabrir funciona enquanto o token for válido | idem | N/A (sem conta) | idem | idem, até expirar (14 dias/deadline) |
| Contexto de "de onde vim" (Overview→Detail, §37) | deveria sobreviver dentro da mesma navegação | pode perder | pode perder | N/A | N/A |

Não decidido aqui: mecanismo (localStorage, query param, estado de servidor) — só o requisito.

---

## 35. Trust-State Requirements

- **GTR-01** (SURF-014): o `External Submitter` precisa de um estado que comunique identidade do
  solicitante antes de decidir enviar — hoje ausente, superfície permanece `PARTIAL` até resolvido.
- **Anti-enumeração** (SURF-014): `GuestRequestUnavailable` é o único estado externo para falha de
  token, independente da causa interna — qualquer novo estado/mensagem que diferencie
  invalid/expired/revoked/not_found viola uma decisão de segurança já tomada.
- **OCC como trust, não conveniência** (SURF-003/SURF-005/SURF-015): `CONFLICT` nunca sobrescreve
  silenciosamente — o usuário sempre vê que houve mudança concorrente antes de decidir.
- **Ações de alta consequência exigem confirmação deliberada** (sem decidir mecanismo): excluir
  (SURF-002/SURF-003), arquivar (SURF-003), renovar (SURF-005), revogar solicitação (SURF-011).
  Marcadas como `requires deliberate confirmation` / `error prevention`, não como modal específico.

---

## 36. Accessibility-State Requirements

```
Transições de estado assíncrono devem ser perceptíveis (não só atualização visual silenciosa) —
  aplica-se a SURF-006, SURF-007, SURF-014, SURF-015.

Sucesso/falha nunca comunicado só por cor — todo status (Vencido/Vencendo, CLEAN/REJECTED,
  SATISFIED/MISSING, COMMITTED/FAILED) precisa de texto/ícone redundante.

Recuperação de erro deve identificar o que precisa ser corrigido, nunca mensagem genérica única
  (SURF-004, SURF-005, SURF-015 — validação por campo).

Upload não pode depender só de drag-and-drop (SURF-006, SURF-014 — forte hipótese de mobile no
  guest).

Interrupção de sessão não pode estranhar usuário de teclado/leitor de tela (SURF-017) — 401 claro,
  navegação para reautenticação sem perda de foco abrupta.

Conclusão de loading deve ser comunicada, não presumida pela ausência do spinner (todas as
  superfícies com INITIAL_LOADING/ASYNC_POLLING).

Ações de alta consequência navegáveis por teclado, com confirmação deliberada (§35).
```

---

## 37. Surface Transition Matrix

| From Surface | Event / Decision | To Surface | Context that must survive |
|---|---|---|---|
| SURF-001 Overview | seleciona um item | SURF-003 Expiration Detail | `expirationId` + contexto de atenção de origem (ex. "veio da lista de vencidos") |
| SURF-001 Overview | inicia criação | SURF-004 Expiration Creation | nenhum |
| SURF-002 Expiration Collection | seleciona um item | SURF-003 Expiration Detail | `expirationId` |
| SURF-002 Expiration Collection | inicia criação | SURF-004 Expiration Creation | filtro/contexto de origem (opcional) |
| SURF-003 Expiration Detail | inicia renovação | SURF-005 Expiration Renewal | `expirationId` + versão OCC atual |
| SURF-003 Expiration Detail | inicia upload | SURF-006 Document Context | `expirationId` |
| SURF-003 Expiration Detail | configura alerta | SURF-007 Alert Configuration | `expirationId` |
| SURF-004 Expiration Creation | `CREATED` | SURF-002 ou SURF-003 | `itemId` recém-criado |
| SURF-004 Expiration Creation | `UNKNOWN_OUTCOME` | SURF-002 Expiration Collection | nenhuma automação — usuário reconsulta manualmente |
| SURF-005 Expiration Renewal | `SUCCESS` | SURF-003 Expiration Detail (novo item) | `newItemId`; rastro para o item de origem (`renewedFromId`) |
| SURF-005 Expiration Renewal | abandona antes de confirmar | SURF-003 Expiration Detail (item original) | nenhum (nada persistido) |
| SURF-008 Subject Collection | seleciona um Fornecedor | SURF-009 Subject Detail | `subjectId` |
| SURF-009 Subject Detail | seleciona um requisito | SURF-010 Requirement Context | `subjectId` + `requirementId` |
| SURF-010 Requirement Context | cria solicitação | SURF-011 Document Request Context | `requirementId` + `documentRequestId` recém-criado |
| SURF-010 Requirement Context | vínculo manual (link) | permanece em SURF-010 | confirmação de vínculo (`CONFIRMED`) |
| SURF-011 Document Request Context | fornecedor envia documento (evento externo, via J-07) | SURF-012 Submission Review (só se Alternativa B existir) | `documentRequestId` → `documentSubmissionId` |
| SURF-012 Submission Review | operador vincula (Alternativa B, hipotética) | SURF-010 Requirement Context | resultado do vínculo |
| SURF-014 Guest Submission | `UploadAcceptedByBrowser` | fim da journey — **não retorna ao app principal** (P6) | nenhum — guest sai da navegação |
| SURF-015 Import Flow | `COMMITTED` | SURF-002 Expiration Collection / SURF-008 Subject Collection | contagem de registros criados |
| qualquer superfície autenticada | `SESSION_EXPIRED` | SURF-017 Session Recovery | superfície e identificador de objeto de origem, para retorno pós-reautenticação |
| SURF-017 Session Recovery | reautenticação bem-sucedida | superfície de origem | mesmo identificador preservado |

---

## 38. Journey → Surface Matrix

| Journey | Entry Surface | Supporting Surfaces | Exit Surface/State |
|---|---|---|---|
| J-01 | SURF-001 Overview | SURF-002, SURF-003 | permanece em SURF-001/SURF-002, ou transiciona para J-03/J-04/J-05 |
| J-02 | SURF-004 Expiration Creation | SURF-002 (opcional, associar existente) | SURF-002/SURF-003 (`CREATED`) |
| J-03 | SURF-003 Expiration Detail | SURF-005 Expiration Renewal | SURF-003 (novo item, `SUCCESS`) |
| J-04 | SURF-003 Expiration Detail | SURF-006 Document Context | **bloqueado no passo final** — não há "exit" de sucesso alcançável hoje (BLOCKER-A) |
| J-05 | SURF-003 Expiration Detail | SURF-007 Alert Configuration | `POLICY_CONFIGURED` — **sem exit de sucesso pleno** (BLOCKER-B) |
| J-06 | SURF-009 Subject Detail | SURF-010, SURF-011, SURF-012 (branch), SURF-013 (suporte) | **branch point não resolvido** (BLOCKER-C) |
| J-07 | SURF-014 Guest Submission | nenhuma (isolada) | `UploadAcceptedByBrowser` — journey termina sem retorno ao app |
| J-08 | SURF-015 Import Flow | SURF-002/SURF-008 (destino) | SURF-002/SURF-008 (`COMMITTED`) |

---

## 39. Journey → State Matrix

| Journey | Critical States |
|---|---|
| J-01 | `INITIAL_LOADING`, `EMPTY_TRUE` (sucesso genuíno), erro de rede distinto de vazio |
| J-02 | `VALIDATION_ERROR`, `SUBMITTING`, `CREATED`, `UNKNOWN_OUTCOME` (sem retry automático) |
| J-03 | `EDITING_NEW_DUE_DATE`, `CONFLICT`, `SOURCE_STATE_CHANGED`, `SUCCESS` (dual claim), `UNKNOWN_OUTCOME` (reconsulta segura) |
| J-04 | `PENDING_UPLOAD`, `SCANNING`, `FILE_VERIFIED` (`NOT_CURRENTLY_OBSERVABLE`), `FILE_BLOCKED`, `VERIFICATION_TIMEOUT` |
| J-05 | `POLICY_CONFIGURED` (teto real), `MATERIALIZATION_PENDING` (nunca observável) |
| J-06 | `REQUIREMENT_PENDING`, `REQUEST_SENT`, `REQUEST_OPENED`, `SUBMISSION_STARTED`, `BLOCKER_C_BOUNDARY` (branch não resolvido) |
| J-07 | `GuestRequestUnavailable` (unificado), `RequestLoaded` (GTR-01 incompleto), `ReservationAccepted`, `UploadAcceptedByBrowser`, `UploadUnknownOutcome` |
| J-08 | `PARSING`, `PREVIEW_READY`, `VALIDATION_ISSUES` (só agregado), `COMMITTING`, `COMMITTED`, `UNKNOWN_OUTCOME` (reconsulta segura) |

Todo estado crítico identificado nas 8 journeys aparece em pelo menos uma superfície (`SSI-G2`
verificado).

---

## 40. Backend Dependency Mapping

```
Full BFF (D-053/D-054)        — pré-requisito de TODA superfície autenticada; zero código hoje
BLOCKER-A                     — SURF-006 (direto); SURF-005 (indireto)
BLOCKER-B                     — SURF-007 (direto); SURF-001 (indireto, se resumo de alertas)
BLOCKER-C                     — SURF-012 (existência da própria superfície); SURF-010/011 (outcome pleno)
GTR-01                        — SURF-014 (trust readiness)
CREATE-IDEMPOTENCY-01         — SURF-004 (recovery de UNKNOWN_OUTCOME)
Guest verification visibility gap — SURF-014 (teto de certeza do guest)
Tenant-wide requests query    — SURF-013 (existência da própria superfície)
Document current/version semantics — SURF-006 (Open Question, independente de BLOCKER-A ser corrigido)
```

---

## 41. Engineering Blocker Matrix

| ID | Dependency | Affected surfaces | Affected states | Severity | Required before |
|---|---|---|---|---|---|
| BFF | Full BFF (D-053/D-054), zero código | Todas as autenticadas (SURF-001 a SURF-013, SURF-015 a SURF-017) | `AUTHENTICATED`, todos os demais dependem dele | Crítica — bloqueia literalmente qualquer frontend real | Qualquer implementação de frontend autenticado |
| BLOCKER-A | Sem leitura/listagem de `Document`/`DocumentSubmission` | SURF-006 (direto), SURF-005 (indireto) | `FILE_VERIFIED`, `FILE_BLOCKED`, `VERIFICATION_TIMEOUT` (todos `NOT_CURRENTLY_OBSERVABLE`) | Alta — outcome T0 inteiro (J-04) | J-04 ser representada como completável |
| BLOCKER-B | Materialização de `ReminderOccurrence` desconectada | SURF-007 (direto), SURF-001 (indireto) | `MATERIALIZATION_PENDING` em diante | Alta — outcome T0 inteiro (J-05) | J-05 ser apresentada como funcional |
| BLOCKER-C | Ciclo de coleta externa não fecha | SURF-012 (existência), SURF-010/011 (outcome) | `FILE_VERIFIED`→`SATISFIED` (transição inexistente) | Alta — outcome T0 inteiro (J-06) | J-06 ser representada como completável; decisão de produto (branch) primeiro |
| GTR-01 | Identidade do solicitante ausente no guest flow | SURF-014 | `RequestLoaded` (incompleto) | Média-Alta (Trust/phishing) | Tráfego guest real de produção |
| CREATE-IDEMPOTENCY-01 | `POST /items` sem proteção de idempotência | SURF-004 | `UNKNOWN_OUTCOME` | Média (risco de duplicata, não de perda) | Qualquer retry automatizado nesta superfície (deve permanecer proibido até corrigido) |
| — | Guest sem rota pública pós-envio | SURF-014 | `UploadAcceptedByBrowser` é o teto | Média (Trust/completude, não bloqueia a ação em si) | Guest UX que pretenda confirmar resultado final |
| — | Query tenant-wide de solicitações | SURF-013 | toda a superfície | Baixa-Média (enfraquece decisão, não bloqueia outcome J-06 em si) | SURF-013 sair de `BLOCKED` |

---

## 42. Open Questions

Carregadas das etapas anteriores + novas desta etapa:

1. (herdada) Automatic completion vs. human review (branch point de BLOCKER-C) — determina se
   SURF-012 chega a existir como superfície real ou se `FILE_VERIFIED`→`SATISFIED` vira transição
   automática sem interação humana nenhuma.
2. (herdada) Semântica de "documento vigente" — backend precisa de ponteiro explícito, ou a
   interface infere por "mais recente"? Afeta diretamente quantos estados de `Persistence/Visibility`
   SURF-006 terá quando BLOCKER-A for resolvido.
3. (herdada) Nome final de `Subject`/`Fornecedor` por vertical — não afeta esta etapa estruturalmente,
   só terminologia de SURF-008/009.
4. (herdada) Necessidade real de "reenviar" uma Solicitação antes do link expirar — afeta se
   SURF-011 precisa de um `Action obligation` adicional.
5. (herdada) Query tenant-wide de solicitações pendentes — determina se SURF-013 sai de `BLOCKED`.
6. **Nova**: quando `BLOCKER-B` for corrigido, a Overview (SURF-001) deve resumir estado de alertas
   (ex. "3 alertas programados para esta semana")? Se sim, quais dos estados de §27 ficam
   `USER_KNOWN` na Overview vs. só em SURF-007 — não decidido aqui, registrado para quando a
   correção de backend existir.
7. **Nova**: se a Alternativa A (fechamento automático) de BLOCKER-C for escolhida, SURF-012 deixa
   de existir como superfície — os 3 novos estados hipotéticos de fila de confirmação (§28) também
   deixam de ser necessários. Esta etapa não pode fechar essa dependência sozinha.

---

## 43. Rejected Surface Assumptions

Rejeitadas explicitamente (§59 do prompt-fonte), com verificação:

- **"Uma URL = uma tela"** — rejeitado: nenhuma decisão de rota/URL foi tomada nesta etapa; a
  mesma Interaction Surface pode virar página, painel ou seção conforme a etapa de wireframes decidir.
- **"Toda entidade de backend precisa de tela"** — rejeitado: `NotificationIntent`,
  `IdentityMapping`, `DeviceSession`, `OutboxRecord`, `GuestTokenPointer`, `TenantEntitlement`
  permanecem sem superfície (nenhuma journey os exige, herdado da IA).
- **"Todo enum precisa de estado visível"** — rejeitado: estados mortos do enum (`REQUESTED`/
  `SUBMITTED`/`UNDER_REVIEW`/`REJECTED` de Requirement; `COMPLETED`/`CANCELLED`/`EXPIRED` de
  DocumentRequest) não recebem estado de UI — nenhuma transição do código os produz hoje.
- **"Todo loading é igual"** — rejeitado, ver §16 (5 subtipos).
- **"Todo empty é igual"** — rejeitado, ver §17 (5 subtipos).
- **"Timeout significa falha"** — rejeitado, ver §21 (`UNKNOWN_OUTCOME` como classe própria).
- **"Retry é sempre seguro"** — rejeitado explicitamente para SURF-004 (`CREATE-IDEMPOTENCY-01`).
- **"Guest sabe CLEAN"** — rejeitado, ver §29 (nenhum estado guest-facing equivalente existe).
- **"CLEAN significa aprovado"** — rejeitado, herdado e reforçado em §26/§31.
- **"SATISFIED significa compliance atual"** — rejeitado, herdado e reforçado em §31.
- **"Estado técnico deve sempre ser visível ao usuário"** — rejeitado: vários estados são
  deliberadamente `SYSTEM_ONLY` (ex. `NotificationAttempt`) até haver rota e journey que os
  justifiquem — visibilidade não é um padrão automático.
- **Superfícies candidatas descartadas** (§9 do prompt-fonte, hipótese de trabalho inicial, não
  aceita automaticamente): "Requirement Context" e "External Request Context" não foram fundidas
  em uma só (decisões distintas: status agregado vs. acompanhamento/revogação de uma solicitação
  específica) nem fragmentadas além do necessário; "Documento" (C2) e "Documento recebido" (C6)
  permanecem em superfícies diferentes (SURF-006 vs. SURF-012) — fundir esconderia `BLOCKER-C`;
  J-01/J-03/J-04/J-05 não geraram 4 superfícies de detalhe distintas — todas usam SURF-003 como hub,
  com seções contextuais próprias (SURF-005/006/007) só onde a diferença é de decisão, não de estado.

---

## 44. Codex Review

Revisão adversarial independente (Codex, sandbox read-only, código real verificado — não confiando
no texto da Rodada A), respondendo aos 26 pontos de crítica do prompt-fonte mais verificações
factuais pontuais (BLOCKER-A/B/C, CREATE-IDEMPOTENCY-01, GTR-01, ausência de rota pública guest
pós-envio, rotas reais do API Gateway). Veredito: **3 furos reais, todos pontuais/textuais — nenhum
furo estrutural no inventário de superfícies**.

**23 pontos sem furo** (verificados e confirmados corretos): toda journey tem superfície (1);
nenhuma superfície inventada sem journey real (2); SURF-006/SURF-012 corretamente não fundidas,
preservando C2≠C6 e BLOCKER-C (3); nenhuma entidade interna vazando como tela (4); nenhum estado
crítico das journeys omitido (5); loading/empty/async não comprimidos (6-8); `UNKNOWN_OUTCOME`
nunca tratado como `FAILED` (9); nenhum retry inseguro sugerido (10); `CREATE-IDEMPOTENCY-01`
aplicado corretamente — confirmado em código que `POST /items` (`item-handlers.ts:140-147`) não lê
idempotência, ao contrário de `renew` (11); guest nunca alcança estado equivalente a "verificado",
rotas públicas confirmadas como só `GET`/`POST uploads` (12); anti-enumeração preservada,
`GuestRequestUnavailable` confirmado contra `guest-submission-service.ts` (13); `CLEAN` nunca
tratado como aprovação, confirmado contra `document-state-machine.ts:61-65` (14); `SATISFIED`
nunca tratado como compliance atual, confirmado contra `requirement-service.ts:148-182` (15);
BLOCKER-A/B/C sem copy defensivo (16); `GTR-01` marcado incompleto, confirmado que
`getRequestInfo()` não expõe identidade do tenant (17); re-entry quebrado declarado explicitamente
para documento/guest/reminder (18); session-expiry com retorno ao contexto modelado, mas
corretamente marcado `BLOCKED` por Full BFF zero código (19); OCC como `CONFLICT` próprio, nunca
erro genérico (20); nenhum componente visual decidido cedo demais (24); nenhuma confusão URL/página
vs. Interaction Surface (25); nenhum product creep (26).

**3 furos reais, mesma causa raiz** (achado único, propagado por 4 seções):

21. **Persistência classificada errado**: `Document.PENDING_UPLOAD`/`SCANNING` são gravados no
    backend na reserva e no finalizer (`document-service.ts:136-148`;
    `upload-finalizer/finalizer.ts:55-85`), mas o rascunho os classificava como `REMOTE_ASYNC` — uma
    confusão entre o eixo de armazenamento (o valor está gravado) e o eixo de processamento
    (o valor pode mudar de novo em breve). Correção: `PERSISTED`, não `REMOTE_ASYNC`.
22. **Visibilidade classificada errado**: `SCANNING` estava como `USER_KNOWN`, mas não existe
    rota `GET`/lista de documentos (`infra/modules/api-gateway/main.tf:174-178` só tem `POST`/
    `DELETE`) — a transição para `SCANNING` em si não é consultável. Correção:
    `NOT_CURRENTLY_OBSERVABLE` (no máximo `USER_INFERRED` na mesma sessão, logo após o `PUT`).
23. **UI claim excede o domínio**: por causa do item 22, a claim "verificando segurança" para
    `SCANNING` excedia o que a API atual sustenta. Correção: só "upload enviado" até `BLOCKER-A`
    ser resolvido.

**Verificações factuais**: BLOCKER-A, BLOCKER-B, BLOCKER-C continuam válidos; CREATE-IDEMPOTENCY-01
continua válido; GTR-01 continua válido; não existe rota pública de status pós-envio guest; rotas
reais batem com as premissas do rascunho. **Severidade geral**: 3 furos reais, todos pontuais,
concentrados na classificação/claim de estados de documento em andamento — não exige redesenhar o
inventário de superfícies.

## 45. Reconciliation

Os 3 furos reais (mesma causa raiz: confusão entre eixo de armazenamento e eixo de processamento na
Persistence Taxonomy) foram aceitos e corrigidos:

| Finding | Evidence | Accepted/Rejected | Change |
|---|---|---|---|
| §21 Persistência `PENDING_UPLOAD`/`SCANNING` como `REMOTE_ASYNC` | `document-service.ts:136-148`, `upload-finalizer/finalizer.ts:55-85` gravam o status | **Accepted** | Reclassificado `PERSISTED` em §15, §26, §28; definição de `REMOTE_ASYNC` em §13 restrita a valores ainda não gravados por ninguém |
| §22 Visibilidade `SCANNING` como `USER_KNOWN` | `infra/modules/api-gateway/main.tf:174-178` só tem `POST`/`DELETE` para documentos | **Accepted** | Reclassificado `NOT_CURRENTLY_OBSERVABLE` em §15, §26, §28; nota de que `BLOCKER-A` começa em `SCANNING`, não só em `CLEAN` |
| §23 Claim "verificando segurança" excede o domínio | consequência direta do achado 22 | **Accepted** | Claim permitida reduzida a "upload enviado" em §26 e §32; Readiness de `SCANNING` rebaixado a `PARTIAL` |

Correção propagada por consistência (mesma causa raiz, não novo achado do Codex) a **§30 Import
States**: `UPLOADED`/`PARSING`/`COMMITTING` também usavam `REMOTE_ASYNC` para um valor já gravado e
plenamente observável (`GET /imports/{jobId}`) — reclassificados `PERSISTED`, sem mudança de
Visibility (já corretos como `USER_KNOWN`, dado que a rota de leitura existe de fato, ao contrário
de Documento).

Nenhuma divergência estrutural remanescente — os 17 SURF, as 8 journeys, os 3 blockers nomeados,
`GTR-01`, `CREATE-IDEMPOTENCY-01` e a arquitetura de informação herdada permanecem intactos. O
amendment desta rodada foi inteiramente sobre precisão de classificação Persistence×Visibility e
disciplina de Epistemic Integrity dentro do próprio inventário de estados, não sobre reabrir
decisões estruturais de superfície.

### Rodada D — revisão final do reconciliado

Codex confirmou as 3 correções da Rodada C item a item (persistência, visibilidade, claim) e
respondeu **não** à pergunta final do protocolo (nenhuma journey crítica ficou sem superfícies/
estados completos e recuperáveis) — mas achou **1 inconsistência textual residual**: o bloco
detalhado de SURF-006 (§5) ainda descrevia "transição visível para 'verificando segurança'" e
"resultado final reconsultável — quebrado no passo final", linguagem herdada da Rodada A que não
tinha sido propagada para o bloco de superfície ao corrigir §26/§32 — sugeria que o bloqueio de
observabilidade começava só no resultado final, quando na verdade começa em `SCANNING`. **Aceito e
corrigido**: bloco de SURF-006 reescrito para não prometer nenhuma transição observável, e a
implicação de acessibilidade correspondente ("scanning anunciado") corrigida para não exigir
anunciar um estado que não pode ser consultado. Veredito condicionado do Codex ("aprovaria depois
desta correção") tratado como satisfeito.

## 46. Quality Evaluation

| Eixo | Aplicável? | Avaliação |
|---|---|---|
| TaskSuitability | Sim | Todo outcome T0 tem superfície de suporte (§38); nenhum órfão |
| InformationArchitecture | Sim | Superfícies GLOBAL/CONTEXTUAL/GUEST/UTILITY consistentes com a IA já aprovada; nenhuma área nova inventada |
| SystemFeedback | Sim | Feedback obligation definida por superfície (§5) e por ação crítica (§32) |
| ErrorRobustness | Sim | Taxonomia de erro compartilhada (§18) + `UNKNOWN_OUTCOME` como classe própria (§21) |
| Accessibility | Parcial | Requisitos derivados por estado (§36); avaliação de componente real é próxima fase |
| Consistency | Sim | Taxonomias de estado/persistência/visibilidade aplicadas uniformemente (§12-14) |
| Content | Sim | Vocabulário herdado sem contradição (CLEAN/SATISFIED, GuestRequestUnavailable) |
| Trust | Sim | GTR-01, anti-enumeração e OCC tratados como requisitos de estado de primeira ordem (§35) |
| InformationPresentation | N/A | depende de layout/wireframe |
| Forms | N/A | nível de componente |
| DataOperations | N/A | nível de componente |
| Responsiveness | N/A | layout, próxima fase |

## 47. Final Status

**`APPROVED AS INPUT FOR LOW-FIDELITY WIREFRAMES`**

Motivo: revisão adversarial independente (Codex, 2 rodadas — B e D) encontrou 3 furos reais de
mesma causa raiz (confusão entre eixo de armazenamento e eixo de processamento aplicada a
`Document.PENDING_UPLOAD`/`SCANNING`, propagando-se em claim de UI excedendo o domínio) mais 1
inconsistência textual residual na Rodada D — todos corrigidos e verificados, nenhum estrutural.
Nenhum dos 11 gates (`SSI-G1` a `SSI-G11`) foi violado: toda journey tem superfície com estados
completos (`SSI-G1`); nenhum estado crítico omitido (`SSI-G2`); nenhuma compressão de estados
semanticamente distintos sobrevive à correção (`SSI-G3`); nenhum retry inseguro — `CREATE-IDEMPOTENCY-01`
aplicado explicitamente (`SSI-G4`); `UNKNOWN_OUTCOME` nunca vira `FAILED` (`SSI-G5`); todo
processamento assíncrono tem estado correspondente, mesmo quando `NOT_CURRENTLY_OBSERVABLE`
(`SSI-G6`); re-entry quebrado é declarado explicitamente, nunca escondido (`SSI-G7`); nenhuma
superfície mascara os blockers técnicos (`SSI-G8`); `GTR-01` tratado como requisito de trust
central (`SSI-G9`); nenhuma claim de UI excede o que o domínio sabe, depois da correção da Rodada C
(`SSI-G10`); nenhuma decisão de componente/layout foi tomada (`SSI-G11`).

Respondendo ao critério de conclusão (§66 do prompt-fonte): as 17 Interaction Surfaces e seus
estados respondem quais superfícies existem e por quê (§5-11), quais estados cada uma assume e sua
classificação Persistence×Visibility (§12-31), quais são compartilhados (§16-22), quais dependem de
processamento assíncrono e sua re-entry (§23, §33), o que o usuário sabe vs. só o backend vs. não é
observável hoje (§14-15, §31), o que a UI pode/não pode afirmar em cada estado (§31-32), como
loading/empty/failure se diferenciam por subtipo (§16-18, §21), quando retry é seguro ou proibido
(§21, `CREATE-IDEMPOTENCY-01`), como OCC aparece conceitualmente (§22), como sessão expira e se
recupera (§19, SURF-017), quais estados de guest são unificados por segurança (§29), onde `GTR-01`
e `BLOCKER-A/B/C` entram (§40-41), e o que está bloqueado pelo backend (§41). Nenhuma superfície
foi inventada sem journey (§43), nenhuma journey ficou sem superfície (§38), nenhum estado crítico
foi perdido (§39), e nenhuma decisão de wireframe foi tomada cedo demais (verificado nas duas
rodadas de revisão). Os 3 blockers técnicos, `GTR-01`, `CREATE-IDEMPOTENCY-01` e a arquitetura de
informação das três etapas anteriores permanecem intactos, não reabertos. Pronto para a próxima
etapa (Low-Fidelity Wireframes), carregando as 17 superfícies, a taxonomia de estados, as matrizes
de dependência/bloqueio e as Open Questions (§42) como input de entrada.

---

*Documento produzido a partir da leitura integral das três etapas anteriores já aprovadas, sem
refazer a auditoria de código original — verificações pontuais (status de D-053/D-054,
`NEXT_SESSION_PROMPT.md`) confirmadas diretamente antes de redigir.*
