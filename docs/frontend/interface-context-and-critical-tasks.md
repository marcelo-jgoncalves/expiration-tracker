---
status: APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE (Claude↔Codex, 2 rodadas — auditoria original §37-38 + amendment metodológico §39-40)
owner: Marcelo
authority: insumo para Conceptual Model + Information Architecture (próxima etapa) — não normativo de arquitetura de sistema
---

# Expiration Tracker — Context of Use, User Roles, Jobs to Be Done e Inventário de Tarefas Críticas

Primeira etapa formal do planejamento de interface. Não contém wireframes, navegação final, dashboard,
paleta ou stack de frontend — só o modelo de contexto/tarefas que vai alimentar a próxima etapa
(Conceptual Model + Information Architecture).

Disciplina de evidência usada em todo o documento (§42-43 do prompt-fonte):
`FACT` (verificado em código/schema/infra, com citação) · `STRONG INFERENCE` (decorre diretamente
de um FACT) · `HYPOTHESIS` (produto ainda não tem dado real) · `OPEN QUESTION` (não resolvível sem
decisão do Marcelo). Toda linha relevante indica `SOURCE: code | requirement | ADR | roadmap |
business inference | UX inference`.

### Modelo de três eixos (amendment metodológico — ver §41-44)

Este documento passou por uma rodada de correção metodológica depois da reconciliação original
(§37-38): a versão anterior misturava, em alguns pontos, **quanto uma tarefa importa para o
usuário** com **quão pronto o backend está para sustentá-la**. Isso é separado agora em três eixos
independentes, aplicados a toda tarefa/outcome relevante do documento:

```
Task Criticality      — T0/T1/T2/T3, com base SÓ em impacto sobre o objetivo do usuário,
                         consequência de execução incorreta, importância para a proposta de
                         valor, frequência e dependência de outras tarefas. NUNCA contaminado
                         por bug ou lacuna de implementação.

Implementation Readiness — estado técnico atual, independente da criticidade:
  READY    — o backend oferece o contrato necessário para a tarefa ser exposta corretamente.
  PARTIAL  — parcialmente suportada; limitações reais, mas não impedem a experiência por completo.
  BLOCKED  — pertence ao produto/interface pretendida, mas a implementação atual não sustenta a
             promessa de forma correta ou segura.
  FUTURE   — ainda não pertence ao horizonte atual de implementação.

Planning Horizon      — NOW/NEXT/LATER, sobre QUANDO a experiência deveria existir
                         conceitualmente — independente de estar pronta hoje.
```

Teste de contaminação usado em toda reclassificação abaixo: *"se todos os bugs técnicos fossem
corrigidos amanhã, essa tarefa continuaria tendo a mesma importância para o objetivo do
usuário?"* — se não, a classificação de criticidade anterior estava contaminada pelo estado da
implementação, e foi corrigida.

**Regra para funcionalidade `BLOCKED`** (aplicada em todo o documento, especialmente §33 e §13):
uma tarefa `BLOCKED` nunca deve ser apresentada pela interface como operacional com um mero aviso
("lembrete salvo — mas talvez não dispare"). Se a promessa central não pode ser cumprida, a
funcionalidade não deve ser apresentada como disponível — o blocker técnico precisa ser resolvido
antes, não mascarado por copy defensivo.

**Outcome vs. Supporting Operation**: onde aumenta clareza (principalmente no inventário T0, §13),
o documento agora distingue o **resultado que não pode falhar** (`User Outcome` — o que a
arquitetura de informação futura deve tratar como estável) das **operações técnicas atuais** que o
sustentam (`Supporting Operations` — podem mudar de mecanismo sem mudar o outcome). Isso evita
acoplar o modelo conceitual da interface a um mecanismo de backend específico.

**Três blockers técnicos, citados por ID em todo o documento** (não resolvidos nesta rodada — são
constraints reais de implementação, registradas para não distorcer o modelo conceitual):

| ID | Blocker | Consequência para a interface |
|---|---|---|
| **BLOCKER-A** | Sem leitura/listagem de `Document`/`DocumentSubmission` | Impossível construir uma experiência persistente de "documento atual"; impossível reabrir um item e verificar o que foi recebido/processado |
| **BLOCKER-B** | Materialização normal de `ReminderOccurrence` não conectada | Não é aceitável a interface prometer que o usuário será avisado antes do vencimento enquanto isso não for corrigido |
| **BLOCKER-C** | Ciclo `DocumentRequest → DocumentSubmission → RequirementAssignment` não fecha sozinho | A interface não pode representar a coleta externa como automática/completa enquanto a decisão de produto/backend não for resolvida |

---

## 1. Executive Summary

- O produto hoje é **single-owner de fato**: `tenantId = userId` (`identity-mapping-repository.ts:36`,
  `resolve-request-context.ts:47-48`), e todo usuário novo recebe sempre `roles: ["OWNER"]`
  (`resolve-request-context.ts:57-64`). `MEMBER`/`VIEWER` existem na matriz de autorização mas
  **nenhum código atribui esses papéis a ninguém** — são papéis "mortos" até `Organization`/
  `Membership` (M13) existir. **FACT.**
- Existe um segundo tipo de ator, totalmente real e já implementado: o **participante externo
  (guest)** que recebe um link de convite e faz upload sem conta. **FACT**, ponta a ponta.
- **Três achados desta auditoria (confirmados de forma independente por uma revisão adversarial
  do Codex — ver §37) mudam o que a primeira interface pode prometer, e precisam de confirmação
  do time antes de virarem requisito de tela:**
  1. **Rota de leitura de documentos não existe.** `infra/modules/api-gateway/main.tf:174-198`
     só registra `POST` (reservar upload) e `DELETE` — não há `GET` de documento nem lista de
     documentos de um item, em nenhum lugar do código. Um item pode ter múltiplos documentos
     coexistindo sem nenhum vínculo entre eles nem forma de consultá-los. **Isso bloqueia
     estruturalmente qualquer tela de detalhe de item que pretenda mostrar "o documento atual".**
     Confirmado pelo Codex — vale a qualificação de que `DocumentRequest` (o convite) tem `GET`
     normalmente; o que não existe é leitura do `Document` (o anexo em si) nem de
     `DocumentSubmission` (item 3 abaixo).
  2. **A materialização automática de lembretes não está conectada em produção — endurecido de
     suspeita para FATO confirmado por revisão independente (Codex).** Nenhuma classe/handler
     `OutboxPublisher` genérico existe em `src/` (só referenciado em comentários de `outbox.ts` e
     `dispatch-outbox-relay/relay.ts`); o relay real só processa registros com `destination`
     reconhecido e **pula silenciosamente** os demais (`relay.ts:54-58`). O único chamador real de
     `ReminderMaterializer.materialize()` fora de teste é o worker de reconciliação de DST
     (`reminder-reconciliation/reconciliation.ts:114`), que resolve só um caso de borda, nunca o
     caminho normal. **Correção factual apontada pelo Codex**: `createItem()` não grava outbox
     (só cria item + auditoria, `expiration-service.ts:75`); `updateItem()` só grava o evento
     quando `dueDate` muda (`expiration-service.ts:182`); `renewItem()` também grava
     (`expiration-service.ts:320`) — a versão anterior deste documento generalizava isso de forma
     imprecisa. **Recomendo verificar com quem implementou M3/M3.5 antes de desenhar qualquer
     tela ou cópia que prometa "você será lembrado automaticamente" — hoje, salvar uma política
     de lembrete não produz lembrete real.**
  3. **Achado novo, trazido pela revisão do Codex: a coleta externa (guest upload) também não
     fecha o ciclo sozinha.** `GuestSubmissionService.startSubmission()` só move o
     `DocumentRequest` para `SUBMITTED` (`guest-submission-service.ts:151`); a promoção para
     `CLEAN` (`advance-after-submission-evidence.ts:72`) só atualiza o `DocumentSubmission`, nunca
     o `RequirementAssignment` (que só chega a `SATISFIED` via `link` manual de um
     `ExpirationItem` já existente, `requirement-service.ts:148`) nem o `DocumentRequest` (que
     nunca chega a `COMPLETED` — enum morto, ver tabela de capacidades). E não existe nenhuma rota
     `GET` para o usuário interno sequer **ver** a submissão recebida. Ou seja: depois que o
     fornecedor envia o documento e ele passa no scan de segurança, **o usuário interno não tem
     hoje nenhuma forma, via API, de saber que chegou nem de completar o vínculo automaticamente**
     — precisaria descobrir por fora (abrindo o objeto no S3 diretamente) e então criar/vincular
     um item manualmente. O design original de M10 (`roadmap-evolution/04-domain-model-guest-upload.md:112`)
     previa uma cadeia `REQUESTED → SUBMITTED → UNDER_REVIEW → SATISFIED`; o código implementado
     não chega lá. Isso rebaixa "coleta externa" de "T1 simples" para uma tarefa com um elo
     realmente faltando — tratado como Open Question crítica junto das outras duas (§35).
- O produto tem hoje uma jornada B2B2C bem definida e diferenciada de mercado (guest upload +
  automated chasing), confirmada como padrão real por 3 concorrentes independentes (SubCompliant,
  VendorJot, TrustLayer — `docs/architecture/roadmap-evolution/02-market-research.md`), não uma
  hipótese de produto.
