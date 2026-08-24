---
status: APPROVED AS INPUT FOR SCREEN + STATE INVENTORY (Claude↔Codex, 4 rodadas — A/B/C/D)
owner: Marcelo
authority: insumo para Screen + State Inventory (próxima etapa) — não normativo de arquitetura de sistema
---

# Expiration Tracker — Critical User Journeys

Terceira etapa formal do planejamento de interface. Entradas, lidas integralmente, não refeitas:
`docs/frontend/interface-context-and-critical-tasks.md` (`APPROVED AS INPUT FOR CONCEPTUAL MODEL +
INFORMATION ARCHITECTURE`) e `docs/frontend/interface-conceptual-model-and-information-architecture.md`
(`APPROVED AS INPUT FOR CRITICAL USER JOURNEYS`, incluindo o amendment semântico). Constraints
adicionais confirmadas: D-053/D-054 (Full BFF, `decisions-log.md`), `implementation-blueprint.md`,
`NEXT_SESSION_PROMPT.md`. Nenhuma decisão aprovada anterior é reaberta sem evidência nova.

Sem wireframes, componentes, layout ou implementação. Disciplina de evidência mantida: `FACT` ·
`STRONG INFERENCE` · `HYPOTHESIS` · `OPEN QUESTION`, `SOURCE: context-task-model |
conceptual-model-IA | code | schema | ADR | roadmap | UX inference | business inference`.

---

## 1. Executive Summary

- 8 journeys mapeadas. **7 de 8 ancoradas em outcomes T0 já aprovados** (nenhum outcome T0/P0 sem
  journey — ver §27); **J-02 é uma exceção explícita, não uma decisão nova** — corrigido nesta
  rodada para não ser apresentada como "ancorada" da mesma forma que as demais.
- **Um gap real herdado, não corrigido, só exposto por esta etapa**: `Criar vencimento` (J-02)
  nunca recebeu uma linha própria de criticidade T0/T1 no Context/Task Model — é tratado ali só
  como item do inventário de tarefas (§8) e da frequência (§10), sem classificação formal.
  Mantida no inventário por exigência explícita do prompt desta etapa (journey mínima a investigar),
  tratada como **T0 por inferência forte** (pré-requisito estrutural de todos os outcomes T0
  existentes), mas com essa inferência marcada em toda tabela relevante, não silenciada —
  registrada como Open Question retroativa (§39).
- **Dois achados factuais reais desta rodada, confirmados em código, corrigidos**: (1) `POST
  /items` (J-02) não tem nenhuma proteção de idempotência — um retry após timeout de rede criaria
  um item duplicado, diferente de renovar/importar, que têm idempotência real; (2) J-07 (guest)
  comprimia "upload enviado" com "documento verificado" — não existe rota pública para o
  submitter consultar o resultado do scan de segurança depois do envio, e as mensagens de erro de
  token devem ser **genéricas por desenho de segurança** (anti-enumeração), nunca distintas por
  tipo de falha — a versão anterior deste documento pedia o oposto.
- **Três journeys carregam blocker técnico direto**: J-04 (`BLOCKER-A`), J-05 (`BLOCKER-B`), J-06
  (`BLOCKER-C`). Nenhuma foi mascarada como pronta — cada uma descreve o produto correto esperado
  E onde a implementação atual quebra, lado a lado.
- **J-07 (guest submission) tem um requisito de confiança formal, `GTR-01`**, não resolvido —
  tratado como parte central da journey, não como nota de rodapé.
- **Full BFF (D-053/D-054) é pré-requisito de implementação de toda journey autenticada** (J-01 a
  J-06, J-08) — não redesenhado aqui, só registrado uniformemente.
- **J-06 tem um branch point não decidido** (fechamento automático vs. revisão humana,
  `BLOCKER-C`) — as duas variantes são descritas lado a lado (§37), sem escolha.
- Regra permanente herdada e aplicada em toda journey: **a interface nunca promete mais certeza do
  que o domínio sustenta** (`Epistemic Integrity`, §6) — cada passo assíncrono é rotulado com o que
  o sistema realmente sabe (`KNOWN/INFERRED/PENDING/CONFIRMED/FAILED/UNKNOWN`).

---

## 2. Inputs and Scope

**Entradas primárias**: os dois documentos aprovados citados acima, lidos integralmente.
**Entradas de constraint**: D-053/D-054, `decisions-log.md`, `implementation-blueprint.md`,
`NEXT_SESSION_PROMPT.md`. `docs/frontend/interface-quality-standard.md` continua não existindo
como arquivo formal (mesma nota da etapa anterior) — eixos usados diretamente do prompt-fonte.
**Fora de escopo**: wireframes, componentes, layout, modais/drawers/wizards, Figma, código,
resolução dos blockers/`GTR-01`, decisão final do branch point de J-06, pesquisa de mercado nova
(reaproveitada quando já existente).

---

## 3. Journey Methodology

Cada journey parte de um **outcome** aprovado (Context/Task Model), nunca de uma rota HTTP ou
tela — **exceto J-02**, mantida como journey mínima obrigatória desta etapa e marcada como
inferência de criticidade, não como outcome já aprovado (ver §1/§39). Estrutura fixa por journey
(§9 do prompt-fonte): `Journey ID, Name, Actor, User Outcome,
Criticality, UI Priority, Frequency, Implementation Readiness, Planning Horizon, Trigger, Entry
Point(s), Preconditions, Starting Knowledge, Success Definition, Failure Consequence, Related
Concepts, Related Decisions, Backend Dependencies, Trust Requirements, Accessibility
Considerations` — seguida de uma tabela de passos com só os campos que agregam valor por journey
(`Step | User action | System action | System knowledge | Feedback required | Possible failure →
Recovery`), mais Critical Alternate Paths, Failure Paths, Abandonment e Re-entry quando aplicável.

### System Knowledge (taxonomia usada em toda journey)

```
KNOWN      — o domínio confirmou este fato (ex.: item existe, versão OCC atual)
INFERRED   — deduzido client-side, sem garantia do backend (ex.: "documento mais recente" como vigente)
PENDING    — evidência aguardada, resultado ainda não existe
CONFIRMED  — ação humana explícita resolveu a ambiguidade (ex.: link/unlink)
FAILED     — o domínio sabe que não deu certo
UNKNOWN    — nem o backend nem o cliente sabem o resultado (ex.: timeout de rede pós-envio)
```

---

## 4. Journey Prioritization

| Journey | Criticality | UI Priority | Frequency | Readiness |
|---|---|---|---|---|
| J-01 Revisão operacional | T0 | P0 | Daily | PARTIAL |
| J-02 Criar vencimento | **T0** (inferência — ver §1) | P0 | Weekly-monthly | READY |
| J-03 Renovar vencimento | T0 | P0 | Event-driven | PARTIAL |
| J-04 Manter evidência documental | T0 | P0 | Event-driven | **BLOCKED** (BLOCKER-A) |
| J-05 Ser avisado antes do vencimento | T0 | P0 | Event-driven/onboarding | **BLOCKED** (BLOCKER-B) |
| J-06 Coleta externa | T0 | P0 | Weekly | **BLOCKED** (BLOCKER-C) |
| J-07 Guest submission | T0 (do ponto de vista do submitter) | P0 | Event-driven | **PARTIAL (técnico — sem confirmação pós-envio) / PARTIAL** (trust — GTR-01), ambos corrigidos nesta rodada |
| J-08 Importação em massa | T1 | P1 | Occasional | READY (PARTIAL em erros por linha) |

---

## 5. Cross-Journey Principles

```
P1 — O usuário sempre sabe se uma operação está pendente, concluída ou falhou —
     nunca uma conclusão ambígua (CJ-G6).

P2 — Nenhuma ação destrutiva/de alta consequência é ambígua ou fácil de disparar
     por acidente (CJ-G9 quando envolve confiança externa).

P3 — Um erro de validação recuperável nunca apaga o que o usuário já preencheu.

P4 — A interface nunca promete mais certeza do que o domínio sustenta
     (Epistemic Integrity, §6) — inclui nunca apresentar um outcome BLOCKED
     como se fosse READY, mascarado por copy defensivo.

P5 — Processos assíncronos (upload, scan, import, guest submission, materialização
     de alerta) têm status persistente e recuperável — sair e voltar depois
     não perde o rastro de onde o processo parou.

P6 — O External Submitter recebe só o contexto relevante à tarefa dele — nunca
     é exposto ao restante do produto nem tratado como usuário do SaaS.

P7 — Um entry point externo (link de e-mail, link de guest) preserva contexto
     suficiente para agir sem navegação adicional.
```

Nenhum princípio foi aceito sem verificação: todos os 7 sugeridos pelo prompt-fonte se sustentam
contra os blockers e o modelo conceitual já aprovados — nenhum foi removido ou reformulado.

---

## 6. Epistemic Integrity Rules

