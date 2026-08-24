---
status: APPROVED AS INPUT FOR CRITICAL USER JOURNEYS (estrutural: 4 rodadas A/B/C/D, §41-42; amendment semântico: rodada curta, §44.2-44.4)
owner: Marcelo
authority: insumo para Critical User Journeys (próxima etapa) — não normativo de arquitetura de sistema
---

# Expiration Tracker — Conceptual Model + Information Architecture

Segunda etapa formal do planejamento de interface. Entrada: `docs/frontend/interface-context-and-critical-tasks.md`
(status `APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE`) — lido integralmente,
não refeito. Não contém wireframes, sidebar final, paleta ou stack de frontend. `docs/frontend/interface-quality-standard.md`
não existe ainda como arquivo formal — os 12 eixos citados no prompt-fonte (`TaskSuitability`,
`InformationArchitecture`, `InformationPresentation`, `SystemFeedback`, `ErrorRobustness`, `Forms`,
`DataOperations`, `Accessibility`, `Consistency`, `Content`, `Responsiveness`, `Trust`) são usados
diretamente como critério de avaliação (§43) — registrado como item a formalizar, não bloqueante.

Disciplina de evidência mantida: `FACT` · `STRONG INFERENCE` · `HYPOTHESIS` · `OPEN QUESTION`, com
`SOURCE: code | schema | ADR | roadmap | context-task-model | UX inference | business inference`.

---

## 1. Executive Summary

- O produto tem **dois anchors mentais igualmente T0**, não um só: **Vencimentos** (o objeto
  atômico, sempre existe, é a base do produto desde antes de M9) e **Fornecedores/Requisitos**
  (a camada de compliance por terceiro, opcional, adicionada em M9-M10, validada por mercado como
  padrão dominante — `02-market-research.md`). Isso é uma conclusão derivada das tarefas (§17), não
  presumida: `OUTCOME-001` (identificar vencidos) e `OUTCOME-006` (obter documentação de
  terceiros) são ambos T0/P0 no Context/Task Model, e não têm relação hierárquica 1:1 no backend —
  `ExpirationItem` não tem `subjectId`, o vínculo é opcional e indireto via `RequirementAssignment.linkedItemId`.
  Isso afeta diretamente a recomendação de navegação (§33).
- **`Document`/`DocumentSubmission` não têm relação de versão/substituição no backend** — N
  documentos podem coexistir sob um item sem nenhum vínculo entre eles, e a leitura está
  bloqueada (`BLOCKER-A`). O modelo conceitual não inventa uma semântica de "documento atual" que
  o backend não sustenta — documenta o que existe e o que precisaria ser decidido (§9).
- **Três blockers técnicos permanecem, citados por ID, não mascarados**: `BLOCKER-A` (leitura de
  documento), `BLOCKER-B` (materialização de reminders), `BLOCKER-C` (fechamento do ciclo de
  coleta externa). Nenhum foi resolvido nesta etapa (fora de escopo por design). Um quarto achado
  menor, não elevado ao mesmo status: a listagem de solicitações pendentes é hoje só por
  assignment ou uma por vez — não existe consulta "todas as pendentes do tenant" (afeta §18/§35).
- **Full BFF (D-053/D-054) é pré-requisito de qualquer frontend real** — sem sessão de browser
  utilizável, nenhuma rota autenticada pode ser chamada com segurança pelo SPA. Não é um blocker
  de IA, é um blocker de implementação (registrado em §36, não redecidido aqui).
- **Recomendação de navegação**: `Overview`, `Vencimentos`, `Fornecedores`, `Solicitações`
  (marcado `BLOCKED` — precisa de uma query nova no backend) e `Configurações` como áreas de
  primeiro nível — ver §33 para a comparação completa com as alternativas descartadas.

---

## 2. Inputs and Scope

- **Entrada única e primária**: `docs/frontend/interface-context-and-critical-tasks.md` (papéis,
  JTBD, inventário de tarefas, criticidade/readiness/horizon, Decision Inventory, mapeamento
  técnico→usuário, terminologia de risco).
- **Entradas de arquitetura**: D-053/D-054 (Full BFF), `docs/architecture/roadmap-evolution/02-market-research.md`
  (padrões de mercado já pesquisados neste projeto — reaproveitados, não repesquisados).
- **Fora de escopo**: wireframes, sidebar/menu final (esquerda/direita, ícones), design visual,
  stack de frontend, implementação de qualquer código, resolução dos 3 blockers técnicos, decisão
  final sobre coleta externa automática vs. revisão humana (só o decision brief, §37).

---

## 3. Constraints Inherited from Context/Task Model

Herdados sem reabertura (o Context/Task Model já passou por 2 rodadas de reconciliação Claude↔Codex):

1. Single-owner de fato hoje (`tenantId=userId`); `Internal Operator` é o papel conceitual, `OWNER`
   é a role RBAC atual (não confundir os dois nesta etapa também).
2. `External Submitter` é um papel conceitual reutilizável — cenário atual é fornecedor, mecanismo
   não é fornecedor-específico.
3. `BLOCKER-A/B/C` continuam `Implementation Readiness: BLOCKED` e não são resolvidos aqui.
4. Escala real esperada é modesta (~8 itens/usuário, skew até ~800 no pior caso) — não determina
   sozinha nenhuma decisão de IA.
5. Nenhum workflow de aprovação humana de conteúdo de documento existe hoje — só decisão
   automática de segurança + vínculo manual de item↔requirement.
6. `MEMBER`/`VIEWER` não têm nenhum caminho de atribuição real hoje — a IA não deve superdimensionar
   RBAC futuro, mas também não deve travar a evolução (§28).

---

## 4. User Conceptual Model

O usuário (`Internal Operator`) não pensa em módulos de backend. Ele pensa em: coisas que vencem,
provas de que estão em dia, pessoas/empresas que precisam mandar essas provas, e avisos para não
esquecer. O modelo conceitual central:

```
Vencimento (o que precisa de atenção)
  ├── tem Documento(s) associado(s)          [PRIMARY, mas leitura bloqueada — BLOCKER-A]
  ├── tem Alerta configurado                  [PRIMARY, mas disparo bloqueado — BLOCKER-B]
  └── pode estar ligado a um Requisito         [opcional, não obrigatório]
                                                  de um Fornecedor

Fornecedor (de quem eu preciso de documentação)
  └── tem Requisito(s)
        ├── pode já estar Atendido (ligado a um Vencimento existente)
        └── pode estar Pendente
              └── eu posso enviar uma Solicitação
                    └── o Fornecedor externo envia um Documento recebido
                          [ciclo não fecha sozinho — BLOCKER-C]
```

**Achado central (`STRONG INFERENCE`, derivado das tarefas, não presumido)**: essas duas árvores
não são uma hierarquia única. `Vencimento` existe e é útil mesmo sem nenhum `Fornecedor`/`Requisito`
— é o caso mais simples e provavelmente o mais comum hoje (M9/Subject só existe desde uma
milestone recente; a suposição de capacidade do próprio projeto, 8 itens/usuário, antecede
Subject). `Fornecedor`/`Requisito` é uma camada de compliance opcional por cima, não um contêiner
obrigatório de todo vencimento. Tratar uma como sub-item da outra desalinharia o modelo mental de
quem usa só vencimentos simples.

---

## 5. Concept Inventory

| Concept ID | Nome candidato (usuário) | Definição | Por que o usuário precisa | Tarefas relacionadas | Decisões relacionadas | Technical backing | Relação com outros | Prioridade de informação | Readiness | Riscos de terminologia |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Vencimento | Algo com data de validade que precisa de ação antes de expirar | É o objeto central do produto | OUTCOME-001,002,003,004 | "O que exige minha atenção?", "Devo renovar?" | `ExpirationItem` | tem Documento, tem Alerta, opcionalmente ligado a Requisito | Primary | PARTIAL (dashboard sem paginação real) | `renovar`≠`editar` |
| C2 | Documento | Prova documental de que um vencimento está em dia | Sem isso o produto não cumpre a promessa central | OUTCOME-002,004 | "Esse documento está correto?" | `Document` (+ `DocumentSubmission` quando vindo de fornecedor) | pertence a um Vencimento (0..N, sem versão) | Primary (deveria ser) | **BLOCKED — BLOCKER-A** | `item`×`documento` (1:N sem hierarquia clara) |
| C3 | **Conceptual Area: Subject Area** — **Current working label: Fornecedores** (correção do amendment — ver nota abaixo da tabela) | Terceiro de quem preciso de documentação recorrente | Âncora da coleta externa | OUTCOME-006 | "Esse fornecedor está regular?" *(ver §13.2 — ressalva de honestidade sobre "regular")* | `TrackedSubject` | tem Requisito(s) | Primary (quando usado) | READY | nome final não deve ser cristalizado ainda — ver nota |
| C4 | Requisito | Tipo de documento que um Fornecedor precisa manter válido | Define o que cobrar de cada terceiro | OUTCOME-006, TASK-007 | "Esse fornecedor está regular?" *(ver §13.2 — ressalva de honestidade sobre "regular", mesma nota de C3)* | `RequirementAssignment` | de um Fornecedor; opcionalmente ligado a um Vencimento | Secondary | READY (só MISSING↔SATISFIED, snapshot não recalculado) | `requirement`≠`document request` |
| C5 | Solicitação | Convite enviado a um Fornecedor pedindo um documento | Reduz cobrança manual por e-mail | OUTCOME-006 | "Preciso reenviar?" | `DocumentRequest` | de um Requisito | Secondary | READY como operação; **view global BLOCKED** (sem query cross-subject) | confundível com Requisito |
| C6 | Documento recebido | Arquivo que um Fornecedor enviou, ainda não confirmado como o documento oficial | Ponte entre a coleta externa e o Documento oficial | OUTCOME-006 | "Esse documento pertence a qual vencimento?" | `DocumentSubmission` | de uma Solicitação; deveria virar C2 quando confirmado | Contextual | **BLOCKED — BLOCKER-C** (sem rota de leitura nem fechamento automático) | risco de o usuário nunca saber que existe (sem notificação) |
| C7 | Alerta | Configuração de quando quero ser avisado antes de um vencimento | É a promessa central de "nunca esquecer" | OUTCOME-003 | "O que exige minha atenção?" | `ReminderPolicy`/`ReminderOccurrence` | de um Vencimento | Primary (conceitualmente) | **BLOCKED — BLOCKER-B** | usuário não pensa em "política" |
| C8 | Responsável | Pessoa (texto livre hoje) ligada a um vencimento | Quem deve agir | OUTCOME-001 | "Quem deve agir?" | `assigneeUserId` (string livre) | de um Vencimento | Secondary | PARTIAL (sem validação contra usuário real) | conceito fraco até Membership existir |
| C9 | Importação | Ferramenta para cadastrar vários Vencimentos/Fornecedores de uma vez a partir de planilha | Reduz cadastro manual repetitivo | TASK-008 | — | `ImportJob` | cria Vencimentos/Fornecedores | Secondary, mas transiente (não um objeto que o usuário revisita depois) | READY (parcial em erros por linha) | não é um "objeto" persistente no modelo mental |
| C10 | Observador | Pessoa que acompanha um vencimento de outra | — | TASK-011 | — | `ItemWatch` | de um Vencimento | Contextual, mas sem uso real hoje | **FUTURE** | sem "terceiro" real até Membership |