- Não existe workflow de aprovação humana de documento recebido — a única decisão automática é
  segurança (malware/formato); a única ação humana é vincular manualmente um `ExpirationItem` já
  existente a um requisito (`link`/`unlink`). Isso é MENOS trabalho manual do que um fluxo de
  aprovação clássico, mas também significa que a interface não pode assumir uma fila de "documentos
  aguardando revisão de conteúdo".
- Escala real esperada é modesta (`capacity-model.md:35`, ASSUMPTION): 8 itens por usuário ativo em
  todos os estágios, com skew de até 100× no maior tenant (≈800 itens no pior caso hoje modelado).
  Não há evidência real de que tabelas de milhares de linhas sejam um problema do dia 1.
- A superfície de autenticação do browser está em transição: o design "Full BFF" (D-053/D-054) está
  aprovado mas **zero código implementado** — a interface não tem hoje nenhuma rota de sessão
  utilizável por um SPA sem lidar com token diretamente.

---

## 2. Product State Relevant to UI

### 2.1 Tabela de capacidades

| Capability | Implementada | Parcial | Planejada | Não existe | Observação (SOURCE) |
|---|:---:|:---:|:---:|:---:|---|
| Cadastro de vencimento | ✅ | | | | `POST /items` (code) |
| Edição de vencimento | ✅ | | | | `PUT /items/{id}`, rota distinta de renovar (code) |
| Renovação | ✅ | | | | `POST /items/{id}/renew` — cria item **novo**, não edita (code) |
| Arquivamento | ✅ | | | | `POST /items/{id}/archive` (code) |
| Exclusão | ✅ | | | | soft-delete, `status=DELETED`, invisível a leituras (code) |
| Histórico/auditoria de item | | ✅ | | | gravado (append-only) mas **sem rota HTTP** que o exponha (code) |
| Upload de documento | ✅ | | | | reserve + PUT direto ao S3, confirmação 100% automática (code) |
| **Leitura/listagem de documento** | | | | ✅ | nenhuma rota `GET` existe — achado crítico (code) |
| Malware scanning | ✅ | | | | automático, fail-closed em prod; **sem notificação ao usuário** (code) |
| Substituição de documento | | | | ✅ | não existe conceito de versão/substituição (code) |
| OCR/extração (M7) | | | ✅ | | design aprovado 9,2/9,3; zero código; kill switch default `false` (ADR) |
| Reminders — configurar política | ✅ | | | | CRUD real, `/reminders/policies*` (code) |
| **Reminders — disparo automático real** | | ⚠️ | | | **OPEN QUESTION crítica** — ver §1; pipeline de dispatch existe e é testado, mas o "gatilho" de criação de novas ocorrências parece desconectado (code) |
| Notificações — envio (e-mail) | ✅ | | | | SES real, templates versionados (code) |
| Notificações — WhatsApp | | | | ✅ | scaffolding puro, `SUPPORTED_CHANNELS = ["EMAIL"]` (code) |
| Notificações — histórico visível | | | | ✅ | domínio existe (`NotificationAttempt`), sem rota GET (code) |
| Notification preferences | ✅ | | | | só `emailEnabled`/`locale`/`quietHours` — sem escolha de canal (code) |
| Responsável (assignee) por item | | ✅ | | | campo string livre, sem validação contra usuário real (code) |
| Observar item de terceiro (watch) | ⚠️ | | | | capacidade técnica real (`GET /items/{id}/watchers`), mas **sem workflow real hoje** — achado do Codex: todo usuário é `OWNER` do próprio tenant single-owner, não há "terceiro" para observar até Membership existir (rebaixado de NOW) |
| "Meus itens observados" (view reversa) | | | | ✅ | sem query por usuário, só por item (code) |
| Subjects (fornecedor/pessoa/ativo) | ✅ | | | | M9, deployado em `main`/`dev` (`NEXT_SESSION_PROMPT.md`) — correção: a versão anterior deste documento afirmava incorretamente que ainda estava só em `develop` |
| Requirements — vínculo manual | ✅ | | | | só `MISSING↔SATISFIED`; demais estados do enum sem transição (code) |
| Requirements — fluxo de submissão/revisão | | ✅ | | | estados existem no schema, zero lógica (code) |
| Contato externo reutilizável | | | | ✅ | decisão explícita de não modelar — snapshot inline por solicitação (ADR) |
| Solicitação de documento (convite) | ✅ | | | | create/list/get/revoke (code) |
| **Fechamento automático do ciclo de coleta externa** (submissão aprovada → requirement satisfeito) | | | | ✅ | achado do Codex — sem transição automática `SUBMITTED→SATISFIED/COMPLETED`, sem rota para ver a submissão recebida (code) |
| Reenvio de solicitação | | | | ✅ | não existe método/rota (code) |
| "Todas as solicitações pendentes" (cross-subject) | | | | ✅ | só por assignment ou uma por vez (code) |
| Guest upload (fornecedor sem conta) | ✅ | | | | ponta a ponta, com mitigação anti-enumeração (code) |
| Aprovação/rejeição humana de submissão | | | | ✅ | só decisão automática de segurança (code) |
| Automated chasing (cobrança automática) | ✅ | | | | T7/T3/EXPIRED, e-mail apenas (code) |
| Import (CSV) | ✅ | | | | reserve/parse/commit real (code) |
| Import — erros por linha visíveis ao usuário | | ⚠️ | | | plano existe só em S3, sem rota que exponha por linha (code) |
| Export (CSV) | | | | ✅ | não existe, apesar do nome da decisão D-042 (code) |
| Organization/Membership/RBAC | | | ✅ | | design fechado; gatilho = primeira venda B2B real (`evolution.md:13`) |
| Billing real (cobrança) | | | | ✅ | bloqueado por decisão de produto, D-052 (ADR) |
| Sessão de browser utilizável por SPA (Full BFF) | | | ✅ | | D-053/D-054 aprovados, zero código (ADR) |
| Multi-tenant (um usuário, vários workspaces) | | | | ✅ | estrutural — `tenantId=userId` hoje (code) |

### 2.2 Rotas HTTP reais hoje (autenticadas, exceto `/guest/*`)

```
items:        POST /items · GET /items/dashboard · GET/PUT/DELETE /items/{id}
              POST /items/{id}/archive · POST /items/{id}/renew
              POST/DELETE /items/{id}/watchers/{userId} · GET /items/{id}/watchers
documents:    POST /items/{id}/documents · DELETE /items/{id}/documents/{docId}
reminders:    POST/GET/PUT /reminders/policies[/{id}] · POST .../disable
notifications: GET/PUT /notifications/preferences
subjects:     POST /subjects · GET /subjects/dashboard · GET/PUT/DELETE /subjects/{id}
              POST /subjects/{id}/archive
              POST/GET /subjects/{id}/requirements · GET/PUT/DELETE .../{assignmentId}
              POST .../link · POST .../unlink
              POST/GET .../document-requests · GET .../document-requests/{id} · POST .../revoke
              GET/PUT /subjects/document-request-delivery-preference
guest:        GET /guest/document-requests/{token} · POST /guest/document-requests/{token}/uploads (sem auth)
imports:      POST /imports · GET /imports/{id} · POST /imports/{id}/commit
```

`SOURCE: code — infra/modules/api-gateway/main.tf`.

---

## 3. UI Planning Horizon

**Correção metodológica (achado da revisão adversarial focada no amendment)**: a formulação
anterior desta tabela descrevia outcomes `BLOCKED` como "deve ser suportado... com aviso
explícito", reintroduzindo exatamente o anti-padrão que a regra do topo do documento proíbe
(mascarar funcionalidade quebrada com um warning de UI). Corrigido para listar em `NOW` só o que é
`READY`/`PARTIAL`; outcomes que pertencem conceitualmente a `NOW` mas estão `BLOCKED` ficam
registrados em §33 (`MUST SUPPORT — BLOCKED BEFORE RELEASE`), nunca aqui como se fossem entregáveis
com ressalva.

| Horizonte | Capacidades |
|---|---|
| **NOW — READY/PARTIAL** (deve ser suportado pela primeira interface) | Items CRUD+renovar+arquivar (`PARTIAL` na continuidade documental); upload de documento como operação (`READY`); reminders CRUD como operação de configuração (`READY` — não confundir com o outcome "ser avisado", que é `BLOCKED`, ver §33); notification preferences; subjects+requirements CRUD e link/unlink; document requests como operações de criar/ver/revogar (`READY` — não confundir com o outcome "obter documentação de terceiros", que é `BLOCKED`, ver §33); guest upload (tela separada, sem autenticação); CSV import |
| **NOW — conceitualmente NOW, mas `BLOCKED` (ver §33 para a lista completa e os 3 blockers)** | Manter evidência documental acessível (BLOCKER-A); ser avisado antes do vencimento (BLOCKER-B); obter documentação de terceiros sem cobrança manual (BLOCKER-C) |
| **NEXT** (já influencia decisões estruturais) | Full BFF (pré-requisito técnico — sem ele a SPA não tem sessão utilizável); resolução dos 3 blockers acima; resend de document request; histórico de notificações; extração/OCR (M7, design fechado) |
| **LATER** (existe no roadmap, não deve complicar a primeira interface) | Organization/Membership/RBAC (gatilho comercial não disparado); Billing real; WhatsApp; CSV Export; External Contact reutilizável; aprovação/rejeição humana formal de submissão; digest de notificação (sem evidência de mercado a favor ou contra); "observar item de terceiro" (capacidade técnica sem workflow real até Membership existir) |