Herdada sem reabertura do amendment da etapa anterior — regra central:

> **A interface nunca deve apresentar um estado com grau de certeza maior do que aquele suportado
> pelo domínio.**

Cadeia de não-equivalências aplicada a toda journey abaixo (verificada em código na etapa
anterior, não repetida aqui):

```
arquivo enviado          ≠ upload confirmado
upload confirmado        ≠ arquivo verificado
arquivo verificado       ≠ documento correto            (Document.CLEAN)
documento recebido       ≠ documento oficial             (C6 → C2, BLOCKER-C)
solicitação enviada      ≠ solicitação entregue          (REQUESTED → OPENED)
solicitação aberta       ≠ documento enviado             (OPENED → SUBMITTED)
documento enviado        ≠ requisito atendido            (BLOCKER-C)
SATISFIED                ≠ "em dia agora"                 (snapshot, não recalculado)
ReminderPolicy salva     ≠ ocorrência agendada            (BLOCKER-B)
ocorrência agendada      ≠ notificação entregue
```

---

## 7. Journey Inventory

| Journey | Actor | Outcome | Criticality | Frequency | Readiness | Main Entry Point | Main Dependencies |
|---|---|---|---|---|---|---|---|
| J-01 | Internal Operator | Saber o que exige atenção agora | T0 | Daily | PARTIAL | Overview | Full BFF |
| J-02 | Internal Operator | Colocar algo novo sob acompanhamento | T0 (inferência) | Weekly-monthly | READY | Global action (qualquer lugar) | Full BFF |
| J-03 | Internal Operator | Iniciar novo ciclo sem perder rastreabilidade | T0 | Event-driven | PARTIAL | Detalhe do Vencimento; link externo de alerta (futuro) | Full BFF, BLOCKER-A (indireto) |
| J-04 | Internal Operator | Manter evidência documental acessível | T0 | Event-driven | BLOCKED | Detalhe do Vencimento | Full BFF, BLOCKER-A (direto) |
| J-05 | Internal Operator | Ser avisado antes do vencimento e agir | T0 | Event-driven | BLOCKED | Detalhe do Vencimento (config); e-mail do alerta (futuro) | Full BFF, BLOCKER-B (direto) |
| J-06 | Internal Operator (+ External Submitter) | Obter documentação de terceiros sem cobrança manual | T0 | Weekly | BLOCKED | Detalhe do Fornecedor/Requisito | Full BFF, BLOCKER-C (direto) |
| J-07 | External Submitter | Enviar documento solicitado com confiança | T0 (submitter) | Event-driven | **PARTIAL / PARTIAL** (corrigido — nem o fluxo técnico confirma o resultado final ao submitter, nem o trust está resolvido) | Magic link (fora do app) | GTR-01 |
| J-08 | Internal Operator | Trazer dados existentes sem cadastro manual | T1 | Occasional | READY | Global action | Full BFF |

Nenhuma journey adicional foi justificada (critério §7 do prompt-fonte aplicado): capacidades
como notification preferences, tags, arquivamento avulso são operações de apoio já cobertas dentro
das journeys acima (ex. arquivar é um exit path de J-01/J-03), não outcomes T0/T1 isolados que
exijam journey própria.

---

## 8. J-01 — Daily Operational Review

```
Journey ID: J-01
Actor: Internal Operator
User Outcome: saber o que precisa de ação sem revisar item por item
Criticality: T0
UI Priority: P0
Frequency: many times per day / daily
Implementation Readiness: PARTIAL — GET /items/dashboard existe, mas a API não aplica
  paginação/ordenação real hoje, mesmo o backend suportando isso via GSI1
Planning Horizon: NOW
Trigger: login / retorno ao produto / necessidade de revisão periódica
Entry Point(s): Overview (principal); Vencimentos (direto)
Preconditions: sessão autenticada válida (depende de Full BFF implementado)
Starting Knowledge: nenhum — o usuário pode não lembrar o que cadastrou
Success Definition: usuário identifica corretamente os itens que precisam de ação
Failure Consequence: vencimento não percebido a tempo — o pior desfecho possível do produto
Related Concepts: C1 (Vencimento), C7 (Alerta, se existir), C5 (Solicitação, se existir)
Related Decisions: "O que exige minha atenção agora?"
Backend Dependencies: Full BFF (direto); BLOCKER-B (indireto — se a Overview pretender informar
  resultado de alertas, herda a mesma incerteza de J-05)
Trust Requirements: nenhum além de autenticação básica
Accessibility Considerations: nenhuma informação só por cor (status precisa de texto/ícone
  redundante); nenhum timeout de sessão silencioso
```

### Fluxo

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Abre a Overview | Consulta status/dueDate dos itens ativos | KNOWN (status/dueDate persistidos) | Contagem clara por urgência | API offline → distinguir de "sem itens" (Falha de rede, P1) |
| 2 | Escaneia prioridades | Cliente calcula vencido/vencendo a partir de `dueDate` | INFERRED (cálculo client-side, backend não persiste "vencendo") | Agrupamento temporal visível | — |
| 3 | Seleciona um item para investigar | Carrega detalhe do item | KNOWN | Todas as informações Primary/Secondary do item | Item não encontrado (excluído por outro processo) → mensagem clara, retorno à lista |
| 4 | Decide agir (renovar/upload/arquivar) ou seguir | Transição para J-03/J-04/outro exit | — | — | — |
| 5 | Retorna à Overview após agir | Reflete o novo estado do item | KNOWN (mutação já confirmada) | Confirmação visível de que a lista está atualizada | Lista desatualizada (cache) → P1 |

**Critical Alternate Paths**: nenhum item pendente (estado de sucesso genuíno, não erro — deve ser
distinguível de "erro ao carregar", per §15 pergunta 4). **Failure Path**: Overview falha ao
carregar → erro explícito, nunca uma lista vazia silenciosa. **Recovery**: retry manual; nenhuma
perda de contexto porque nada foi inserido pelo usuário nesta journey. **Abandonment**: usuário sai
sem agir — sem consequência, é uma journey de leitura. **Re-entry**: sempre trivial (é o ponto de
entrada padrão).

---

## 9. J-02 — Create Expiration

```
Journey ID: J-02
Actor: Internal Operator
User Outcome: colocar algo novo sob acompanhamento
Criticality: T0 (inferência — não classificado explicitamente no Context/Task Model, ver §1/§39)
UI Priority: P0
Frequency: weekly a monthly (fora de onboarding)
Implementation Readiness: READY — POST /items funciona de ponta a ponta
Planning Horizon: NOW
Trigger: necessidade identificada de rastrear algo nova (contrato, licença, certificado etc.)
Entry Point(s): ação global — não exige contexto de nenhum objeto prévio (§21 do documento anterior)
Preconditions: sessão autenticada
Starting Knowledge: usuário sabe o nome/categoria/data — não precisa saber nada do sistema
Success Definition: item criado, visível na Overview/Vencimentos imediatamente
Failure Consequence: se falhar silenciosamente, o item nunca é monitorado sem o usuário perceber
Related Concepts: C1 (Vencimento); opcionalmente C3/C4 (Fornecedor/Requisito), C2 (Documento
  inicial), C7 (Alerta) — nenhum obrigatório (Progressive Complexity, §17 do prompt-fonte)
Related Decisions: nenhuma decisão de alto risco nesta journey — só entrada de dados
Backend Dependencies: Full BFF
Trust Requirements: nenhum
Accessibility Considerations: validação de formulário precisa de erro claro por campo, não só
  mensagem genérica
```

### Verificação de "menor caminho" (Progressive Complexity)

**Hipótese testada, confirmada pelo backend**: um vencimento simples pode existir sem Subject,
Requirement, Documento ou Alerta — `schemas/api/create-item-request.v1.json` só exige `name`,
`category`, `dueDate`. A journey mínima não deve forçar a camada de compliance por terceiro.

### Fluxo (caminho mínimo)

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Inicia criação (ação global) | — | — | — | — |
| 2 | Informa nome, categoria, data (mínimo) | Validação client-side de formato | PENDING (ainda não enviado) | Erros de validação por campo | Data inválida/passada sem confirmação → erro claro, não silencioso |
| 3 | Confirma criação | `POST /items` | PENDING → KNOWN | — | **Achado real desta rodada, verificado em código**: `createItem()` **não tem nenhuma proteção de idempotência** — `handleCreateItem()` (`item-handlers.ts:140-147`) não lê nenhum header de idempotência, e `createItem()` (`expiration-service.ts:75-114`) sempre gera um `itemId` novo. Diferente de `renewItem()` (que usa `idempotencyKey ?? "${itemId}|${expectedVersion}|${cycle}"`, `expiration-service.ts:239-254`) e de `imports` (`Idempotency-Key` real). Timeout de rede após envio → **UNKNOWN real**: um reenvio automático da UI criaria um item **duplicado**, não apenas uma consulta desnecessária. A UI nunca deve reenviar automaticamente após timeout nesta operação especificamente — só reconsultar a lista e deixar o usuário decidir se o item já existe. Registrado como gap de backend a considerar (§39), não corrigido aqui. |
| 4 | — | Item criado, `status: ACTIVE` | KNOWN | Confirmação explícita + navegação para o item novo ou lista atualizada | Conflito de nome/duplicidade — não é erro do backend hoje (sem unicidade forçada), mas vale considerar aviso de possível duplicata (`HYPOTHESIS`, fora de escopo decidir aqui) |