*Linhas abaixo (`Concept ID = —`) não são conceitos de usuário — internos ou removidos do modelo conceitual, mantidos aqui só para rastreabilidade da decisão:*

| — | `NotificationIntent` | — | — | — | — | interno | — | Internal only | — | — |
| — | `IdentityMapping`/`DeviceSession` | — | — | — | — | interno | — | Internal only | — | — |
| — | `OutboxRecord`/`GuestTokenPointer` | — | — | — | — | interno | — | Internal only | — | — |
| — | `TenantEntitlement` | Limite do plano | **Removido do inventário de conceitos de usuário (achado da revisão adversarial: product creep)** — nenhuma tarefa do Context/Task Model cobre "ver meu uso/limite"; incluir aqui seria propor um conceito sem lastro em tarefa real, o mesmo erro que este documento rejeita em §40. Fica como `FUTURE`/interno até existir uma tarefa real e uma rota que a sustente (billing, M12, hoje bloqueado por decisão de produto) | — | — | — | — | FUTURE | — |

### Nota sobre C3 — por que "Fornecedores" fica como working label, não nome definitivo (amendment)

Verificado nesta rodada: `TrackedSubjectType` (`tracked-subject.ts:11`) = `"COMPANY" | "VENDOR" |
"CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM"` — sete tipos, não só fornecedor. Não há
nenhum documento de roadmap/produto que declare o vertical inicial como deliberadamente
fornecedor-only; o `type` genérico no schema e a ausência de qualquer commitment comercial
registrado (`docs/architecture/roadmap-evolution/*`) não sustentam cristalizar "Fornecedor" como
nome definitivo agora — só como o cenário mais evidenciado por mercado (`02-market-research.md`:
TrustLayer/Certificial/SubCompliant/VendorJot são todos vendor-compliance). Por isso, a partir
deste amendment, C3 é registrado como:

```
Conceptual Area: Subject Area
Current working label: Fornecedores
```

Isso preserva a arquitetura dual-anchor (nada muda estruturalmente) sem fechar prematuramente uma
decisão de naming comercial. O termo técnico `Subject`/`TrackedSubject` continua **nunca exposto
ao usuário final** — "Subject Area" é um placeholder só para esta documentação, não um candidato
de copy. Se evidência comercial futura confirmar foco deliberado em fornecedor, "Fornecedores"
pode ser promovido a nome definitivo sem mudança estrutural nenhuma.

---

## 6. Primary / Secondary / Contextual / Internal Concepts

- **PRIMARY**: Vencimento (C1), Documento (C2, apesar de bloqueado — teste do §15 do prompt-fonte:
  removendo o nome "documento" da interface, o usuário NÃO consegue mais confirmar compliance —
  então é primário mesmo bloqueado), Fornecedor (C3, quando a camada de compliance é usada), Alerta
  (C7, mesmo raciocínio de C2 — é primário conceitualmente, independente de estar bloqueado).
- **SECONDARY**: Requisito (C4), Solicitação (C5), Responsável (C8), Importação (C9).
- **CONTEXTUAL**: Documento recebido (C6 — só aparece no contexto de uma Solicitação/Requisito),
  Observador (C10 — só apareceria no contexto de um item, e hoje nem isso).
- **INTERNAL ONLY**: `NotificationIntent`, `IdentityMapping`, `DeviceSession`, `OutboxRecord`,
  `GuestTokenPointer`. Teste aplicado (§15 do prompt-fonte): removendo esses nomes da interface, o
  usuário atinge o objetivo normalmente — confirmado para todos os cinco.

---

## 7. Technical-to-User Concept Mapping