---

## 4. Context of Use

### 4.1 Ambientes/situações (`SOURCE: business inference` a partir de FACTs de código)

- **Desktop, uso administrativo recorrente** — produto B2B de compliance operacional; nenhuma
  exigência de mobile-first (mesmo raciocínio já registrado no documento de qualidade de
  frontend). `HYPOTHESIS`.
- **Sessão longa de revisão** (ex. início do dia, fim de mês) vs. **ação pontual disparada por
  e-mail** (clicar num lembrete e agir num item específico) — dois padrões de entrada bem
  diferentes. `HYPOTHESIS`, mas coerente com o modelo de dados (reminders levam a um item
  específico, não a uma lista).
- **Fornecedor externo em dispositivo desconhecido** (pode ser mobile, pode ser um scanner de
  celular fotografando um documento) — o guest upload aceita `image/jpeg`/`image/png` além de PDF
  (`schemas/api/reserve-document-upload-request.v1.json` reaproveitado), o que é `STRONG
  INFERENCE` de que o caso de uso inclui foto de celular, não só PDF de escritório.

### 4.2 Cenários concretos suportados hoje pelo produto (verificados, não hipotéticos)

| Cenário | Trigger | Actor | Suportado hoje? |
|---|---|---|---|
| Revisão matinal | login | Owner | Parcial — dashboard existe (`GET /items/dashboard`) mas sem paginação/ordenação aplicada pela API hoje |
| Lembrete reativo | e-mail de reminder (se o pipeline estiver de fato disparando — ver Open Question) | Owner | `OPEN QUESTION` sobre o disparo real |
| Documento recebido externamente | e-mail/WhatsApp fora do sistema | Owner | Sim, upload manual — mas sem como ver depois (gap crítico) |
| Coleta externa | Owner cria `DocumentRequest` | Owner → Fornecedor | Sim, ponta a ponta |
| Auditoria/investigação | necessidade de saber "quem mudou o quê" | Owner/gestor | `AuditEvent` existe mas **sem rota HTTP** — não suportado via interface hoje |

---

## 5. User Roles

Papéis funcionais derivados do código real, não hipóteses demográficas.

### Role: Internal Operator (papel conceitual)
`SOURCE: code`. **Correção metodológica (amendment)**: a versão anterior nomeava este papel
"Account Owner", confundindo o papel funcional (o que a pessoa FAZ) com `OWNER`, que é uma
**authorization role** técnica, não um conceito de UX. Separando os dois:

```
Conceptual role (UX):        Internal Operator
Current technical RBAC role: OWNER (única role atribuída a alguém hoje — resolve-request-context.ts:57-64)
```

Isso importa porque, quando `Organization`/`Membership` existir (M13), o MESMO papel funcional
("Internal Operator" — a pessoa que opera o dia a dia do compliance) poderá ser exercido tanto por
`OWNER` quanto por `MEMBER`, sem que o modelo mental da interface precise mudar — só a autorização
por trás muda. O modelo conceitual da interface deve ser desenhado em torno do papel funcional,
nunca da role RBAC.

```
Primary objective: garantir que nada sob sua responsabilidade vença sem ação, com o mínimo de
trabalho manual de acompanhamento.
Secondary objectives: reduzir dependência de e-mail/WhatsApp manual para cobrar terceiros;
manter um registro auditável de documentos e vencimentos.
Responsibilities: cadastrar/editar/renovar vencimentos; fazer upload de documentos; configurar
lembretes; solicitar documentos a fornecedores externos; vincular documentos recebidos a
requisitos; importar dados em massa; configurar preferências de notificação.
Information needed: o que está vencido/vencendo; quem/o quê está pendente de resposta externa;
status de processamento (upload/malware/import); histórico de mudanças (hoje inacessível via UI).
Actions performed: create/edit/renew/archive/delete item; upload; create/revoke document request;
link/unlink requirement; import CSV; configure reminder policy; configure notification prefs.
Frequency: diária a semanal (monitoramento) + event-driven (ação sobre um vencimento específico).
Criticality: alta — é o único operador humano do sistema hoje.
Technical sophistication: variável — HYPOTHESIS (sem dado real de usuário).
Typical environment: desktop, jornada de trabalho administrativa.
Main risks: perder um vencimento por falta de visibilidade; achar que um lembrete foi configurado
e ele nunca disparar de fato (ver Open Question §1); não notar que um documento nunca terminou de
processar (sem notificação de conclusão de scan).
```

### Role: Collaborator (Member) — NEXT, não existe hoje
`SOURCE: code (matriz de autorização) + roadmap`. `HYPOTHESIS`/`OPEN QUESTION`: papel `MEMBER`
existe na matriz (`WRITE_ROLES`) mas nenhum código atribui esse papel a ninguém hoje — só passa a
existir de fato quando `Organization`/`Membership` (M13) for implementado, gatilhado por venda B2B
real. Presumível (não confirmado): faria a mesma operação que o Owner, exceto ações `ADMIN_ROLES`
(hoje só OWNER: `notification:configure`, `tenant:configure-document-request-delivery`,
possivelmente convite de novo membro quando existir).

### Role: Viewer — NEXT, não existe hoje
Mesmo status do Collaborator — só leitura, existe na matriz sem nenhum caminho de atribuição real.

### Role: External Submitter (papel conceitual — renomeado de "External Supplier/Contact")
`SOURCE: code`, ponta a ponta implementado. **Correção metodológica (amendment)**: "Supplier"
nomeava o cenário dominante, não o papel conceitual em si. O mecanismo (token opaco, sem conta,
upload contra um pedido específico) não tem nada de fornecedor-específico — serve igualmente a
funcionário, contador, corretor, cliente ou qualquer terceiro que precise enviar um documento sem
criar conta. Mantendo isso explícito:

```
Conceptual role (UX):    External Submitter
Current primary scenario: fornecedor/prestador externo (guest document upload via DocumentRequest)
```

Não há motivo para renomear o mecanismo técnico (`DocumentRequest`/guest token) nem para propor
suporte a outros cenários agora — só para não acoplar o nome do papel conceitual ao cenário
comercial de hoje, caso o produto expanda para outros tipos de terceiro sem exigir um segundo
mecanismo.

```
Primary objective: cumprir rapidamente um pedido de documento sem precisar criar conta.
Responsibilities: abrir o link recebido; enviar o arquivo solicitado.
Information needed: qual documento está sendo pedido (requirementName); prazo (deadline); tipos e
tamanho de arquivo aceitos.
Actions performed: GET das informações do pedido; upload do arquivo.
Frequency: event-driven, tipicamente única ação por link (token de uso não-exclusivo, mas fluxo
pensado para uma submissão).
Criticality: alta para o Owner (é o gargalo externo do processo), baixa fricção para o próprio
fornecedor (não precisa de conta).
Technical sophistication: desconhecida/variável — pode ser leigo. `HYPOTHESIS`.
Typical environment: qualquer dispositivo, possivelmente mobile (aceita foto JPEG/PNG).
Main risks: link expirado (14 dias ou deadline, o que vier primeiro) sem forma de reenvio
automático hoje (`resend` não existe — Owner precisa criar uma solicitação nova); confusão sobre o
que exatamente está sendo pedido se `requirementName` for pouco descritivo.
```

---

## 6. Internal vs External Actors

| | Internal Operator (RBAC hoje: `OWNER`; futuro: também `MEMBER`/`VIEWER`) | External Submitter (guest) |
|---|---|---|
| Possui conta/login | Sim (Cognito) | Não |
| Passa por `RequestContext`/`authorize()` | Sim | **Não** — validado só pelo token opaco (`guest-token.ts`) |
| Acesso a dados | Todo o tenant, conforme role RBAC | Só o `DocumentRequest` específico do token |
| Rota base | JWT authorizer, todas autenticadas | `/guest/*`, `authorization_type = NONE`, throttle mais restrito |
| Pode ser convidado permanentemente | Não existe hoje (sem Organization/Membership) | Sim, é o modelo já real (magic link) |

---

## 7. Jobs to Be Done

Por papel, `SOURCE: business inference` a partir de tarefas/rotas reais confirmadas.

**Owner — Awareness**
> Quando começo minha revisão do dia, quero saber o que está vencido ou vence em breve, para agir
> antes que vire um problema.

**Owner — Manutenção de registro**
> Quando renovo um contrato/certificado, quero atualizar a data rapidamente e manter o histórico
> do ciclo anterior, para nunca perder o rastro de quando algo mudou.
> `OPEN QUESTION`: como o usuário anexa o documento renovado ao ciclo novo, dado que não existe
> rota de leitura de documentos e a renovação cria um item novo sem copiar documentos do anterior
> (`expiration-service.ts:282-305` não menciona documentos)?

**Owner — Coleta externa**
> Quando um requisito de um fornecedor está em aberto, quero solicitar o documento por link sem
> precisar cobrar manualmente por e-mail, para reduzir o trabalho de acompanhamento.

**Owner — Importação em massa**
> Quando tenho uma planilha com vários fornecedores/ativos, quero importar de uma vez, para não
> cadastrar um por um.

**Owner — Configuração de alerta**
> Quando cadastro algo importante, quero garantir que serei avisado antes do vencimento, para
> nunca depender só da minha própria memória. `OPEN QUESTION` crítica: isso depende do pipeline
> de materialização estar de fato conectado (§1).