**Critical Alternate Paths**: usuário opcionalmente associa a um Fornecedor/Requisito existente
(progressive complexity — expande a journey, não é obrigatório). **Failure Path**: erro de API
genérico → preservar os dados já preenchidos (P3), nunca limpar o formulário. **Abandonment**:
usuário sai no meio — nenhum dado é persistido até confirmação explícita (não há necessidade de
draft persistence aqui, diferente de journeys mais longas — critério §40 do prompt-fonte:
perder dados de um formulário curto e não confirmado é aceitável). **Re-entry**: N/A (journey
curta, sem estado intermediário a retomar).

---

## 10. J-03 — Renew Expiration

```
Journey ID: J-03
Actor: Internal Operator
User Outcome: iniciar corretamente um novo ciclo sem perder rastreabilidade do anterior
Criticality: T0
UI Priority: P0
Frequency: event-driven (ligado ao ciclo do próprio vencimento)
Implementation Readiness: PARTIAL — a operação central (POST .../renew) é OCC-safe e funciona;
  a continuidade documental entre ciclos depende de BLOCKER-A
Planning Horizon: NOW
Trigger: vencimento se aproxima ou já venceu; novo documento/ciclo chega
Entry Point(s): Detalhe do Vencimento (contextual); futuramente, link direto de um alerta por
  e-mail (depende de BLOCKER-B para existir de fato)
Preconditions: item de origem existe e está ACTIVE; usuário conhece (ou o sistema mostra) a
  versão OCC atual
Starting Knowledge: usuário sabe a nova data de validade — precisa primeiro investigar o estado
  atual do item (renew ≠ edit precisa ficar claro antes da ação)
Success Definition: novo item ativo com a data correta; item de origem rastreável como RENEWED
Failure Consequence: perda de rastreabilidade do ciclo anterior, ou duplicidade de itens
Related Concepts: C1 (Vencimento, dois — origem e novo), C2 (Documento, continuidade bloqueada)
Related Decisions: "Devo renovar isso?"
Backend Dependencies: Full BFF (direto); BLOCKER-A (indireto — qual documento pertence a qual
  ciclo permanece invisível)
Trust Requirements: usuário precisa entender que renovar cria um registro novo, não edita o
  existente (risco de terminologia já registrado, `renovar`≠`editar`)
Accessibility Considerations: confirmação de ação de alta consequência não pode depender só de
  posição/cor de botão
```

### Fluxo

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Investiga o estado atual do item | Mostra dados do item (data atual, status) | KNOWN | Versão OCC atual disponível para a próxima chamada | — |
| 2 | Informa a nova data de validade | Validação client-side | PENDING | Diferenciação visual clara de "isto vai criar um item novo" | Data nova igual/anterior à atual sem aviso → erro de validação |
| 3 | Confirma renovação | `POST /items/{id}/renew {newDueDate, expectedVersion}` | PENDING → KNOWN (transação atômica: origem vira RENEWED, novo item ACTIVE) | Confirmação explícita das DUAS mudanças (novo item + origem renovado) — P1/P5 | **Conflito OCC** (409 — outro processo alterou o item entre a leitura e a confirmação): FAILED conhecido, não genérico — mensagem "este item foi alterado desde que você o abriu", reler e permitir nova tentativa (nunca sobrescrever silenciosamente) |
| 4 | — | — | — | Usuário sabe: nova data, existência do novo ciclo, estado do ciclo anterior (todos os 3, per §45 do prompt-fonte) | Timeout pós-envio → **UNKNOWN**, mesma cautela de J-02 (idempotência real existe via `tenantId|sourceItemId|sourceVersion|cycle`, a UI deve reconsultar antes de assumir falha) |

**Critical Alternate Paths**: usuário tenta renovar um item que não está `ACTIVE` (já `ARCHIVED`/
`RENEWED`) → erro conhecido (`FAILED`), não genérico. **Failure Path**: conflito de versão (acima).
**Recovery**: sempre por reconsulta do estado atual, nunca retry cego. **Re-entry**: se o usuário
abandona no meio (antes de confirmar), nada foi persistido — sem necessidade de draft (mesma
lógica de J-02, journey curta). **Cross-journey**: J-03 pode levar de volta a J-01 (retorno à
revisão) ou alimentar J-04 (associar documento ao ciclo novo, hoje bloqueado por `BLOCKER-A`).

---

## 11. J-04 — Maintain Document Evidence

```
Journey ID: J-04
Actor: Internal Operator
User Outcome: manter, a qualquer momento, a prova documental correta associada ao vencimento certo
Criticality: T0
UI Priority: P0
Frequency: event-driven
Implementation Readiness: BLOCKED — BLOCKER-A
Planning Horizon: NOW (conceitualmente) — bloqueado antes de release real
Trigger: documento recebido (e-mail/WhatsApp externo) ou digitalizado; ou necessidade de conferir
  o documento já associado a um item
Entry Point(s): Detalhe do Vencimento (contextual)
Preconditions: item já existe (documento nunca é "solto", C2 sempre pertence a um C1)
Starting Knowledge: usuário tem o arquivo em mãos; não sabe (sistema também não garante) qual é
  "o documento vigente" se houver mais de um
Success Definition: usuário consegue, a qualquer momento, confirmar qual documento é o vigente
Failure Consequence: usuário acredita ter documentação em dia sem nunca ter confirmação real
Related Concepts: C1 (Vencimento), C2 (Documento)
Related Decisions: "Esse documento está correto?"
Backend Dependencies: Full BFF (direto); **BLOCKER-A (direto, bloqueante)**
Trust Requirements: usuário precisa entender que "arquivo verificado" (CLEAN) é segurança
  técnica, não validação de conteúdo (Epistemic Integrity, §6)
Accessibility Considerations: upload precisa de alternativa a drag-and-drop; estado assíncrono
  (scanning) precisa ser anunciado, não só visual
```

### Fluxo (produto correto esperado — parte READY, parte BLOCKED)

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Seleciona arquivo localmente | — | — (client-only) | Tipo/tamanho aceito visível antes do envio | Arquivo inválido/grande demais → erro antes de tentar enviar |
| 2 | Confirma envio | Reserva upload (`PENDING_UPLOAD`) + URL pré-assinada (10 min) | PENDING (`PENDING_UPLOAD`) | Indicação clara de que a URL expira em 10 min | URL expira antes do envio → **FAILED conhecido**, reserva nova necessária (não é ambíguo — TTL é fixo) |
| 3 | Upload em progresso | Cliente envia direto ao S3 | PENDING (`SCANNING` após chegar) | Progresso de upload; transição visível para "verificando segurança" | Falha de rede durante upload → **UNKNOWN** se parte do arquivo chegou; recovery = reserva nova, nunca assumir sucesso parcial |
| 4 | Aguarda (pode sair e voltar — P5) | Scan de malware assíncrono (evento S3 → workers) | PENDING → **CONFIRMED** (`CLEAN`, "arquivo verificado") ou **FAILED** (`REJECTED`/`UNSUPPORTED`) ou **UNKNOWN** (`TIMEOUT`, ~10-25min sem evidência) | Estado atual reconsultável — **hoje impossível: `BLOCKER-A`** | Malware detectado → `REJECTED`, sem notificação proativa hoje (gap adicional, registrado) |
| 5 (produto correto) | Consulta "o documento deste vencimento" a qualquer momento depois | Lista/lê documentos do item | KNOWN (se `BLOCKER-A` resolvido) | Qual é o documento vigente, histórico se houver mais de um | **Hoje: rota não existe — journey para aqui, `BLOCKER-A`** |

**Onde a implementação atual quebra (explícito, não mascarado)**: o Step 5 não é alcançável hoje —
depois do Step 4, o usuário não tem nenhuma forma de reabrir o item e ver o resultado, mesmo que o
upload/scan tenham terminado com sucesso. Isso não é um "erro" no sentido de falha — é uma
capacidade que nunca foi construída (`BLOCKER-A`). **Critical Alternate Path**: múltiplos
documentos sob o mesmo item sem hierarquia — a journey do "documento vigente" (Open Question do
documento anterior, §9) permanece sem resposta até uma decisão de domínio.

---

## 12. J-05 — Reminder-Driven Action

