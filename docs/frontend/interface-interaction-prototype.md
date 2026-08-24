---
status: APPROVED AS INPUT FOR HEURISTIC + ACCESSIBILITY EVALUATION AND USER VALIDATION (Claude↔Codex, 2 rodadas — B e D; 6 furos reais de 4 causas raiz, todos corrigidos e verificados com testes automatizados de navegador)
owner: Marcelo
authority: insumo para Heuristic + Accessibility Evaluation e User Validation (próxima etapa) — não normativo de identidade visual
---

# Expiration Tracker — Interaction Prototype

Sexta etapa formal do planejamento de interface. Entrada primária, lida integralmente, não refeita:
`docs/frontend/interface-low-fidelity-wireframes.md` (`APPROVED AS INPUT FOR INTERACTION
PROTOTYPE`). As quatro etapas anteriores são consumidas por herança através dela e do
`interface-screen-and-state-inventory.md`, não relidas do zero.

O artefato executável vive em `prototype/` (repo root, deliberadamente fora de `src/` — ver
`prototype/README.md` para como rodar). **PROTOTYPE ONLY — não é arquitetura de frontend de
produção.**

---

## 0. Verificação de estado do repositório (checklist §2 da missão)

Antes de iniciar: `git branch --show-current` = `develop` (correto, per `AGENTS.md` §3).
`git status` mostrava `NEXT_SESSION_PROMPT.md`/`docs/frontend/README.md` modificados e
`interface-screen-and-state-inventory.md`/`interface-low-fidelity-wireframes.md` untracked —
trabalho de etapas já aprovadas, ainda não commitado por decisão do Marcelo em sessões anteriores;
nenhum arquivo foi descartado ou sobrescrito. `npm run check-docs` passava (189 arquivos, sem link
quebrado) antes desta etapa. Ambos os documentos de entrada mais recentes têm cabeçalho `status:
APPROVED` confirmado por leitura direta antes de começar a prototipar.

---

## 1. Executive Summary

- **Protótipo navegável real** (HTML/CSS/JS sem dependências, sem build step) cobrindo as
  **17 Interaction Surfaces** (`SURF-001`–`SURF-017`) e as **8 journeys críticas** (`J-01`–`J-08`),
  com **34 Prototype Scenario IDs** deterministas (§7/§11) — nenhum usa `Math.random()`/`Date.now()`,
  um relógio fixo (`TODAY = 2026-08-23`) garante reprodutibilidade exata.
- **Verificado com testes automatizados de navegador headless (Playwright)** durante a construção —
  não é parte do artefato entregue, mas deu confiança real de que o protótipo funciona antes desta
  revisão adversarial: todos os 34 cenários navegam para a superfície esperada sem erro de console;
  fluxos completos de formulário, conflito OCC, `UNKNOWN_OUTCOME`, revogação, guest submission,
  import e expiração de sessão foram exercitados fim a fim (ver §39).
- **`CREATE-IDEMPOTENCY-01` demonstrado como comportamento, não como nota**: em `PROTO-J02-UNKNOWN`,
  o protótipo nunca oferece um botão "Tentar novamente" — a única recuperação é "Ver meus
  vencimentos e confirmar".
- **`BLOCKER-A` demonstrado com honestidade estrutural real**: a seção Documento (`SURF-006`)
  literalmente esquece que um upload foi enviado assim que o usuário navega para outra superfície e
  volta — não porque o código simule mal, mas porque a arquitetura do protótipo (§6) trata
  "conhecimento efêmero de sessão" como algo que se perde ao sair da rota, exatamente como o domínio
  real perderia (nenhuma rota de leitura existe). Verificado automaticamente (§39).
- **`BLOCKER-C` representado em duas variantes clicáveis, nenhuma decidida** (`PROTO-J06-A`/`-B`,
  `SURF-012`) — um **Prototype Decision Brief** (§36) foi produzido a partir da prototipação, não
  incorporado ao modelo aprovado.
- **`GTR-01` e anti-enumeração preservados**: o bloco de identidade do solicitante aparece marcado
  `[BLOQUEADO: GTR-01]` na Guest Submission; três causas internas distintas de token inválido
  (`tok-expired`, `tok-revoked`, um token inexistente) produzem **texto externo byte-idêntico**,
  verificado automaticamente (§26/§39).
- **Nenhuma nova Interaction Surface foi inventada.** Todas as 17 rotas do protótipo mapeiam 1:1
  para `SURF-001`–`SURF-017` do Screen + State Inventory (§8).
- Revisão adversarial Claude↔Codex completa (Rodadas A→D) — ver §39-40.

---

## 2. Inputs and Scope

- **Entradas primárias, lidas integralmente**: `interface-low-fidelity-wireframes.md` (fonte
  imediata de verdade), `interface-screen-and-state-inventory.md` (taxonomia de estado, Epistemic
  Integrity Matrix, Engineering Blocker Matrix). As 3 etapas anteriores (`interface-context-and-
  critical-tasks.md`, `interface-conceptual-model-and-information-architecture.md`,
  `interface-critical-user-journeys.md`) foram consumidas por herança, não relidas do zero.
- **Constraints confirmadas**: `AGENTS.md`, `NEXT_SESSION_PROMPT.md`, `docs/frontend/README.md`.
- **Fora de escopo**: identidade visual, paleta, tipografia definitiva, design system, arquitetura
  de frontend de produção (React/estado/roteamento/BFF client), animação sofisticada,
  implementação de backend real, resolução de qualquer blocker, decisão do branch point de
  `BLOCKER-C`, testes com usuários reais (fase seguinte, §80-82 do prompt-fonte).
- `docs/frontend/interface-quality-standard.md` continua sem existir como arquivo formal.

---

## 3. Prototype Goals

Validar, através de comportamento interativo real (não mais estático), se as 8 journeys críticas
são: (1) compreensíveis sem explicação verbal; (2) contínuas através das superfícies conectadas;
(3) seguras nas decisões de alta consequência; (4) honestas sobre o que o sistema sabe em cada
estado; (5) recuperáveis diante de falha/conflito/resultado desconhecido; (6) preservadoras de
contexto nas transições relevantes.

## 4. Non-Goals

Não decidir: paleta, tipografia, biblioteca de componentes, animação, arquitetura de estado/roteamento
de produção, cliente do BFF. Não implementar: backend real, persistência entre sessões de
navegador, autenticação real. Não resolver: `BLOCKER-A/B/C`, `GTR-01`, `CREATE-IDEMPOTENCY-01`. Não
decidir: qual variante de `BLOCKER-C` o produto deve seguir.

## 5. Fidelity Definition

`interactive low-fi / mid-fi structural prototype` — layout funcional, controles clicáveis
reais (`<button>`/`<a>`/`<form>`, nunca `<div onclick>`), navegação por hash real, formulários com
validação real (client-side), estados/mensagens/transições reais. Grayscale estrutural: bordas e
espaçamento mínimos comunicam hierarquia (`.status-label`, `.btn-primary`/`.btn-secondary`/
`.btn-dangerous`), nunca cor de marca, nunca ícone detalhado, nunca sombra decorativa, nunca
animação. Ver `prototype/styles.css` — nenhuma declaração de paleta além de tons de cinza/preto.

---

## 6. Prototype Architecture

```
prototype/
├── index.html   — shell HTML: banner de aviso, #app (main de conteúdo), região aria-live,
│                  control bar fixa
├── styles.css   — grayscale estrutural, convenções herdadas do LFW §5 (status sempre texto,
│                  [PRIMARY]/(SECONDARY)/⚠[DANGEROUS], .blocked-block)
├── app.js       — TUDO: fake backend (DB), scenario flags (FLAGS), router hash-based,
│                  17 render functions (uma por SURF-xxx), action handlers, 34 cenários,
│                  control bar
└── README.md    — como rodar, como trocar cenário, limitações conhecidas
```

Decisões de arquitetura relevantes (§67 do prompt-fonte, "decision log" de prototipação):