**External guest — Cumprimento de pedido**
> Quando recebo um link pedindo um documento, quero enviá-lo rapidamente sem precisar criar
> conta, para atender ao pedido sem fricção.

---

## 8. Complete Task Inventory

Derivado das rotas/domínio reais confirmados (não da lista de exemplo do prompt-fonte).

```
IDENTIFICAR o que precisa de atenção (dashboard por status)
VER vencidos / vencendo em breve / sem problema (cálculo do cliente a partir de dueDate — backend
  não persiste esse estado, ver §2)
BUSCAR/FILTRAR itens (backend suporta filtro por status via GSI1; busca textual não confirmada)
ABRIR detalhe de um item
CRIAR vencimento
EDITAR vencimento
RENOVAR vencimento (cria item novo)
ARQUIVAR vencimento
EXCLUIR vencimento (soft delete)
FAZER UPLOAD de documento
[GAP] VER/CONSULTAR documento(s) de um item — não suportado pelo backend hoje
CONFIGURAR política de lembrete (por item)
DESABILITAR política de lembrete
[OPEN QUESTION] VER lembretes já agendados/disparados de um item — sem rota
[SEM WORKFLOW REAL HOJE] OBSERVAR item de terceiro (watch) / deixar de observar — capacidade
  técnica existe, mas achado do Codex: sem "terceiro" real até Membership existir (single-owner)
CRIAR subject (fornecedor/pessoa/ativo/local)
EDITAR/ARQUIVAR subject
CRIAR requirement (requisito) para um subject
VINCULAR item existente a um requirement (marca SATISFIED)
DESVINCULAR item de um requirement
VER todos os requirements de um subject e seu status
CRIAR solicitação de documento (document request) para um requirement
VER status de uma solicitação específica
VER todas as solicitações de um requirement
REVOGAR solicitação
[GAP] REENVIAR solicitação — não existe
CONFIGURAR preferência de entrega de convite (manual vs. e-mail automático)
[GUEST] ABRIR link de solicitação
[GUEST] ENVIAR documento via link
IMPORTAR planilha CSV (reservar → aguardar parse → revisar contagens → commit)
[PARCIAL] VER erros específicos de linhas do import — só contagem agregada hoje
CONFIGURAR preferências de notificação (e-mail on/off, locale, quiet hours)
```

---

## 9. T0/T1/T2/T3 Classification

Critério: impacto sobre o objetivo do usuário, não complexidade técnica (§11 do prompt-fonte) —
**e, a partir deste amendment, também não estado atual de implementação** (esse é um eixo
separado, `Implementation Readiness`, coluna própria abaixo). Cada linha foi reavaliada pelo teste
"se o bug fosse corrigido amanhã, a importância mudaria?".

| Outcome/Tarefa | Criticality | Justificativa (só impacto no objetivo do usuário) | Implementation Readiness |
|---|---|---|---|
| Ser avisado do que está vencido/vencendo (identificar) | **T0** | falha = vencimento perdido, consequência de negócio real; verdadeiro independente de qualquer bug | **PARTIAL** — dashboard existe, mas API não aplica paginação/ordenação (`§4.2`) |
| Manter evidência documental de um vencimento atualizada e acessível | **T0** | consequência de não ter comprovação quando exigida é real e não depende de nenhum bug — é o motivo do produto existir | **BLOCKED** — BLOCKER-A (sem leitura/listagem) |
| Ser avisado antes do vencimento (não só "configurar a política") | **T0** | mesmo teste: mesmo se o pipeline funcionasse perfeitamente, esta continuaria sendo a promessa central mais crítica do produto | **BLOCKED** — BLOCKER-B |
| Renovar o ciclo de vencimento preservando o histórico | **T0** | erro aqui = item continua "vencido" para sempre ou histórico se perde; verdadeiro independente de bug | **PARTIAL** — a operação em si funciona (`POST .../renew`); a continuidade documental depende de BLOCKER-A |
| Obter documentação obrigatória de terceiros sem cobrança manual (coleta externa) | **T0** | consequência de um requisito externo não atendido é da mesma natureza que um vencimento perdido — compliance ausente sem que o usuário saiba. **Nota metodológica**: na Rodada de reconciliação anterior, esta tarefa foi elevada de T1 para T0 citando a falha silenciosa como motivo — isso estava parcialmente contaminado pelo bug (BLOCKER-C prova que existe um blocker, não que a tarefa é T0 por si só). Recriticado aqui usando só consequência/importância para a proposta de valor: **permanece T0**, porque a consequência de negócio (documentação de terceiro ausente) é estruturalmente equivalente a um vencimento perdido, com ou sem o bug | **BLOCKED** — BLOCKER-C |
| Vincular/desvincular requirement manualmente | T1 | decisão que afeta status de compliance de um subject, mas é uma operação de apoio, não o outcome em si | READY |
| Importar dados em massa (CSV) | T1 | ação de alto impacto mas pouco frequente (onboarding/lote) | READY (com PARTIAL em ver erros por linha — só contagem agregada) |
| Cumprir um pedido de documento sem criar conta (guest) | **T0** (do ponto de vista do External Submitter) | falha = processo trava, sem fallback automático; verdadeiro independente de bug | READY (a ação do próprio submitter funciona; o que está BLOCKED é o que acontece depois, do lado do Owner — ver BLOCKER-C) |
| Configurar preferências de notificação | T2 | importante, mas não bloqueia o valor central | READY |
| Ver requisitos de um subject | T2 | apoio à decisão, não a decisão em si | READY (lista crua, sem resumo agregado) |
| Editar campos administrativos (tags, notes) | T3 | manutenção, baixo impacto se adiado | READY |
| Configurar preferência de entrega de convite | T3 | configuração pontual, raramente revisitada | READY |

---

## 10. Frequency Classification

| Tarefa | Frequência |
|---|---|
| Ver dashboard / identificar pendências | many times per day / daily |
| Fazer upload de documento | event-driven |
| Renovar vencimento | event-driven (ligado ao ciclo do próprio vencimento, ex. anual) |
| Criar item | weekly a monthly (fora de onboarding) |
| Solicitar documento externo | event-driven / weekly |
| Importar CSV | occasional (onboarding, migração de planilha) |
| Configurar notificação/entrega | rare |

---

## 11. UI Priority Matrix (Criticidade × Frequência × Readiness)

`UI Priority` reflete só Criticidade × Frequência (a mesma lógica de sempre — o quão em destaque
a tarefa deveria estar SE estivesse pronta). `Implementation Readiness` é um eixo deliberadamente
separado (amendment): uma tarefa pode ser **P0 e BLOCKED ao mesmo tempo** — isso não é uma
contradição, é exatamente o caso que este documento precisa deixar explícito para a próxima etapa
não desenhar em torno de uma promessa que o backend ainda não sustenta.

| Outcome/Tarefa | Criticidade | Frequência | UI Priority | Implementation Readiness |
|---|---|---|---|---|
| Ver vencidos/vencendo | T0 | diária | **P0** | PARTIAL |
| Manter evidência documental acessível | T0 | event-driven | **P0** | **BLOCKED** (BLOCKER-A) |
| Ser avisado antes do vencimento | T0 | event-driven/onboarding | **P0** | **BLOCKED** (BLOCKER-B) |
| Renovar vencimento | T0 | event-driven | **P0** | PARTIAL |
| Guest: cumprir pedido de documento | T0 (submitter) | event-driven | **P0** | READY |
| Obter documentação de terceiros (coleta externa) | T0 | semanal | **P0** | **BLOCKED** (BLOCKER-C) |
| Vincular/desvincular requirement | T1 | event-driven | P1 | READY |
| Importar CSV | T1 | ocasional | P1 | READY |
| Ver requisitos de um subject | T2 | semanal | P2 | READY |
| Preferências de notificação | T2 | rara | P2 | READY |
| Preferência de entrega de convite | T3 | rara | P3 | READY |

---

## 12. Awareness / Investigation / Action / Configuration

- **Awareness**: o que está vencido? o que vence em breve? o que está pendente de resposta
  externa? (dashboard, `GET /items/dashboard`, `GET .../document-requests`)
- **Investigation**: por que está vencido? quem é responsável (campo livre, ver §2)? qual o
  histórico (gap — sem rota)? qual o status de processamento de um upload/import?
- **Action**: criar, editar, renovar, arquivar, excluir, fazer upload, vincular/desvincular,
  solicitar, revogar, importar.
- **Configuration**: política de lembrete, preferências de notificação, preferência de entrega de
  convite.

---

## 13. Mission-Critical Task Inventory (T0)

Reformulado neste amendment em torno de **outcomes** (o resultado que não pode falhar), não do
mecanismo atual — com `Implementation Readiness` e `Known Blockers` como campos próprios,
separados da definição do outcome em si (§6-7 do prompt de amendment).

### OUTCOME-T0-01 — Ser avisado do que precisa de atenção (identificar vencidos/vencendo)
```
Actor: Internal Operator
User Outcome: saber o que precisa de ação sem revisar item por item
Why mission-critical: vencimento não percebido a tempo é o pior desfecho possível do produto —
  verdadeiro independentemente de qualquer estado de implementação
Supporting operations: GET /items/dashboard?status=ACTIVE; cálculo cliente de vencido/vencendo a
  partir de dueDate (backend não persiste esse estado)
Implementation Readiness: PARTIAL — a rota existe, mas não aplica paginação/ordenação por
  vencimento mesmo o backend suportando isso via GSI1 (`§4.2`)
Known blockers: nenhum blocker crítico — lacuna menor, não impede a experiência
Required feedback: contagem clara por urgência; nenhum "silêncio" quando há erro de rede (distinguir
  de lista vazia genuína)
Success definition: usuário identifica corretamente os itens que precisam de ação
Failure consequence: vencimento não percebido a tempo
```

