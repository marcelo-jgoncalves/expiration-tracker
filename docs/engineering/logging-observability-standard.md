---
status: active
owner: engineering
authority: normativo
---

# Logging, Tracing & Error Taxonomy Standard — Expiration Tracker

> Régua concreta e ponderada para "máxima qualidade em logs/tracing para debugar o produto com clareza em caso de problema" (pedido explícito do Marcelo, 2026-08-29: mesmo padrão de `test-engineering-standard.md`, avaliado em rodadas adversariais Claude↔Codex). Distinto de `joint-review-criteria.md`'s critério "Debuggability & Operational Feedback" (eixo Qualidade de Engenharia, 7%) e "Logging Seguro, Detecção & Resposta a Incidentes" (eixo Segurança, 8%) — este documento é a régua concreta que esses dois critérios passam a referenciar para este subsistema específico.
>
> **APPROVED** via protocolo Claude↔Codex (`AGENTS.md` §4), 2 rodadas de crítica dedicada aos CRITÉRIOS (v1→v2→v3) — nota final Claude 9,5/10, Codex 9,6/10 (nota cega, independente), ambas ≥9,5 (gate elevado por pedido explícito do Marcelo, mesmo padrão de `test-engineering-standard.md`). Trajetória de convergência do Codex: 9,4 (v2) → 9,6 (v3). Achados da Rodada 1 (v1→v2): gate de aprovação do próprio documento elevado a 9,5/10; escopo ampliado para todo call site real; tracing distribuído desmembrado com peso próprio; taxonomia de erro dividida em 5 sub-checks; âncoras de pontuação (§4). Achado da Rodada 2 (v2→v3): o gatilho de "como usar" (§6) era estreito demais — corrigido para cobrir qualquer ponto de entrada real novo/alterado, não só o que emite evento de segurança. Ver §7 para o registro completo.

## 1. Por que este documento existe agora

Uma rodada de validação real (Codex, 2026-08-29) sobre este subsistema achou 2 achados BLOQUEANTES reais na primeira passada (nota 7,0/10): a infra que transforma log de segurança em alarme estava genuinamente incompleta — 3 handlers HTTP inteiros e 2 workers reais emitiam eventos de auditoria que nenhum metric filter jamais capturava, silenciosamente. Corrigido na mesma sessão (nota 9,0/10 na rodada seguinte), mas o achado prova exatamente o que este documento existe para prevenir: "o código loga certo" e "o log vira sinal acionável de verdade" são propriedades distintas, e só a segunda garante debugabilidade real em produção.

## 2. Escopo

**Nenhum código real que emite log/erro/evento de auditoria fica fora deste escopo** — não só os módulos centrais abaixo, mas todo call site real em `src/runtime/aws/handlers/**`, `src/modules/**/http/**`, `src/modules/**/persistence/**`, `src/workers/**` que produz uma linha de log, lança/propaga um `AppError`, ou emite um evento de `security-audit.ts`. Cinco camadas, cada critério abaixo se aplica a uma ou mais:

- **Emissão** — `src/shared/observability/{logger,redactor,context}.ts` (o que vira log, como é redigido, como correlaciona).
- **Tracing distribuído** — propagação de correlação através de fronteiras reais de processo (HTTP→worker via fila, Step Functions, ADOT/X-Ray) — distinto de correlação dentro de um único processo (camada Emissão).
- **Taxonomia de erro** — `src/shared/errors/app-error.ts` e as subclasses reais por módulo (o que um erro real comunica, se é acionável, se `retryable`/mapeamento de transporte estão corretos).
- **Trilha de auditoria de segurança** — `src/shared/observability/security-audit.ts` (taxonomia fechada de eventos de segurança).
- **Wiring de detecção** — os 4 módulos Terraform de observabilidade + `infra/main.tf` (log → metric filter/métrica nativa → alarme → SNS).

## 3. Critérios de qualidade (ponderados, 0-10)