Ver Concept Inventory (§5), coluna "Technical backing" — não duplicado aqui. Diferença em relação
ao Context/Task Model original: `Document` e `DocumentSubmission` são explicitamente split em
**dois conceitos de usuário distintos** (C2 "Documento" vs. C6 "Documento recebido"), não fundidos
num só — ao contrário do que o Context/Task Model original sugeria ("usuário provavelmente não
deveria perceber essa distinção"). Motivo da correção (ver §9 para o raciocínio completo): a
distinção importa para o usuário precisamente porque o backend não faz a ponte automaticamente
(`BLOCKER-C`) — esconder essa diferença na interface criaria uma falsa promessa de que "documento
recebido" já é "documento oficial", quando pode não ser.

---

## 8. Concept Relationships

```
Vencimento (C1)
├── Documento (C2) — 0..N, sem ordem/versão definida [BLOCKED: BLOCKER-A]
├── Alerta (C7) — 0..N triggers [BLOCKED: BLOCKER-B]
├── Responsável (C8) — 0..1, texto livre
└── (opcional) Requisito (C4) — vínculo manual, não obrigatório, não exclusivo

Fornecedor (C3)
└── Requisito (C4) — 0..N
      ├── (opcional) Vencimento (C1) vinculado — 0..1
      └── Solicitação (C5) — 0..N
            └── Documento recebido (C6) — 0..N
                  [não vira C2 nem C4=SATISFIED automaticamente: BLOCKER-C]
```

Nenhuma seta é obrigatória além de Vencimento existir (o único objeto verdadeiramente independente
do modelo). Isso é o oposto de uma árvore rígida — é dois grafos frouxamente conectados por uma
ponte manual.

---

## 9. Expiration ↔ Document Model

**O que sabemos (FACT)**: `ExpirationItem` não tem relação 1:1 com `Document` — múltiplos podem
coexistir sob o mesmo item, sem campo de ordem, versão ou "atual" no schema
(`document.ts` não tem `previousDocumentId`/`supersedes`). Não existe rota de leitura (`BLOCKER-A`).
Renovar um item (`POST .../renew`) cria um item novo e não copia/vincula documentos do item de
origem.

**O que o usuário provavelmente precisa entender (`STRONG INFERENCE`, a partir de OUTCOME-002/004)**:
qual é o documento (ou documentos) que hoje comprovam que este vencimento está em dia — mesmo que
tecnicamente existam vários registros no backend, o modelo mental provável é "o documento deste
vencimento" (singular), com histórico secundário ("documentos anteriores/substituídos"), não uma
lista plana sem hierarquia.

**Decisão de domínio possivelmente necessária** (`OPEN QUESTION`, não decidida aqui): o backend
precisará, além de resolver `BLOCKER-A` (leitura), decidir se introduz um conceito explícito de
"documento vigente" (um ponteiro/flag por item) ou se a interface deriva isso client-side por
"mais recente não excluído" sem nenhuma garantia forte do backend. **Correção factual (achado da
revisão adversarial)**: a versão anterior desta frase citava `RequirementAssignment.linkedDocumentId`
como se já implementasse esse ponteiro do lado do Requisito — o campo existe no tipo
(`requirement-assignment.ts:38`), mas `RequirementService.linkExpirationItem()` nunca o define, só
grava `linkedItemId` (`requirement-service.ts:150-160`) — ou seja, **nem o lado do Requisito tem
hoje um ponteiro de "documento vigente" funcional**; é um campo do schema sem uso real, do mesmo
jeito que os estados mortos do enum (§13). Removida a citação incorreta; a decisão de domínio
segue em aberto, sem precedente já implementado a reaproveitar. Registrar as duas alternativas
para quem for desenhar a correção de `BLOCKER-A`:
- **Opção 1**: backend ganha um ponteiro explícito "documento vigente" por item (mais correto,
  mais trabalho de domínio).
  - **Opção 2**: interface trata "mais recente" como vigente por convenção, sem garantia do
  backend (mais rápido, mais frágil — dois uploads simultâneos ou fora de ordem quebram a
  suposição).

---

## 10. Subject ↔ Requirement ↔ Document Model

Já coberto estruturalmente em §8. Ponto adicional: **o vínculo `RequirementAssignment↔ExpirationItem`
é frouxo e não exclusivo** (`FACT`: `linkExpirationItem` só valida que o item existe e pertence ao
tenant, nunca que "pertence ao mesmo Fornecedor" — porque essa noção nem existe no backend). Isso
significa que, conceitualmente, um Vencimento pode aparecer vinculado a mais de um Requisito, e a
interface não deve impedir isso nem fingir uma exclusividade que o backend não impõe.

**Âncora mental**: nenhuma das duas hierarquias hipotéticas do prompt-fonte (`Fornecedor→Documentos`
ou `Vencimentos→Fornecedor`) vence sozinha — ver §1/§4. A Information Architecture (§18) reflete
isso com duas áreas de primeiro nível, cross-linkadas, em vez de aninhar uma dentro da outra.

---

## 11. Document Request / Submission Model

```
Requisito (MISSING)
   ↓ Internal Operator cria
Solicitação (REQUESTED)
   ↓ External Submitter abre o link
Solicitação (OPENED)
   ↓ External Submitter envia arquivo
Solicitação (SUBMITTED) + Documento recebido criado
   ↓ scan de segurança automático
Documento recebido (CLEAN ou REJECTED)
   ↓ [AQUI O CICLO PARA — BLOCKER-C]
   ↓ (esperado, não implementado) alguma forma de virar:
Requisito (SATISFIED) + Documento oficial (C2) criado/vinculado
```

Estados mortos no enum atual (nunca alcançados pelo código, `FACT`, confirmado por grep): em
`RequirementAssignment`, `REQUESTED`/`SUBMITTED`/`UNDER_REVIEW`/`REJECTED`; em `DocumentRequest`,
`COMPLETED`/`CANCELLED`/`EXPIRED`. **Regra para este documento e para a próxima etapa**: não
desenhar nenhuma tela/estado de interface em torno de um valor de enum que o código nunca produz
hoje — isso seria desenhar para um estado que não existe, o inverso do erro de "esconder estado
real". Quando `BLOCKER-C` for resolvido (alternativa A ou B, ver §37), alguns desses estados podem
passar a ser alcançáveis — a decisão de qual muda com qual alternativa.

---

## 12. Alert/Reminder Conceptual Model

Nome de usuário candidato: **"Alertas"** (não "política de lembrete" — teste do prompt-fonte
aplicado: o usuário pensa em "quando eu quero ser avisado", não no mecanismo). Modelo:

```
Vencimento
  └── Alerta(s) — "avise-me X dias antes"
        └── (esperado) Aviso enviado no momento configurado [BLOCKED: BLOCKER-B]
```

**Regra explícita, herdada do Context/Task Model e reforçada aqui**: o conceito "Alerta" continua
existindo como PRIMARY na arquitetura de informação — não removido por causa do bug (§7 do
prompt-fonte: "não remova o conceito de alerta só porque a implementação atual possui um bug"). O
que muda é só a Readiness (`BLOCKED`) e a regra de não apresentar como funcional (herdada, §33).

---

## 13. Status Vocabulary

**Correção semântica (amendment — achado real de uma revisão independente, verificado em código
antes de aceitar)**: a versão anterior traduzia `Document.CLEAN` como "Aprovado" e
`RequirementAssignment.SATISFIED` como "Em dia". As duas traduções emprestam mais certeza do que o
domínio realmente sustenta — ver §13.1/§13.2 para a verificação completa e a seção nova "Epistemic
Integrity of UI States" (§45) para a regra geral que evita repetir esse erro.

Critério aplicado, coluna por coluna, à tabela revisada: `User-facing semantic` é o rótulo, e
`Confidence/meaning` diz exatamente o que o sistema sabe — nunca o que gostaríamos que soubesse.

| Entity | Technical status | User-facing semantic | Confidence/meaning | Notes |
|---|---|---|---|---|
| Vencimento | `ACTIVE` | Ativo | O item existe e não foi arquivado/excluído | — |
| | `ARCHIVED` | Arquivado | Usuário marcou como não mais monitorado | — |
| | `RENEWED` | Renovado (substituído por um ciclo novo) | Existe um item novo com `renewedFromId` apontando para este | Contextual, não aba principal |
| | `DELETED` | — | — | Invisível por design |
| Documento | `PENDING_UPLOAD` | Aguardando envio | Reserva feita, arquivo ainda não chegou ao S3 | — |
| | `SCANNING` | Verificando segurança | Arquivo chegou, aguardando resultado do scan de malware | — |
| | `CLEAN` | **"Arquivo verificado"** (nunca "Aprovado") | **Só que o arquivo passou na validação estrutural (checksum/tamanho/tipo) e no scan de malware (`NO_THREATS_FOUND`) — `decideNextAction()`, `document-state-machine.ts:44-72`, verificado nesta rodada.** Zero validação de conteúdo, tipo documental, fornecedor correto, data de validade ou aderência a um requisito | Ver §13.1 — S3 Major, corrigido |
| | `REJECTED` | **"Arquivo rejeitado pela verificação de segurança"** (nunca "Recusado" sozinho) | Malware encontrado OU upload estruturalmente inválido — nunca "documento comercialmente rejeitado" | evita ambiguidade com uma futura rejeição de conteúdo (que não existe hoje) |
| | `UNSUPPORTED` | Tipo de arquivo não suportado pela verificação | O scanner de malware não sabe processar este tipo | — |
| | `TIMEOUT` | Expirou sem concluir a verificação | Nem upload nem scan produziram evidência a tempo | — |
| Requisito | `MISSING` | Pendente | Nenhum vencimento vinculado | — |
| | `SATISFIED` | **"Vinculado a um vencimento"** (nunca "Em dia") | **Só que um `ExpirationItem` foi manualmente ligado no momento X — grava `linkedItemId`+`satisfiedAt` uma única vez (`requirement-service.ts:150-160`) e nunca é recalculado. Nenhum worker verifica se o item ainda está `ACTIVE`/não vencido. Confirmado nesta rodada por grep exaustivo de escritores de `RequirementAssignment.status` — só existem os dois pontos citados.** Um requisito pode estar `SATISFIED` com o item vinculado já `ARCHIVED`, `RENEWED` ou vencido, sem nenhum rebaixamento automático | Ver §13.2 — S2/S3, corrigido |
| | `REQUESTED`/`SUBMITTED`/`UNDER_REVIEW`/`REJECTED` | **estado morto — não desenhar tela para isso ainda** | nenhuma transição do código chega lá | — |
| Solicitação | `REQUESTED` | Enviada | — | — |
| | `OPENED` | Aberta pelo fornecedor | — | — |
| | `SUBMITTED` | Documento recebido | **Não significa aceito/vinculado — ver C6, §7** | ver "Epistemic Integrity", §45 |
| | `REVOKED` | Revogada | — | — |
| | `COMPLETED`/`CANCELLED`/`EXPIRED` | **estado morto — não desenhar tela para isso ainda** | nenhuma transição do código chega lá | — |
| Importação | `UPLOADED`/`PARSING` | Processando | — | — |
| | `PREVIEW_READY` | Pronto para revisar | — | — |
| | `COMMITTING`/`COMMITTED` | Aplicando / Concluído | `COMMITTED` = linhas efetivamente gravadas | — |
| | `FAILED`/`EXPIRED` | Falhou / Expirado | — | — |

### 13.1 Verificação de `Document.CLEAN` (perguntas obrigatórias do amendment)

1. **O que causa a transição para `CLEAN`?** `decideNextAction()` (`document-state-machine.ts:60-64`):
   `uploadConfirmedValid && malwareClean` → `PROMOTE` (o worker então copia para o bucket limpo e
   só aí persiste `CLEAN`).
2. **Existe validação de conteúdo?** Não — confirmado por leitura completa do arquivo. A função
   só combina duas evidências: validade estrutural do upload (checksum/tamanho/tipo/parser PDF) e
   resultado do scanner de malware.
3. **Existe verificação de validade, tipo documental correto, fornecedor correto, datas, ou
   aderência ao Requirement?** Não, nenhuma das quatro.
4. **`CLEAN` significa exclusivamente segurança técnica do arquivo?** Sim, confirmado.
5. **Existe workflow humano ou automático de aprovação de conteúdo?** Não — confirma o achado já
   registrado em §36/Rejected Assumptions do Context/Task Model ("não existe workflow de
   aprovação humana de documento recebido").

**Severidade**: classificado como problema de **Information Integrity / Trust, severidade alta
(S3 Major)** — `CLEAN = Aprovado` poderia induzir o usuário a acreditar que o conteúdo foi
validado, quando só a segurança do arquivo foi. Corrigido em toda a tabela acima.

### 13.2 Verificação de `RequirementAssignment.SATISFIED` (perguntas obrigatórias do amendment)

Verificado: `SATISFIED` é **snapshot, não estado derivado**. `linkExpirationItem()`
(`requirement-service.ts:150-168`) grava `status:"SATISFIED"`, `linkedItemId`, `satisfiedAt` numa
única escrita condicional (OCC), sem nenhuma lógica de recálculo. Grep exaustivo em
`src/workers/` e `src/runtime/aws/handlers/` por escritores de `RequirementAssignment.status`
encontrou só os dois pontos em `requirement-service.ts` (`MISSING`↔`SATISFIED` via
`link`/`unlink`, ambos manuais) — nenhum worker/job consulta `linkedItemId` dinamicamente para
revalidar. `document-chasing-dispatch/dispatch.ts` **lê** `RequirementAssignment` (para decidir
cobrança), mas não regrava seu status a partir do `dueDate` do item vinculado.

**Resposta ao critério do amendment**: **Opção B — `SATISFIED` NÃO equivale a "Em dia"**. Um
requisito pode estar `SATISFIED` com o item vinculado já `ARCHIVED`, `RENEWED` (substituído por um
ciclo novo, sem que o requisito seja re-vinculado ao item novo — outro gap real descoberto aqui,
registrado em §39 como Open Question nova) ou até vencido, sem nenhum rebaixamento automático.
Rótulo corrigido para **"Vinculado a um vencimento"** em toda a tabela e nas seções que o citam.

**Impacto sobre "Fornecedor regular"**: a mesma imprecisão se propaga para qualquer cálculo
agregado de compliance por fornecedor — ver §17 (Information Hierarchy) e §45, corrigidos para não
usar "regular"/"em dia" sem essa ressalva.

**Normalização semântica entre entidades**: "em andamento" (Documento `SCANNING`, Importação
`PARSING`/`COMMITTING`, Solicitação `REQUESTED`/`OPENED`) merece linguagem/indicador visual
consistente. "Concluído tecnicamente" (Documento `CLEAN`, Importação `COMMITTED`) é uma categoria
diferente de "confirmado por vínculo humano, sem garantia temporal" (Requisito `SATISFIED`) — as
duas não devem compartilhar o mesmo peso visual de "sucesso pleno".

---

## 14. Terminology Decisions

- **"Documento" (C2) vs. "Documento recebido" (C6)** — mantidos como dois termos distintos (ver
  §7), não fundidos, precisamente para não mascarar `BLOCKER-C`.
- **"Alerta"**, não "lembrete"/"política de reminder" — linguagem do usuário, não do backend.
- **"Fornecedores"** é o *working label* atual da área conceitual "Subject Area" (`TrackedSubject`)
  — **não um nome definitivo** (corrigido nesta rodada, ver nota em §5). Sete tipos existem no
  schema (`COMPANY`/`VENDOR`/`CLIENT`/`EMPLOYEE`/`ASSET`/`LOCATION`/`CUSTOM`), sem commitment
  comercial registrado a um vertical único.
- **"Documento verificado"**, não "Aprovado", para `Document.CLEAN` — corrigido nesta rodada (§13.1).
- **"Vinculado a um vencimento"**, não "Em dia", para `RequirementAssignment.SATISFIED` — corrigido
  nesta rodada (§13.2).
- **"Renovar"** mantido como termo distinto de "editar" — mas a interface precisa deixar claro
  (não decidido aqui, é copy/journey da próxima etapa) que renovar cria um registro novo.

## 15. Terminology Open Questions (herdadas, não resolvidas)

Ver Context/Task Model §18/§35 — mantidas sem alteração: nome final de `Subject` por vertical;
necessidade de reenvio de Solicitação; `requirement` vs. `document request`.

---

## 16. User Decision → Information Mapping

Baseado diretamente no Decision Inventory já produzido (preservado, não reduzido):

| Decisão | Informação necessária | Onde deveria viver conceitualmente | Conceitos relacionados | Criticidade |
|---|---|---|---|---|
| O que exige minha atenção agora? | status + data + resultado de alerta | Overview / Vencimentos | C1, C7 | T0 |
| Devo renovar isso? | data atual, documento atual, última renovação | Detalhe do Vencimento | C1, C2 | T0 |
| Esse documento está correto? | preview do documento | Detalhe do Vencimento (contextual) | C2 | T0 (bloqueado) |
| Preciso reenviar uma solicitação? | status + prazo restante | Fornecedor → Requisito, ou Solicitações (se existir view global) | C4, C5 | T0 |
| Esse fornecedor está regular? | **honestamente, hoje só**: contagem de requisitos pendentes vs. vinculados — não uma garantia temporal real (`SATISFIED` não é recalculado, §13.2); "regular" de fato exigiria correção de backend | Detalhe do Fornecedor | C3, C4 | T0 |
| Quem deve agir? | responsável | Vencimento (Primary info) | C1, C8 | T1 |
| Esse documento recebido já virou o documento oficial? | vínculo C6→C2 | Contextual, dentro do Requisito | C4, C6 | T0 (bloqueado, BLOCKER-C) |

---

## 17. Information Hierarchy

Por contexto (não universal, per §22 do prompt-fonte):

**Lista de Vencimentos**: Primary = nome, status, dias restantes; Secondary = responsável,
fornecedor associado (se houver); Contextual = última renovação, alerta configurado, solicitação
relacionada.

**Detalhe de um Vencimento**: Primary = nome, status, data, documento (quando `BLOCKER-A`
resolvido); Secondary = responsável, histórico de renovação, requisito vinculado (se houver);
Contextual = alerta configurado, erro de processamento.

**Lista de Fornecedores** (`Subject Area`, working label): Primary = nome, tipo, **contagem de
requisitos pendentes vs. vinculados** (`STRONG INFERENCE`, achado do amendment — substitui "status
agregado de compliance"/"regular" da versão anterior, que o domínio não sustenta sem a ressalva
de §13.2: um requisito `SATISFIED` não garante que o item vinculado ainda está válido); Secondary =
vencimentos associados; Contextual = última solicitação enviada. Se um resumo mais forte tipo
"regular/irregular" for desejado pelo produto, ele exigiria primeiro o backend recalcular
`SATISFIED` dinamicamente contra o `dueDate` do item vinculado — não existe hoje, registrado como
Open Question nova em §39.

---

## 18. Candidate Information Areas

Avaliadas uma a uma (§23-25 do prompt-fonte), não aceitas automaticamente:

| Área candidata | Perguntas que responde | Tarefas críticas | Conceitos | Top-level? |
|---|---|---|---|---|
| **Overview** | O que precisa de mim agora, em tudo? | OUTCOME-001, 003, 006 | C1, C7, C5 | **Sim** — única forma de responder "atenção geral" sem forçar o usuário a visitar 2 áreas |
| **Vencimentos** | O que está vencido/vencendo? Detalhe de um item. | OUTCOME-001,002,003,004 | C1, C2, C7, C8 | **Sim** — tarefa diária, T0, sem substituto |
| **Fornecedores** (`Subject Area`) | Quais requisitos faltam/estão vinculados? (não "quem está regular" sem ressalva — §13.2) | OUTCOME-006 | C3, C4 | **Sim** — T0, âncora mental própria (§4), validado por mercado |
| **Solicitações** (cross-subject) | Quais estão pendentes/expirando em todos os fornecedores? | OUTCOME-006 | C5 | **Condicional** — merece existir conceitualmente (decisão do usuário real, §16), mas hoje `BLOCKED`: sem query tenant-wide no backend. Ver §35 |
| **Importações** | — | TASK-008 | C9 | **Não** — é uma ferramenta/ação pontual, não um objeto que o usuário revisita; não é um "lugar", é uma ação com uma tela de acompanhamento transiente |
| **Configurações** | Como notificações chegam? Como convites são entregues? | TASK-010, 012 | preferências | **Sim, mas baixa prioridade/frequência** — settings clássico. **Correção (achado da revisão adversarial)**: não inclui "alerta padrão" — não existe hoje resolução de política `TEMPLATE`/tenant-wide (`scope: TEMPLATE` nunca implementado, Context/Task Model §3), então "como quero ser avisado por padrão" não é uma pergunta que esta área pode responder ainda; Alerta (C7) permanece só contextual por item (§12), nunca uma tela global |

---

## 19. Global vs Contextual Views

| Conceito | Global ou Contextual | Por quê |
|---|---|---|
| Todos os vencimentos | **Global** | Tarefa diária, T0 |
| Documento de um item | **Contextual** | Nenhuma evidência de necessidade de "navegar todos os documentos" isoladamente |
| Requisitos de um fornecedor | **Contextual** | Só faz sentido dentro de um fornecedor específico |
| Solicitações pendentes de todos | **Global (conceitualmente) / Contextual (hoje, por limitação técnica)** | O usuário precisa responder isso globalmente (Decision Inventory), mas o backend só suporta consulta por assignment — registrado como dependência de engenharia (§36), não decidido silenciosamente como "só contextual para sempre" |
| Configuração de alerta | **Contextual por item** | Não existe hoje resolução de política "padrão do tenant" (`scope:TEMPLATE` nunca implementado) — a IA não pode fingir uma tela global de "meus alertas padrão" que o backend não sustenta |

---

## 20. Entry Points for T0/P0 Outcomes

| Outcome | Entry point esperado |
|---|---|
| OUTCOME-001 (identificar) | Overview (home) — principal; Vencimentos — direto |
| OUTCOME-002 (evidência documental) | Detalhe do Vencimento (contextual) |
| OUTCOME-003 (ser avisado) | Detalhe do Vencimento (configurar); e-mail do próprio alerta quando disparar (entrada externa, quando `BLOCKER-B` for resolvido) |
| OUTCOME-004 (renovar) | Detalhe do Vencimento; possivelmente link direto de um alerta por e-mail (entrada externa) |
| OUTCOME-005 (guest) | Link mágico — **fora** da navegação do app, é uma superfície própria (§27) |
| OUTCOME-006 (coleta externa) | Detalhe do Fornecedor → Requisito; secundariamente, Solicitações (se/quando existir) |

---

## 21. Global vs Contextual Actions

**Correção metodológica (amendment)**: a versão anterior misturava classificação conceitual com
exemplo de implementação visual ("ex. botão persistente"). `GLOBAL ACTION` é definida formalmente
como: *ação cujo início não depende de um objeto previamente selecionado* — nada sobre onde/como
ela aparece na tela, isso é decisão de wireframe, fora de escopo aqui.

| Action | Scope | Required context | Consequence | Readiness |
|---|---|---|---|---|
| Criar vencimento | GLOBAL | none | Baixa | READY |
| Importar CSV | GLOBAL | none | Média | READY |
| Criar fornecedor | GLOBAL | none | Baixa | READY |
| Renovar | CONTEXTUAL | um Vencimento específico | Alta (`HIGH CONSEQUENCE`) | PARTIAL (ver OUTCOME-004) |
| Fazer upload de documento | CONTEXTUAL | um Vencimento específico | Alta | READY (operação); outcome maior `BLOCKED` (BLOCKER-A) |
| Arquivar / Excluir | CONTEXTUAL | um Vencimento específico | Alta (`HIGH CONSEQUENCE`) | READY |
| Solicitar documento | CONTEXTUAL | um Requisito específico | Média | READY (operação); outcome maior `BLOCKED` (BLOCKER-C) |
| Revogar solicitação | CONTEXTUAL | uma Solicitação específica | Alta (`HIGH CONSEQUENCE`) | READY |

---

## 22. Search Architecture

Papel conceitual: busca por nome do vencimento, nome do fornecedor, tag, responsável (texto
livre). Backend hoje **não confirma busca textual** — só filtro por status (GSI1). Classificação:
busca global (Vencimentos + Fornecedores) é `LIKELY` desejável, mas `FUTURE` em termos de
prontidão de backend — não implementar suposição de full-text search sem confirmação.

## 23. Filter Architecture

| Filtro | Classificação |
|---|---|
| Status (Vencimento) | **ESSENTIAL** — já suportado (GSI1) |
| Responsável | LIKELY — sem suporte confirmado no backend |
| Fornecedor associado | LIKELY — sem suporte confirmado |
| Tag | LIKELY — sem suporte confirmado |
| "Tem solicitação pendente" | FUTURE — depende da mesma lacuna de query do §18/§35 |

---

## 24. Temporal Information Architecture

`HYPOTHESIS` informada pelo outcome (não medida): agrupamento temporal provavelmente faz parte do
modelo mental de Vencimentos — `Vencidos / Hoje / Próximos 7 dias / Próximos 30 dias / Depois`.
Não decidir visualização (calendário, lista, etc.) — isso é screen design. Vale registrar que o
backend já ordena por `dueDate` via GSI1, então agrupamento temporal é tecnicamente viável sem
mudança de backend, ao contrário de busca textual.

---

## 25. First-use IA

0 vencimentos, 0 fornecedores, 0 documentos. Conceitos que precisam aparecer no primeiro uso:
Vencimento (criar o primeiro) OU Importação (trazer uma planilha existente) — ambos tecnicamente
prontos hoje. Fornecedor/Requisito NÃO precisa aparecer no primeiro uso a menos que o usuário
já opere com fornecedores — é uma camada opcional (§4), não deveria ser forçada no onboarding.

## 26. Recurring-use IA

Usuário estabelecido: modelo muda para scan → priorizar → investigar → agir. A Overview/dashboard
deve favorecer isso respondendo às perguntas do §31 primeiro, não listando tudo sem prioridade.

---

## 27. Guest IA

Experiência totalmente separada, sem nenhum elemento da navegação principal (`Overview`,
`Vencimentos`, `Fornecedores` etc. nunca aparecem). Conceitos necessários: quem está pedindo, o
que está sendo pedido (`requirementName`), prazo (`deadline`), como enviar (upload), resultado
(confirmação). Mantém-se `unauthenticated`, `magic-link scoped`, `task-focused` — nunca converter
o convidado em usuário do SaaS dentro desse fluxo.

### GTR-01 — Guest Trust Requirement: identidade do solicitante (amendment — severidade elevada)

**Reavaliação (achado de uma revisão independente, aceito)**: a versão anterior tratava "quem está
pedindo" como uma dependência pequena de engenharia. O impacto real é de **Trust**, não só de
completude de dados — reavaliado à luz do modelo de ameaça real do fluxo:

```
External Submitter recebe um link
  ↓
abre um site que pode nunca ter visto antes
  ↓
o site pede upload de um documento (possivelmente sensível)
```

O `External Submitter` pode não conhecer o produto, não ter conta, não reconhecer o domínio, e não
ter como saber quem de fato criou a solicitação — só que um link chegou (por e-mail, ou
repassado por terceiros). Riscos concretos se essa identidade não for exibida: confusão sobre o
destinatário real (o submitter não consegue confirmar que está enviando para a organização
correta); maior superfície de phishing (um link malicioso reaproveitando o mesmo mecanismo seria
indistinguível de um pedido legítimo); risco elevado para um submitter que atende vários clientes/
tenants simultaneamente e precisa saber qual pediu o quê antes de anexar um documento sensível.

**Verificado em código**: `getRequestInfo()` (`guest-submission-service.ts:92-107`) retorna hoje
só `{requirementName, deadline, allowedMediaTypes, maxUploadBytes}` — nenhum campo de identidade
do tenant/organização/pessoa requisitante.

```
Guest Trust Requirement GTR-01

O External Submitter deve conseguir identificar a organização solicitante
antes de enviar um documento.

Technical readiness:  BLOCKED (guest upload technical flow em si é READY —
                       ver distinção abaixo)
UX trust readiness:   NOT READY
Backend gap:          GET /guest/document-requests/{token} não expõe identidade
                       do tenant/organização requisitante
Severity:             S2/S3 (Trust) — elevado da classificação anterior
                       ("dependência pequena")
```

**Distinção formal, sem exagerar a taxonomia**: o fluxo técnico de guest upload (token→info→
upload→S3) está `READY` (Context/Task Model, OUTCOME-005) — o que não está pronto é a **UX trust
readiness** especificamente sobre GTR-01. As duas coisas são independentes: o mecanismo funciona,
a confiança do destinatário nele não está garantida.

Informação mínima proposta para fechar GTR-01 (`HYPOTHESIS`, não decidida — derivada do modelo de
ameaça acima, não inventada livremente): nome da organização/tenant solicitante. `requirementName`
e `deadline` já cobrem "o que"/"até quando"; o que falta é só "de quem".

## 28. Future Organization/Membership Compatibility

Constraint aplicada: nenhuma área/copy deste modelo assume "minha conta = meu tenant = meu
usuário" de forma hard-coded — os nomes de área (`Vencimentos`, `Fornecedores`) já são neutros
(escopados por tenant, não por "meu"), o que sobrevive sem mudança quando `Membership` existir.
`Internal Operator` como papel conceitual (não `OWNER`) já é a preparação correta (herdada do
Context/Task Model, preservada aqui). Nenhuma tela de "membros"/convite é modelada agora — não é
necessário até o gatilho comercial disparar.

---

## 29. Candidate Navigation Model A — Dual-anchor (recomendado, ver §33)

```
Overview
Vencimentos
Fornecedores
Solicitações [marcado BLOCKED até query tenant-wide existir]
Configurações
```

## 30. Candidate Navigation Model B — Vencimento-first

```
Overview
Vencimentos
Configurações

(Fornecedores e Solicitações só contextuais, acessados a partir do detalhe de um vencimento
 ou de uma entrada secundária dentro de Vencimentos)
```

## 31. Candidate Navigation Model C — Compliance unificado

```
Overview
Compliance (abas: Vencimentos | Fornecedores | Solicitações)
Configurações
```

---

## 32. Candidate Comparison

| Critério | A (dual-anchor) | B (vencimento-first) | C (compliance unificado) |
|---|---|---|---|
| Task Suitability | Alta — os 2 outcomes T0 (001, 006) têm entrada direta | Média — esconde OUTCOME-006 atrás de navegação contextual | Média — adiciona 1 clique à tarefa mais frequente (Vencimentos) |
| Findability | Alta | Baixa para fluxo de fornecedor | Média |
| Cognitive Load | Média (5 itens) | Baixa (3 itens) | Baixa (3 itens de topo, mas abas escondem estrutura) |
| Frequency alignment | Boa — Vencimentos continua 1 clique | Boa | Ruim — Vencimentos (tarefa diária) perde destaque de topo |
| Conceptual coherence | Alta — reflete os 2 anchors reais (§4) | Baixa — força hierarquia única que o backend não tem | Média — mistura 2 anchors sob um rótulo (`Compliance`) que nenhuma tarefa nomeia |
| Scalability | Boa | Boa para tenants sem fornecedores | Boa |
| Future compatibility | Boa (nenhum acoplamento a RBAC/tenant) | Boa | Boa |
| Guest separation | Preservada nos 3 | Preservada | Preservada |
| Risco de navegação duplicada | Baixo | Baixo | Médio (abas internas replicando o que já seria top-level) |

---

## 33. Recommended Information Architecture

**Candidato A**, com uma ressalva explícita sobre `Solicitações` e uma correção de classificação
(amendment): as áreas não são todas do mesmo tipo conceitual. Separando **Operational Areas**
(ligadas ao trabalho cotidiano do `Internal Operator`) de **Utility Area** (suporte, não
equivalente em importância conceitual):

```
OPERATIONAL AREAS

Overview           — responde "o que precisa de mim agora, em tudo"
Vencimentos        — lista + detalhe; T0 diário
Fornecedores       — lista + detalhe (requisitos, solicitações do fornecedor); Subject Area, working label
Solicitações       — READINESS: BLOCKED até existir query tenant-wide (§18/§35);
                      até lá, acessível só contextualmente dentro de Fornecedores,
                      NUNCA anunciada como área de topo funcional

UTILITY AREA

Configurações      — notificações, preferência de entrega (Alerta/C7 NÃO entra aqui — é
                      contextual por item, sem resolução de padrão de tenant hoje, ver §12)
```

**Nota (amendment)**: essa distinção não remove `Configurações` nem muda sua presença na
recomendação — só registra que ela não tem a mesma importância conceitual das áreas operacionais
(sem entrada em nenhum outcome T0/P0, frequência `rare`, ver §10/§16 do Context/Task Model). **Não
decidido aqui**: posição visual (menu secundário, avatar, rodapé, etc.) — isso pertence à
apresentação de wireframe/navegação, fora de escopo desta etapa. Registrar só como `Utility
Destination`, sem forma.

Justificativa (preservada, não reaberta): dá entrada direta aos dois outcomes T0 mais frequentes
(Vencimentos diário, Fornecedores para quem usa compliance por terceiro), não força uma hierarquia
única onde o backend tem dois grafos frouxos (§4/§10), e não introduz nenhuma dependência de RBAC
futuro. `Importações` é deliberadamente uma ação, não uma área — nenhuma evidência de que o
usuário revisita "imports antigos" como um destino de navegação.

**Conceitos deliberadamente escondidos**: `NotificationIntent`, `IdentityMapping`,
`DeviceSession`, `OutboxRecord`, `GuestTokenPointer` (internal only, §6); `Documento recebido`
(C6) nunca é uma área própria — só aparece contextualmente dentro de um Requisito, e só quando
`BLOCKER-C` permitir que o usuário sequer o veja.

---

## 34. Dashboard Information Questions

Reaproveitadas do Context/Task Model, sem mudança: o que está vencido; o que vence nos próximos N
dias; quais solicitações estão pendentes/expirando; houve erro recente (import); há processamento
travado (documento em `SCANNING` por tempo anormal — hoje irrespondível, `BLOCKER-A`). O
entregável aqui é a lista de perguntas, não cards — layout é da próxima fase.

---

## 35. Backend Readiness Mapping

| Área/Conceito | Readiness | Motivo |
|---|---|---|
| Vencimentos (lista/detalhe) | PARTIAL | dashboard sem paginação/ordenação real |
| Documento (C2) | **BLOCKED** — BLOCKER-A | sem leitura/listagem |
| Alerta (C7) | **BLOCKED** — BLOCKER-B | materialização desconectada |
| Fornecedores/Requisitos | READY | CRUD + link/unlink funcionam |
| Documento recebido (C6) | **BLOCKED** — BLOCKER-C | ciclo não fecha, sem visibilidade |
| Solicitações (view global) | **BLOCKED** (achado novo, menor) | sem query tenant-wide — só por assignment/individual |
| Configurações (notificação) | READY | |
| Guest IA | READY | ponta a ponta |
| Qualquer rota autenticada do SPA | **BLOCKED** | Full BFF (D-053/D-054) não implementado |

---

## 36. Engineering Enablement Dependencies

| Dependency | Why needed | Blocks which UI outcome | Priority |
|---|---|---|---|
| D-053/D-054 Full BFF implementation | Sem sessão de browser utilizável, nenhuma rota autenticada pode ser chamada com segurança pelo SPA | TODOS os outcomes autenticados — bloqueia iniciar qualquer frontend real, independente dos outros 3 | **1** |
| Document read/list API (BLOCKER-A) | Sem isso, "documento atual" não pode ser mostrado | OUTCOME-002, OUTCOME-004 (parcial) | 2 |
| Reminder materialization correction (BLOCKER-B) | Sem isso, "ser avisado" é uma promessa falsa | OUTCOME-003 | 2 |
| External collection completion — decisão de produto (§37) + implementação (BLOCKER-C) | Sem isso, coleta externa não fecha nem tem visibilidade | OUTCOME-006 | 3 (decisão em si é imediata/barata; implementação depende da alternativa escolhida) |
| Query tenant-wide de solicitações pendentes | Sem isso, `Solicitações` não pode existir como área global | Enfraquece OUTCOME-006 (fica só contextual) | 4 |
| **GTR-01 — expor identidade do requisitante no guest flow** (amendment) | Sem isso, a jornada guest tem risco de Trust/phishing (§27) | OUTCOME-005 (não bloqueia o outcome T0 em si, mas é **required before production guest UX**) | 4 — não elevado ao mesmo nível de BLOCKER-A/B/C (não impede nenhum outcome T0 autenticado), mas necessário antes de tráfego guest real em produção |

### Prioridade técnica recomendada — tentativa de refutar a ordem sugerida no prompt-fonte

Ordem sugerida: (1) Full BFF, (2) Document read/list, (3) Reminder materialization, (4) External
collection completion. **Full BFF em 1º lugar está bem fundamentado e não refuto** — é o único
item que bloqueia literalmente qualquer frontend real, independente da ordem dos outros três
(são bugs de domínio; BFF é a camada de sessão, dependência estrutural diferente, paralelizável
com o resto). **A ordem entre 2, 3 e 4 é `HYPOTHESIS`, não `FACT`** — não tenho evidência de custo
de implementação real de cada correção. Pela descrição disponível, `BLOCKER-B` (materialização de
reminders) parece um fix mais contido (religar um consumidor a um evento já existente) do que
`BLOCKER-A` (uma capacidade nova inteira de leitura, possivelmente com decisão de domínio sobre
versionamento, §9) — se essa suposição se confirmar, `BLOCKER-B` poderia vir antes de `BLOCKER-A`.
A decisão de produto de `BLOCKER-C` (§37) custa ~zero e não precisa esperar a fila de implementação
— pode/deve acontecer em paralelo, imediatamente. Recomendo confirmar custo real de implementação
de A vs. B com quem avaliar o código de M3/M3.5/M6 antes de travar a sequência.

---

## 37. External Collection Decision Brief

Não decidido aqui — só as alternativas, com impacto em UX/complexidade/risco, para apoiar a
decisão de produto que falta.

### Alternativa A — Fechamento automático
```
Documento recebido (CLEAN) → validação/vínculo automático → Requisito SATISFIED
```
- UX: zero trabalho manual — mais fiel à promessa "solicitei e o sistema resolve sozinho".
- Risco: nenhum checkpoint humano antes de marcar compliance como satisfeita — um documento
  errado/vencido/de outro fornecedor poderia ser aceito silenciosamente.
- Complexidade: provavelmente **alta** — vincular automaticamente a um vencimento exige inferir
  qual vencimento (criar um novo? qual data usar?), o que exige alguma fonte confiável de dados
  estruturados sobre o documento (data de validade, tipo). **Correção (achado da revisão
  adversarial — verificado contra `document-submission.ts:19` e
  `schemas/api/start-guest-submission-request.v1.json:8`)**: hoje `DocumentSubmission` só guarda
  metadados de arquivo (mediaType/tamanho/checksum), nunca dados de conteúdo como data de
  validade — confirmado no código, não inferido. A frase anterior atribuía essa lacuna
  especificamente a "M7/OCR ainda não implementado", o que é uma inferência mais forte do que a
  evidência sustenta: a fonte confiável poderia vir de M7/OCR, mas igualmente de um campo
  declarado pelo próprio fornecedor no formulário de guest upload, ou de revisão humana
  preenchendo o dado — nenhuma dessas alternativas foi eliminada pela evidência.
- `STRONG INFERENCE`: falta uma fonte confiável de dados estruturados do documento para fechar o
  ciclo com segurança automática — não necessariamente M7. Isso não decide a escolha, mas é
  informação relevante para quem decidir.

### Alternativa B — Revisão humana explícita
```
Documento recebido (CLEAN) → fila "aguardando confirmação" → Internal Operator revisa
   → vincula a vencimento existente OU cria vencimento novo a partir dele → Requisito SATISFIED
```
- UX: um passo manual a mais — ainda assim menos trabalho que cobrança por e-mail (o problema que
  o produto já resolve).
- Risco: baixo — nenhuma decisão de compliance é tomada sem confirmação humana, consistente com
  todo o resto do domínio hoje (nenhuma outra parte do sistema aprova conteúdo automaticamente).
- Complexidade: provavelmente **menor** — reaproveita o mecanismo de `link`/`unlink` já
  implementado; só precisa de uma rota de leitura da fila (`GET` de `DocumentSubmission`
  pendentes), sem depender de nenhuma fonte nova de dados estruturados sobre o documento.

`STRONG INFERENCE` registrada, não decisão: Alternativa B é mais consistente com o padrão já
estabelecido no restante do domínio (verificação sempre humana) e parece ter menor custo de
implementação por não depender de uma fonte de dados estruturados que hoje não existe. Fica para
o Marcelo decidir.

---

## 38. Assumptions

- Vencimento e Fornecedor/Requisito são dois anchors mentais coexistentes, não um hierárquico
  (`STRONG INFERENCE`, §4).
- Agrupamento temporal (`Vencidos/Hoje/7 dias/30 dias`) faz parte do modelo mental (`HYPOTHESIS`).
- "Documento recebido" precisa ser um conceito visível separado de "Documento" (`STRONG INFERENCE`,
  §7/§14) — decisão de design que preserva honestidade sobre `BLOCKER-C`.

## 39. Open Questions

1. (herdada) Nome final de `Subject`/`Fornecedor` por vertical de uso.
2. (herdada) Necessidade real de reenvio de Solicitação.
3. **Nova**: backend deve introduzir um ponteiro explícito de "documento vigente" por item, ou a
   interface deve inferir por "mais recente"? (§9)
4. **Nova**: quando/se uma view global de "Solicitações pendentes" deve ser priorizada — depende
   de uma query nova no backend, não coberta por nenhum blocker já nomeado.
5. **Elevada a requisito formal nesta rodada — GTR-01 (§27)**: `getRequestInfo()`
   (`guest-submission-service.ts:92-107`) não expõe identidade do tenant/organização requisitante.
   Reclassificado de "dependência pequena" (rodada anterior) para questão de **Trust**, severidade
   S2/S3, com modelo de ameaça explícito em §27 — não é um dos 3 blockers nomeados (não bloqueia
   nenhum outcome T0 autenticado), mas é `NOT READY` do ponto de vista de UX trust readiness da
   jornada guest, registrado em §36.
6. **Nova (amendment)**: quando um `ExpirationItem` vinculado a um `RequirementAssignment`
   `SATISFIED` é renovado (`POST .../renew` cria item novo, original vira `RENEWED`), o requisito
   permanece apontando para o item antigo (`linkedItemId` não é atualizado automaticamente) — a
   interface e/ou o backend precisam decidir como isso é tratado antes da etapa de Journeys
   (re-vínculo automático? aviso ao usuário? ambos ficam fora de escopo aqui, só registrados).

## 40. Rejected Alternatives

- **Fundir "Documento" e "Documento recebido" num único conceito de usuário** — rejeitado: o
  Context/Task Model original sugeria isso, mas mascararia `BLOCKER-C` (o usuário pensaria que um
  documento recebido de fornecedor já é oficial, quando pode não ser vinculado a nada).
- **Modelar `Fornecedor` como contêiner obrigatório de todo `Vencimento`** — rejeitado: o backend
  não tem essa relação (`ExpirationItem` não tem `subjectId`), e forçar essa hierarquia
  desalinharia o modelo mental de quem usa só vencimentos simples (Candidato C também rejeitado
  pelo mesmo motivo raiz).
- **Área de topo "Importações"** — rejeitado: é uma ação/ferramenta, não um destino de navegação
  persistente; nenhuma evidência de necessidade de revisitar imports antigos.
- **Modelar telas para os estados mortos do enum** (`REQUESTED`/`SUBMITTED`/`UNDER_REVIEW` de
  Requisito; `COMPLETED`/`CANCELLED`/`EXPIRED` de Solicitação) — rejeitado por ora: desenhar para
  um estado que o código nunca produz é o mesmo erro que esconder um estado real, na direção
  oposta.

---

## 41. Codex Review

Revisão adversarial independente (Codex, sandbox read-only, código real verificado, não confiando
no texto da Rodada A), respondendo aos 14 pontos de crítica + verificação extra do §37. Veredito:
**5 furos reais** — 2 factuais, 2 de inferência forte demais, 1 de product creep menor. Nenhum
furo estrutural na Information Architecture recomendada (Candidato A se sustenta).

1. **Arquitetura derivada do backend**: sem furo — `Vencimentos`/`Fornecedores` lastreados em
   OUTCOME-001/006 do Context/Task Model; `Solicitações` já vinha marcado como condicional.
2. **Conceitos técnicos expostos**: bem traduzidos em geral. Furo: `TenantEntitlement` listado
   como conceito de usuário provável sem nenhuma tarefa do Context/Task Model o cobrindo —
   product creep conceitual.
3. **Áreas top-level desnecessárias**: as 5 áreas se sustentam, mas **furo factual real**:
   `Configurações` incluía "alertas (por item, hoje)" como se fosse uma configuração global,
   contradizendo o próprio §12 do documento (Alerta é contextual por item, sem resolução de
   política de tenant implementada).
4. **Tarefa crítica escondida**: nenhuma — todos os 6 outcomes T0 têm entry point. Achado
   relacionado: Guest IA (§27) presumia "quem está pedindo" sem confirmar que o backend expõe
   isso — **verificado no código, não expõe** (`getRequestInfo()` só retorna requirementName/
   deadline/tipos/limite).
5. **Duplicação de navegação**: nenhuma real — sobreposição Fornecedores/Solicitações já é
   corretamente tratada como global vs. contextual.
6. **Confusão Subject×Requirement×Document**: tese central (ExpirationItem sem `subjectId`,
   vínculo opcional via `RequirementAssignment`) **confirmada correta**. Mas **furo factual real**:
   o documento citava `RequirementAssignment.linkedDocumentId` como já funcional — verificado que
   o campo existe no tipo mas `linkExpirationItem()` nunca o define, só grava `linkedItemId`.
7. **Confusão Expiration×Document**: modelo de §9 confirmado correto contra `document.ts`.
8. **IA acoplada a bugs**: nenhum acoplamento indevido — Alerta/Documento continuam PRIMARY apesar
   dos blockers, como deveria ser.
9. **Blockers ignorados**: nenhum — os 3 aparecem em todos os lugares relevantes.
10. **Future-proofing excessivo**: contido, exceto o mesmo `TenantEntitlement` do item 2.
11. **Product creep**: confirmado só o `TenantEntitlement`.
12. **RBAC como persona**: nenhuma confusão — `Internal Operator` mantido separado de `OWNER`/
    `MEMBER`/`VIEWER`.
13. **Dashboard decorativo**: perguntas genuínas, herdadas do Decision Inventory já aprovado.
14. **Navegação por feature**: nenhum problema — áreas nomeadas por objeto de trabalho, não módulo.
15. **§37/M7**: a inferência estava correta no fundo mas forte demais na forma — verificado no
    código que `DocumentSubmission` só guarda metadados de arquivo, nunca dados de validade, mas
    isso não implica necessariamente que M7/OCR seja a única solução (poderia ser formulário
    declarado pelo guest, ou revisão humana preenchendo o dado).

## 42. Reconciliation

Todos os 5 achados foram aceitos e corrigidos: (1) `linkedDocumentId` — citação incorreta removida
do §9, substituída pela confirmação de que nem o lado do Requisito tem hoje um ponteiro de
documento vigente funcional; (2) `Configurações` corrigida em duas seções (Concept Inventory
implícito e Recommended IA) para excluir "alerta padrão", mantendo Alerta como contextual por item
em todo o documento; (3) `TenantEntitlement` removido do inventário de conceitos de usuário,
rebaixado a `FUTURE`; (4) inferência do §37 sobre M7 generalizada corretamente para "fonte
confiável de dados estruturados sobre o documento", sem presumir que só OCR resolveria; (5) Open
Question 5 (§39) atualizada de "não verificado" para achado confirmado, registrada como dependência
de engenharia pequena para a etapa de Journeys. Nenhuma divergência real remanescente — a
Information Architecture recomendada (Candidato A) não precisou de reformulação estrutural,
só das correções pontuais acima.

---

## 43. Quality Evaluation

Eixos aplicáveis nesta etapa (`docs/frontend/interface-quality-standard.md` não existe como
arquivo formal ainda — usando os nomes de eixo diretamente do prompt-fonte):

| Eixo | Aplicável? | Avaliação |
|---|---|---|
| TaskSuitability | Sim | Os 6 outcomes T0 têm entry point mapeado (§20); nenhum ficou sem caminho de acesso |
| InformationArchitecture | Sim | Autoavaliação — ver §32/§33; dual-anchor deriva das tarefas, não do backend |
| Content | Sim | Terminologia decidida onde possível (§14), riscos registrados onde não (§15/§39) |
| Trust | Sim | Nenhum blocker mascarado; `BLOCKER-A/B/C` explícitos em toda seção relevante, nunca escondidos atrás de um "com aviso" |
| InformationPresentation | N/A | depende de layout/wireframe |
| SystemFeedback | N/A | nível de interação, próxima fase |
| ErrorRobustness | N/A | nível de tela/interação |
| Forms | N/A | nível de componente |
| DataOperations | N/A | nível de componente |
| Accessibility | N/A | nível visual/componente |
| Consistency | Parcial | vocabulário de status normalizado (§13) onde a informação já existe; resto é nível de componente |
| Responsiveness | N/A | layout, próxima fase |

---

## 44. Epistemic Integrity of UI States (seção nova — amendment)

Regra adicionada nesta rodada, a partir dos achados de `CLEAN`/`SATISFIED` (§13.1/§13.2):

> **A interface nunca deve apresentar um estado com grau de certeza maior do que aquele suportado
> pelo domínio.**

Exemplos reais do Expiration Tracker, todos verificados em código nesta rodada:

```
Document.CLEAN
≠ documento aprovado
= arquivo passou na verificação estrutural + scan de malware, nada sobre conteúdo

RequirementAssignment.SATISFIED
≠ "em dia" / "compliant agora"
= um vencimento foi vinculado manualmente uma vez, nunca revalidado contra o dueDate atual

DocumentRequest.SUBMITTED / DocumentSubmission recebida
≠ requisito satisfeito
= arquivo chegou e passou no scan de segurança; o vínculo ao Requisito continua manual (BLOCKER-C)

ReminderPolicy salva (PUT /reminders/policies bem-sucedido)
≠ garantia de que o aviso será enviado
= confirmação de que a configuração foi persistida; o disparo depende de BLOCKER-B
```

**Constraint que sobrevive a esta etapa, aplicável a Critical User Journeys**: toda jornada futura
que envolva documento, guest submission, requisito ou lembrete deve distinguir explicitamente
entre estados `known` (confirmado pelo próprio domínio), `inferred` (deduzido client-side, sem
garantia do backend — ex. "mais recente" como documento vigente, §9), `pending` (aguardando
evidência), `confirmed` (ação humana explícita, ex. `link`/`unlink`) e `failed`. Nenhuma journey
deve colapsar essas cinco categorias numa única badge de "sucesso" genérica.

## 44.1 Final Semantic Amendment Before Critical User Journeys

Resumo deste amendment (metodológico, não uma nova Information Architecture — dual-anchor, os 3
blockers nomeados, e as demais conclusões estruturais do documento original permanecem intactos):

- **Status semantics**: `Document.CLEAN` traduzido de "Aprovado" para "Arquivo verificado";
  `Document.REJECTED` esclarecido como rejeição de segurança/formato, nunca de conteúdo;
  `RequirementAssignment.SATISFIED` traduzido de "Em dia" para "Vinculado a um vencimento" —
  ambos verificados em código antes de corrigir (§13.1/§13.2), classificados S3 Major e S2/S3
  respectivamente.
- **Requirement semantics**: confirmado que `SATISFIED` é snapshot, não recalculado — nenhum
  worker rebaixa automaticamente quando o item vinculado expira/é arquivado/renovado. "Fornecedor
  regular" removido do vocabulário sem essa ressalva em toda seção que o usava (§16, §17, §18).
- **Subject naming**: `TrackedSubject` registrado como `Subject Area` (conceitual) com
  `Fornecedores` como *working label* atual, não nome definitivo — sete tipos existem no schema,
  sem commitment comercial a um vertical único.
- **Guest trust**: formalizado `GTR-01` — identidade do solicitante ausente no guest flow,
  reclassificado de dependência pequena para questão de Trust (S2/S3), com modelo de ameaça
  explícito e distinção entre technical readiness (`READY`) e UX trust readiness (`NOT READY`).
- **Utility-area classification**: `Configurações` separada explicitamente como `UTILITY AREA`,
  distinta das 4 `OPERATIONAL AREAS` — sem mudar sua presença na recomendação, sem decidir posição
  visual.
- **Removal of premature UI decisions**: `Global vs Contextual Actions` (§21) reescrito sem
  exemplos de componente/layout ("botão persistente" removido), usando só
  Action/Scope/Required-context/Consequence/Readiness.
- **Codex findings / Reconciliation**: ver rodada curta abaixo.

## 44.2 Codex Review — Amendment Semântico (rodada curta)

Revisão curta (não repetiu a auditoria completa, tratou o Context/Task Model e a IA estrutural
como já aprovados), respondendo às 10 perguntas do amendment:

1. `CLEAN` — corrigido, sem uso remanescente de "aprovação".
2. `SATISFIED`/"Em dia" — nenhum uso remanescente sustentando essa equivalência.
3. "Regular"/"compliance" — quase todo uso qualificado; **achado real, menor**: C4 (Requisito) no
   Concept Inventory ainda trazia a decisão "Esse fornecedor está regular?" sem a mesma ressalva
   explícita de C3. **Aceito e corrigido.**
4. `Fornecedor` cristalizado — não, working label registrado corretamente.
5. Guest identity/trust — GTR-01 cobre adequadamente, distinção technical/UX trust readiness bem
   feita.
6. `Configurações` como anchor operacional — corrigido em §33; aparecer como peer visual nos
   candidatos A/B/C (§29-32, não editados) é aceitável, é comparação de modelos de navegação, não
   reabre a classificação Operational/Utility já feita em §33.
7. Componente visual prematuro — nenhum remanescente.
8. Dual-anchor — permanece coerente, não reaberto.
9. Product creep novo — nenhum; GTR-01 é requisito de confiança diretamente ligado ao guest flow
   já existente.
10. Contradição com Context/Task Model — nenhuma.

**Veredito**: `APPROVED AS INPUT FOR CRITICAL USER JOURNEYS`, com o único achado (item 3) já
corrigido antes de fechar.

## 44.3 Reconciliation — Amendment Semântico

O achado real (C4 sem a mesma ressalva de C3 sobre "regular") foi aceito e corrigido no Concept
Inventory (§5), citando explicitamente §13.2. Nenhuma outra divergência real de metodologia foi
encontrada — as demais 9 confirmações (CLEAN/SATISFIED corrigidos, Fornecedor não cristalizado,
GTR-01 adequado, Configurações corrigida, sem vazamento visual, dual-anchor intacto, sem creep,
sem contradição) não exigem mudança.

## 44.4 Final Status

**`APPROVED AS INPUT FOR CRITICAL USER JOURNEYS`**

Motivo: revisão adversarial independente confirmou que as 6 correções semânticas do amendment
(CLEAN, SATISFIED, naming de Subject/Fornecedor, GTR-01, Configurações como Utility Area, remoção
de vazamento visual) foram aplicadas corretamente, com 1 achado real menor (célula C4 sem a mesma
ressalva de C3) corrigido antes de fechar. Nenhuma das 11 invariantes do §25 do prompt-fonte foi
violada: dual-anchor, separação Vencimento×Fornecedor/Requisito, distinção Documento×Documento
recebido, Overview transversal, Solicitações como global condicionada, Importação como
ação/ferramenta, guest experience separada, Internal Operator separado de RBAC, e os 3 blockers
técnicos — todos preservados sem reabertura. Nenhum status induz mais certeza do que o domínio
sustenta (regra nova, §44). Pronto para a próxima etapa (Critical User Journeys).

*(Status anterior a este amendment semântico, preservado para histórico: `APPROVED AS INPUT FOR
CRITICAL USER JOURNEYS`, via a rodada A/B/C/D estrutural registrada em §41-42.)*

**Status anterior (antes deste amendment semântico): `APPROVED AS INPUT FOR CRITICAL USER JOURNEYS`**

Motivo: revisão adversarial independente (Codex, código real verificado) encontrou 5 furos reais
(2 factuais — citação incorreta de `linkedDocumentId`, inferência forte demais sobre M7;
1 inconsistência interna — Alerta aparecendo como configuração global; 1 product creep —
`TenantEntitlement` sem tarefa real; 1 gap confirmado — Guest IA sem "quem está pedindo"), todos
corrigidos, mais um ajuste de consistência editorial (§27) na Rodada D. Nenhum furo estrutural na
Information Architecture recomendada (Candidato A, dual-anchor Vencimentos/Fornecedores) — o
Codex confirmou explicitamente que ela "se sustenta" e "não precisa de reformulação estrutural".
Os 3 blockers técnicos (BLOCKER-A/B/C) permanecem explícitos em toda seção relevante, nunca
mascarados; a decisão de coleta externa (§37) permanece registrada como decision brief, não
decidida. Pronto para a próxima etapa (Critical User Journeys), carregando os blockers, as 4 Open
Questions herdadas e as 5 novas (§39) como constraints de entrada.

---

## Engineering Enablement Matrix

| Technical dependency | Status | UI outcomes blocked | Required before | Recommended priority |
|---|---|---|---|---|
| D-053/D-054 Full BFF | Aprovado, zero código | Todos os outcomes autenticados | Qualquer frontend real | 1 |
| Document read/list API | Não iniciado | OUTCOME-002, 004 | Detalhe de vencimento mostrar documento | 2 (ordem entre 2/3 é HYPOTHESIS, §36) |
| Reminder materialization fix | Não iniciado | OUTCOME-003 | Qualquer UI de alerta ser apresentada como funcional | 2 |
| External collection decision + fix | Decisão pendente (Marcelo) | OUTCOME-006 | Coleta externa ser representada como completa | 3 (decisão é imediata; implementação depende da alternativa) |
| Query tenant-wide de solicitações | Não iniciado | Área "Solicitações" como view global | Solicitações sair de contextual-only | 4 |
| **GTR-01 — identidade do requisitante no guest flow** (amendment) | Não iniciado | OUTCOME-005 (UX trust, não o outcome técnico) | Tráfego guest real de produção | 4 |

---

*Documento produzido a partir da leitura integral do Context/Task Model já aprovado, sem refazer
a auditoria de código original — apenas verificações pontuais de enum/schema para a seção de
Status Vocabulary (§13). Pesquisa de mercado reaproveitada de `02-market-research.md`, não
repetida.*
