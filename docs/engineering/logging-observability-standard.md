---
status: proposta
owner: engineering
authority: normativo quando APPROVED
---

# Logging, Tracing & Error Taxonomy Standard — Expiration Tracker

> Régua concreta e ponderada para "máxima qualidade em logs/tracing para debugar o produto com clareza em caso de problema" (pedido explícito do Marcelo, 2026-08-29). Distinto de `joint-review-criteria.md`'s critério "Debuggability & Operational Feedback" (eixo Qualidade de Engenharia, 7%) e "Logging Seguro, Detecção & Resposta a Incidentes" (eixo Segurança, 8%) — este documento é a régua concreta que esses dois critérios passam a referenciar para este subsistema específico, mesmo papel que `test-engineering-standard.md` já tem para teste automatizado. Escopo: `src/shared/observability/**` (SecureLogger/Redactor/context/security-audit), `src/shared/errors/app-error.ts` (taxonomia de erro), e toda a infra Terraform que transforma log em métrica/alarme real (`document-observability`/`import-observability`/`reminder-observability`/`security-audit-observability`).

## 1. Por que este documento existe agora

Uma rodada de validação real (Codex, 2026-08-29) sobre este subsistema achou 2 achados BLOQUEANTES reais na primeira passada (nota 7,0/10): a infra que transforma log de segurança em alarme estava genuinamente incompleta — 3 handlers HTTP inteiros e 2 workers reais emitiam eventos de auditoria que nenhum metric filter jamais capturava, silenciosamente. Corrigido na mesma sessão (nota 9,0/10 na rodada seguinte), mas o achado prova exatamente o que este documento existe para prevenir: "o código loga certo" e "o log vira sinal acionável de verdade" são propriedades distintas, e só a segunda garante debugabilidade real em produção. Este documento registra os critérios explícitos para não depender de auditoria ad-hoc a cada vez.

## 2. Escopo

Quatro camadas, cada critério abaixo se aplica a uma ou mais:

- **Emissão** — `SecureLogger`/`Redactor`/`context.ts` (o que vira log, como é redigido, como correlaciona).
- **Taxonomia de erro** — `src/shared/errors/app-error.ts` e as subclasses reais por módulo (o que um erro real comunica, se é acionável, se `retryable` está correto).
- **Trilha de auditoria de segurança** — `security-audit.ts` (taxonomia fechada de eventos de segurança).
- **Wiring de detecção** — os 4 módulos Terraform de observabilidade + `infra/main.tf` (log → metric filter/métrica nativa → alarme → SNS).

## 3. Critérios de qualidade (ponderados, 0-10)

| # | Critério | Peso | Camada | Definição |
|---:|---|---:|---|---|
| 1 | Completude & consistência da emissão estruturada | 12% | Emissão | Todo handler real usa `SecureLogger` (nunca `console.*` fora do sink sancionado); toda linha é JSON estruturado com `timestamp`/`level`/`event`/contexto; nomes de evento (`event`) são estáveis e greppáveis, não texto livre variável. |
| 2 | Completude & corretude da redação | 14% | Emissão | Denylist de campo (`schemas/sensitive-fields.json`) cobre todo campo sensível real do domínio atual (auditado, não presumido); padrões de valor (email/token/key-value) cobrem os formatos reais em uso; `redactError` nunca vaza stack/corpo de erro de SDK; truncamento/profundidade máxima/referência circular nunca quebram o processo de log em si. |
| 3 | Propagação de correlação & rastreamento distribuído | 15% | Emissão | `correlationId`/`tenantId` propagam via `AsyncLocalStorage` em TODO ponto de entrada real (HTTP, SQS, DynamoDB Streams, Step Functions, agendado) sem vazar entre registros do mesmo batch; a propagação atravessa fronteira de fila (`MessageAttribute`) e permanece correlacionável em traces ADOT/X-Ray. Nenhum handler novo pode ficar fora de `runWithContext` sem justificativa documentada (ver achado `parser-sandbox-handler`). |
| 4 | Qualidade & acionabilidade da taxonomia de erro | 16% | Taxonomia de erro | Códigos de `AppError` são estáveis e semânticos (nunca strings ad-hoc); `retryable` reflete corretamente se uma nova tentativa pode ter sucesso (decide roteamento DLQ/retry real — um valor errado é um bug de produção, não cosmético); mensagem é acionável por um humano de plantão sem precisar ler o código-fonte; nenhum catch-all genérico mascara a causa raiz real. |
| 5 | Completude do wiring de detecção (log → alarme real) | 15% | Wiring de detecção | Todo emissor real de um evento com intenção de alarme (`security-audit.ts` e equivalentes) tem um metric filter/alarme real correspondente, provado por teste automatizado que cruza call sites reais contra a wiring Terraform — nunca por auditoria manual pontual (ver `test/architecture/security-audit-observability-coverage.test.ts` como padrão de referência). Um teste de módulo isolado com fixture sintética própria NÃO satisfaz este critério sozinho — precisa do cruzamento contra código real. |
| 6 | Cobertura de teste do próprio subsistema de observabilidade | 12% | Todas | `logger`/`redactor`/`context`/`security-audit` têm teste real (não só "compila"), incluindo caso adversarial (campo formatado como PII, referência circular, isolamento entre registros de um mesmo batch, `AccessDeniedException` real classificado corretamente). |
| 7 | Debugabilidade real de um incidente (só com o log, sem acesso ao código) | 10% | Todas | Dado um evento de falha real, um operador consegue reconstruir o que aconteceu e por quê usando só `correlationId`/`event`/`code` nos logs — sem precisar abrir o código-fonte para decifrar o que um evento/código significa. |
| 8 | Documentação & descobribilidade da taxonomia | 6% | Taxonomia de erro + auditoria | A taxonomia de erro/eventos de segurança é descoberta por um humano de plantão sem grep no source — comentário de código tratado como documentação real conta, desde que centralizado e não espalhado. |

**Gate**: nota mínima 9,0/10 em cada lado (Claude/Codex), protocolo de nota cega padrão (`AGENTS.md` §4) — mesmo gate do resto do projeto, não elevado, salvo decisão explícita futura do Marcelo.

## 4. Como usar

Rodar o protocolo Claude↔Codex (`AGENTS.md` §4) contra este documento sempre que: (a) um novo handler/worker for adicionado e precisar entrar na trilha de auditoria; (b) uma sessão dedicada de validação de logging/observabilidade for pedida explicitamente; (c) um achado real de produção expuser uma lacuna de uma das 4 camadas. Registrar evidência de rodada em `docs/engineering/reviews/logging-observability-standard/` (mesma convenção de `test-engineering-standard/`) — nota por critério, achados corrigidos com commit real, achados restantes classificados. Este documento evolui só quando o próprio critério se mostrar mal calibrado em uso real (mesma regra de `joint-review-criteria.md`), nunca reaberto a cada rodada sobre o mesmo eixo.

## 5. Status de convergência

**2026-08-29**: v1 proposta pelo Claude, ainda sem rodada de crítica dedicada aos CRITÉRIOS em si (a validação já executada nesta data avaliou a IMPLEMENTAÇÃO ad-hoc, não este documento formal, que foi escrito depois, a partir do achado real). Marcar `APPROVED` só depois de uma rodada real onde o Codex critique a própria tabela de pesos/definições, não apenas a implementação.