### OUTCOME-T0-02 — Manter evidência documental de um vencimento atualizada e acessível
```
Actor: Internal Operator
User Outcome: ter, a qualquer momento, a prova documental correta associada ao vencimento certo
Why mission-critical: sem isso, o produto não cumpre sua proposta de valor central (compliance
  documentado) mesmo que o resto funcione perfeitamente — teste de contaminação: mesmo sem
  nenhum bug, isso continuaria T0
Supporting operations: fazer upload (reservar → PUT S3 → confirmação automática por evento);
  consultar documento(s) de um item; associar documento ao ciclo correto na renovação
Implementation Readiness: **BLOCKED — BLOCKER-A**. Upload em si funciona (reservar/enviar/
  confirmação automática), mas "consultar"/"ver o documento atual" não tem nenhuma rota — a
  outcome como um todo não pode ser entregue de forma correta, mesmo com o upload funcionando
Known blockers: BLOCKER-A (sem leitura/listagem de `Document`); ausência de notificação quando o
  scan de malware termina; `TIMEOUT` após ~10-25min sem evidência
Required feedback: estado atual do documento reconsultável a qualquer momento — hoje impossível
Success definition: usuário consegue, a qualquer momento, confirmar qual documento é o vigente
Failure consequence: usuário acredita ter documentação em dia sem nunca ter confirmação real
```

### OUTCOME-T0-03 — Ser avisado antes do vencimento (não "configurar uma política")
```
Actor: Internal Operator
User Outcome: nunca depender da própria memória para agir a tempo
Why mission-critical: é a promessa central do produto — teste de contaminação: mesmo com o
  pipeline 100% saudável, este outcome continuaria sendo o mais crítico do sistema; o outcome em
  si não muda de importância por causa do bug, só sua entregabilidade muda (ver Readiness)
Supporting operations: criar/editar/desabilitar `ReminderPolicy` (mecanismo atual — pode mudar sem
  alterar o outcome)
Implementation Readiness: **BLOCKED — BLOCKER-B**. A operação de salvar a política funciona
  (`PUT /reminders/policies`), mas isso é só a operação de apoio — o outcome real (ser avisado)
  não é sustentado hoje
Known blockers: BLOCKER-B (materialização de `ReminderOccurrence` desconectada da criação/edição
  normal de item — só o worker de reconciliação de DST chama o materializer)
Required feedback: confirmação de que a política foi salva é necessária mas **não suficiente** —
  não prova que o outcome (ser avisado) será cumprido
Success definition: usuário recebe o aviso no momento configurado
Failure consequence: falsa sensação de segurança — a regra do §"Regra para funcionalidade BLOCKED"
  (topo do documento) se aplica diretamente aqui: não apresentar como operacional até corrigir
```

### OUTCOME-T0-04 — Renovar o ciclo de vencimento preservando o histórico
```
Actor: Internal Operator
User Outcome: mover o vencimento para a nova data sem perder o rastro do ciclo anterior
Why mission-critical: erro aqui = item continua "vencido" para sempre ou histórico se perde —
  verdadeiro independente de bug
Supporting operations: POST /items/{id}/renew {newDueDate} (cria item novo, origem vira RENEWED,
  `renewedFromId` preserva a linhagem)
Implementation Readiness: PARTIAL — a operação central funciona e é OCC-safe; a continuidade
  documental entre ciclos depende de BLOCKER-A (não há como saber/mover qual documento pertence a
  qual ciclo)
Known blockers: BLOCKER-A (indireto — afeta a continuidade documental, não a operação de renovar
  em si)
Required information: qual documento pertence a qual ciclo — hoje invisível
Success definition: novo item ativo com a data correta, linhagem preservada
Failure consequence: perda de rastreabilidade do ciclo anterior, ou duplicidade de itens
```

### OUTCOME-T0-05 (External Submitter) — Cumprir um pedido de documento sem criar conta
```
Actor: External Submitter
User Outcome: atender ao pedido rapidamente, sem fricção de conta
Why mission-critical: falha = processo trava sem fallback automático — verdadeiro independente de
  bug do lado do Owner
Supporting operations: GET info do pedido (token) → POST upload → PUT no S3 pré-assinado
Implementation Readiness: READY (do ponto de vista do próprio submitter — o mecanismo funciona
  ponta a ponta); o que está BLOCKED é o que acontece DEPOIS, do lado do Owner (BLOCKER-C,
  outcome seguinte)
Known blockers: nenhum bloqueia a ação do submitter em si; expiração de link sem reenvio
  automático é uma lacuna menor (gap), não um blocker desta outcome
Required feedback: confirmação clara de recebimento
Success definition: `DocumentSubmission` chega a CLEAN
Failure consequence: processo trava sem fallback
```

### OUTCOME-T0-06 — Obter documentação obrigatória de terceiros sem cobrança manual (coleta externa)
```
Actor: Internal Operator
User Outcome: ver um requisito de compliance de um fornecedor resolvido sem precisar cobrar por
  e-mail manualmente
Why mission-critical: consequência de um requisito externo não atendido é estruturalmente
  equivalente a um vencimento perdido (documentação de compliance ausente sem que o usuário
  saiba) — teste de contaminação aplicado: mesmo sem o bug abaixo, esta é uma das duas jornadas
  centrais do produto (a outra é o vencimento em si), então permanece T0 por consequência de
  negócio, não pela falha silenciosa em si
Supporting operations: criar `DocumentRequest`; fornecedor envia via link; scan de segurança
  aprova `DocumentSubmission`; (esperado, não implementado) vínculo automático a
  `RequirementAssignment`
Implementation Readiness: **BLOCKED — BLOCKER-C**. Depois que o scan aprova a submissão, nada
  mais acontece automaticamente: `RequirementAssignment` continua `MISSING`, `DocumentRequest`
  nunca chega a `COMPLETED`, e não existe rota para o Internal Operator sequer ver a submissão
  recebida
Known blockers: BLOCKER-C (design original de M10 previa
  `REQUESTED→SUBMITTED→UNDER_REVIEW→SATISFIED`; código implementado não chega lá)
Required feedback: hoje, nenhum — esta é a falha silenciosa mais séria encontrada na auditoria,
  porque o Internal Operator pode acreditar que o processo "roda sozinho" quando precisa de ação
  manual que a interface não tem como sugerir
Success definition (real, hoje): impossível de alcançar via API sem intervenção fora do sistema
Failure consequence: exatamente a falsa sensação de segurança que o produto existe para evitar
```

---

## 14. Error and Exception Scenarios (por tarefa crítica)

| Cenário | Onde se aplica | Cobertura real hoje |
|---|---|---|
| API offline | todas | `AppError` taxonomy existe; UI precisa distinguir de "lista vazia" |
| Sessão expirada | todas (autenticadas) | depende do Full BFF (NEXT, não implementado) |
| Item alterado por outra pessoa (OCC) | edit/renew/archive/delete | `If-Match`/`expectedVersion` já exigido pelo backend — UI precisa expor conflito, não só erro genérico |
| Upload falhou | upload de documento | presigned URL expira em 10min; UI precisa de retry claro |
| Malware detectado | upload | `REJECTED`, sem notificação — UI precisaria polling ou nova consulta (bloqueada pelo gap de leitura) |
| OCR não encontrou data / encontrou errado | M7 (futuro) | design já prevê confirm/reject por campo — nada a fazer agora |
| Notification failed | envio de lembrete/e-mail | sem exposição ao usuário hoje (gap) |
| Link de fornecedor expirado | guest | sem reenvio automático — Owner precisa criar nova solicitação |
| Duplicate submit | criação de item, import | idempotência real no backend (`Idempotency-Key`) — UI deve usá-la, não score aqui |
| Network timeout | todas | mesma nota de API offline |

---

## 15. Decision Inventory

| Decisão do usuário | Informação necessária para decidir corretamente |
|---|---|
| O que exige minha atenção agora? | status + dueDate + (se existir) resultado de reminder |
| Devo renovar isso? | data atual, documento associado (gap), última renovação |
| Esse documento está correto? | preview do documento — **não existe rota de leitura**, hoje impossível sem sair do sistema |
| Preciso reenviar uma solicitação? | status da solicitação + prazo restante — hoje só via consulta manual, sem alerta proativo |
| Esse fornecedor está regular? | status agregado dos requirements do subject (rota existe, é lista crua, sem resumo) |
| Quem deve agir? | campo `assigneeUserId` — hoje texto livre, sem garantia de correspondência a um usuário real |

---

## 16. User Conceptual Objects (mapeamento técnico → usuário)