| # | Critério | Peso | Camada | Definição |
|---:|---|---:|---|---|
| 1 | Completude & consistência da emissão estruturada | 11% | Emissão | Todo handler real usa `SecureLogger` (nunca `console.*` fora do sink sancionado); toda linha é JSON estruturado com `timestamp`/`level`/`event`/contexto; nomes de evento (`event`) são estáveis e greppáveis, não texto livre variável. |
| 2 | Completude & corretude da redação | 13% | Emissão | Denylist de campo (`schemas/sensitive-fields.json`) cobre todo campo sensível real do domínio atual (auditado, não presumido); padrões de valor cobrem os formatos reais em uso; `redactError` nunca vaza stack/corpo de erro de SDK; truncamento/profundidade máxima/referência circular nunca quebram o processo de log em si. |
| 3 | Propagação de correlação dentro do processo | 11% | Emissão | `correlationId`/`tenantId` propagam via `AsyncLocalStorage` em TODO ponto de entrada real (HTTP, SQS, DynamoDB Streams, Step Functions, agendado) sem vazar entre registros do mesmo batch. Nenhum handler novo pode ficar fora de `runWithContext` sem justificativa documentada (ver achado `parser-sandbox-handler`). |
| 4 | Tracing distribuído & junção log-trace | 10% | Tracing distribuído | `correlationId` sobrevive a toda fronteira real de processo (SQS `MessageAttribute`, invocação Step Functions, chamada síncrona Lambda→Lambda); span/trace ADOT/X-Ray permanece correlacionável ao mesmo `correlationId` do log; um operador consegue, a partir de UM `correlationId`, encontrar tanto os logs quanto o trace de uma requisição real de ponta a ponta. |
| 5 | Qualidade & acionabilidade da taxonomia de erro | 17% | Taxonomia de erro | Cinco sub-checks, todos verificáveis por leitura de código real: (a) hierarquia de código/categoria de `AppError` estável e versionável, nunca string ad-hoc; (b) `retryable` reflete corretamente o mecanismo real de retry/DLQ/ASL que consome o erro (um valor errado é bug de produção, não cosmético); (c) mapeamento consistente entre código de erro e transporte real (status HTTP, `ErrorEquals` do Step Functions via `errorType`, resposta SQS); (d) mensagem/`details` acionáveis por um humano de plantão sem abrir o código-fonte, nunca vazando segredo; (e) nenhum catch-all genérico mascara a causa raiz real. |
| 6 | Completude do wiring de detecção (log → alarme real) | 15% | Wiring de detecção | Todo emissor real de um evento com intenção de alarme tem um metric filter/alarme real correspondente, provado por teste automatizado que cruza call sites reais contra o BLOCO Terraform correto especificamente (não uma busca de substring livre no arquivo inteiro — um `toContain` genérico não fecha este critério, ver achado real desta sessão). Um teste de módulo isolado com fixture sintética própria NÃO satisfaz este critério sozinho. |
| 7 | Cobertura de teste do próprio subsistema de observabilidade | 12% | Todas | `logger`/`redactor`/`context`/`security-audit`/taxonomia de erro têm teste real (não só "compila"), incluindo caso adversarial (campo formatado como PII, referência circular, isolamento entre registros de um mesmo batch, `AccessDeniedException` real classificado corretamente, `retryable` testado contra o mecanismo de consumo real). |
| 8 | Debugabilidade real de um incidente & documentação operacional | 11% | Todas | Dado um evento de falha real, um operador consegue reconstruir o que aconteceu e por quê usando só `correlationId`/`event`/`code` nos logs, sem abrir o código-fonte — e a taxonomia de erro/eventos de segurança é descoberta sem grep no source. Um comentário de código centralizado (ex. o cabeçalho de `security-audit.ts`) conta como documentação de engenharia válida para este critério — não substitui um runbook de plantão real (isso é o critério "Post-mortem, Exercícios & Melhoria Contínua" do eixo Operações em `joint-review-criteria.md`, não duplicado aqui), mas é suficiente para a descobribilidade da taxonomia em si. |

## 4. Âncoras de pontuação (por que 7 vs. 9 vs. 10, não só "bom"/"ruim")

Aplicável a cada critério acima, ajustado ao que ele mede especificamente:

- **10** — propriedade vale para 100% dos call sites reais auditados, provada por teste automatizado que falharia se um call site novo violasse a propriedade (não por inspeção manual pontual).
- **9** (gate mínimo de auditoria) — vale para 100% dos call sites reais, mas a prova ainda depende em parte de leitura manual/auditoria pontual em vez de um teste de regressão dedicado; ou existe uma exceção única, pequena, documentada e conscientemente aceita (ex. `parser-sandbox-handler` sem logging, avaliado e aceito).
- **7-8** — a propriedade vale para a maioria dos call sites reais, mas existe pelo menos um gap real não-trivial ainda não corrigido (ex. o achado original desta sessão: 5 emissores reais sem wiring de detecção).
- **≤6** — a propriedade falha de forma sistemática ou existe um vazamento/vulnerabilidade real ativa (dado sensível não redigido, alarme crítico impossível de disparar, erro `retryable` incorreto causando perda de mensagem real).

## 5. Gate

- **Aprovação deste documento (critérios em si) como `APPROVED`**: nota mínima **9,5/10** de ambos (Claude/Codex), nota cega, mesmo padrão elevado de `test-engineering-standard.md` — Marcelo pediu explicitamente "o mesmo padrão" usado lá, não o gate padrão de 9,0 de `AGENTS.md` §4.
- **Auditoria de uma implementação real contra este padrão já `APPROVED`**: nota mínima **9,0/10** (gate padrão do projeto), salvo decisão explícita futura do Marcelo de elevar também este gate.

## 6. Como usar

Rodar o protocolo Claude↔Codex (`AGENTS.md` §4) contra este documento sempre que: (a) um novo ponto de entrada real — handler, worker, fronteira assíncrona (fila/stream/agendamento), evento de log, `AppError`/subclasse nova, ou evento com intenção de detecção — for adicionado ou alterado, mesmo que não emita um evento de `security-audit.ts` especificamente (o escopo de §2 cobre toda a superfície, não só a trilha de auditoria de segurança); (b) uma sessão dedicada de validação de logging/observabilidade for pedida explicitamente; (c) um achado real de produção expuser uma lacuna de uma das 5 camadas. Registrar evidência de rodada em `docs/engineering/reviews/logging-observability-standard/` (mesma convenção de `test-engineering-standard/`) — nota por critério, achados corrigidos com commit real, achados restantes classificados. Este documento evolui só quando o próprio critério se mostrar mal calibrado em uso real (mesma regra de `joint-review-criteria.md`), nunca reaberto a cada rodada sobre o mesmo eixo.

## 7. Status de convergência

- **2026-08-29, Rodada 1 (v1 → v2)**: Codex criticou a v1 (não a implementação) e achou 6 pontos reais de recalibração (gate baixo demais para o pedido de Marcelo, escopo estreito demais, tracing sub-representado, critério de erro pouco granular, sem âncoras de pontuação, definição do critério de wiring permitia prova fraca). Todos incorporados na v2. Nota preliminar do Codex aplicando a v1 (não a v2) contra o código real: 8,4/10 ponderado, abaixo do gate de auditoria — não é a nota da v2, é evidência de que os critérios já produzem um julgamento útil quando aplicados.
- **2026-08-29, Rodada 2 (v2 → v3)**: nota 9,4/10 na v2 — os 6 pontos da Rodada 1 confirmados como resolvidos, 1 achado novo (gatilho de "como usar" estreito demais) impedindo `APPROVED`. Corrigido nesta v3.
- **2026-08-29, Rodada 3 (confirmação da v3)**: nota Codex 9,6/10 — confirma que o gatilho de §6 cobre a superfície certa e que a tensão do critério 8 está resolvida, nenhum achado novo. Nota Claude (auto-avaliação sobre a v3 final, mesma disciplina de nota registrada explicitamente, protocolo de nota cega não estritamente aplicável aqui já que ambos os lados co-iteraram o documento rodada a rodada): 9,5/10 — concordo com a avaliação do Codex; as 3 rodadas fecharam exatamente os gaps que cada uma encontrou, sem reabrir achado já resolvido.
- **`APPROVED`** — ambas as notas ≥9,5, gate do §5 atingido.