```
Journey ID: J-05
Actor: Internal Operator
User Outcome: receber um aviso no momento apropriado e conseguir agir a partir dele
Criticality: T0
UI Priority: P0
Frequency: event-driven / configurado no onboarding
Implementation Readiness: BLOCKED — BLOCKER-B
Planning Horizon: NOW (conceitualmente) — bloqueado antes de release real
Trigger: criação de item importante / revisão de política existente
Entry Point(s): Detalhe do Vencimento (configuração); e-mail do próprio alerta (entrada externa,
  só existe quando BLOCKER-B for corrigido)
Preconditions: item existe
Starting Knowledge: usuário sabe quando quer ser avisado (ex. "7 dias antes")
Success Definition: usuário recebe o aviso no momento configurado e consegue agir a partir dele
Failure Consequence: falsa sensação de segurança — o pior tipo de falha do produto inteiro
Related Concepts: C1 (Vencimento), C7 (Alerta)
Related Decisions: "O que exige minha atenção agora?" (a notificação é o gatilho externo desta
  mesma decisão)
Backend Dependencies: Full BFF (direto); **BLOCKER-B (direto, bloqueante)**
Trust Requirements: usuário precisa entender que "política salva" ≠ "aviso garantido" (Epistemic
  Integrity, §6)
Accessibility Considerations: e-mail de notificação precisa ser acionável sem depender só de um
  link visual (texto claro do que fazer)
```

### Fluxo, com as 4 fases exigidas separadas (Configuration / Scheduling / Delivery / User reaction)

| Step | Fase | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|---|
| 1 | Configuration | Define quando quer ser avisado (offset, canal) | `PUT /reminders/policies` | PENDING → KNOWN (política persistida) | Confirmação de que a política foi salva — **explicitamente insuficiente para provar entrega** (P4/Epistemic Integrity) | Erro de validação (offset inválido) → erro claro |
| 2 | Scheduling/materialization | (nenhuma — automático, esperado) | Sistema deveria criar uma `ReminderOccurrence` futura quando o item é criado/tem `dueDate` alterado | **Produto correto: PENDING→KNOWN. Hoje: nunca ocorre no caminho normal — `BLOCKER-B`** | — | **Journey para aqui hoje** — nenhuma ocorrência é materializada fora do caso de borda de reconciliação de DST |
| 3 | Delivery | (nenhuma) | Sistema deveria disparar a notificação no momento configurado | Produto correto: `CONFIRMED` (enviado) ou `FAILED` (falha de envio, hoje sem exposição ao usuário) | Notificação clara, acionável | Falha de envio (SES) → hoje invisível ao usuário (gap adicional, registrado) |
| 4 | User reaction | Abre a notificação | Deep-link para o contexto do vencimento (`STRONG INFERENCE`, §24 do prompt-fonte — não decidido como URL concreta) | KNOWN (o vencimento existe, o motivo do aviso é claro) | Contexto preservado — usuário não precisa procurar de novo o item que motivou o aviso (P7) | Link expirado/item já resolvido por outra via → mensagem clara, não erro genérico |
| 5 | User reaction | Investiga e decide agir | Transição para J-03 (renovar) ou J-04 (upload) | — | — | — |

**Onde a implementação atual quebra**: entre os Steps 1 e 2 — a política é salva, mas nada a
conecta à criação real de uma ocorrência futura no caminho normal (só o worker de reconciliação de
DST, um caso de borda, chama o materializer). Os Steps 3-5 descrevem o produto correto esperado
para quando `BLOCKER-B` for resolvido; não são alcançáveis hoje. **Cross-journey**: J-05 é o
principal gatilho externo de J-01 (revisão) e leva diretamente a J-03/J-04.

---

## 13. J-06 — External Document Collection

```
Journey ID: J-06
Actor: Internal Operator (lado interno) + External Submitter (lado externo, ver J-07)
User Outcome: obter de um terceiro a documentação necessária sem acompanhamento manual constante
Criticality: T0
UI Priority: P0
Frequency: weekly
Implementation Readiness: BLOCKED — BLOCKER-C
Planning Horizon: NOW (conceitualmente) — bloqueado antes de release real
Trigger: requisito identificado como pendente (`MISSING`) para um Fornecedor
Entry Point(s): Detalhe do Fornecedor → Requisito
Preconditions: Fornecedor e Requisito já existem
Starting Knowledge: usuário sabe de quem precisa do documento e qual documento é
Success Definition (produto correto): requisito passa a `SATISFIED`, vinculado ao documento
  recebido, sem trabalho manual de acompanhamento
Failure Consequence: exatamente a falsa sensação de segurança que o produto existe para evitar
Related Concepts: C3/C4 (Fornecedor/Requisito), C5 (Solicitação), C6 (Documento recebido)
Related Decisions: "Preciso reenviar uma solicitação?", "Esse fornecedor está regular?" (com a
  ressalva de honestidade já registrada — `SATISFIED` é vínculo, não garantia temporal)
Backend Dependencies: Full BFF (direto); **BLOCKER-C (direto, bloqueante)**
Trust Requirements: ver J-07/GTR-01 para o lado externo
Accessibility Considerations: revogação de solicitação é ação de alta consequência (o fornecedor
  perde acesso ao link imediatamente) — precisa de confirmação deliberada
```

### Fluxo (lado interno, até o branch point)

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Identifica requisito `MISSING` | Lista requisitos do fornecedor | KNOWN | Status claro por requisito | — |
| 2 | Cria solicitação (e-mail/nome do destinatário) | `POST .../document-requests` | PENDING → KNOWN (`REQUESTED`) | Confirmação de envio (manual ou automático, conforme preferência de entrega) | — |
| 3 | Acompanha o estado | Consulta status da solicitação | KNOWN (`REQUESTED`/`OPENED`/`SUBMITTED`) — mas **sem view global cross-subject hoje** (gap adicional, registrado no documento anterior) | Prazo restante visível | Link nunca aberto até o deadline → `EXPIRED` só no token, `DocumentRequest` não transiciona (estado morto, §13 do documento anterior) — usuário só percebe pelo prazo, sem alerta proativo |
| 4 | (externa — ver J-07) Fornecedor envia documento | `DocumentSubmission` criada, scan de segurança roda | PENDING → `CLEAN`/`REJECTED` | — | — |
| 5 | **Branch point** — ver §37 | — | — | — | — |

**Branch point (não decidido, `BLOCKER-C`)**:

```
Documento recebido + CLEAN
                 ↓
      ┌──────────┴──────────┐
      ↓                     ↓
Automatic completion    Human review
   (Alternativa A)        (Alternativa B)
```

Comparação completa das duas variantes: §37.

---

## 14. J-07 — Guest Submission

```
Journey ID: J-07
Actor: External Submitter
User Outcome: entender quem está pedindo, o que está sendo solicitado, e enviar o documento com
  segurança, sem criar conta
Criticality: T0 (do ponto de vista do submitter)
UI Priority: P0
Frequency: event-driven, tipicamente uma submissão por link
Implementation Readiness: **PARTIAL** (fluxo técnico de envio funciona; UX trust readiness
  também `PARTIAL` — GTR-01. Corrigido nesta rodada de "READY" — ver nota abaixo sobre o que o
  submitter realmente consegue confirmar)
Planning Horizon: NOW
Trigger: recebe um link (e-mail manual ou automático)
Entry Point(s): o link em si — fora de qualquer navegação do app principal (P6)
Preconditions: token válido, não expirado (14 dias ou deadline, o que vier primeiro), não revogado
Starting Knowledge: nenhuma — o submitter não conhece o produto nem necessariamente a organização
  requisitante (ver GTR-01)
Success Definition: **corrigido nesta rodada** — o envio (`PUT` ao S3 via URL pré-assinada) foi
  aceito. **Não é**: confirmação de que `DocumentSubmission` chegou a `CLEAN` — não existe rota
  pública para o submitter consultar o resultado do scan de segurança depois do envio
  (`infra/modules/api-gateway/main.tf:279-283`, verificado nesta rodada: só há `GET` do pedido e
  `POST` para iniciar o upload, nenhuma consulta de status pós-envio). O submitter sai da journey
  sabendo só que o arquivo foi transmitido, nunca se foi aceito.
Failure Consequence: processo trava sem fallback — não há reenvio automático de link; e o
  submitter nunca descobre, pela própria interface, se o envio foi rejeitado depois
Related Concepts: C5 (Solicitação), C6 (Documento recebido)
Related Decisions: nenhuma decisão de negócio — só "devo confiar nisso?" (trust) e "meu arquivo
  está certo?" (validação local)
Backend Dependencies: nenhuma dependência de Full BFF (rota pública, `authorization_type=NONE`);
  **GTR-01 não resolvido**
Trust Requirements: **GTR-01 — formal, ver abaixo**
Accessibility Considerations: forte hipótese de uso em mobile (aceita foto JPEG/PNG) — precisa
  funcionar com câmera do celular, rede fraca, interrupção; upload não pode depender só de
  drag-and-drop
```