| Backend (FACT) | Conceito potencial ao usuário | Confirma? |
|---|---|---|
| `ExpirationItem` | Vencimento | Sim — é o átomo central do produto |
| `TrackedSubject` | Fornecedor / Pessoa / Ativo / Local (tipo genérico) | Sim, mas nome final depende de qual `type` domina o uso real |
| `RequirementAssignment` | Requisito / Documento obrigatório | Sim |
| `Document` | Documento (anexo de um vencimento) | Sim, mas hoje o usuário não consegue "ver" o conceito via UI (gap) |
| `DocumentSubmission` | Documento recebido de fornecedor | Tecnicamente distinto de `Document` no backend — usuário provavelmente não deveria perceber essa distinção |
| `DocumentRequest` | Solicitação / Convite | Sim |
| `NotificationIntent` | não precisa aparecer | Confirmado — puramente interno |
| `ReminderPolicy`/`ReminderOccurrence` | Alertas / Lembretes | Sim, mas ver Open Question sobre disparo real |
| `ItemWatch` | "Observar" / seguir um item | Tecnicamente sim, mas sem workflow real até Membership existir (achado Codex) |
| `TenantEntitlement` | Limite do plano / uso | Existe no backend mas **sem rota GET** — hoje não pode aparecer na UI mesmo que devesse |
| `IdentityMapping`/`DeviceSession` | não precisa aparecer | Internal only |
| `AuditEvent` | Histórico / Log de alterações | Existe no backend, **sem rota** — não pode virar UI ainda |

---

## 17. User-Facing / Supporting / Internal Concepts

- **USER-FACING**: Vencimento (`ExpirationItem`), Documento (`Document`, com a ressalva do gap),
  Fornecedor/Subject, Requisito, Solicitação, Alerta/Lembrete, Observador (watch).
- **SUPPORTING**: status de importação (contadores), preferências de notificação, preferência de
  entrega de convite.
- **INTERNAL ONLY**: `NotificationIntent`, `IdentityMapping`, `DeviceSession`, `OutboxRecord`,
  `GuestTokenPointer` (o usuário vê só "o link", nunca o token internamente).

---

## 18. Terminology Risks

| Termo técnico | Risco |
|---|---|
| `item` vs `documento` | Um item PODE ter zero, um ou vários documentos — nomear ambos de forma que não sugira 1:1 é importante, já que hoje não há nem forma de ver quantos existem |
| `subject` | Nome técnico genérico demais para usuário final — provavelmente precisa de tradução por vertical ("fornecedor", "colaborador", "ativo") dependendo do `type` |
| `requirement` vs `document request` | Um é o requisito abstrato (ex. "apólice de seguro"), o outro é o convite concreto enviado — risco real de confusão sem nomes bem diferenciados |
| `assignee` vs `watcher` | Dois conceitos de "pessoa ligada ao item" com semânticas bem diferentes (responsável vs. observador) — nomes precisam deixar isso óbvio |
| `renovar` vs `editar` | Tecnicamente duas operações muito diferentes (renovar cria item novo) — usuário provavelmente pensa nas duas como "atualizar a data", risco de expectativa errada sobre o que acontece com o histórico |

---

## 19. Critical Information Inventory

| Informação | Prioridade |
|---|---|
| Nome do item | Primary |
| Status / dias restantes | Primary |
| Data de vencimento | Primary |
| Responsável (texto livre) | Secondary |
| Fornecedor/Subject associado | Secondary |
| Documento associado (hoje inacessível — gap) | Secondary (deveria ser, tecnicamente impossível hoje) |
| Última renovação | Contextual |
| Alerta configurado (existe política?) | Contextual |
| Solicitação pendente relacionada | Contextual |
| Erro de processamento (upload/import) | Advanced (mas crítico quando ocorre) |

---

## 20. Scale Considerations

`SOURCE: capacity-model.md:35` (ASSUMPTION, não medição real) — 8 itens/usuário em todos os
estágios, skew de até 100× no maior tenant (≈800 itens no pior caso hoje modelado).

**Correção metodológica (amendment)**: a versão anterior mapeava contagem de registros
diretamente a componente de UI (ex. "500 itens → tabela"). Isso foi removido — quantidade de
registros sozinha não determina o componente correto; a decisão de componente pertence à fase de
screen design, não a este documento. Em vez de thresholds, a escala é descrita como uma entre
várias variáveis relevantes:

| Variável | Por que importa |
|---|---|
| Necessidade de comparação | ver §27 — comparar datas/status/fornecedores sugere estrutura tabular, mesmo em volume baixo |
| Densidade de atributos por item | quantos campos o usuário precisa ver simultaneamente por item |
| Frequência de scanning | tarefas `many times per day` (§10) toleram menos fricção visual que tarefas raras |
| Necessidade de ordenação | já suportada estruturalmente por status/data via GSI1 |
| Necessidade de filtragem | ver §29 — dimensões desejadas além de status ainda não confirmadas no backend |
| Ações por item | quantas ações (renovar/arquivar/upload/etc.) precisam estar acessíveis por linha |
| Frequência da tarefa | tarefas diárias (dashboard) têm requisitos de eficiência diferentes de tarefas ocasionais (import) |
| Escala (volume de registros) | uma variável a mais, não a determinante única |

Faixas de escala, mantidas como contexto (não como regra de componente):

- **Escala baixa** (dezenas de itens): pode permitir interfaces mais simples — mas se houver forte
  necessidade de comparação (§27), tabela ainda pode ser apropriada mesmo aqui.
- **Escala intermediária** (dezenas a poucas centenas — a faixa mais provável hoje, dado o pior
  caso modelado de ≈800): busca, filtros e ordenação ganham importância.
- **Escala alta** (muito acima do modelado hoje): paginação, virtualização, filtros eficientes e
  ações em lote podem passar a ser necessárias — `HYPOTHESIS`, já que não há dado que preveja esse
  patamar como caso comum.

A decisão real de componente fica para a fase de screen design, informada por todas as variáveis
acima, não só por volume.

---

## 21. First-use vs Recurring-use Context

- **First-use**: 0 itens, 0 subjects, 0 documentos. Objetivo provável: entender o produto rápido,
  criar o primeiro item OU importar uma planilha existente (CSV import já suporta isso desde o
  dia 1). `HYPOTHESIS` sobre qual caminho o usuário escolhe primeiro.
- **Established account**: dezenas a centenas de itens/subjects, algumas solicitações pendentes.
  Objetivo muda para escanear, priorizar, agir — típico de dashboard operacional.

---

## 22. Time to First Value (hipótese)

```
cadastro
  ↓
criar primeiro item OU importar planilha
  ↓
configurar lembrete (se o pipeline de disparo estiver de fato funcional — Open Question)
  ↓
produto passa a ter valor percebido de "estou coberto"
```
`HYPOTHESIS` — sem dado de usuário real. A alternativa "importar planilha → dashboard mostra
riscos" é plausível e tecnicamente já suportada (CSV import existe desde o dia 1), mas depende de
o usuário já ter uma planilha organizada — não confirmável sem teste real.

---

## 23. High-Repetition Tasks

`HIGH REPETITION`: ver dashboard/identificar pendências; fazer upload de documento; vincular/
desvincular requirement (potencialmente repetido por fornecedor); revisar status de solicitações
pendentes.

---

## 24. High-Consequence Tasks

`HIGH CONSEQUENCE`: excluir item; revogar solicitação (fornecedor perde acesso ao link
imediatamente); renovar com data errada (não há "desfazer" documentado); confirmar campo extraído
incorretamente (quando M7 existir).

---

## 25. Frequency × Consequence Matrix

| Tarefa | Frequência | Consequência | Implicação |
|---|---|---|---|
| Ver dashboard | alta | baixa (por evento isolado) | otimizar velocidade/clareza |
| Excluir item | baixa | alta | confirmação explícita, difícil de disparar por acidente |
| Upload de documento | média | alta (falha silenciosa) | design cuidadoso de feedback, não só velocidade |
| Renovar | média | alta | clareza sobre o que muda e o que não muda (histórico) |
| Configurar preferências | baixa | baixa | otimizar para não atrapalhar, não para velocidade |

---

## 26. Recognition vs Memorization Needs

A interface deve tornar visível, sem exigir memorização: quem é o responsável de um item (hoje
teria que aparecer sempre, já que é texto livre sem cadastro de usuários reais); qual fornecedor
está com pendência; qual documento pertence a qual ciclo de vencimento (bloqueado pelo gap de
leitura — motivo a mais para priorizar a correção); o que já foi solicitado e ainda não respondido.

---

## 27. Comparison Needs

Comparação relevante identificada: datas de vencimento entre itens (para priorizar); status entre
subjects/fornecedores (quem está regular vs. irregular); documentos de diferentes ciclos de um
mesmo item (bloqueado pelo gap). Sinal de necessidade futura de tabela com ordenação/alinhamento
consistente — sem decidir componente aqui.

---

## 28. Search Needs

Prováveis termos de busca (`HYPOTHESIS`, sem dado real): nome do item; nome do fornecedor/subject;
tag; responsável (texto livre, então busca por substring, não por ID). Backend hoje não confirma
busca textual — só filtro por status via GSI1.

---

## 29. Filter Needs

Dimensões suportadas estruturalmente hoje: status (`GSI1`). Dimensões desejáveis sem suporte
confirmado no backend: por responsável, por subject, por tag, por "tem solicitação pendente".
Não propor 20 filtros — priorizar status (já suportado) e avaliar os demais conforme uso real.

---

## 30. Bulk-operation Needs