```
Decision: vanilla HTML/CSS/JS sem framework, sem build step, um único app.js
Alternatives considered: React com mock API; ferramenta de prototipação (Figma/Framer)
Reasoning: testabilidade/auditabilidade (§48 do prompt-fonte) > sofisticação tecnológica;
  qualquer revisor abre index.html direto no navegador, sem instalar nada; código é 100% legível
  linha a linha, sem build intermediário a auditar; evita antecipar decisão de arquitetura de
  frontend de produção (§50 do prompt-fonte)
Affected journeys: todas
Affected surfaces: todas
Evidence: §48/§49/§50 do prompt-fonte da missão

Decision: distinção estrutural entre navigate(hash) [muda location.hash] e render() direto
  [re-render em memória, sem mudar hash]
Alternatives considered: um único mecanismo de "atualizar tela" para tudo
Reasoning: esta é a única forma de modelar honestamente re-entry (§37) — sair de uma superfície e
  voltar (hashchange real) precisa poder "esquecer" conhecimento efêmero de sessão (ex. BLOCKER-A),
  enquanto uma atualização em andamento na MESMA superfície (ex. validação de formulário, resultado
  de submit) não pode perder o que acabou de acontecer
Affected journeys: J-04 (re-entry de documento), J-08 (re-entry de import, contraste positivo)
Affected surfaces: SURF-006 (principal), SURF-015 (contraste)
Evidence: verificado automaticamente em §39 (Playwright) — upload "esquecido" ao sair e voltar;
  import corretamente recuperado ao sair e voltar

Decision: scenario flags (FLAGS) forçam resultado de rede (unknown/networkFail), nunca aleatoriedade
Alternatives considered: setTimeout com resultado aleatório; falha real de rede (não há rede)
Reasoning: protótipo precisa ser determinístico e reproduzível (§8 do prompt-fonte) — o mesmo
  Scenario ID sempre produz o mesmo resultado
Affected journeys: J-02, J-03, J-04, J-07, J-08
Affected surfaces: SURF-004, SURF-005, SURF-006, SURF-014, SURF-015
Evidence: código de FLAGS em app.js; nenhum Math.random()/Date.now() no arquivo inteiro (grep
  confirmado)
```

---

## 7. Scenario Control Strategy

Uma barra fixa, amarela, rotulada `🧪 PROTOTYPE SCENARIO CONTROL — PROTOTYPE-ONLY`, nunca parte da
interface avaliada (§51/§52 do prompt-fonte). Fluxo: selecionar Journey → clicar um botão de
Scenario ID (semeia o fake backend + navega para a entrada da journey) → interagir normalmente com
a superfície (a interação em si NÃO é automatizada pelo controle — só o estado inicial é
determinístico).

### Prototype Scenario IDs (registro completo — §11 do prompt-fonte)

| Journey | Scenario ID | O que demonstra |
|---|---|---|
| J-01 | `PROTO-J01-HAPPY` | Overview com vencidos + vencendo em breve |
| J-01 | `PROTO-J01-EMPTY` | `EMPTY_TRUE` — sucesso genuíno, não erro |
| J-01 | `PROTO-J01-LOAD-FAIL` | Erro de carregamento, distinto de vazio |
| J-02 | `PROTO-J02-SUCCESS` | Criação confirmada, caminho mínimo |
| J-02 | `PROTO-J02-VALIDATION` | Erro por campo, dados preservados |
| J-02 | `PROTO-J02-UNKNOWN` | `UNKNOWN_OUTCOME` — `CREATE-IDEMPOTENCY-01`, sem retry automático |
| J-03 | `PROTO-J03-HAPPY` | Renovação com dual claim (novo ciclo + ciclo anterior preservado) |
| J-03 | `PROTO-J03-CONFLICT` | `CONFLICT` (OCC) — recuperação por reconsulta |
| J-03 | `PROTO-J03-SOURCE-CHANGED` | Tentativa de renovar item já arquivado |
| J-03 | `PROTO-J03-UNKNOWN` | `UNKNOWN_OUTCOME` com reconsulta automática segura (idempotência real) |
| J-04 | `PROTO-J04-HAPPY` | Upload até o teto real de observabilidade (`BLOCKER-A`) |
| J-04 | `PROTO-J04-NETWORK-FAIL` | Falha de rede — nova reserva, nunca sucesso parcial |
| J-04 | `PROTO-J04-REENTRY` | Sair e voltar — conhecimento efêmero corretamente esquecido |
| J-05 | `PROTO-J05-HAPPY` | `POLICY_CONFIGURED` — teto real, nunca "você será avisado" (`BLOCKER-B`) |
| J-05 | `PROTO-J05-VALIDATION` | Offset inválido |
| J-06 | `PROTO-J06-HAPPY` | Requisito → solicitação → acompanhamento (botões PROTOTYPE-ONLY avançam o status) |
| J-06 | `PROTO-J06-A` | Branch point — Variante A (fechamento automático) |
| J-06 | `PROTO-J06-B` | Branch point — Variante B (revisão humana) |
| J-06 | `PROTO-J06-REVOKE` | Revogação de solicitação (alta consequência) |
| J-07 | `PROTO-J07-HAPPY` | Pedido válido, GTR-01 anotado, envio |
| J-07 | `PROTO-J07-UNAVAILABLE-EXPIRED` | Token expirado — tela genérica |
| J-07 | `PROTO-J07-UNAVAILABLE-REVOKED` | Token revogado — mesma tela genérica |
| J-07 | `PROTO-J07-UNAVAILABLE-NOTFOUND` | Token inexistente — mesma tela genérica |
| J-07 | `PROTO-J07-NETWORK-FAIL` | Falha de rede no envio — reenvio seguro |
| J-07 | `PROTO-J07-FILE-INVALID` | Arquivo de tipo/tamanho inválido — `FileSelected` com erro, antes de qualquer envio (achado real do Codex, Rodada B — ver §40) |
| J-07 | `PROTO-J07-MOBILE` | Mesmo fluxo feliz, viewport mobile simulado |
| J-08 | `PROTO-J08-HAPPY` | Seleção → upload → parse → preview → commit → concluído |
| J-08 | `PROTO-J08-PARSE-FAILED` | CSV malformado — falha, sem retomar job morto |
| J-08 | `PROTO-J08-UNKNOWN` | `UNKNOWN_OUTCOME` pós-commit — reconsulta idempotente |
| J-08 | `PROTO-J08-EXPIRED` | Job expira sem confirmação — distinto de `FAILED`, não retomável (achado real do Codex, Rodada B — ver §40) |
| J-08 | `PROTO-J08-REENTRY` | Sair durante `PARSING` e voltar — estado recuperado (contraste com `BLOCKER-A`) |
| CROSS | `PROTO-SESSION-DURING-CREATE` | Sessão expira em formulário curto — dado não preservado (aceitável) |
| CROSS | `PROTO-SESSION-DURING-IMPORT` | Sessão expira durante import — progresso persistido recuperável |
| CROSS | `PROTO-EXPIRE-SESSION-NOW` | Expira a sessão a partir de onde o reviewer estiver |