### Guest Trust Model (aplicado explicitamente, per §31 do prompt-fonte)

| Pergunta do trust model | Resposta hoje |
|---|---|
| Quem está pedindo? | **Não exposto — `GTR-01` não resolvido** (`getRequestInfo()` não retorna identidade do tenant/organização) |
| O que está sendo solicitado? | `requirementName` — exposto |
| Por quê / em qual contexto? | Não exposto além do nome do requisito |
| Prazo? | `deadline` — exposto |
| Quais tipos de arquivo? | `allowedMediaTypes`/`maxUploadBytes` — exposto |
| O que acontece depois do envio? | **Corrigido nesta rodada**: nada — não existe rota pública para o submitter consultar o resultado do scan depois do `PUT`. Achado real, não apenas dependência do branch point de J-06 |
| O envio foi recebido? | Só parcialmente: o submitter sabe que o `PUT` ao S3 teve sucesso (observação do próprio browser), mas **o backend não confirma isso de volta a ele nem confirma o resultado do scan** — dois fatos distintos, nenhum dos dois totalmente "sim" |

### Fluxo

**Correção metodológica desta rodada (achado real do Codex)**: a versão anterior comprimia
"upload enviado" e "scan concluído" no mesmo passo, e a "Success Definition" prometia confirmação
que a rota pública não entrega. Corrigido para separar claramente o que o **submitter** sabe
(via a própria interação do browser) do que só o **backend/Internal Operator** sabe (via eventos
internos, sem rota pública que os exponha).

| Step | User action | System action | System knowledge (submitter) | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Abre o link | `GET /guest/document-requests/{token}` — valida token (rate limit anti-enumeração, comparação `timingSafeEqual`) | KNOWN (se válido) / FAILED (se qualquer forma de token ruim) | **GTR-01: quem está pedindo — hoje ausente** | Token inválido, expirado, revogado, ou rate-limited → **mensagem genérica idêntica em todos os casos, por desenho deliberado de segurança** (anti-enumeração — `guest-submission-service.ts:24-30,190-231`, `guest-handlers.ts:1-5` documentam explicitamente que distinguir esses casos permitiria a um atacante sondar quais tokens existem). **Correção real desta rodada**: a versão anterior deste documento pedia "mensagem clara e distinta para cada caso" — isso contradiria uma decisão de segurança já tomada no domínio. A journey correta é: uma única mensagem genérica ("link inválido ou expirado"), nunca diferenciada |
| 2 | Lê o que é pedido, prazo, tipos aceitos | — | KNOWN | Informação suficiente para decidir se tem o arquivo certo | requirementName pouco descritivo → confusão (risco já registrado no documento anterior) |
| 3 | Seleciona o arquivo (upload ou foto) | Validação de tipo/tamanho client-side | PENDING | Erro claro se tipo/tamanho inválido, antes de tentar enviar | — |
| 4 | Confirma envio | `POST .../uploads` — reserva a submissão, `DocumentSubmission` criada em `PENDING_UPLOAD`, `DocumentRequest → SUBMITTED`; retorna URL pré-assinada S3 | KNOWN (a reserva foi aceita) — **isto não é "documento enviado"**, é só "posso enviar agora" | Confirmação de que a reserva foi aceita, distinta da confirmação de envio do arquivo em si | Reserva falha (tipo/tamanho/checksum inválido) → erro antes de qualquer upload real |
| 5 | Envia o arquivo (`PUT` direto ao S3 com a URL) | — (chamada direta ao S3, fora do backend do produto) | KNOWN, mas só para o submitter, pela resposta HTTP do próprio `PUT` — **o backend do produto não confirma isso de volta de forma alguma nesta rota** | Confirmação de que o `PUT` teve sucesso (observável só client-side) | Rede fraca/interrompida (mobile) → **UNKNOWN** se parte chegou; recovery = nova tentativa (o `PUT` pode ser reenviado com segurança, é uma escrita idempotente de objeto S3) |
| 6 | (nenhuma ação do submitter) | Evento S3 dispara finalização + scan de malware, assíncrono | **UNKNOWN para o submitter — sem rota para consultar.** Para o backend/Internal Operator: `PENDING` → `CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT` | **Gap real, não resolvido aqui**: o submitter não tem como saber o resultado final. Fica sabendo só que enviou (Step 5) | Malware detectado, formato inválido, ou timeout → `REJECTED`/`UNSUPPORTED`/`TIMEOUT` do lado do backend; **o submitter nunca é informado**, nem por notificação nem por consulta |

**Achado registrado (não elevado a blocker nomeado, paralelo a `BLOCKER-A` do lado interno)**: o
lado externo da jornada também não tem visibilidade pós-envio — o mesmo tipo de lacuna de
"nenhuma rota de leitura depois da escrita", agora do lado do `External Submitter`. Vale
considerar junto de `BLOCKER-A` quando a correção de backend for priorizada, mas não é o mesmo
gap (rotas e atores diferentes).