| Operação | Horizonte |
|---|---|
| Importar em massa (CSV) | **NOW** — já implementado |
| Exportar em massa (CSV) | LATER — não existe no backend |
| Arquivar vários itens de uma vez | **Removido do horizonte NEXT (achado do Codex: product creep)** — nenhuma base em código nem em roadmap aprovado; se reconsiderado, registrar como `HYPOTHESIS` explícita, não como "extensão natural" |
| Solicitar documento para vários subjects de uma vez | LATER — não existe, e o mercado (SubCompliant) sugere pedidos individuais, não bulk |

---

## 31. Dashboard Information Questions (não layout)

- O que está vencido?
- O que vence nos próximos N dias?
- Quais solicitações de documento estão pendentes/expirando?
- Algum import recente teve erros?
- Existe algum documento preso em processamento (`SCANNING`) por tempo anormal? (hoje sem rota
  para responder isso — dependeria do gap de leitura ser fechado)

---

## 32. Candidate Information Areas (hipóteses, não menu)

```
vencimentos
fornecedores/subjects
solicitações
import
configurações (lembretes, notificações, preferências de entrega)
```
Hipóteses a validar na próxima etapa (Information Architecture) — não uma decisão de navegação.

---

## 33. Initial UI Scope

**Correção metodológica (amendment)**: a versão anterior listava capacidades diretamente em
MUST/SHOULD/LATER, sem separar o que já está pronto do que pertence conceitualmente ao primeiro
release mas ainda não pode ser entregue com segurança. Isso mascarava outcomes T0 `BLOCKED` como
se fossem equivalentes a outcomes T0 `READY` — exatamente o tipo de mistura que este amendment
existe para eliminar.

### MUST SUPPORT — READY
Dashboard de vencimentos (com o `PARTIAL` de paginação/ordenação registrado); CRUD de item +
arquivar/excluir; operação de renovar (`PARTIAL` na continuidade documental); operação de upload
de documento (`READY` como operação, ainda que o outcome maior dependa de BLOCKER-A); CRUD de
subject + requirement + link/unlink manual; criar/ver/revogar document request como operações
(`READY`); tela de guest upload (não autenticada, `READY`); import CSV (reserve + status).

### MUST SUPPORT — BLOCKED BEFORE RELEASE
Estes outcomes pertencem conceitualmente à primeira experiência (são T0, P0), mas **não devem ser
apresentados como operacionais até o blocker técnico correspondente ser resolvido** (regra do topo
do documento — nunca mascarar por warning de UI):

| Outcome | Blocker | O que precisa acontecer antes do release |
|---|---|---|
| Manter evidência documental acessível | BLOCKER-A | rota de leitura/listagem de `Document` |
| Ser avisado antes do vencimento | BLOCKER-B | materialização de `ReminderOccurrence` conectada ao caminho normal |
| Obter documentação de terceiros (coleta externa) | BLOCKER-C | fechamento do ciclo `DocumentRequest→DocumentSubmission→RequirementAssignment` (decisão de produto: automático vs. revisão humana) |

### SHOULD SUPPORT
Notification preferences (`READY`).

### LATER
Tudo classificado como NÃO EXISTE/LATER na tabela de capacidades (Organization/RBAC, Billing,
WhatsApp, Export, External Contact, aprovação humana formal, resend de document request,
"observar item de terceiro" — sem workflow real até Membership existir, ver §5/§9).

**Pré-requisito bloqueante, fora do escopo de UI em si**: Full BFF (D-053/D-054) precisa existir
antes de qualquer SPA real ter uma sessão de browser utilizável — hoje a única forma de chamar as
rotas é `Authorization: Bearer` direto.

**Recomendação forte antes de iniciar wireframes**: resolver os três blockers técnicos (BLOCKER-A/
B/C) — todos bloqueiam outcomes T0/P0, não tarefas secundárias.

---

## 34. Assumptions

- 8 itens/usuário é representativo do caso comum (`capacity-model.md`, ASSUMPTION original, não
  medição).
- Usuário típico é administrativo, não técnico (`HYPOTHESIS`).
- Documento por item tende a ser 1 "documento vigente" na prática, mesmo sem o backend impor isso
  (`HYPOTHESIS` — o backend permite N documentos por item sem relação entre eles).

## 35. Open Questions

1. ~~O pipeline de materialização automática de `ReminderOccurrence` está de fato conectado em
   produção?~~ **Resolvida na reconciliação — não está, confirmado por revisão independente do
   Codex (§1, item 2).** Deixa de ser pergunta e vira item de correção de backend a decidir
   quando priorizar, não mais incerteza.
2. **Como a interface deveria representar "o documento atual de um item"** dado que o backend não
   tem conceito de versão/substituição nem rota de leitura? Precisa de decisão de produto antes
   de UI (ou de uma pequena extensão de backend).
3. **Nova, trazida pela reconciliação (achado do Codex)**: o ciclo de coleta externa
   (`DocumentRequest`→`DocumentSubmission`→`RequirementAssignment`) precisa de um passo de backend
   que hoje não existe (transição automática ou revisão humana explícita) antes de a interface
   poder prometer "solicitei e o sistema resolve sozinho". Decisão de produto: fechar
   automaticamente (fiel ao design original de M10) ou introduzir uma tela de revisão humana
   explícita (mais alinhado ao fato de já não haver aprovação de conteúdo em nenhum outro ponto)?
4. Qual `TrackedSubject.type` vai dominar o uso real (fornecedor? funcionário? ativo?) — afeta a
   terminologia final da interface.
5. Existe necessidade real de "reenviar" uma `DocumentRequest` antes do link expirar, ou criar uma
   nova solicitação é aceitável? (mercado — SubCompliant renova automaticamente; este produto não
   tem isso ainda.)

## 36. Rejected Assumptions

- **"O usuário vai querer aprovar/rejeitar cada documento recebido de fornecedor"** — rejeitado:
  o backend não modela isso, e a decisão de design (M10) foi deliberadamente automática por
  segurança, com vínculo humano só no nível de requirement (link/unlink), não de submissão
  individual. Propor uma fila de aprovação na UI inventaria um conceito que não existe no domínio.
- **"Notificação por WhatsApp é esperada no MVP de UI"** — rejeitado por evidência de código
  (scaffolding puro) e por mercado (nenhum concorrente pesquisado vende WhatsApp como diferencial
  central, ainda que Remindax o ofereça).

---

## 37. Codex Review

Revisão adversarial independente (Codex, sandbox read-only, explorando o código diretamente, não
confiando no texto da Rodada A). Veredito geral: **a auditoria dos dois achados críticos originais
foi confirmada e endurecida de suspeita para fato**; o Codex também achou furos reais que mudam
conclusões de classificação e um erro factual pontual. Achados, todos incorporados nas seções
correspondentes:

1. **Furo real, o mais importante**: "coleta externa/guest upload ponta a ponta" estava
   superestimado — não existe transição automática de submissão aprovada para requisito
   satisfeito, nem rota para o usuário interno ver a submissão recebida. Rebaixa a confiabilidade
   da tarefa mais central de diferenciação do produto. **Aceito integralmente** — nova Open
   Question (§35.3), novo TASK-T0-06, `Solicitar documento a fornecedor` elevado de T1 para T0 em
   toda tabela relevante.
2. **Reminders**: confirmado como fato de código (não suspeita), com uma correção factual pontual
   — a Rodada A generalizava "criar/atualizar grava um evento outbox"; na realidade só
   `updateItem()` (quando `dueDate` muda) e `renewItem()` gravam, `createItem()` não. **Aceito e
   corrigido** (§1).
3. **Documento GET**: confirmado, com a qualificação de que `DocumentRequest` (o convite) tem
   `GET` normal — o que não existe é leitura de `Document` (anexo) e `DocumentSubmission`.
   **Aceito, qualificação incorporada** (§1, item 1).
4. **"Observar item de terceiro" como tarefa NOW real**: o Codex apontou que isso é capacidade
   técnica sem workflow real hoje, já que todo usuário é `OWNER` do próprio tenant single-owner —
   não há "terceiro" para observar até Membership existir. **Aceito** — rebaixado de NOW/T2/P2
   para LATER/P3 em toda tabela relevante.
5. **Fato desatualizado**: a Rodada A dizia que Subjects (M9) estavam "em `develop`, ainda não em
   `main`" — o estado vigente (`NEXT_SESSION_PROMPT.md`, já verificado extensamente nesta mesma
   sessão) é que M9-M11 estão deployados em `main`/`dev`. **Aceito e corrigido** — o Codex rodou
   uma checagem de `git log main..develop` que pode ter refletido um estado local desatualizado;
   o fato correto vem da fonte já verificada nesta sessão.
6. **Product creep pequeno**: "arquivar vários itens de uma vez" estava listado como NEXT/"extensão
   natural" sem nenhuma base em código ou roadmap aprovado. **Aceito e removido** do horizonte
   NEXT.

Nenhum papel foi considerado inventado, nenhuma mistura backend↔modelo mental foi encontrada, e
nenhuma tarefa esquecida além do item 1 acima.

## 38. Reconciliation

Todos os 6 achados do Codex foram aceitos e já incorporados nas seções correspondentes do
documento (não há divergência remanescente a arbitrar). O documento está pronto para servir de
insumo à próxima etapa (Conceptual Model + Information Architecture), com três avisos que devem
sobreviver a essa transição, não apenas a este documento: (1) o pipeline de materialização de
reminders precisa de correção de backend antes de qualquer cópia de UI prometer "lembrete
automático"; (2) o ciclo de coleta externa precisa de uma decisão de produto (fechamento
automático vs. revisão humana explícita) antes de a interface poder representá-lo como completo;
(3) a leitura/listagem de documentos precisa existir no backend antes de qualquer tela de detalhe
de item mostrar "o documento atual".