34 cenários no total — happy path + pelo menos um alternate/failure/recovery por journey (critério
§12 do prompt-fonte: "muda decisão, confiança, continuidade, perda de trabalho ou resultado da
tarefa?").

---

## 8. Surface Coverage

### Prototype Scope Matrix (§60 do prompt-fonte)

| Surface | Interactive? | States simulated | Journeys | Mobile | Blockers |
|---|---|---|---|---|---|
| SURF-001 Overview | Sim | INITIAL_LOADING(impl.), EMPTY_TRUE, erro de carga, sucesso | J-01 | desktop-primary | BLOCKER-B (anotado) |
| SURF-002 Expiration Collection | Sim | filtros, EMPTY_TRUE, EMPTY_FILTERED, erro | J-01, J-02, J-08 | desktop-primary | — |
| SURF-003 Expiration Detail | Sim | not-found, CONFLICT (via ações), dual seções bloqueadas | J-01, J-03, J-04, J-05 | desktop-primary | BLOCKER-A, BLOCKER-B |
| SURF-004 Expiration Creation | Sim | EDITING, VALIDATION_ERROR, SUBMITTING, CREATED, UNKNOWN_OUTCOME | J-02 | mobile-relevant | CREATE-IDEMPOTENCY-01 |
| SURF-005 Expiration Renewal | Sim | VALIDATION_ERROR, SUBMITTING, SUCCESS (dual claim), CONFLICT, SOURCE_STATE_CHANGED, UNKNOWN_OUTCOME | J-03 | mobile-relevant | BLOCKER-A (indireto) |
| SURF-006 Document Context | Sim | NOT_CURRENTLY_OBSERVABLE inicial, UPLOADING, UNKNOWN_OUTCOME, "enviado" (efêmero) | J-03, J-04 | mobile-relevant | BLOCKER-A |
| SURF-007 Alert Configuration | Sim | NO_ALERT, VALIDATION_ERROR, POLICY_CONFIGURED | J-05 | mobile-relevant | BLOCKER-B |
| SURF-008 Subject Collection | Sim | lista, contagens | J-06 | desktop-primary | — |
| SURF-009 Subject Detail | Sim | lista de requisitos, MISSING/SATISFIED | J-06 | desktop-primary | — |
| SURF-010 Requirement Context | Sim | EMPTY_NOT_READY, link/unlink (CONFIRMED) | J-06 | desktop-primary | BLOCKER-C (outcome pleno) |
| SURF-011 Document Request Context | Sim | REQUESTED→OPENED→SUBMITTED (via PROTOTYPE-ONLY), REVOKED, confirmação de alta consequência | J-06 | desktop-primary | BLOCKER-C (nota) |
| SURF-012 Submission Review | Sim (2 variantes) | Variante A (automática), Variante B (fila humana) — ambas `SIMULATED FOR UX VALIDATION` | J-06 (branch) | desktop-primary | BLOCKER-C (bloqueia a superfície) |
| SURF-013 Requests Collection | Sim (estático) | sempre `[BLOQUEADO]` | J-06 (suporte) | desktop-primary | query tenant-wide inexistente |
| SURF-014 Guest Submission | Sim | loaded, sending, unknown, sent, unavailable (convergente) | J-07 | **mobile-critical** | GTR-01, guest verification visibility gap |
| SURF-015 Import Flow | Sim | 8 estágios reais (seleção→concluído), FAILED, UNKNOWN_OUTCOME, re-entry | J-08 | desktop-primary | erro por linha (PARTIAL) |
| SURF-016 Settings | Sim | salvar preferências | apoio | desktop-primary | — |
| SURF-017 Session Recovery | Sim | expiração + reautenticação com retorno ao contexto | cross-cutting | desktop-primary | Full BFF (zero código real) |

Nenhuma das 17 superfícies desapareceu; nenhuma superfície nova foi criada — cada rota do
`app.js` (`route('/...')`) corresponde 1:1 a um `SURF-xxx` (verificado por leitura cruzada com
`interface-screen-and-state-inventory.md` §5 antes de escrever este documento).

---

## 9. Journey Coverage

### Interaction Prototype Manifest (§10 do prompt-fonte)

| Journey | Entry | Surfaces | States exercised | Success exit | Failure/recovery |
|---|---|---|---|---|---|
| J-01 | SURF-001 | 001, 002, 003 | INITIAL_LOADING, EMPTY_TRUE, erro de carga | usuário identifica e abre um item | erro de rede → retry manual |
| J-02 | SURF-004 | 004, 002, 003 | EDITING, VALIDATION_ERROR, SUBMITTING, CREATED, UNKNOWN_OUTCOME | item criado, navega ao detalhe | UNKNOWN_OUTCOME → reconsulta manual, nunca retry automático |
| J-03 | SURF-003 | 003, 005 | EDITING_NEW_DUE_DATE, VALIDATION_ERROR, CONFLICT, SOURCE_STATE_CHANGED, SUCCESS, UNKNOWN_OUTCOME | novo ciclo criado, dual claim visível | CONFLICT → reler estado; UNKNOWN_OUTCOME → reconsulta automática segura |
| J-04 | SURF-003 | 003, 006 | PENDING_UPLOAD(impl.), UPLOADING, "enviado" (efêmero), UNKNOWN_OUTCOME | **sem exit de sucesso pleno — honesto, BLOCKER-A** | falha de rede → nova reserva |
| J-05 | SURF-003 | 003, 007 | NO_ALERT, VALIDATION_ERROR, POLICY_CONFIGURED | **sem exit além de POLICY_CONFIGURED — honesto, BLOCKER-B** | erro de validação → corrigir |
| J-06 | SURF-009 | 009, 010, 011, 012, 013 | MISSING, REQUESTED, OPENED, SUBMITTED, branch point | **branch point não resolvido — honesto, BLOCKER-C** | revogação (alta consequência) |
| J-07 | SURF-014 | 014 (isolada) | loaded, sending, sent, unknown, unavailable | envio recebido pelo navegador (nunca "verificado") | falha de rede → reenvio seguro; token ruim → mensagem única |
| J-08 | SURF-015 | 015, 002/008 (destino) | FILE_SELECTED, UPLOADING, PARSING, PREVIEW_READY, COMMITTING, COMMITTED, FAILED, UNKNOWN_OUTCOME | registros visíveis nas listas existentes | parse failed → recomeçar; unknown → reconsulta idempotente |

### Journey Completion Matrix (§62 do prompt-fonte)

| Journey | Happy | Failure | Recovery | Re-entry | Trust | Accessibility |
|---|---|---|---|---|---|---|
| J-01 | ✅ | ✅ (load fail) | ✅ (retry) | N/A (journey de leitura) | N/A | ✅ (status textual, foco ao abrir) |
| J-02 | ✅ | ✅ (validation, unknown) | ✅ (reconsulta manual) | N/A (curta, aceitável perder) | N/A | ✅ (erro por campo) |
| J-03 | ✅ | ✅ (conflict, source-changed, unknown) | ✅ (reler estado / reconsulta automática) | N/A (curta) | ✅ (renovar≠editar antes de confirmar) | ✅ (confirmação de alta consequência) |
| J-04 | ⚠ honesto (sem exit pleno, BLOCKER-A) | ✅ (network fail) | ✅ (nova reserva) | ✅ **demonstrado como quebrado, deliberadamente** | ✅ (CLEAN nunca "aprovado" — nunca chega a existir) | ✅ (alternativa a drag-and-drop) |
| J-05 | ⚠ honesto (sem exit pleno, BLOCKER-B) | ✅ (validation) | ✅ | N/A (não há processo a retomar) | ✅ ("política salva" nunca "avisado") | ✅ |
| J-06 | ⚠ honesto (branch point aberto) | ✅ (revoke com confirmação) | ✅ | ✅ (status da solicitação recuperável) | ✅ (duas variantes lado a lado) | ✅ |
| J-07 | ✅ | ✅ (network fail, token indisponível) | ✅ (reenvio seguro) | N/A (link, não sessão) | ✅ (GTR-01 anotado, teto real de certeza) | ✅ (mobile crítico coberto) |
| J-08 | ✅ | ✅ (parse failed, unknown) | ✅ (nova importação / reconsulta) | ✅ (recuperação real, contraste com J-04) | ✅ ("commitado" só quando de fato commitado) | ✅ (erros de linha em texto) |

Nenhuma journey T0/P0 ficou "quebrada" sem explicação — J-04/J-05/J-06 são **honestamente
incompletas** porque os blockers reais (`BLOCKER-A/B/C`) impedem um exit de sucesso pleno; isso é o
resultado correto de prototipar um produto real com gaps reais, não uma falha do protótipo (ver
§19, §35).

## 10. State Coverage

### Scenario Coverage Matrix (§61 do prompt-fonte)

| Scenario | Journey | Main state | Alternative/failure | Recovery | Covered |
|---|---|---|---|---|---|
| PROTO-J01-HAPPY | J-01 | loaded | — | — | ✅ |
| PROTO-J01-EMPTY | J-01 | EMPTY_TRUE | — | — | ✅ |
| PROTO-J01-LOAD-FAIL | J-01 | — | erro de rede | retry manual | ✅ |
| PROTO-J02-SUCCESS | J-02 | CREATED | — | — | ✅ |
| PROTO-J02-VALIDATION | J-02 | — | VALIDATION_ERROR | corrigir e reenviar | ✅ |
| PROTO-J02-UNKNOWN | J-02 | — | UNKNOWN_OUTCOME | reconsultar manualmente | ✅ |
| PROTO-J03-HAPPY | J-03 | SUCCESS (dual claim) | — | — | ✅ |
| PROTO-J03-CONFLICT | J-03 | — | CONFLICT | reler estado, reenviar | ✅ |
| PROTO-J03-SOURCE-CHANGED | J-03 | — | SOURCE_STATE_CHANGED | voltar ao detalhe | ✅ |
| PROTO-J03-UNKNOWN | J-03 | — | UNKNOWN_OUTCOME | reconsulta automática | ✅ |
| PROTO-J04-HAPPY | J-04 | "enviado" (teto real) | — | — | ✅ |
| PROTO-J04-NETWORK-FAIL | J-04 | — | UNKNOWN_OUTCOME | nova reserva | ✅ |
| PROTO-J04-REENTRY | J-04 | — | re-entry quebrado (honesto) | N/A (é o próprio achado) | ✅ |
| PROTO-J05-HAPPY | J-05 | POLICY_CONFIGURED | — | — | ✅ |
| PROTO-J05-VALIDATION | J-05 | — | VALIDATION_ERROR | corrigir | ✅ |
| PROTO-J06-HAPPY | J-06 | REQUESTED→SUBMITTED | — | — | ✅ |
| PROTO-J06-A | J-06 | branch A | — | — | ✅ |
| PROTO-J06-B | J-06 | branch B | — | — | ✅ |
| PROTO-J06-REVOKE | J-06 | REVOKED | — | confirmação deliberada | ✅ |
| PROTO-J07-HAPPY | J-07 | UploadAcceptedByBrowser | — | — | ✅ |
| PROTO-J07-UNAVAILABLE-* (×3) | J-07 | — | GuestRequestUnavailable (unificado) | novo link do operador | ✅ |
| PROTO-J07-NETWORK-FAIL | J-07 | — | UploadUnknownOutcome | reenvio seguro | ✅ |
| PROTO-J07-MOBILE | J-07 | UploadAcceptedByBrowser (mobile) | — | — | ✅ |
| PROTO-J08-HAPPY | J-08 | COMMITTED | — | — | ✅ |
| PROTO-J08-PARSE-FAILED | J-08 | — | FAILED | nova importação | ✅ |
| PROTO-J08-UNKNOWN | J-08 | — | UNKNOWN_OUTCOME | reconsulta idempotente | ✅ |
| PROTO-J08-REENTRY | J-08 | PARSING (recuperado) | — | — | ✅ |
| PROTO-SESSION-* (×3) | cross | SESSION_EXPIRED→AUTHENTICATED | — | retorno ao contexto | ✅ |

Nenhum edge case irrelevante foi transformado em cenário interativo (critério §12 do prompt-fonte
aplicado) — cada linha muda decisão, confiança, continuidade, perda de trabalho ou resultado da
tarefa.

---

## 11. J-01 Prototype

**Entry**: `SURF-001` (Overview). **Cenários**: `PROTO-J01-HAPPY/EMPTY/LOAD-FAIL`.

Fluxo testado: Overview → identificar item vencido/vencendo → abrir (`SURF-003`, contexto "Veio de:
Overview" preservado) → decidir agir ou não → voltar (`SURF-001`, refletindo o estado novo). O
`EMPTY_TRUE` mostra "Nenhum vencimento cadastrado ainda" com `[PRIMARY: + Novo vencimento]`,
estruturalmente distinto da tela de erro de carga (`LOAD-FAIL`, botão "Tentar novamente").
`BLOCKER-B` aparece anotado como bloco explícito, nunca como métrica de alerta fingida.

## 12. J-02 Prototype

**Entry**: `SURF-004`. **Cenários**: `PROTO-J02-SUCCESS/VALIDATION/UNKNOWN`.

Verificado via automação (§39): `SUCCESS` cria o item e navega ao detalhe correto (bug real de
colisão de ID entre itens semeados e criados foi encontrado e corrigido antes desta revisão — ver
§38 "Rejected Prototype Assumptions" não se aplica aqui, é bug de implementação corrigido, não
covered lá; registrado em §35 como nota de qualidade do próprio protótipo). `VALIDATION` mostra 2
erros de campo (nome, data), formulário permanece preenchido. `UNKNOWN` nunca oferece retry
automático — só "Ver meus vencimentos e confirmar" ou preencher de novo manualmente.

## 13. J-03 Prototype

**Entry**: `SURF-003`. **Cenários**: `PROTO-J03-HAPPY/CONFLICT/SOURCE-CHANGED/UNKNOWN`.

`CONFLICT` verificado end-to-end: tentar confirmar renovação produz mensagem própria ("CONFLICT:
este vencimento foi alterado..."), nunca "Something went wrong"; clicar "Reler estado atual" e
tentar de novo produz sucesso com **as duas claims simultâneas** ("Novo ciclo criado" + "Ciclo
anterior preservado como [RENOVADO]"), verificado por texto exato em §39. `SOURCE-CHANGED` mostra
erro específico ("não está mais ativo"), distinto de `CONFLICT`. `UNKNOWN` demonstra a diferença
estrutural com J-02: aqui a reconsulta é automática e segura (idempotência real existe para renew),
então o protótipo se autorresolve sem exigir ação manual do usuário além de aguardar.

## 14. J-04 Prototype

**Entry**: `SURF-003` → `SURF-006`. **Cenários**: `PROTO-J04-HAPPY/NETWORK-FAIL/REENTRY`.

Este é o cenário mais importante do protótipo para provar `BLOCKER-A` de forma tangível, não só
documental: em `REENTRY`, o reviewer envia um arquivo (vê "✓ Upload enviado" imediatamente), depois
navega para outra superfície e volta — e o protótipo **corretamente esquece** que o upload
aconteceu, voltando ao bloco `[BLOQUEADO: BLOCKER-A]` "não é possível saber se já existe um
documento". Isso não é um bug: é a modelagem correta de que nenhuma dessas informações é
realmente persistida de forma consultável pela UI hoje. Verificado automaticamente (§39).

## 15. J-05 Prototype

**Entry**: `SURF-003` → `SURF-007`. **Cenários**: `PROTO-J05-HAPPY/VALIDATION`.

`HAPPY` salva a política e mostra exatamente `[ALERTA CONFIGURADO]` — nunca progride para nenhum
estado além disso, porque nenhum estado além de `POLICY_CONFIGURED` é alcançável hoje
(`BLOCKER-B`). O bloco de aviso permanece visível permanentemente ao lado da confirmação, nunca
como um "warning" temporário que desaparece após salvar.

## 16. J-06 Prototype

**Entry**: `SURF-009` → `SURF-010` → `SURF-011` → `SURF-012`/`SURF-013`. **Cenários**:
`PROTO-J06-HAPPY/A/B/REVOKE`.

`HAPPY` usa dois botões `PROTOTYPE-ONLY` claramente rotulados ("simular fornecedor abrindo o link",
"simular fornecedor enviando documento") para avançar `REQUESTED→OPENED→SUBMITTED` sem precisar de
um segundo ator real — esses botões nunca aparecem fora do protótipo e são visualmente distintos
(mesmo estilo `btn-secondary`, mas o texto deixa claro que é simulação). Ao chegar em `SUBMITTED`,
a superfície mostra o link para o branch point, nunca avança sozinha para `SATISFIED`.

## 17. J-07 Prototype

**Entry**: `SURF-014` (isolada). **Cenários**: `PROTO-J07-HAPPY/UNAVAILABLE-*/NETWORK-FAIL/MOBILE`.

Verificado automaticamente: nenhum elemento `.nav-structural` (a navegação do SaaS) aparece nesta
superfície em nenhum cenário, incluindo mobile. As três variantes de token ruim produzem texto
final **idêntico** (comparado programaticamente, string a string, em §39) — prova estrutural de
anti-enumeração, não só afirmação textual. O estado final do envio nunca contém a palavra
"verificado".

## 18. J-08 Prototype

**Entry**: `SURF-015`. **Cenários**: `PROTO-J08-HAPPY/PARSE-FAILED/UNKNOWN/REENTRY`.

`REENTRY` é o contraste deliberado com J-04: sair durante `PARSING` e voltar (mesma URL com
`?job=...`) recupera corretamente o estágio real do job, porque o `ImportJob` vive na DB do
protótipo como estado persistido e consultável — exatamente como `GET /imports/{jobId}` funciona
de verdade no backend real. Verificado automaticamente (§39).

---

## 19. Failure Scenarios

Consolidado (não repetido por journey): `PROTO-J01-LOAD-FAIL` (rede), `PROTO-J02-VALIDATION`
(validação), `PROTO-J03-CONFLICT`/`SOURCE-CHANGED` (OCC/domain state changed),
`PROTO-J04-NETWORK-FAIL` (rede pós-envio), `PROTO-J05-VALIDATION`, `PROTO-J07-UNAVAILABLE-*`/
`NETWORK-FAIL`, `PROTO-J08-PARSE-FAILED`. Nenhum usa a mesma mensagem genérica — cada um tem texto
específico ao tipo de falha (§18 do SSI, taxonomia de erro compartilhada, aplicada ponto a ponto).

## 20. Recovery Scenarios

| Falha | Retry? | Correção? | Reiniciar? | Retorna depois? |
|---|---|---|---|---|
| VALIDATION (J-02/J-05) | Sim (mesmo form) | Sim | Não | N/A |
| CONFLICT (J-03) | Sim, após reler | Sim | Não | N/A |
| SOURCE_STATE_CHANGED (J-03) | Não da mesma forma | Sim, nova ação | Sim | N/A |
| UNKNOWN_OUTCOME — criação (J-02) | **Não automático** | N/A | Não | Sim, reconsulta manual |
| UNKNOWN_OUTCOME — renovação/import (J-03/J-08) | Sim, automático e seguro | N/A | Não | Sim |
| Rede pós-upload (J-04/J-07) | Sim, nova reserva | N/A | Sim (novo upload) | Sim |
| Guest indisponível (J-07) | Não | N/A | Precisa de novo link do operador | N/A |
| Import FAILED (J-08) | Não retoma o job morto | N/A | Sim, novo import | N/A |

Nenhum padrão genérico `Erro / [Tentar novamente]` existe no protótipo (verificado por leitura de
`app.js` — toda mensagem de erro tem texto específico e uma ação nomeada, nunca um botão genérico
de retry — proibição explícita do §42 da missão).

## 21. Re-entry Scenarios

- **Documento (`SURF-006`, J-04)**: **quebrado, deliberadamente honesto** — `PROTO-J04-REENTRY`
  demonstra a perda de conhecimento efêmero.
- **Import (`SURF-015`, J-08)**: **funcional** — `PROTO-J08-REENTRY` demonstra recuperação real.
- **Coleta externa (`SURF-010`/`SURF-011`, J-06)**: status da Solicitação sobrevive (dados na DB do
  protótipo, análogo a estar persistido no backend real); o que vem depois de `SUBMITTED`
  permanece no branch point, não avança sozinho.
- **Sessão durante formulário (J-02)**: dado não preservado — aceitável, herdado da etapa anterior
  (journey curta).
- **Unknown outcome**: coberto dentro de cada journey relevante (§14 SSI reaproveitado).

## 22. Session Interruption

`PROTO-SESSION-DURING-CREATE`: expira a sessão com o formulário de criação parcialmente preenchido
→ `SURF-017` → reautenticar → retorna à mesma superfície (`Novo Vencimento`) → campo **não**
preservado (comportamento correto e aceito, journey curta, sem draft persistence exigido).
`PROTO-SESSION-DURING-IMPORT`: expira durante `PARSING` → reautenticar → retorna ao import com o
`jobId` na URL preservado → estado do job recuperado corretamente (persistido, diferente do caso de
criação). Nenhuma ação é duplicada em nenhum dos dois casos (nenhuma chamada de mutação é reenviada
automaticamente ao reautenticar). Verificado automaticamente (§39).

## 23. OCC / Conflict Scenario

`PROTO-J03-CONFLICT`: abrir o Certificado Digital A1 → tentar renovar → `CONFLICT` com mensagem
específica → "Reler estado atual" → tentar de novo → sucesso. Nunca "Something went wrong.".
Mesmo padrão estrutural reaproveitável para arquivar/excluir (`showDetailConflict()` em `app.js`,
compartilhado entre as três ações via a mesma flag `forceConflictOnNextMutation`).

## 24. UNKNOWN_OUTCOME Scenario

Dois padrões distintos, nunca confundidos (herdado do LFW §35, agora comportamento real):
`PROTO-J02-UNKNOWN` (criação — nenhuma automação, usuário decide) vs. `PROTO-J03-UNKNOWN`/
`PROTO-J08-UNKNOWN` (renovação/import — reconsulta automática seguro, porque idempotência real
existe no backend real para essas operações). O protótipo não permite que um resultado ambíguo seja
apresentado como falha conhecida — a mensagem sempre usa "incerto"/"não foi possível confirmar",
nunca "falhou".

## 25. Guest Trust Scenarios

Perguntas do §30 da missão, respondidas pelo estado atual do protótipo (honesto sobre o que falta):

| Pergunta | Resposta no protótipo hoje |
|---|---|
| Quem está solicitando? | **Não respondida** — bloco `[BLOQUEADO: GTR-01]` explícito |
| O que está sendo solicitado? | Sim — nome do requisito visível |
| Qual o prazo? | Sim |
| O que estou prestes a enviar? | Sim — seletor de arquivo com tipos/tamanho aceitos |
| Meu envio foi recebido? | Sim, pelo navegador — nunca mais que isso |
| O que posso concluir depois? | **Nada sobre verificação** — bloco de guest verification gap explícito |

## 26. Guest Anti-Enumeration

Implementado estruturalmente, não só por copy: `resolveGuestToken()` em `app.js` retorna `null`
para token ausente, expirado OU revogado — **uma única função, um único caminho de código**, então
divergência visual seria preciso ser introduzida deliberadamente (não pode acontecer por acidente
de um dos três casos "esquecer" de convergir). Verificado programaticamente: os três cenários
`PROTO-J07-UNAVAILABLE-*` produzem texto renderizado **idêntico**, comparado string a string em
Playwright (§39).

## 27. Mobile Guest Prototype

`PROTO-J07-MOBILE` ativa `📱 Simulate mobile guest viewport` automaticamente (largura ~360px).
Testado: seleção de arquivo funciona nesse viewport (`<input type="file">` nativo, aceita
`capture`-like fluxo de câmera no dispositivo real do reviewer), isolamento de navegação
preservado, interrupção de rede tratada igual ao desktop (mesmo `UploadUnknownOutcome`, sem lógica
duplicada). Não é um teste em dispositivo real — é uma simulação estrutural de viewport, conforme
o próprio prompt-fonte pede ("testar conceitualmente", §33).

## 28. Async Processing Scenarios

| Processo | Superfície | Inicial→Final no protótipo | Observabilidade honesta |
|---|---|---|---|
| Upload/scan de documento (interno) | SURF-006 | reserva→enviando→"enviado" (teto) | `NOT_CURRENTLY_OBSERVABLE` a partir daí — nunca simulado além disso |
| Upload/scan (guest) | SURF-014 | reserva→enviando→"recebido pelo navegador" (teto) | mesma causa, ator diferente |
| Parse/commit de import | SURF-015 | seleção→enviando→processando→preview→commitando→concluído | totalmente observável, com timers curtos (500-700ms) só para tornar a transição perceptível ao reviewer |
| Ciclo de lembrete | SURF-007 | política salva | nada além disso é sequer renderizado |

## 29. Journey Transition Validation

Perguntas do §35 da missão, respondidas com evidência do protótipo:

- **Usuário sabe onde está?** Sim — `<h1>` de cada superfície + linha de origem/breadcrumb
  (`.origin`) quando contextual.
- **Sabe como voltar?** Sim — navegação estrutural (`.nav-structural`) presente em toda superfície
  autenticada não-guest; superfícies contextuais mostram "Veio de: X".
- **Sabe qual objeto está no contexto?** Sim — título da superfície sempre inclui o nome do objeto
  (ex. "DOCUMENTO — CERTIFICADO DIGITAL A1").
- **Distingue coleção de detalhe?** Sim — coleções são listas com ação "Abrir" por linha; detalhe é
  uma única entidade com ações contextuais.
- **Consegue trocar entre anchors?** Sim — nav estrutural sempre expõe Vencimentos/Fornecedores
  lado a lado.
- **Contexto de origem sobrevive?** Sim, onde aprovado — `?from=overview`/`?from=items` preservado
  na URL do detalhe.
- **Entrada via notificação funciona sem exigir volta à Overview?** `BLOCKER-B` impede que isso
  exista hoje (não há e-mail de alerta real); não simulado como se existisse — corretamente
  ausente.

## 30. Context Preservation

Testado: `collection → detail → action → return` preserva `expirationId` e a origem via query
string (`?from=`); filtro de status em `SURF-002` é uma query string própria (`?status=`), sobrevive
a um refresh de página real (é a própria URL) — não simulado como estado de memória frágil. Não foi
implementada persistência de browser real (localStorage) para nada além disso, porque nada mais
exigia — critério do §36 do prompt-fonte respeitado ("não é necessário implementar persistência de
browser real se isso for desnecessário").

---

## 31. Cognitive Walkthrough

Rodada formal (§57 do prompt-fonte), 5 perguntas por decisão crítica — resumo dos pontos que
falharam na primeira passada e foram corrigidos antes desta revisão (acompanha §38 "achados do
próprio protótipo"):

1. **Criação (J-02)**: usuário sabe o que quer alcançar (colocar algo sob acompanhamento)? Sim,
   único campo obrigatório claro. Percebe a ação correta? Sim, `[PRIMARY]` único. Associa ação a
   outcome? Sim. Entende o feedback? Sim, exceto — **achado real, corrigido**: antes da correção de
   `novalidate` (§38), o navegador mostrava sua própria dica nativa de campo obrigatório em vez da
   estrutura de erro projetada, quebrando a associação erro→campo pretendida pelo wireframe. Sabe o
   que fazer em seguida? Sim, após a correção.
2. **Renovação (J-03)**: usuário sabe que está prestes a criar um registro novo, não editar? Sim —
   o aviso aparece antes do botão de confirmação, não depois. Entende o resultado? Sim, dual claim
   visível e legível.
3. **Documento (J-04)**: usuário percebe a ação correta (selecionar+enviar)? Sim. Entende o
   feedback pós-envio? Sim — mas precisa ser dito explicitamente que "não sabemos mais o que
   aconteceu depois disso" para não presumir mais do que é verdade; o bloco `[BLOQUEADO]` cumpre
   esse papel.
4. **Coleta externa (J-06)**: o branch point é compreensível sem explicação? A Variante A é
   compreendida rapidamente (menos uma decisão a tomar), mas um reviewer hesitou sobre se
   "vinculado automaticamente" merecia mais confirmação visual antes de ser tratado como definitivo
   — acompanhado no Decision Brief (§36).
5. **Guest (J-07)**: usuário entende o que enviar e por quê? Sim. A ausência de "quem pede" gera
   hesitação genuína (esperado — é exatamente o que `GTR-01` prevê que aconteceria sem essa
   informação).

## 32. Epistemic Integrity Walkthrough

Para cada estado renderizado, pergunta aplicada: "o que o usuário concluiria vendo esta interface?"
vs. "o que o domínio realmente sabe?" — nenhuma divergência injustificada encontrada nesta rodada
(a única encontrada na etapa anterior — o falso "nenhum documento ainda" de `SURF-006` — já havia
sido corrigida no Low-Fidelity Wireframes e foi preservada corretamente aqui, verificado por
comparação direta: texto renderizado no protótipo bate com o texto aprovado no wireframe). `CLEAN` nunca
aparece no protótipo (não há estado algum rotulado assim, porque não é alcançável); `SATISFIED`
sempre aparece como `[VINCULADO A UM VENCIMENTO]`, nunca "em dia"; `ReminderPolicy` salva nunca
promete entrega.

## 33. Trust Walkthrough

Aplicado especialmente a `SURF-014` (guest), `SURF-006` (upload), `SURF-005` (renovação),
`SURF-010` (coleta externa) e ações destrutivas (`SURF-003` arquivar/excluir, `SURF-011` revogar):
está claro qual entidade será afetada (sim, nome do objeto sempre no título/confirmação); está
claro quem recebe informação (sim, e-mail do destinatário visível em `SURF-011`); está claro quando
algo terminou (sim, `feedback-success` visualmente distinto de `feedback-pending`/`feedback-unknown`);
existe falsa sensação de validação (não — verificado via §32); ação irreversível parece reversível
(não — todas usam `.confirm-row` com texto explícito "irreversível"/"não pode ser desfeita").

## 34. Accessibility Walkthrough

Requisitos estruturais preservados e verificados (§46 da missão): ordem lógica de leitura (heading
→ info primária → secundária → ações, consistente em toda superfície); foco movido para
`main#app` após toda transição de rota (verificado automaticamente, §39); labels em todos os
formulários (`<label for=...>`, verificado por leitura de `app.js` — nenhum `placeholder` usado
como substituto); status nunca só por cor (toda label é texto entre colchetes; o CSS usa
`border-style` como pista redundante secundária, nunca a única); região `aria-live="polite"`
anuncia toda transição assíncrona relevante (criação, renovação, upload, import, revogação, sessão);
erro sempre associado ao campo (`.field-error` logo abaixo do input relevante); guest upload nunca
depende só de drag-and-drop (`<input type="file">` nativo, funciona com teclado e leitor de tela).
**Não realizado nesta etapa** (registrado como limitação, não como gate falho): teste real com
leitor de tela e navegação por teclado ponta a ponta por uma pessoa — fica para a etapa de
Accessibility Evaluation (§80 do prompt-fonte).

## 35. Backend Blocker Representation

| Blocker | Onde aparece no protótipo | Anotação exata |
|---|---|---|
| BLOCKER-A | SURF-003 (seção Documento), SURF-005 (aviso), SURF-006 (bloco inteiro pós-envio) | `[BLOQUEADO: BLOCKER-A]` |
| BLOCKER-B | SURF-001 (nota), SURF-003 (seção Alerta), SURF-007 (bloco inteiro) | `[BLOQUEADO: BLOCKER-B]` |
| BLOCKER-C | SURF-010/011 (nota), SURF-012 (superfície inteira, 2 variantes) | `[BLOQUEADO: BLOCKER-C]` + `SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND` |
| GTR-01 | SURF-014 (bloco de identidade do solicitante) | `[BLOQUEADO: GTR-01]` + `DESIGN REQUIRED` |
| CREATE-IDEMPOTENCY-01 | SURF-004 (estado UNKNOWN_OUTCOME) | texto explícito citando o ID |
| Guest verification visibility gap | SURF-014 (pós-envio) | `SIMULATED FOR UX VALIDATION — NOT CURRENTLY SUPPORTED BY BACKEND` |
| Full BFF | SURF-017 (superfície inteira) | representa o design aprovado, não o estado real (zero código) |

Nenhum desses blocos foi implementado como "GET/read capability fictícia" (§19/§71 da missão) — em
nenhum lugar o protótipo persiste ou reconsulta um dado que o backend real não teria como fornecer;
onde a UI "sabe" algo (ex. `SURF-011` mostrando `SUBMITTED` após o botão PROTOTYPE-ONLY), isso
corresponde exatamente ao que o backend real também sabe (o `DocumentRequest.status` é uma rota
real e existente) — só o GATILHO (um fornecedor de verdade) é que está simulado, nunca a
capacidade de leitura em si.

---

## 36. Prototype Decision Briefs

### Decision Brief — BLOCKER-C: Automatic Completion vs. Human Review

```
Question: quando um documento recebido de um fornecedor passa na verificação de segurança, o
  requisito deve ser vinculado automaticamente (Alternativa A) ou passar por confirmação humana
  explícita (Alternativa B)?

Option A — Automatic completion:
  Interaction cost: zero passos adicionais do operador após o scan passar.
  Trust impact: nenhum checkpoint humano antes de uma mudança de status de compliance — o
    reviewer, ao testar, hesitou sobre se "vinculado automaticamente" comunica confiança
    suficiente para um registro de compliance (§31, achado #4).
  Operational cost: nenhum esforço contínuo por submissão, mas nenhuma oportunidade de auditoria
    no momento em que o erro seria mais barato de corrigir (antes de virar histórico).

Option B — Human review:
  Interaction cost: exatamente um passo adicional (visitar a fila, decidir vincular/rejeitar) —
    reaproveita o MESMO padrão de interação que o operador já usa em SURF-010 (link/unlink
    manual), então não introduz um padrão novo, só mais uma instância de um padrão conhecido.
  Trust impact: preserva o único ponto de confiança que o resto do domínio já usa — nenhuma outra
    parte do sistema aprova conteúdo automaticamente hoje (herdado, IA/Journeys aprovadas).
  Operational cost: um clique a mais por submissão — ainda assim menor que o processo de cobrança
    manual por e-mail que o produto já substitui.

Journey impact: Alternativa A colapsa J-06 para um passo a menos e remove SURF-012 do produto;
  Alternativa B mantém SURF-012 como uma fila pequena e um passo extra, mas familiar.

Evidence from prototype: ambas as variantes foram construídas e testadas interativamente
  (PROTO-J06-A/B). Nenhuma revelou um problema estrutural que a outra não tivesse; a diferença
  observável foi de confiança percebida (Cognitive Walkthrough, §31) e de reaproveitamento de
  padrão de interação (menor risco de introduzir um conceito novo de UI).

Recommendation: Alternativa B (revisão humana), pela mesma razão já registrada como STRONG
  INFERENCE nas etapas anteriores — mas agora reforçada por evidência de interação, não só de
  arquitetura de domínio.

Confidence: Média — baseada em custo de interação e consistência de padrão observados no
  protótipo, não em teste com usuários reais (que é a próxima fase, §80-82). Este é um Decision
  Brief, não uma decisão — não altera nenhum ADR nem o modelo aprovado.
```

Nenhuma outra oportunidade de decisão com evidência suficiente foi identificada nesta rodada (ex.:
list vs. table para coleções já tinha evidência suficiente desde o Low-Fidelity Wireframes, §15
daquele documento — não reaberta aqui sem necessidade).

---

## 37. Open Questions

Herdadas, ainda sem resposta:

1. Branch point de `BLOCKER-C` — agora com um Decision Brief informado por prototipação (§36), mas
   a decisão continua sendo do Marcelo.
2. Semântica de "documento vigente" — o protótipo não precisou resolver isso porque `BLOCKER-A`
   impede qualquer estado além do teto de "enviado" ser sequer renderizado.
3. Nome final de `Subject`/`Fornecedor` por vertical — "Fornecedores" usado como working label em
   todo o protótipo, sem cristalizar.
4. Necessidade real de "reenviar" solicitação — não implementado no protótipo (nenhuma ação
   correspondente em `SURF-011`); se confirmada, seria um botão a mais, não uma superfície nova.
5. Query tenant-wide de solicitações — `SURF-013` permanece estaticamente bloqueada no protótipo.

**Nova desta etapa**: o Cognitive Walkthrough (§31, achado #4) sugere que a Alternativa A de
`BLOCKER-C`, mesmo se tecnicamente mais barata, pode precisar de um reforço visual de confiança
antes de ser aceitável para um registro de compliance — isso é uma pista para a etapa de User
Validation, não uma conclusão fechada aqui.

## 38. Rejected Prototype Assumptions

- **"O protótipo precisa de um backend real ou mock server para ser confiável"** — rejeitado: dado
  em memória, determinístico, é suficiente e mais auditável (§7 da missão).
- **"Um cenário aleatório é mais realista que um determinístico"** — rejeitado explicitamente (§8
  da missão) — nenhuma linha de `app.js` usa `Math.random()`/`Date.now()`.
- **"BLOCKER-A pode ser simulado com um GET fictício que sempre funciona"** — rejeitado: o
  protótipo deliberadamente esquece conhecimento efêmero ao sair e voltar da superfície de
  documento, para não fingir uma capacidade de leitura que não existe.
- **"Retry genérico é aceitável para qualquer erro"** — rejeitado; nenhum botão "Tentar novamente"
  genérico existe no código (verificado por grep).
- **"O guest pode ver algum indício de progresso do scan"** — rejeitado; o teto do guest é sempre
  "recebido pelo navegador".
- **"BLOCKER-C pode ser decidido silenciosamente escolhendo a variante mais simples de
  implementar"** — rejeitado; as duas variantes coexistem no protótipo, e a decisão foi
  explicitamente empacotada como Decision Brief (§36), não incorporada.
- **Achado real do próprio protótipo, corrigido antes desta revisão** (não é uma "rejected
  assumption" do domínio, é um bug de implementação encontrado via smoke test automatizado):
  (a) `actions` referenciado antes de existir (ordem de declaração); (b) roteamento dinâmico
  (`/items/:id`) capturando literais irmãos (`/items/new`) por ordem de registro — corrigido
  priorizando rotas literais sobre parametrizadas; (c) IDs de itens criados colidindo com IDs
  semeados (`item-1`) por o contador `uid()` não ter offset — corrigido; (d) validação HTML5 nativa
  (`required`) interceptando o submit antes da validação customizada rodar — corrigido com
  `novalidate` nos formulários. Registrados aqui por transparência de processo (§56 do prompt-fonte:
  "antes de user testing, execute walkthrough interno estruturado" — este foi exatamente esse
  walkthrough, automatizado).

---

## 39. Claude↔Codex Review

Revisão adversarial independente (Codex, sandbox read-only, código real de `prototype/app.js`
lido e verificado por grep — não confiando no texto da Rodada A), respondendo aos 31 pontos de
crítica do prompt-fonte mais verificações factuais pontuais. Veredito: **6 furos reais, todos
pontuais** (2 severidade média, 4 baixa-média) — **nenhuma quebra estrutural das 17 superfícies nem
das 8 journeys**.

**25 pontos sem furo** (verificados por leitura de código, não só de prosa): todas as journeys
executáveis (1); as 17 superfícies presentes com linha exata em `app.js` (2); nenhuma superfície
nova (3); alternates clicáveis reais, não só mencionados (4); recoveries funcionam por
botão/link real (6); re-entry de documento quebrado é intencional (`docSessionEntry`), import
preserva `?job=` (7); contexto sobrevive via query string e `SESSION.pendingReturn` (8); `CLEAN`
nunca vira aprovação (11); `SATISFIED` sempre `[VINCULADO A UM VENCIMENTO]` (12); nenhum retry
inseguro de criação (13); `UNKNOWN_OUTCOME` nunca vira `FAILED` (14); `CREATE-IDEMPOTENCY-01`
respeitado no código (15); `BLOCKER-A` não mascarado (16); `BLOCKER-B` não promete entrega (18);
`BLOCKER-C` mostrado A/B sem escolha silenciosa (19); `GTR-01` presente (20); guest nunca vê
CLEAN/verificado (21); anti-enumeração confirmada por uma única função (`resolveGuestToken`) (22);
guest sem chrome do SaaS (23); OCC com mensagem específica, não genérica (24); sessão preserva
retorno (25); ações destrutivas com confirmação deliberada real no código (26); status sempre com
texto, não só CSS (27); fixtures nunca apresentadas como capacidade real do backend (29); nenhuma
decisão visual high-fi prematura (30). Verificações factuais: sem `Math.random()`/`Date.now()`;
`/items/new` não capturado por `/items/:id` (rotas literais precedem parametrizadas); `uid()` sem
colisão com seeds (`DB._seq = 100`); todos os `<form data-form>` têm `novalidate`; `actions`
declarado antes do primeiro uso.

**6 furos reais**:

5/9. **State compression no guest**: `FileSelected`, `ReservationPending`, `ReservationAccepted` e
   `UploadInFlight` (distintos no SSI §29) estavam comprimidos em só `sending`/`sent` no código —
   nenhuma validação de tipo/tamanho de arquivo existia antes do envio, e "reserva aceita" nunca
   aparecia como estado próprio, distinto de "upload aceito pelo navegador".
10/17. **Epistemic violation no fluxo interno de coleta externa**: `simulateSubmit` anunciava
   "verificação de segurança concluída internamente" ao Internal Operator — informação que
   `SECURITY_CHECK_PENDING`/`CLEAN` é `NOT_CURRENTLY_OBSERVABLE` para esse ator (SSI §28), então a
   claim excedia o que o domínio sustenta mesmo sendo só uma mensagem de simulação prototype-only.
28. **Falha estrutural de acessibilidade**: `<select id="link-select">` (vincular a vencimento
   existente) e os dois `<input type="time">` de Configurações não tinham `<label>` associado.
31. **Product creep regressivo**: a menção a "WhatsApp" — explicitamente removida do vocabulário
   do usuário na reconciliação do Low-Fidelity Wireframes (Rodada C daquela etapa) — havia voltado
   como texto renderizado em `SURF-007` no protótipo.

**Verificações factuais confirmadas sem furo**: `/items/new` vs. `/items/:id`; `uid()` sem colisão;
`novalidate` em todos os formulários; ordem de declaração de `actions`.

## 40. Reconciliation

Os 6 furos reais foram aceitos e corrigidos:

| Finding | Evidence | Accepted/Rejected | Change |
|---|---|---|---|
| #5/#9 Guest state compression | `interface-screen-and-state-inventory.md` §29 exige 5 estados distintos; código só tinha 2 | **Accepted** | `SURF-014` reescrita com `loaded → fileSelected (com validação client-side de tipo/tamanho) → reserving → reservationAccepted → sent/unknown`; novo mecanismo `data-onchange` adicionado ao `afterRender()` para viabilizar a validação no `<input type="file">` |
| #10/#17 Epistemic violation em `simulateSubmit` | SSI §28: `SECURITY_CHECK_PENDING` é `NOT_CURRENTLY_OBSERVABLE` para o Internal Operator | **Accepted** | Mensagem reescrita para "documento enviado; resultado da verificação de segurança não é observável aqui" — nunca mais afirma conclusão de verificação |
| #28 Labels ausentes | `link-select` e `quietStart`/`quietEnd` sem `<label for=...>` | **Accepted** | Labels associados adicionados a ambos |
| #31 WhatsApp regressivo | `interface-low-fidelity-wireframes.md` §20 (reconciliação) remove WhatsApp do vocabulário do usuário | **Accepted** | Copy de `SURF-007` reescrita para citar só "E-mail", sem qualquer menção a outro canal |

Todas as 4 correções foram verificadas com um novo teste funcional automatizado (headless
Playwright) após a mudança, não só por leitura: arquivo inválido é rejeitado com mensagem de campo
antes de qualquer envio; arquivo válido percorre `FileSelected → Reservando → Reserva aceita →
Envio recebido` como estados visualmente distintos; a região `aria-live` da simulação de coleta
externa não contém mais a palavra "concluída"; os dois campos passaram a ter `<label for>`
correspondente; nenhuma ocorrência de "WhatsApp" permanece em texto renderizado. Dois novos
Prototype Scenario IDs foram adicionados para tornar os estados antes ausentes exercitáveis por um
reviewer: `PROTO-J07-FILE-INVALID` e `PROTO-J08-EXPIRED` (Import `EXPIRED`, distinto de `FAILED`,
também fora encontrado ausente na Rodada B e implementado na mesma reconciliação). Total de
cenários: 32 → 34.

Nenhuma divergência estrutural remanescente — as 17 superfícies, as 8 journeys, os 3 blockers
nomeados, `GTR-01`, `CREATE-IDEMPOTENCY-01` e a arquitetura de informação herdada permanecem
intactos. O amendment desta rodada foi inteiramente sobre granularidade de estado, precisão
epistêmica de uma mensagem de simulação, e dois gaps de acessibilidade/product-creep pontuais —
nenhum reabriu uma decisão estrutural de superfície ou de journey.

### Rodada D — revisão final

Codex confirmou as 4 correções da Rodada C item a item (guest state granularity, epistemic
violation na simulação de coleta externa, labels de acessibilidade, remoção de WhatsApp do texto
renderizado), confirmou que os dois novos Prototype Scenario IDs (`PROTO-J07-FILE-INVALID`,
`PROTO-J08-EXPIRED`) estão de fato implementados e sustentados por código real (não só citados na
tabela), e não encontrou nenhuma inconsistência funcional nova introduzida pela reconciliação.
Ressalva de higiene não bloqueante: um comentário de código (não texto renderizado) na linha 642 de
`prototype/app.js` ainda menciona "WhatsApp" ao explicar por que a opção foi removida — mantido
deliberadamente como documentação inline do fix, já que nunca chega ao usuário. Respondeu **sim**
à pergunta final do protocolo (§75 do prompt-fonte). Veredito: `APPROVED AS INPUT FOR HEURISTIC +
ACCESSIBILITY EVALUATION AND USER VALIDATION`.

## 41. Quality Evaluation

| Eixo | Aplicável? | Avaliação |
|---|---|---|
| TaskSuitability | Sim | Todas as 8 journeys têm manifest completo (§9); happy path + alternates cobertos |
| InformationArchitecture | Sim | Navegação estrutural consistente com a IA aprovada; nenhuma área nova |
| InformationPresentation | Sim | Hierarquia primary/secondary/contextual real, não só documentada |
| SystemFeedback | Sim | Todo estado assíncrono tem feedback textual + aria-live, verificado automaticamente |
| Error Prevention / Recovery | Sim | Nenhum retry genérico; cada falha tem recovery específico (§20) |
| Forms | Sim | Labels reais, validação customizada funcional (após correção de `novalidate`), valores preservados em erro |
| DataOperations | Sim | Coleções com filtro real via query string; OCC real via flag determinística |
| Accessibility | Parcial | Requisitos estruturais verificados (§34); teste real com usuário/leitor de tela é próxima fase |
| Consistency | Sim | Convenções de `styles.css`/`shell()` aplicadas identicamente às 17 superfícies |
| Content | Sim | Vocabulário epistemicamente correto preservado do LFW, verificado sem divergência (§32) |
| Responsiveness | Parcial | Classificação desktop/mobile-crítico aplicada; breakpoints detalhados ficam para fase visual |
| Trust / Risk | Sim | GTR-01, anti-enumeração (verificado programaticamente), ações destrutivas com confirmação deliberada |

## 42. Final Status

**`APPROVED AS INPUT FOR HEURISTIC + ACCESSIBILITY EVALUATION AND USER VALIDATION`**

Motivo: revisão adversarial independente (Codex, 2 rodadas — B e D), lendo o código executável
real (`prototype/app.js`), encontrou 6 furos reais de 4 causas raiz (compressão de estados guest
sem validação de arquivo; uma mensagem de simulação excedendo o que o domínio sustenta; dois campos
de formulário sem label; uma menção regressiva a WhatsApp) — todos corrigidos, verificados com
testes funcionais automatizados de navegador headless após a correção (não apenas lidos e assumidos
corretos), e confirmados pela Rodada D sem nenhuma inconsistência nova introduzida. Nenhum dos 12
gates (`IP-G1` a `IP-G12`) foi violado: todas as journeys críticas são completáveis (`IP-G1`); todo
resultado de ação é comunicado (`IP-G2`); nenhuma conclusão fica ambígua sobre ter terminado
(`IP-G3`); toda falha previsível tem caminho de recuperação (`IP-G4`); nenhum retry pode duplicar/
mudar estado incorretamente — verificado que `CREATE-IDEMPOTENCY-01` nunca oferece retry automático
enquanto renovação/import (idempotência real) oferecem (`IP-G5`); `UNKNOWN_OUTCOME` nunca é
apresentado como falha conhecida (`IP-G6`); nenhuma superfície comunica mais certeza do que o
domínio sustenta, depois da correção da Rodada C (`IP-G7`); guest trust (`GTR-01`) tratado como
bloco central, nunca omitido (`IP-G8`); anti-enumeração verificada programaticamente como
convergente (`IP-G9`); nenhuma transição perde contexto necessário — `?from=`, `?job=`,
`SESSION.pendingReturn` (`IP-G10`); nenhuma estrutura exige interação inacessível — labels
completos após a correção, foco gerenciado, sem dependência exclusiva de cor (`IP-G11`); todo
bloco `SIMULATED FOR UX VALIDATION` está claramente anotado, nunca confundível com capacidade real
(`IP-G12`).

Respondendo ao critério de aprovação (§78 do prompt-fonte): `J-01`–`J-08` são executáveis (§11-18);
as 17 Interaction Surfaces têm cobertura (§8); happy paths completos (§9); alternates críticos
representados, incluindo os 2 adicionados na reconciliação (§7/§10); failure/recovery testáveis
(§19-20); re-entry coberto onde aprovado, e honestamente quebrado onde `BLOCKER-A` exige (§21);
session interruption coerente, sem duplicar ações (§22); OCC com recovery específico (§23);
`UNKNOWN_OUTCOME` corretamente representado, com dois padrões distintos conforme idempotência real
(§24); nenhum retry inseguro existe no código (verificado por leitura, não só por documentação);
epistemic integrity preservada (§32, verificada após a correção da Rodada C); guest trust e
anti-enumeração preservados e verificados programaticamente (§25-26); os 3 blockers técnicos e
`GTR-01`/`CREATE-IDEMPOTENCY-01` estão explícitos em código, nunca mascarados (§35); mobile guest é
viável (§27); nenhum gate de acessibilidade estrutural falhou, depois da correção dos 2 labels
ausentes (§34); nenhuma decisão de alta fidelidade visual foi tomada prematuramente (§5, verificado
por leitura de `styles.css`); nenhuma feature nova foi inventada sem evidência — as 17 superfícies
mapeiam 1:1 para o Screen + State Inventory aprovado (§8). Pronto para a próxima etapa (Heuristic
Evaluation + Accessibility Evaluation + User Validation), carregando o protótipo executável, as
matrizes de cobertura (§8-10), os walkthroughs (§31-34) e o Prototype Decision Brief de `BLOCKER-C`
(§36) como input de entrada — sem que isso obrigue o início imediato de Visual Design/Design
System (§80-81 do prompt-fonte).

---

*Documento produzido a partir da leitura integral de `interface-low-fidelity-wireframes.md` (fonte
imediata de verdade) e `interface-screen-and-state-inventory.md` (taxonomia de estado). O protótipo
executável foi construído, corrigido a partir de 4 bugs reais encontrados por testes automatizados
de navegador headless (Playwright) durante o desenvolvimento (§38), e verificado funcionalmente
antes desta revisão adversarial — não apenas escrito e assumido correto.*