**Critical Alternate Paths**: token já usado uma vez, mas reaberto (token não é de uso único —
`FACT`, o mecanismo permite reabrir a mesma info) — deve continuar funcionando até expiração/
revogação, sempre com a mesma mensagem genérica em caso de falha. **Failure Path**: link revogado
no meio do processo (Internal Operator revoga enquanto o submitter está com a página aberta) →
a próxima ação (upload) falha, com a mesma mensagem genérica do Step 1 (nunca "este link foi
revogado especificamente", por consistência com a regra anti-enumeração). **Abandonment**:
submitter fecha sem enviar — sem consequência para ele; do lado interno, o requisito continua
`MISSING`/solicitação `OPENED` sem alerta proativo. **Re-entry**: reabrir o mesmo link funciona
enquanto válido — não há "progresso salvo" de um upload incompleto, mas isso é aceitável dado que
a ação em si é curta (P5 não se aplica com a mesma força de um processo longo); o que NÃO é
aceitável, e fica registrado como gap, é a ausência de qualquer confirmação final pós-envio.

---

## 15. J-08 — Bulk Import

```
Journey ID: J-08
Actor: Internal Operator
User Outcome: trazer dados existentes para o sistema sem cadastrar manualmente um por um
Criticality: T1
UI Priority: P1
Frequency: occasional (onboarding, migração de planilha)
Implementation Readiness: READY (reserve/parse/commit funcionam); PARTIAL em erros por linha
  (plano existe só em S3, sem rota que exponha por linha — usuário só vê contagem agregada)
Planning Horizon: NOW
Trigger: usuário tem uma planilha com vários fornecedores/ativos
Entry Point(s): ação global
Preconditions: sessão autenticada; arquivo CSV ≤ 5 MiB
Starting Knowledge: usuário conhece o conteúdo da própria planilha, não o formato exato exigido
  até tentar
Success Definition: linhas válidas são commitadas; usuário encontra os registros resultantes
Failure Consequence: dados parcialmente importados sem o usuário perceber quais faltaram
Related Concepts: C9 (Importação), indiretamente C1/C3 (o que é criado)
Related Decisions: nenhuma decisão de alto risco — revisão de contagens antes de commit
Backend Dependencies: Full BFF
Trust Requirements: nenhum
Accessibility Considerations: erros de linha (quando existirem) precisam de texto claro, não só
  destaque visual na "linha X"
```

### Fluxo

| Step | User action | System action | System knowledge | Feedback required | Possible failure → Recovery |
|---|---|---|---|---|---|
| 1 | Inicia importação | `POST /imports` (com `Idempotency-Key`) → URL pré-assinada (15 min, ≤5 MiB) | PENDING (`UPLOADED` assumido, S3 não confirma síncrono) | TTL da URL visível | — |
| 2 | Envia o arquivo | Evento `ObjectCreated` dispara parse assíncrono | PENDING (`PARSING`) | Indicação de processamento em andamento — **recuperável, P5**: usuário pode sair e voltar | CSV malformado → `FAILED`, mensagem clara |
| 3 | (pode sair e voltar) Consulta resultado | `GET /imports/{jobId}` (polling) | `PREVIEW_READY` com contadores agregados (total/aceitas/rejeitadas/duplicadas) | Contagens claras — **hoje sem detalhe por linha** (PARTIAL, gap registrado) | Linhas rejeitadas sem explicação acessível → usuário não sabe corrigir sem inspecionar o CSV original por fora |
| 4 | Decide commitar | `POST /imports/{jobId}/commit` (com `If-Match`) | PENDING → `COMMITTING` → `COMMITTED` | Confirmação de quantos registros foram efetivamente criados | Conflito de versão (`If-Match`) → erro conhecido, recarregar estado |
| 5 | Encontra os registros resultantes | Navega para Vencimentos/Fornecedores | KNOWN | Os novos registros aparecem nas listas já existentes — **não é necessário nenhum "histórico de imports" como destino de navegação** (Importação é ferramenta, não área, decisão preservada) | — |

**Critical Alternate Paths**: reenvio de um CSV corrigido após erros — dedupe por `externalId`/nome
evita duplicar linhas já commitadas com sucesso (idempotência real do backend). **Failure Path**:
`FAILED`/`EXPIRED` do job → usuário precisa recomeçar do zero (sem retomar um job morto).
**Recovery**: sempre por novo `ImportJob`, nunca editar linhas individualmente dentro do sistema
(não existe essa capacidade). **Re-entry**: coberto pelo Step 3 (P5 aplicado corretamente aqui,
diferente de J-02).

---

## 16. Additional Journey — nenhuma justificada

Nenhuma journey além das 8 foi adicionada. Candidatas descartadas explicitamente, com motivo
(critério §7/§8 do prompt-fonte — outcome real vs. feature isolada):

- **"Journey de configurações"** — rejeitada: preferências de notificação/entrega são operações
  de apoio de baixa frequência (T2/T3), sem outcome próprio que não seja variação de "ajustar como
  recebo informação" — não atravessam múltiplos conceitos como uma journey exige.
- **"Journey de observar item"** — rejeitada: `TASK-011` é `FUTURE`, sem workflow real hoje
  (single-owner) — não há journey a mapear até `Membership` existir.
- **"Journey de auditoria/histórico"** — rejeitada por ora: `AuditEvent` existe no backend mas sem
  rota HTTP — não há journey possível até essa capacidade existir; registrado como Open Question
  herdada, não nova.

---

## 17. Cross-Journey Transitions

| From | Trigger | To | Context that must survive |
|---|---|---|---|
| J-01 | usuário decide agir sobre um item específico | J-03 ou J-04 | ID do vencimento + estado de atenção de origem (ex. "veio da lista de vencidos") |
| J-05 | usuário abre a notificação (quando `BLOCKER-B` resolvido) | J-03 ou J-04 | ID do vencimento que motivou o aviso |
| J-03 | renovação concluída | J-04 (associar documento ao ciclo novo) ou de volta a J-01 | ID do novo item |
| J-06 | documento recebido resolvido (qualquer branch) | pode alimentar J-03 (se o documento implica um novo ciclo de vencimento) | qual Requisito/Fornecedor originou o documento |
| J-07 | `PUT` ao S3 concluído; scan desconhecido para o submitter | (não retorna ao app principal — o submitter sai da journey aqui, P6) | — |
| J-08 | commit concluído | J-01 (revisão dos novos registros) | contagem de registros criados |

---

## 18. Entry Points

Consolidado (já mapeado por journey acima, sem decidir navegação visual):

| Journey | Entry point(s) |
|---|---|
| J-01 | Overview (principal); Vencimentos |
| J-02 | Global action, sem contexto prévio |
| J-03 | Detalhe do Vencimento; e-mail de alerta (futuro, `BLOCKER-B`) |
| J-04 | Detalhe do Vencimento |
| J-05 | Detalhe do Vencimento (configurar); e-mail do alerta (futuro) |
| J-06 | Detalhe do Fornecedor/Requisito |
| J-07 | Magic link (externo ao app) |
| J-08 | Global action |

---

## 19. Exit / Abandonment / Re-entry

| Journey | Successful completion | Cancel/Abandon | Defer | Blocked | Requires external action |
|---|---|---|---|---|---|
| J-01 | usuário identifica e age ou confirma que nada exige ação | sai sem agir (sem consequência) | — | — | — |
| J-02 | item criado | sai sem confirmar (nada persistido) | — | — | — |
| J-03 | novo ciclo ativo, origem rastreável | sai antes de confirmar | — | — | — |
| J-04 | documento verificado E consultável | — | pode sair durante scan (P5) e voltar | **estruturalmente, no Step 5** | — |
| J-05 | aviso recebido e ação tomada | política configurada mas nunca revisitada | — | **estruturalmente, do Step 2 em diante** | — |
| J-06 | requisito `SATISFIED` com documento correto | solicitação nunca respondida (expira) | aguardando resposta do fornecedor (é o estado normal, não abandono) | **estruturalmente, no branch point** | sim — depende do External Submitter (J-07) |
| J-07 | envio ao S3 confirmado (resultado do scan permanece desconhecido ao submitter — corrigido, ver §14) | fecha sem enviar | — | — | — |
| J-08 | registros commitados | job abandonado após preview (nunca commitado) | pode sair durante parsing (P5) e voltar | — | — |

---

## 20. Shared Failure Taxonomy

```
Validation           — dado informado pelo usuário não passa em regra conhecida (client ou server)
Conflict              — OCC: o registro mudou desde que foi lido (edit/renew/archive/delete)
Permission            — ação negada pela matriz de autorização
Authentication        — sessão ausente/expirada (depende de Full BFF)
Network               — falha de transporte, resultado no servidor desconhecido (UNKNOWN)
Processing            — falha assíncrona de um worker (scan, parse, materialização)
Security rejection    — malware/formato inválido (Document.REJECTED/UNSUPPORTED)
External dependency   — falha de um provedor externo (SES, S3) sem exposição ao usuário hoje
Domain state changed  — precondição não é mais válida (ex. item não está mais ACTIVE)
```

---

## 21. Shared Recovery Principles

| Failure | Can retry? | Can correct? | Must restart? | Can return later? | Input preserved? | System knows outcome? |
|---|---|---|---|---|---|---|
| Validation | Sim | Sim | Não | N/A | Sim (P3) | Sim |
| Conflict (OCC) | Sim, após reconsulta | Sim | Não (mas precisa reler estado) | N/A | Depende do formulário | Sim |
| Permission | Não | N/A | N/A | N/A | N/A | Sim |
| Authentication | Sim, após reautenticar | N/A | Não, se P5 for respeitado | Sim | Depende — ver §22 | Sim |
| Network (pós-envio) | Só após reconsulta | N/A | Não | Sim | N/A | **Não — UNKNOWN até reconsulta** |
| Processing (assíncrono) | N/A (é o próprio processo) | N/A | Não | Sim (P5) | N/A | Sim, eventualmente |
| Security rejection | Sim, com arquivo novo | N/A | Sim (novo upload) | Sim | N/A | Sim |
| External dependency | Depende do gap específico | N/A | N/A | Sim | N/A | Hoje, não (gap registrado em várias journeys) |
| Domain state changed | Não da mesma forma — precisa nova ação | Sim, com dado atual | Sim | N/A | N/A | Sim |

---

## 22. Authentication / Session Interruptions

Aplicável a toda journey autenticada (todas exceto J-07). Full BFF (D-053/D-054) não implementado
— registrado uniformemente como pré-requisito, não redesenhado aqui.

```
Sessão ausente/expirada no meio de uma journey curta (J-02, J-03, J-07 N/A):
  → reautenticar, dado não persistido ainda → perda aceitável (journey curta, sem draft)

Sessão expira durante processo longo (J-04 aguardando scan, J-08 aguardando parse):
  → P5 já cobre isso: o estado do processo (Document/ImportJob) é persistido no backend,
    independente da sessão do browser — reautenticar e reconsultar recupera o progresso sem
    perda, DESDE QUE BLOCKER-A seja resolvido para J-04 (hoje, mesmo reautenticado, o usuário
    não teria como ver o resultado)

Refresh de sessão falha (Full BFF, D-054 — rotação nativa do Cognito):
  → produto correto: usuário nunca percebe (refresh transparente); se falhar de fato,
    401 claro → tela de login, sem perda de trabalho não confirmado
```

---

## 23. Async Processing Model

Processos assíncronos identificados: upload+scan (J-04), materialização+entrega de alerta (J-05),
guest submission+scan (J-07), import parse+commit (J-08). Todos exigem, per P5, status persistente
e recuperável. **Achado explícito**: J-04 e J-05 falham nesse critério hoje — não por design de
UI, mas porque o backend não expõe (`BLOCKER-A`) ou não produz (`BLOCKER-B`) o estado a ser
consultado. J-08 cumpre o critério (`GET /imports/{jobId}` sempre disponível). J-07 cumpre
parcialmente (o submitter não tem como reconsultar depois de fechar a aba — token não é
"sessão", é um documento por chamada).

---

## 24. Trust Requirements

| Journey | Trust requirement |
|---|---|
| J-03 (Renovar) | usuário entende que renovar cria registro novo, não edita (risco de terminologia) |
| J-04 (Documento) | "arquivo verificado" ≠ "documento correto" (Epistemic Integrity) |
| J-06 (Coleta externa) | "documento recebido" ≠ "documento oficial"; "SATISFIED" ≠ "em dia agora" |
| J-07 (Guest) | **GTR-01 — formal, não resolvido**: submitter precisa saber quem está pedindo antes de enviar |
| J-08 (Import) | usuário confia que "commitado" significa realmente criado — `COMMITTED` é o único estado que sustenta isso |

---

## 25. Accessibility Requirements

Derivados por journey, sem decidir componente:

- Nenhuma informação de status transmitida só por cor (todas as journeys — Vencido/Vencendo,
  CLEAN/REJECTED, SATISFIED/MISSING precisam de texto/ícone redundante).
- Processamento assíncrono (J-04, J-05, J-07, J-08) precisa de anúncio acessível de mudança de
  estado, não só atualização visual silenciosa.
- Timeout existe em J-04 (presigned URL, scan) e J-08 (presigned URL) — usuário precisa ser
  avisado antes de expirar, não só depois.
- Ações irreversíveis (excluir, revogar, renovar) precisam de correção clara e confirmação
  deliberada, navegável por teclado.
- J-07 (guest, forte hipótese de mobile) precisa de alternativa a drag-and-drop (seleção de
  arquivo/câmera padrão do dispositivo).
- Nenhuma journey exige uma forma de interação que exclua usuário sem alternativa (`CJ-G10`) —
  verificado, nenhuma dependência de gesto/mouse-only identificada nas jornadas mapeadas.

---

## 26. High-Consequence Actions

| Ação | Journey | Nota |
|---|---|---|
| Excluir vencimento | J-01 (exit path) | requer confirmação deliberada — error prevention |
| Arquivar vencimento | J-01/J-03 (exit path) | consequência menor que excluir, mas ainda deliberada |
| Renovar | J-03 | consequência alta por criar novo registro + mudar estado do antigo |
| Revogar solicitação | J-06 | fornecedor perde acesso ao link imediatamente — irreversível |
| Confirmar campo extraído (M7, futuro) | fora de escopo (não implementado) | registrado para quando existir |

Não decidido aqui: modal de confirmação, dialog, etc. — só a obrigação de "requires deliberate
confirmation / error prevention".

---

## 27. Journey → Outcome Mapping

| Journey | Outcome(s) | Criticality |
|---|---|---|
| J-01 | OUTCOME-001 | T0 |
| J-02 | (não nomeado no Context/Task Model — ver §1/§39) | T0 (inferência) |
| J-03 | OUTCOME-004 | T0 |
| J-04 | OUTCOME-002 | T0 |
| J-05 | OUTCOME-003 | T0 |
| J-06 | OUTCOME-006 | T0 |
| J-07 | OUTCOME-005 | T0 (submitter) |
| J-08 | TASK-008 | T1 |

Todo outcome T0 do Context/Task Model tem journey correspondente — nenhum órfão.

## 28. Journey → Concept Mapping

| Journey | Concepts touched |
|---|---|
| J-01 | C1, C7 (se existir), C5 (se existir) |
| J-02 | C1 (+ opcionalmente C2, C3, C4, C7) |
| J-03 | C1, C2 |
| J-04 | C1, C2 |
| J-05 | C1, C7 |
| J-06 | C3, C4, C5, C6 |
| J-07 | C5, C6 |
| J-08 | C9 (+ cria C1/C3) |

## 29. Journey → Decision Mapping

| Journey | User decisions |
|---|---|
| J-01 | O que exige minha atenção agora? |
| J-03 | Devo renovar isso? Esta é a nova data correta? |
| J-04 | Esse documento está correto? |
| J-06 | Preciso reenviar uma solicitação? Esse fornecedor está regular? (com ressalva) |
| J-07 | (do submitter) Devo confiar nisso? Meu arquivo está certo? |

## 30. Journey → Information Mapping

| Journey | O que o usuário precisa saber antes de agir |
|---|---|
| J-01 | status + dueDate de cada item |
| J-02 | nada além do próprio conteúdo que quer cadastrar |
| J-03 | data atual, versão OCC, (idealmente) documento atual — bloqueado |
| J-04 | tipos/tamanho aceitos; estado atual do documento (bloqueado depois do upload) |
| J-05 | nada até o aviso chegar; depois, o motivo do aviso |
| J-06 | quais requisitos estão pendentes; status da solicitação enviada |
| J-07 | quem pede (GTR-01, ausente), o quê, prazo, tipos aceitos; resultado final do envio (ausente — ver §14) |
| J-08 | formato exigido do CSV; contagens de resultado |

---

## 31. Backend Dependency Matrix

| Journey | BFF | BLOCKER-A | BLOCKER-B | BLOCKER-C | GTR-01 | Other |
|---|---|---|---|---|---|---|
| J-01 | DIRECT | NO | INDIRECT (se Overview informar alertas) | NO | NO | — |
| J-02 | DIRECT | NO | NO | NO | NO | — |
| J-03 | DIRECT | INDIRECT | NO | NO | NO | — |
| J-04 | DIRECT | **DIRECT** | NO | NO | NO | — |
| J-05 | DIRECT | NO | **DIRECT** | NO | NO | — |
| J-06 | DIRECT | NO | NO | **DIRECT** | NO | query tenant-wide de solicitações (indireto, enfraquece visibilidade) |
| J-07 | NO (rota pública) | NO | NO | INDIRECT (o submitter não sabe se o requisito foi atendido) | **DIRECT** | — |
| J-08 | DIRECT | NO | NO | NO | NO | — |

---

## 32. Readiness Matrix

Já apresentada por journey em §4/§7 — consolidada: 3 `BLOCKED` (J-04/A, J-05/B, J-06/C), 1
`PARTIAL` técnico + `PARTIAL` trust (J-07), 2 `PARTIAL` (J-01, J-03), 2 `READY` (J-02, J-08).
Nenhuma journey `FUTURE` — todos os 8 outcomes pertencem ao horizonte NOW.

## 33. BLOCKER-A Impact

Direto: **J-04** (o outcome inteiro depende disso). Indireto: **J-03** (continuidade documental
entre ciclos de renovação). Não afeta J-01/J-02/J-05/J-06/J-07/J-08 diretamente.

## 34. BLOCKER-B Impact

Direto: **J-05** (o outcome inteiro depende disso). Indireto: **J-01**, se a Overview pretender
informar resultado/estado de alertas configurados (ex. "3 alertas programados para esta semana")
— essa informação também dependeria da materialização funcionar. Não afeta as demais diretamente.

## 35. BLOCKER-C Impact

Direto: **J-06** (o outcome inteiro para no branch point). Indireto: **J-07** — o submitter
completa a ação dele, mas o resultado do lado interno fica incerto, o que indiretamente
enfraquece a confiança de longo prazo no mecanismo (não bloqueia a ação do submitter em si).

## 36. GTR-01 Impact

Direto: **J-07** (UX trust readiness `NOT READY` enquanto não resolvido). Não bloqueia o fluxo
técnico (upload continua funcionando), mas é **required before production guest UX**, per a
classificação já registrada no documento anterior.

---

## 37. External Collection Branch Comparison

Reaproveitado do decision brief da etapa anterior (`STRONG INFERENCE`, não decisão), agora
expresso em termos de journey — nenhuma escolha feita aqui.

### Alternativa A — Fechamento automático

```
Passos: Documento recebido (CLEAN) → validação/vínculo automático → Requisito SATISFIED
Informação necessária: alguma fonte confiável de dados estruturados do documento (data de
  validade, tipo) — hoje inexistente (verificado: DocumentSubmission só guarda metadados de
  arquivo)
Confiança: nenhum checkpoint humano antes de marcar compliance como satisfeita
Riscos: documento errado/vencido/de outro fornecedor aceito silenciosamente
Feedback: nenhuma ação do Internal Operator — a journey J-06 terminaria automaticamente,
  sem um passo de confirmação visível
```

### Alternativa B — Revisão humana explícita

```
Passos: Documento recebido (CLEAN) → fila "aguardando confirmação" → Internal Operator revisa
  → vincula a vencimento existente OU cria vencimento novo → Requisito SATISFIED
Informação necessária: rota de leitura da fila de submissões pendentes (não existe hoje, mas é
  bem menor que a Alternativa A — reaproveita link/unlink já implementado)
Confiança: nenhuma decisão de compliance sem confirmação humana — consistente com o resto do
  domínio (nenhuma outra parte do sistema aprova conteúdo automaticamente)
Custo operacional: um passo manual a mais, ainda menor que a cobrança por e-mail que o produto já
  substitui
Recovery: se o Internal Operator rejeitar, o requisito permanece MISSING e uma nova solicitação
  pode ser criada — caminho já existente
```

`STRONG INFERENCE` preservada: Alternativa B parece mais barata de implementar e mais consistente
com o padrão do domínio. Decisão fica com o Marcelo.

---

## 38. Assumptions

- "Criar vencimento" é T0 por ser pré-requisito estrutural de todo o resto, mesmo sem classificação
  explícita no Context/Task Model (`STRONG INFERENCE`, §1).
- Deep-link de notificação para o contexto do vencimento é desejável (`STRONG INFERENCE`, não
  decidido como mecanismo).
- Perder dados de formulários curtos e não confirmados (J-02, J-03) é aceitável — não exige draft
  persistence (`HYPOTHESIS`).

## 39. Open Questions

1. **Nova**: "Criar vencimento" nunca recebeu uma linha T0/T1 explícita no Context/Task Model —
   vale uma confirmação retroativa nessa classificação (não muda nada nesta etapa, é observação).
2. Herdadas do documento anterior, ainda válidas: semântica de "documento vigente" (§9 do
   documento anterior); working label de Subject/Fornecedor; necessidade de reenvio de
   Solicitação; branch point de J-06 (Alternativa A vs. B); query tenant-wide de solicitações.
3. **Nova**: quando um item vinculado a um requisito `SATISFIED` é renovado, o requisito não é
   re-vinculado automaticamente ao item novo (achado do amendment anterior) — afeta diretamente a
   transição J-03→J-06 mapeada em §17; não resolvido aqui.
4. **Nova (achado real desta rodada, verificado em código)**: `POST /items` (J-02) não tem
   proteção de idempotência — vale considerar adicionar (mesmo padrão de `Idempotency-Key` já
   usado em `renewItem()`/imports) antes de qualquer UI que possa reenviar automaticamente após
   timeout.
5. **Nova (achado real desta rodada, verificado em código)**: o `External Submitter` (J-07) não
   tem nenhuma rota pública para consultar o resultado do scan de segurança depois do envio — o
   mesmo tipo de lacuna de `BLOCKER-A` (sem leitura pós-escrita), agora do lado externo. Não
   elevado a um 4º blocker nomeado nesta etapa, mas registrado para quando a correção de
   `BLOCKER-A`/backend for priorizada.

## 40. Rejected Journey Assumptions

- **"Deep-link de notificação decide a URL exata"** — rejeitado: é decisão de implementação, não
  de journey; só o requisito conceitual (contexto preservado) foi registrado.
- **"Todo processo assíncrono precisa de draft/rascunho persistente"** — rejeitado como regra
  geral: aplicado seletivamente (J-04/J-08 precisam, J-02/J-03 não, por serem curtos e sem
  processamento assíncrono real).
- **"J-06 e J-07 deveriam ser uma journey só"** — rejeitado: são dois atores com outcomes e
  contextos de conhecimento completamente diferentes (Internal Operator nunca vê o que o
  External Submitter vê, e vice-versa) — mantidas separadas, conectadas só pelo branch point.

---

## 41. Codex Review

Revisão adversarial independente (Codex, sandbox read-only, código real verificado), respondendo
aos 24 pontos de crítica. Veredito: **4 furos reais** — 3 factuais, 1 metodológico — nenhum de
arquitetura/escopo das 8 journeys.

1. **J-02 sem outcome aprovado nomeado** (metodológico): confirmado — `Criar vencimento` só
   aparece no inventário de tarefas do Context/Task Model, nunca como outcome T0 classificado.
   **Aceito** — Executive Summary e §3 corrigidos para não afirmar "todas ancoradas em outcomes
   aprovados".
2. Pontos 2-4, 6-11, 13-14, 17-24: **sem furo** — verificados e confirmados corretos (Epistemic
   Integrity respeitada para `CLEAN`/`SATISFIED`/`ReminderPolicy`; nenhuma journey baseada em
   endpoint; failure/recovery mapeados; GTR-01 central; nenhuma decisão de componente vazada;
   nenhuma sobreposição/fragmentação/amplitude indevida; nenhum conflito com a IA aprovada; nenhum
   product creep adicional).
5. **J-07 comprime "envio" com "verificação/confirmação"** (factual): confirmado — a rota pública
   não tem consulta de status pós-envio (`api-gateway/main.tf:279-283`). **Aceito** — fluxo
   reescrito separando o que o submitter sabe do que só o backend sabe.
9. **`SUBMITTED` tratado como ciclo completo em J-07** (factual, mesmo núcleo do item 5):
   **Aceito** — corrigido junto.
12. **`POST /items` tratado como idempotente sem sê-lo** (factual): confirmado —
    `createItem()` não lê `Idempotency-Key`, sempre gera `itemId` novo, diferente de
    `renewItem()`/imports. **Aceito** — corrigido, com aviso explícito de risco de duplicação em
    retry.
15. **Mensagens de erro distintas por tipo de falha de token guest contradizem anti-enumeração
    deliberada** (factual/segurança): confirmado contra `guest-submission-service.ts`/
    `guest-handlers.ts`. **Aceito** — corrigido para mensagem genérica uniforme.
16. **J-07 classificada `READY` técnico quando sua própria Success Definition exigia algo que a
    rota pública não entrega**: **Aceito** — Readiness rebaixada para `PARTIAL` em toda tabela.

Rodada de reconciliação (C) confirmou as 6 correções, com 2 resíduos textuais pequenos (§3 ainda
generalizava "outcome já aprovado" sem a exceção de J-02; resumo de J-07 em §19 ainda dizia
"submissão enviada" de forma ambígua) — ambos corrigidos antes de fechar (Rodada D).

## 42. Reconciliation

Todos os 4 furos reais (1 metodológico, 3 factuais) foram aceitos e corrigidos, mais os 2 ajustes
editoriais da Rodada D. Nenhuma divergência remanescente. As 8 journeys, os 3 blockers nomeados,
`GTR-01`, e toda a arquitetura de informação/modelo conceitual herdados permanecem intactos — o
amendment desta etapa foi inteiramente sobre precisão factual e disciplina de Epistemic Integrity
dentro das próprias journeys, não sobre reabrir decisões estruturais anteriores.

---

## 43. Quality Evaluation

| Eixo | Aplicável? | Avaliação |
|---|---|---|
| TaskSuitability | Sim | Todo outcome T0 tem journey; nenhum outcome órfão (§27) |
| InformationArchitecture | Sim | Entry points consistentes com a IA já aprovada (§18), nenhuma nova área inventada |
| SystemFeedback | Sim | Feedback obrigatório definido por passo (System knowledge + Feedback required em toda tabela) |
| ErrorRobustness | Sim | Failure/Recovery mapeados por journey e taxonomia compartilhada (§20/§21) |
| Accessibility | Parcial | Requisitos derivados (§25); avaliação de componente real é próxima fase |
| Consistency | Sim | Taxonomia de System Knowledge e Epistemic Integrity aplicadas uniformemente |
| Content | Sim | Vocabulário herdado sem contradição (CLEAN/SATISFIED corrigidos, não reabertos) |
| Trust | Sim | GTR-01 tratado como requisito central de J-07, não nota de rodapé |
| InformationPresentation | N/A | layout, próxima fase |
| Forms | N/A | nível de componente |
| DataOperations | N/A | nível de componente |
| Responsiveness | N/A | layout, próxima fase |

## 44. Final Status

**`APPROVED AS INPUT FOR SCREEN + STATE INVENTORY`**

Motivo: revisão adversarial independente (4 rodadas A/B/C/D) encontrou 4 furos reais — 1
metodológico (J-02 sem outcome nomeado, mantida por exigência explícita da etapa, marcada como
tal) e 3 factuais (idempotência inexistente em `POST /items`; compressão de estado assíncrono em
J-07; mensagens de erro de token que violariam anti-enumeração deliberada) — todos corrigidos e
verificados, mais 2 ajustes editoriais residuais. Nenhum dos 10 Journey Gates (`CJ-G1` a
`CJ-G10`) foi violado: todo outcome tem journey com entry point claro (`CJ-G1`), nenhuma decisão
do usuário fica sem informação necessária (`CJ-G2`), nenhum estado promete mais certeza do que o
domínio sustenta depois das correções (`CJ-G3`), toda falha previsível tem recovery mapeado
(`CJ-G4`/`CJ-G5`), nenhuma conclusão é ambígua depois da correção de J-07 (`CJ-G6`), processos
assíncronos têm re-entry mapeado ou o gap está registrado explicitamente, não escondido
(`CJ-G7`/`CJ-G8`), J-07/GTR-01 trata a confiança externa como requisito central (`CJ-G9`), e
nenhuma journey exige interação sem alternativa acessível (`CJ-G10`). Os 3 blockers técnicos
(`BLOCKER-A/B/C`), `GTR-01`, e a arquitetura de informação/modelo conceitual das duas etapas
anteriores permanecem intactos, não reabertos. Pronto para a próxima etapa (Screen + State
Inventory), carregando os blockers, `GTR-01`, e as 5 Open Questions (§39) como constraints de
entrada.

---

*Documento produzido a partir da leitura integral das duas etapas anteriores já aprovadas, sem
refazer a auditoria de código original — verificações pontuais (TTLs, limites de tamanho, janela
de reconciliação) confirmadas diretamente no código antes de usar em journeys específicas.*