---

## Tabela consolidada de tarefas

| ID | Actor | Outcome/Task | JTBD | Type | Criticality | Frequency | Consequence | UI Priority | Horizon | Readiness |
|---|---|---|---|---|---|---|---|---|---|---|
| OUTCOME-001 | Internal Operator | Ser avisado do que precisa de atenção (identificar) | Awareness | Awareness | T0 | Daily | High | P0 | NOW | PARTIAL |
| OUTCOME-002 | Internal Operator | Manter evidência documental atualizada e acessível | Manutenção de registro | Outcome | T0 | Event-driven | High | P0 | NOW | **BLOCKED** (A) |
| OUTCOME-003 | Internal Operator | Ser avisado antes do vencimento | Configuração de alerta | Outcome | T0 | Event-driven | High | P0 | NOW | **BLOCKED** (B) |
| OUTCOME-004 | Internal Operator | Renovar vencimento preservando histórico | Manutenção de registro | Outcome | T0 | Event-driven | High | P0 | NOW | PARTIAL |
| OUTCOME-005 | External Submitter | Cumprir pedido de documento sem conta | Cumprimento de pedido | Action | T0 | Event-driven | High | P0 | NOW | READY |
| OUTCOME-006 | Internal Operator | Obter documentação de terceiros sem cobrança manual | Coleta externa | Outcome | T0 | Weekly | High | P0 | NOW | **BLOCKED** (C) |
| TASK-007 | Internal Operator | Vincular/desvincular requirement (operação de apoio) | Coleta externa | Action | T1 | Event-driven | Medium | P1 | NOW | READY |
| TASK-008 | Internal Operator | Importar CSV | Importação em massa | Action | T1 | Occasional | Medium | P1 | NOW | READY |
| TASK-009 | Internal Operator | Ver requisitos de um subject | Investigation | Investigation | T2 | Weekly | Low | P2 | NOW | READY |
| TASK-010 | Internal Operator | Configurar notification preferences | Configuration | Configuration | T2 | Rare | Low | P2 | NOW | READY |
| TASK-011 | Internal Operator | Observar item de terceiro | Awareness | Action | T2 | Occasional | Low | P3 | **LATER** (sem workflow real até Membership existir) | **FUTURE** (corrigido — achado da revisão focada: a API existe, mas sem um "terceiro" real o contrato não pode ser exposto corretamente como tarefa hoje; `READY` seria inconsistente com a própria definição de Readiness) |
| TASK-012 | Internal Operator | Configurar preferência de entrega | Configuration | Configuration | T3 | Rare | Low | P3 | NOW | READY |

`(A)/(B)/(C)` = BLOCKER-A/B/C, ver tabela de blockers no início do documento.

---

## Amendment — Interface Planning Model

Resumo do amendment metodológico aplicado nesta rodada (não uma nova análise de produto — os
fatos, gaps e a reconciliação anterior com o Codex, §37-38, permanecem intactos).

**Criticidade × Readiness**: as duas dimensões eram parcialmente misturadas na versão anterior
(um bug de backend inflava a nota de criticidade de uma tarefa). Agora são eixos independentes —
`Task Criticality` (T0-T3, só impacto no objetivo do usuário) e `Implementation Readiness`
(READY/PARTIAL/BLOCKED/FUTURE, só estado técnico atual), aplicados lado a lado em toda tabela
relevante (§9, §11, tabela consolidada).

**Outcomes × Operations**: o inventário de tarefas críticas (§13) foi reformulado em torno de
`User Outcome` (o resultado que não pode falhar — ex. "ser avisado antes do vencimento") em vez de
`Supporting Operation` (o mecanismo atual — ex. "configurar política de lembrete"). Isso desacopla
o modelo conceitual da interface do mecanismo de backend vigente.

**Alterações em T0**: nenhum outcome foi removido de T0. Um (coleta externa) teve sua justificativa
recriticada pelo teste de contaminação ("se o bug fosse corrigido amanhã, a importância mudaria?")
e permaneceu T0 por consequência de negócio genuína, não pela falha silenciosa em si — a
diferença é que agora isso está registrado como `Readiness: BLOCKED`, não embutido na nota de
criticidade.

**Alterações de roles**: "Account Owner/Operator" → **Internal Operator** (papel conceitual),
com `OWNER` registrado à parte como a role RBAC atual — preparado para quando `MEMBER` também
puder exercer o mesmo papel funcional. "External Supplier/Contact" → **External Submitter**
(papel conceitual), com "fornecedor/prestador" registrado como o cenário dominante atual, não o
conceito em si.

**Alteração da análise de escala**: thresholds determinísticos (`N registros → componente X`)
removidos. Substituídos por uma lista de variáveis (necessidade de comparação, densidade de
atributos, frequência de scanning, ordenação, filtragem, ações por item, frequência da tarefa,
escala) — a decisão de componente fica para a fase de screen design.

**Blockers preservados, agora citáveis por ID**: BLOCKER-A (leitura/listagem de documento),
BLOCKER-B (materialização de reminders), BLOCKER-C (fechamento do ciclo de coleta externa) — os
três continuam não resolvidos nesta rodada (fora de escopo, por design: esta é uma tarefa de
modelo de interface, não de implementação de backend), e agora aparecem como `Implementation
Readiness: BLOCKED` em vez de aviso textual disperso pelo documento.

**Preservado sem alteração**: Decision Inventory (§15), Technical→User Concept Mapping (§16),
User-Facing/Supporting/Internal Concepts (§17), Terminology Risks (§18), a reconciliação Codex
original (§37-38), disciplina FACT/HYPOTHESIS/OPEN QUESTION, e todas as citações de código.

---

## 39. Codex Review — Amendment Round

Revisão curta e focada (não repetiu a auditoria de código — tratou os 3 blockers como já
confirmados, conforme instruído), respondendo só às 4 perguntas sobre a metodologia do amendment:

1. **Mistura residual real, achada**: a antiga tabela do §3 (UI Planning Horizon) ainda dizia
   "reminders CRUD (com aviso explícito sobre disparo real)" e "document requests... (com aviso
   sobre o elo faltante)" — exatamente o anti-padrão que a regra do topo do documento proíbe
   (mascarar `BLOCKED` com aviso de UI em vez de separar em Readiness), inconsistente com a
   própria separação já feita em §33. Achado um segundo: `TASK-011` (observar item de terceiro)
   estava com `Horizon: LATER` mas `Readiness: READY` — inconsistente com a própria definição de
   `READY` ("backend oferece o contrato para a tarefa ser exposta corretamente"), já que sem um
   "terceiro" real a tarefa não pode ser exposta corretamente hoje.
2. **Não** — nenhum dos 6 outcomes T0 descreve mecanismo em vez de resultado; supporting
   operations aparecem corretamente separadas.
3. **Não** — nenhuma conclusão de componente de UI ficou baseada só em volume; §20 já lista as
   variáveis adicionais e §27 fundamenta a necessidade de tabela em comparação, não em contagem.
4. **Recriticação de OUTCOME-T0-06 confirmada como correta**: passa no teste de contaminação — se
   BLOCKER-C fosse corrigido amanhã, a tarefa continuaria central à proposta de valor, não viraria
   secundária. T0 mantido, não rebaixar para T1.

## 40. Reconciliation — Amendment Round

Os dois achados reais (item 1 acima) foram aceitos e corrigidos: (a) §3 reescrito para listar em
`NOW` só operações `READY`/`PARTIAL`, com os 3 outcomes `BLOCKED` movidos para uma linha própria
que aponta para §33 em vez de aparecerem como "suportados com aviso"; (b) `TASK-011` corrigido de
`Readiness: READY` para `Readiness: FUTURE`, coerente com a definição formal do estado. Nenhuma
outra divergência real de metodologia foi encontrada — as 3 confirmações (outcomes bem formados,
escala sem determinismo de volume, T0-06 corretamente recriticado) não exigem mudança.

---

## Status Final

**`APPROVED AS INPUT FOR CONCEPTUAL MODEL + INFORMATION ARCHITECTURE`**

Motivo: os quatro pontos do amendment metodológico (separação Criticidade/Readiness/Horizon,
Outcome vs. Operation, papéis conceituais vs. RBAC, escala sem determinismo de volume) foram
aplicados e verificados por revisão adversarial independente, que encontrou e corrigiu 2 furos
reais de mistura residual antes de aprovar. Os 3 blockers técnicos (BLOCKER-A/B/C) permanecem
explícitos, não mascarados, e não foram resolvidos nesta rodada por design (tarefa de modelo de
interface, não de implementação). Nenhum fato/gap da reconciliação original (§37-38) foi reaberto
sem evidência nova. Pronto para a próxima etapa (Conceptual Model + Information Architecture),
carregando os 3 blockers e as 5 Open Questions (§35) como constraints de entrada, não como
bloqueio ao início dessa etapa.

---

*Documento produzido por leitura direta do código/infra/schemas do repositório (4 investigações
paralelas dedicadas + verificação adicional do achado de materialização de reminders) — não a
partir de planos antigos ou do README isoladamente. Amendment metodológico (Criticidade ×
Readiness × Horizon, Outcome × Operation) aplicado numa segunda rodada, preservando a base
factual e a reconciliação Codex originais.*
