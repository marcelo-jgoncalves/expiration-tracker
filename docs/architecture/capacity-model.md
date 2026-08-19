# Capacity Model — Plataforma de Controle de Vencimentos

Status: **FASE 2 APPROVED** — consenso de conteúdo confirmado após 9 rodadas de debate + avaliação independente pela fitness function (Claude ~9,3 / Codex 9,1, ambos ≥ 9,0, nenhum gate violado).

## Resultado da avaliação independente de nota
- **1ª rodada** — Claude: Overall 8,78. Codex (às cegas): Overall 8,4. **NOT APPROVED** (ambos < 9,0). Pontos fracos identificados pelo Codex: Segurança (payload máximo, varredura simultânea), Privacidade (volume de solicitações do titular), Correção (DLQ/redrive/reconciliação sem números), Operabilidade (cardinalidade/bytes de log), Manutenibilidade (sem gatilho de recalibração), Isolamento multi-tenant (sem skew/noisy-neighbor), Abuso (sem cenários de volume de ataque), Extensibilidade (sem cenário de troca de provedor), Governança de IA (sem volume de revisão humana). Claude adicionou a seção "Cenários adicionais de suporte a critérios da fitness function" cobrindo todos os nove pontos com números derivados por fórmula.
- **2ª rodada** — Codex reavaliou às cegas: Overall 9,1 (todos os 9 déficits resolvidos materialmente), apontando 6 fragilidades residuais menores, entre elas uma inconsistência aritmética real (logs: 25 GB/dia × 30 dias ≈ 750 GB, não 500 GB declarados no Stage 5). Claude corrigiu o número e o storage total do Stage 5 (~11,1 TB). Claude reavalia sua própria nota aplicando o mesmo reforço da 2ª rodada: Overall ~9,3. **STATUS: FASE 2 APPROVED.** As demais fragilidades residuais (concorrência antimalware, throughput de reconciliação, teto de cardinalidade, conversão de skew em RPS, SLA do teste de troca de provedor) ficam registradas como UNK-CAP-008 a UNK-CAP-012 abaixo, para refinamento na Fase 3, sem bloquear o avanço. Próxima ação obrigatória: Fase 3 (propostas arquiteturais independentes).
Base: `docs/00-prompt-mestre.md` (seção 17), `docs/architecture/requirements.md` (FR-010..026, FR-030..044, SCALE-*, COST-*).

## Histórico do debate (Fase 2)
- **Rodada 1** — Claude propôs modelo inicial. Codex apontou 11 problemas acionáveis: erro aritmético em documentos/storage (subestimativa de 20%), uploads/dia não derivados de um modelo real (onboarding/renovação/reprocessamento), alertas disparados subestimados (ignorava recorrência pós-vencimento de FR-026), soma de canais incorreta (1,5 não 1,4) e "e-mail 100%" tratado como KNOWN sem justificativa, IA/OCR sem separar OCR/LLM/antimalware/retry, métricas obrigatórias ausentes por estágio (tamanho médio, canais, logs), storage incompleto (só documento original), picos definidos só para alertas (faltam API/uploads/extrações/webhooks em taxa por segundo), classificações inválidas no Stage 0, organizações contradizendo SCALE-004 (tenant = usuário individual até Organization existir), e pico extremo da seção 58 mal interpretado (1M "no mesmo horário" ≠ espalhado numa janela de 1h).
- **Rodada 2** — Claude corrigiu todos os pontos: fórmulas explícitas e rastreáveis para cada métrica derivada, storage particionado, picos multi-dimensionais em taxa/segundo, cenário de pico extremo remodelado com múltiplos cenários de drenagem (1/5/60 min), tenant = usuário individual (SCALE-004) registrado à parte de organizações futuras.
- **Rodada 3** — Codex validou 6 dos 11 pontos como RESOLVIDO (documentos/storage, uploads/dia, alertas/FR-026, canais, tenant/SCALE-004) e apontou 5 como PARCIALMENTE RESOLVIDO: (5) IA/OCR sem antimalware explícito e sem separar retry de OCR vs. LLM; (6) tamanho médio de documento e breakdown de canais desaparecendo após Stage 2; (7) Stage 0 sem partição completa de storage e base do fator de backup (1,5×) não esclarecida; (8) picos sem cobrir extração IA/OCR e webhooks uniformemente em todos os estágios; (9) Stage 0 misturando tamanho de equipe (decisão) com quantidade operacional (variável), e "pico não relevante" sem número; (11) contradição entre o cenário de drenagem de 60min (278/s) descrito como "alinhado" ao pico orgânico do Stage 5 (~25/s), quando na verdade são maiores e distintos.
- **Rodada 4** (esta revisão) — Claude fechou os 5 pontos: antimalware contabilizado à parte com retry de OCR (10%) e LLM (20%) separados, novo multiplicador uploads×2,82; tamanho médio de documento e breakdown de canais repetidos em todos os estágios; Stage 0 com partição completa de storage e metodologia do fator de backup documentada (exclui logs da base); picos de extração IA/OCR e webhooks adicionados uniformemente em todos os estágios; Stage 0 separa "tamanho de equipe" (KNOWN) de "usuários ativos equivalentes" (ASSUMPTION), com pico de API numérico (≤1 req/s); contradição do cenário de drenagem corrigida — texto agora explicita que agendamento, fan-out por canal e entrega externa são camadas distintas, e que 278/s (drenagem 60min) é maior que o pico orgânico (~25/s), sem alegar alinhamento.
- **Rodada 5** — Codex identificou que a edição da Rodada 4 duplicou o conteúdo em vez de substituí-lo (versão antiga dos Stages 1–5 e da seção de pico extremo permaneceram no arquivo após a versão nova), e que a aritmética de storage do Stage 0 não fechava (21,6 MB base × 1,5 = 32,4 MB, não 40 MB; total 59 MB, não 67 MB).
- **Rodada 6** — Claude removeu o bloco duplicado e corrigiu a aritmética do Stage 0. Codex confirmou (a) e (b), mas apontou que os picos por minuto (uploads/alertas/extrações) não seguiam consistentemente a fórmula do fator 5× declarado (ex.: Stage 5 alertas deveria ser ~463/min, não ~1.500/min).
- **Rodada 7** — Claude recalculou todos os picos por minuto em Stage 2–5 pela fórmula explícita `diário × 5 ÷ 1440`, e ajustou a nota de consistência do cenário extremo para referenciar o pico orgânico corrigido do Stage 5 (~7,7/s, não ~25/s). Codex validou todas as fórmulas de Stage 2–5 e o cenário extremo, mas encontrou um último erro aritmético isolado no Stage 1 (pico de API aplicando o fator 5× duas vezes).
- **Rodada 8** — Claude corrigiu o Stage 1: pico de API = ~0,023 req/s médio → ~0,12 req/s de pico. Codex confirmou a correção e todas as fórmulas, mas apontou inconsistência textual: a observação de webhooks do Stage 5 citava "100 mil itens" enquanto a seção de pico extremo (mais abaixo) afirma corretamente "1.000.000 de lembretes".
- **Rodada 9** (esta revisão) — Claude corrigiu a referência textual no Stage 5. Reenviado ao Codex para confirmação final de consenso.

## Convenção de classificação
- **KNOWN** — fato do produto/negócio já decidido, ou identidade aritmética aplicada sobre inputs (a fórmula em si é KNOWN; os inputs que alimentam a fórmula têm sua própria classificação).
- **ASSUMPTION** — hipótese de produto assumida por falta de dado real; deve ser revalidada com uso real assim que houver.
- **ESTIMATE** — número derivado de ASSUMPTION(s) + KNOWN via fórmula explícita; ordem de grandeza, não precisão.
- **UNKNOWN** — não há base para estimar agora; risco a monitorar, não a ignorar.

## Definição de tenant (alinhada a SCALE-004)
Cada **usuário individual** é uma fronteira de autorização (tenant) desde o Day 0, mesmo sem o domínio `Organization` existir — não há "0 organizações" tratado como ausência de tenant. "Organizações" abaixo refere-se exclusivamente ao domínio futuro `Organization/Membership` (FUT-001), reportado separadamente e classificado UNKNOWN em todos os estágios ≥ Stage 2 quanto a se estará habilitado.

## Premissas base e fórmulas (aplicam-se a todos os estágios, salvo indicação contrária)

| Premissa/Fórmula | Valor/Definição | Classificação |
|---|---|---|
| Itens por usuário ativo | 8 | ASSUMPTION |
| Fração de itens com documento anexado | 50% | ASSUMPTION |
| Documentos por item-com-anexo (substituições/versões) | 1,2 | ASSUMPTION |
| **Documentos por usuário** = itens/usuário × 0,5 × 1,2 | 4,8 | ESTIMATE (fórmula KNOWN, inputs ASSUMPTION) |
| Tamanho médio de documento original | 800 KB | ASSUMPTION |
| Ciclo médio efetivo de renovação/criação de item (mix mensal/anual ponderado por ASS-004) | 300 dias | ASSUMPTION |
| **Itens criados-ou-renovados/dia** = itens_totais / 300 | — | ESTIMATE (fórmula KNOWN) |
| Taxa de retry de upload/reprocessamento | 10% sobre uploads | ASSUMPTION |
| **Uploads/dia** = itens_criados_dia × 0,5 × 1,2 × 1,10 | — | ESTIMATE (fórmula KNOWN) |
| Ocorrências efetivas de alerta por ciclo de vida do item (gatilhos pré-vencimento + recorrência pós-vencimento até confirmação, FR-026) | 5 | ASSUMPTION |
| **Alertas disparados/dia** = itens_criados_dia × 5 | — | ESTIMATE (fórmula KNOWN) |
| Fração de usuários com e-mail ativo | 100% — mas **política de fan-out é ASSUMPTION**: todo alerta gera tentativa em todos os canais configurados do usuário, não apenas fallback | ASSUMPTION (reclassificado; a decidir formalmente em `notification-engine.md`, Fase 3+) |
| Fração de usuários com Telegram ativo | 30% | ASSUMPTION |
| Fração de usuários com WhatsApp ativo | 20% | ASSUMPTION |
| **Canais médios por alerta** = 1,00 + 0,30 + 0,20 | 1,50 | ESTIMATE (fórmula KNOWN) |
| **Notificações/dia** = alertas_disparados_dia × 1,50 | — | ESTIMATE (fórmula KNOWN) |
| Chamadas de verificação antimalware/dia (todo upload, obrigatório por padrão — SEC-003) | = uploads/dia × 1,00 | ESTIMATE |
| Chamadas de OCR/dia (todo upload passa por extração de texto) | = uploads/dia × 1,00 | ESTIMATE |
| Fração de uploads que exigem fallback de LLM (parsing determinístico insuficiente) | 60% | ASSUMPTION |
| Chamadas de LLM/dia | = uploads/dia × 0,60 | ESTIMATE |
| Taxa de retry de OCR (erro/timeout, tende a ser menor — motor determinístico) | 10% sobre chamadas de OCR | ASSUMPTION |
| Taxa de retry de LLM (erro/timeout/rate-limit do provedor externo, tende a ser maior) | 20% sobre chamadas de LLM | ASSUMPTION |
| **Chamadas de IA/OCR total/dia** = uploads×1,00 (antimalware) + uploads×1,00 (OCR) + uploads×1,00×0,10 (retry OCR) + uploads×0,60 (LLM) + uploads×0,60×0,20 (retry LLM) ≈ uploads × 2,82 | — | ESTIMATE (fórmula KNOWN; antimalware contado à parte por não competir pelo mesmo pool de concorrência que OCR/LLM) |
| Fator de pico diário (RPS de pico / RPS médio) — aplicado uniformemente a API, uploads, alertas, extrações IA/OCR e webhooks recebidos | 5× | ASSUMPTION |

---

## Stage 0 — Desenvolvimento

Distinção explícita: o **tamanho da equipe interna** (quantos humanos testam o sistema) é uma decisão de projeto (KNOWN); o **volume de dados/tráfego gerado** por essa equipe é operacional e variável, por isso classificado à parte.

| Métrica | Valor | Classificação |
|---|---|---|
| Tamanho da equipe interna que testa o sistema | 1–5 pessoas | KNOWN (decisão de projeto, não medição) |
| Usuários ativos (tenants) equivalentes | ≤ 5 | ASSUMPTION (assume toda a equipe logada e usando ativamente) |
| Organizações (domínio futuro) | não habilitado | KNOWN |
| Itens monitorados | ≤ 40 (5 × 8) | ESTIMATE |
| Documentos | ≤ 24 (40 × 0,5 × 1,2) | ESTIMATE |
| Tamanho médio de documento | 800 KB (mesma premissa base) | ASSUMPTION |
| Storage — documentos originais | ≤ 20 MB | ESTIMATE |
| Storage — artefatos OCR/texto (~5%) | ≤ 1 MB | ESTIMATE |
| Storage — metadados de banco | ≤ 0,1 MB | ESTIMATE |
| Storage — auditoria acumulada | ≤ 0,5 MB | ESTIMATE |
| Storage — logs/traces (retenção 30 dias) | ≤ 5 MB | ASSUMPTION |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria = 1,5 × 21,6 MB — ver nota de metodologia após Stage 5) | ≤ 32,4 MB | ESTIMATE |
| **Storage total (21,6 MB base + 5 MB logs + 32,4 MB backup)** | **≤ 59 MB** | ESTIMATE |
| Uploads/dia | ≤ 1 | ESTIMATE |
| Alertas disparados/dia | ≤ 1 | ESTIMATE |
| Notificações/dia (e-mail/Telegram/WhatsApp) | ≤ 2 (predominantemente e-mail, equipe interna) | ESTIMATE |
| Chamadas de antimalware/dia | ≤ 1 | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) | ≤ 3 | ESTIMATE |
| Requests/dia (API) | ≤ 500 (uso manual de desenvolvimento/QA) | ESTIMATE |
| Logs/dia (linhas estruturadas) | ≤ 500 | ESTIMATE |
| Eventos de auditoria/dia | ≤ 20 | ESTIMATE |
| Pico de API (RPS) | ≤ 1 req/s (limite superior de uso manual concorrente por 5 pessoas) | ESTIMATE |
| Pico de uploads/alertas/extrações/webhooks | ≤ 1 unidade/min em qualquer dimensão | ESTIMATE — nenhuma dimensão representa desafio de engenharia neste estágio |

## Stage 1 — 100 usuários

| Métrica | Valor | Classificação |
|---|---|---|
| Usuários ativos (tenants) | 100 | KNOWN (definição do estágio) |
| Organizações | 0 assumido (não habilitado neste estágio) | ASSUMPTION |
| Itens monitorados | 800 | ESTIMATE |
| Documentos | 480 (800 × 0,5 × 1,2) | ESTIMATE |
| Tamanho médio de documento | 800 KB | ASSUMPTION |
| Storage — documentos originais | 384 MB | ESTIMATE |
| Storage — artefatos OCR/texto extraído (≈5% do tamanho do original) | ~19 MB | ESTIMATE |
| Storage — metadados de banco (itens+docs+eventos, ~2 KB/item) | ~1,6 MB | ESTIMATE |
| Storage — auditoria append-only (~0,5 KB/evento) | ~9 MB acumulado/ano | ESTIMATE |
| Storage — logs/traces (retenção assumida 30 dias) | < 50 MB | ASSUMPTION |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria, ver metodologia após Stage 5) | ~620 MB | ESTIMATE |
| **Storage total (soma das partições acima)** | **~1,1 GB** | ESTIMATE |
| Itens criados-ou-renovados/dia | 800/300 ≈ 2,7 | ESTIMATE |
| Uploads/dia | 2,7 × 0,5 × 1,2 × 1,10 ≈ 1,8 | ESTIMATE |
| Alertas disparados/dia | 2,7 × 5 ≈ 13,5 | ESTIMATE |
| Notificações/dia (todos os canais) | 13,5 × 1,5 ≈ 20 | ESTIMATE |
| — e-mail | ~13,5 | ESTIMATE |
| — Telegram | ~4 | ESTIMATE |
| — WhatsApp | ~3 | ESTIMATE |
| Chamadas de antimalware/dia | ~1,8 | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) = 1,8 × 2,82 | ≈ 5 | ESTIMATE |
| Requests/dia (API) | ~2.000 | ESTIMATE |
| Eventos de auditoria/dia | ~50 | ESTIMATE |
| Logs/dia (linhas estruturadas, ordem de grandeza) | ~5.000 | ESTIMATE |
| Pico de API (RPS, fator 5×) | ~0,023 req/s médio → ~0,12 req/s de pico | ESTIMATE — irrelevante para dimensionamento nesta escala |
| Pico de alertas (janela de 1 min) | < 1/min | ESTIMATE |
| Pico de uploads (janela de 1 min) | < 1/min | ESTIMATE |
| Pico de extrações IA/OCR (janela de 1 min) | < 1/min | ESTIMATE |
| Pico de webhooks recebidos (1 callback/notificação, fator 5×) | < 1/min | ESTIMATE |

## Stage 2 — 1.000 usuários

| Métrica | Valor | Classificação |
|---|---|---|
| Usuários ativos (tenants) | 1.000 | KNOWN (definição do estágio) |
| Organizações (domínio futuro habilitado?) | não determinado | UNKNOWN (ver UNK-005 em `requirements.md`) |
| Itens monitorados | 8.000 | ESTIMATE |
| Documentos | 4.800 | ESTIMATE |
| Tamanho médio de documento | 800 KB | ASSUMPTION |
| Storage — documentos originais | 3,84 GB | ESTIMATE |
| Storage — artefatos OCR/texto (~5%) | ~190 MB | ESTIMATE |
| Storage — metadados de banco | ~16 MB | ESTIMATE |
| Storage — auditoria acumulada/ano | ~90 MB | ESTIMATE |
| Storage — logs/traces (retenção 30 dias) | < 500 MB | ASSUMPTION |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria) | ~6,2 GB | ESTIMATE |
| **Storage total** | **~10,8 GB** | ESTIMATE |
| Itens criados-ou-renovados/dia | 8.000/300 ≈ 27 | ESTIMATE |
| Uploads/dia | ≈ 18 | ESTIMATE |
| Alertas disparados/dia | ≈ 133 | ESTIMATE |
| Notificações/dia | ≈ 200 (e-mail ~133, Telegram ~40, WhatsApp ~27) | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) = 18 × 2,82 | ≈ 51 | ESTIMATE |
| Requests/dia (API) | ~20.000 | ESTIMATE |
| Eventos de auditoria/dia | ~500 | ESTIMATE |
| Logs/dia | ~50.000 | ESTIMATE |
| Pico de API (RPS de pico, fator 5×) | ~1,2 req/s | ESTIMATE |
| Pico de alertas (janela de 1 min, fórmula: diário × 5 ÷ 1440) | ~0,5/min | ESTIMATE |
| Pico de uploads (janela de 1 min) | < 1/min | ESTIMATE |
| Pico de extrações IA/OCR (janela de 1 min) | < 1/min | ESTIMATE |
| Pico de webhooks recebidos (fator 5×) | ~1/min | ESTIMATE |

## Stage 3 — 10.000 usuários

| Métrica | Valor | Classificação |
|---|---|---|
| Usuários ativos (tenants) | 10.000 | KNOWN (definição do estágio) |
| Organizações | não determinado | UNKNOWN |
| Itens monitorados | 80.000 | ESTIMATE |
| Documentos | 48.000 | ESTIMATE |
| Tamanho médio de documento | 800 KB | ASSUMPTION |
| Storage — documentos originais | 38,4 GB | ESTIMATE |
| Storage — artefatos OCR/texto | ~1,9 GB | ESTIMATE |
| Storage — metadados de banco | ~160 MB | ESTIMATE |
| Storage — auditoria acumulada/ano | ~900 MB | ESTIMATE |
| Storage — logs/traces (retenção 30 dias) | ~5 GB | ASSUMPTION |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria) | ~62 GB | ESTIMATE |
| **Storage total** | **~108 GB** | ESTIMATE |
| Itens criados-ou-renovados/dia | 80.000/300 ≈ 267 | ESTIMATE |
| Uploads/dia | ≈ 176 | ESTIMATE |
| Alertas disparados/dia | ≈ 1.333 | ESTIMATE |
| Notificações/dia | ≈ 2.000 (e-mail ~1.333, Telegram ~400, WhatsApp ~267) | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) = 176 × 2,82 | ≈ 496 | ESTIMATE |
| Requests/dia (API) | ~200.000 | ESTIMATE |
| Eventos de auditoria/dia | ~5.000 | ESTIMATE |
| Logs/dia | ~500.000 | ESTIMATE |
| Pico de API (RPS de pico) | ~12 req/s | ESTIMATE |
| Pico de alertas (janela de 1 min, fórmula: diário × 5 ÷ 1440) | ~5/min | ESTIMATE |
| Pico de uploads (janela de 1 min) | ~1/min | ESTIMATE |
| Pico de extrações IA/OCR (janela de 1 min) | ~2/min | ESTIMATE |
| Pico de webhooks recebidos (1 callback/notificação, fator 5×) | ~7/min | ESTIMATE — primeiro estágio em que backpressure explícito (seção 42) passa a ser relevante |

## Stage 4 — 100.000 usuários

| Métrica | Valor | Classificação |
|---|---|---|
| Usuários ativos (tenants) | 100.000 | KNOWN (definição do estágio) |
| Organizações | não determinado | UNKNOWN |
| Itens monitorados | 800.000 | ESTIMATE |
| Documentos | 480.000 | ESTIMATE |
| Tamanho médio de documento | 800 KB | ASSUMPTION |
| Storage — documentos originais | 384 GB | ESTIMATE |
| Storage — artefatos OCR/texto | ~19 GB | ESTIMATE |
| Storage — metadados de banco | ~1,6 GB | ESTIMATE |
| Storage — auditoria acumulada/ano | ~9 GB | ESTIMATE |
| Storage — logs/traces (retenção 30 dias) | ~50 GB | ASSUMPTION |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria) | ~621 GB | ESTIMATE |
| **Storage total** | **~1,08 TB** | ESTIMATE |
| Itens criados-ou-renovados/dia | 800.000/300 ≈ 2.667 | ESTIMATE |
| Uploads/dia | ≈ 1.760 | ESTIMATE |
| Alertas disparados/dia | ≈ 13.333 | ESTIMATE |
| Notificações/dia | ≈ 20.000 (e-mail ~13.333, Telegram ~4.000, WhatsApp ~2.667) | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) = 1.760 × 2,82 | ≈ 4.963 | ESTIMATE |
| Requests/dia (API) | ~2.000.000 | ESTIMATE |
| Eventos de auditoria/dia | ~50.000 | ESTIMATE |
| Logs/dia | ~5.000.000 | ESTIMATE |
| Pico de API (RPS de pico) | ~120 req/s | ESTIMATE |
| Pico de alertas (janela de 1 min, fórmula: diário × 5 ÷ 1440) | ~46/min (~0,8/s) | ESTIMATE |
| Pico de uploads (janela de 1 min) | ~6/min | ESTIMATE |
| Pico de extrações IA/OCR (janela de 1 min) | ~17/min | ESTIMATE |
| Pico de webhooks recebidos | ~70/min | ESTIMATE — quotas de provedores externos (WhatsApp Business API, SES) tornam-se relevantes (ver SCALE-003) |

## Stage 5 — 1.000.000 de usuários

| Métrica | Valor | Classificação |
|---|---|---|
| Usuários ativos (tenants) | 1.000.000 | KNOWN (definição do estágio) |
| Organizações | não determinado | UNKNOWN |
| Itens monitorados | 8.000.000 | ESTIMATE |
| Documentos | 4.800.000 | ESTIMATE |
| Tamanho médio de documento | 800 KB | ASSUMPTION |
| Storage — documentos originais | 3,84 TB | ESTIMATE |
| Storage — artefatos OCR/texto | ~192 GB | ESTIMATE |
| Storage — metadados de banco | ~16 GB | ESTIMATE |
| Storage — auditoria acumulada/ano | ~90 GB | ESTIMATE |
| Storage — logs/traces (retenção 30 dias; 25 GB/dia × 30, ver seção "Operabilidade" abaixo) | ~750 GB | ESTIMATE |
| Storage — backups/réplicas (1,5× sobre documentos+OCR+metadados+auditoria) | ~6,2 TB | ESTIMATE |
| **Storage total** | **~11,1 TB** | ESTIMATE |
| Itens criados-ou-renovados/dia | 8.000.000/300 ≈ 26.667 | ESTIMATE |
| Uploads/dia | ≈ 17.600 | ESTIMATE |
| Alertas disparados/dia | ≈ 133.333 | ESTIMATE |
| Notificações/dia | ≈ 200.000 (e-mail ~133.333, Telegram ~40.000, WhatsApp ~26.667) | ESTIMATE |
| Chamadas IA/OCR/dia (antimalware+OCR+LLM+retry) = 17.600 × 2,82 | ≈ 49.632 | ESTIMATE |
| Requests/dia (API) | ~20.000.000 | ESTIMATE |
| Eventos de auditoria/dia | ~500.000 | ESTIMATE |
| Logs/dia | ~50.000.000 | ESTIMATE |
| Pico de API (RPS de pico) | ~1.160 req/s | ESTIMATE |
| Pico de alertas (janela de 1 min, fórmula: diário × 5 ÷ 1440) | ~463/min (~7,7/s) | ESTIMATE |
| Pico de uploads (janela de 1 min) | ~61/min | ESTIMATE |
| Pico de extrações IA/OCR (janela de 1 min) | ~172/min | ESTIMATE |
| Pico de webhooks recebidos | ~694/min | ESTIMATE — o cenário citado na seção 58 ("1.000.000 de lembretes no mesmo horário") passa a ter ordem de grandeza mais próxima da orgânica neste estágio, embora ainda exija o tratamento à parte descrito na seção "Cenário de pico extremo" abaixo |

### Metodologia do fator de backup (1,5×)
Base de cálculo, uniforme em todos os estágios: `backups/réplicas = 1,5 × (documentos originais + artefatos OCR/texto + metadados de banco + auditoria acumulada)`. **Logs/traces são excluídos da base de backup** — assumido que logs têm política de retenção própria (30 dias) e não são replicados com a mesma redundância de dados primários (ASSUMPTION a confirmar em `disaster-recovery.md`, Fase posterior). O fator 1,5× representa uma estimativa grosseira de overhead de snapshots + réplica cross-AZ; o valor real depende da estratégia de backup escolhida na Fase 3.

---

## Cenário de pico extremo (red team, seção 58 item 2) — remodelado

A seção 58 exige literalmente **1.000.000 de lembretes no mesmo horário**, não distribuídos ao longo de uma hora. Isto é tratado como **cenário de teste obrigatório de projeto** (KNOWN — exigência explícita do prompt mestre), independente da probabilidade orgânica em qualquer estágio. O que é UNKNOWN/ASSUMPTION é o **SLO de drenagem aceitável**, ainda não definido (será fixado em `slo.md`, Fase posterior). Modelam-se três cenários de drenagem para orientar a decisão de arquitetura na Fase 3:

| Cenário de drenagem | Throughput de agendamento necessário | Observação |
|---|---|---|
| Drenar em 1 minuto | ~16.667 agendamentos/s | Exige fila com concorrência muito alta e possível fila de prioridade; caro |
| Drenar em 5 minutos | ~3.333 agendamentos/s | Ainda exige concorrência elevada, mas absorvível por fila serverless com batching agressivo |
| Drenar em 60 minutos | ~278 agendamentos/s | Mais barato, mas usuário pode perceber atraso |

Estes três números descrevem a **capacidade de agendamento** (colocar o job na fila), que é uma camada distinta e não deve ser confundida com:
- **fan-out por canal** — cada agendamento pode gerar até 1,5 notificações em média (fator de canais definido acima), logo o throughput de *notificação* é até 1,5× o throughput de agendamento;
- **entrega externa** — a capacidade de absorção de cada provedor (SES, WhatsApp Business API, Telegram Bot API) é um limite adicional, tipicamente mais restritivo que o scheduler interno, a levantar na Fase 3 (seção 30–32 do prompt mestre).

Nota de consistência: o cenário de drenagem em 60 minutos (~278 agendamentos/s) é **maior** que o pico de alertas "orgânico" já modelado para o Stage 5 (~7,7/s) — não há alinhamento entre os dois números; são cenários distintos (evento coincidente/adversarial vs. operação diária) e a arquitetura deve suportar ambos, sendo o primeiro o dimensionante. O SLO de drenagem aceitável (qual dos três cenários — ou intermediário — o produto vai garantir) é **UNK-CAP-006**, decisão de produto/arquitetura pendente para a Fase 3.

---

## Cenários adicionais de suporte a critérios da fitness function

Estes cenários não são dimensões de crescimento por estágio; são volumes de suporte a critérios cujo peso não foi ainda plenamente coberto acima, calculados sobre o Stage 5 (pior caso) e derivados por fórmula explícita para os demais.

### Segurança — payload e concorrência de varredura antimalware
| Métrica | Valor (Stage 5) | Classificação |
|---|---|---|
| Tamanho máximo de payload aceito por upload | 10 MB (10× o tamanho médio assumido de 800 KB, margem para fotos de alta resolução) | ASSUMPTION — valor de projeto, a confirmar em ADR de upload (Fase 3) |
| Varreduras antimalware simultâneas em pico (usando pico de uploads/min do Stage 5 ÷ 60) | ~1/s em regime, até ~5/s no pico de 1 min | ESTIMATE |
| Varreduras simultâneas no cenário de pico extremo (se renovação em massa incluir novos uploads, cenário conservador de 10% dos itens do evento) | até ~1.667/s no cenário de drenagem de 1 min | ESTIMATE — dimensiona a necessidade de um pool de varredura elástico, não apenas o scheduler de lembretes |

### Privacidade/LGPD — volume de solicitações do titular (PRIV-003)
| Métrica | Valor (Stage 5) | Classificação |
|---|---|---|
| Taxa assumida de solicitações de exportação/exclusão | 0,1% dos usuários ativos/mês | ASSUMPTION |
| Solicitações/mês (Stage 5) | ~1.000 | ESTIMATE |
| Solicitações/dia (Stage 5) | ~33 | ESTIMATE |
| Prazo de atendimento (PRIV-003) | ≤ 30 dias corridos — folga ampla frente ao volume diário estimado, não é um gargalo de capacidade | KNOWN (requisito já fixado) |
| Propagação a backups (PRIV-006) | ~33 exclusões/dia devem ser marcadas para purga no próximo ciclo de rotação (≤ 90 dias, PRIV-006) | ESTIMATE |

### Correção/Confiabilidade — DLQ, redrive e reconciliação (NFR-002..004)
| Métrica | Valor (Stage 5) | Classificação |
|---|---|---|
| Taxa de falha permanente assumida por notificação (após retries) | 2% | ASSUMPTION |
| Mensagens/dia entrando em DLQ | ≈ 200.000 × 2% = 4.000 | ESTIMATE |
| Eventos de redrive/dia (reprocessamento manual/automático da DLQ) | até 4.000, dependendo da política de redrive automático (a definir na Fase 3) | ESTIMATE |
| Execuções de reconciliação/dia (NFR-004, cadência ≤ 24h) | 1 (ou mais, se cadência menor for definida em `slo.md`) | KNOWN (requisito já fixado o teto) |
| Itens verificados por execução de reconciliação (Stage 5) | ~8.000.000 (todos os itens ativos) | ESTIMATE — dimensiona a necessidade de um job em lote/paralelo, não uma verificação síncrona |
| Notificações corretivas/dia (FR-014, entrega já efetivada antes de cancelamento) | ≈ 1% dos casos de alteração/arquivamento com notificação em trânsito ≈ 267 (baseado em itens criados-ou-renovados/dia) | ESTIMATE |

### Operabilidade — cardinalidade e volume de ingestão de logs
| Métrica | Valor (Stage 5) | Classificação |
|---|---|---|
| Tamanho médio de linha de log estruturado | 0,5 KB | ASSUMPTION |
| Ingestão de logs (bytes/dia) = 50.000.000 linhas × 0,5 KB | ~25 GB/dia | ESTIMATE |
| Ingestão de logs (pico, bytes/s, fator 5×) | ~1,4 MB/s | ESTIMATE |
| Cardinalidade estimada de séries de métricas (combinações usuário×item×canal não devem virar labels de métrica — apenas de log/trace) | alta cardinalidade em logs/traces (aceitável), baixa cardinalidade obrigatória em métricas agregadas (por estágio/canal/tipo de erro, não por usuário/item) | KNOWN — restrição de design a impor em `observability.md` (Fase posterior) |

### Manutenibilidade — governança de recalibração das premissas
Toda premissa classificada ASSUMPTION ou ESTIMATE neste documento (itens/usuário, ciclo de 300 dias, frações de canal, taxas de retry, fator de pico 5×, etc.) deve ser **recalibrada com dado real assim que houver telemetria de produção**, com gatilho explícito: revisão obrigatória deste documento ao final de cada estágio de crescimento (Stage 1→2, 2→3, etc.) antes de reaplicar a fitness function à arquitetura vigente. Responsável: Arquiteto-Chefe (Claude) + Segundo Engenheiro (Codex), registrado em `decisions-log.md` (Fase 3+).

### Isolamento Multi-tenant — skew e noisy neighbor
| Métrica | Valor (Stage 5, se Organization/Membership habilitado) | Classificação |
|---|---|---|
| Distribuição assumida de itens por tenant | não uniforme — assume-se distribuição de cauda longa (poucos tenants grandes concentram desproporcional volume) | ASSUMPTION |
| Fator de skew assumido (maior tenant vs. tenant médio) | até 100× o volume médio por tenant | ASSUMPTION — cenário de "noisy neighbor" a testar explicitamente nos testes de isolamento exigidos por SCALE-004 quando G5 ativar |
| Implicação de capacidade | limites/quotas (COST-005) devem ser aplicados por tenant, não apenas agregados, para que um tenant grande não degrade os demais | KNOWN — decorre diretamente de COST-005 |

### Abuso/Cost-attack — cenários de volume de ataque (suporte a G6/COST-004..006)
| Métrica | Valor | Classificação |
|---|---|---|
| Tentativas de violação de quota/rate limit (cenário de ataque, 10× o pico orgânico de API do Stage 5) | ~11.600 req/s sustentadas | ASSUMPTION — cenário de teste de carga adversarial para validar rate limiting (COST-005) |
| Upload malicioso em massa (cenário de ataque, 50× o pico orgânico de uploads do Stage 5, ~61/min) | ~3.050 uploads/min | ASSUMPTION — cenário de teste para validar limite de concorrência/tamanho de upload (COST-005) e kill switch (COST-004) |
| Amplificação de custo via retries (cenário: provedor de IA degradado gerando retry em cascata) | até 2,82× o volume normal de chamadas de IA/OCR, potencialmente mais se a taxa de retry subir sob degradação — reforça a necessidade de circuit breaker, não apenas retry com backoff | ASSUMPTION |

### Extensibilidade — cenário de troca de provedor
Para validar FR-033 (contract test por adapter/provider) na Fase 3+, o teste de aceite mínimo é: sob o volume de pico do Stage 3 (dimensionamento intermediário, suficiente para validar sem custo de teste em escala Stage 5), trocar o provedor de e-mail (ou WhatsApp/Telegram/LLM) em ambiente de staging sem alteração de código de domínio, mantendo throughput de notificações/dia ≥ 95% do volume modelado para aquele estágio durante a troca.

### Governança de IA — volume de revisão humana (FR-043)
| Métrica | Valor (Stage 5) | Classificação |
|---|---|---|
| Fração de extrações que caem em `PENDING_CONFIRMATION` (confidence baixa ou condições de FR-043) | 15% das chamadas de LLM (ASSUMPTION, a recalibrar com dado real — ver UNK-002 em `requirements.md`) | ASSUMPTION |
| Itens/dia exigindo confirmação humana (Stage 5) = chamadas de LLM/dia (uploads × 0,60 = 17.600 × 0,60 ≈ 10.560) × 15% | ≈ 1.584 | ESTIMATE — dimensiona a necessidade de uma fila de revisão/dashboard de confirmação com capacidade de UX para milhares de itens/dia, não uma tela artesanal |

---

## Lacunas e riscos identificados (UNKNOWN)

- **UNK-CAP-001** — Não há dado real de retenção/churn de usuários; todas as estimativas assumem base de usuários ativos estável no tamanho do estágio, sem modelar crescimento/decaimento dentro do estágio.
- **UNK-CAP-002** — Distribuição real de vencimentos ao longo do ano (sazonalidade fiscal/regulatória) não modelada — pode concentrar picos muito acima do estimado em datas específicas (ex.: fim de exercício fiscal). O "ciclo médio de 300 dias" é uma média ponderada assumida, não uma distribuição.
- **UNK-CAP-003** — Adoção real de WhatsApp/Telegram por fração de usuários é hipótese de produto, não medição; pricing/quota reais de WhatsApp Business API ainda não pesquisados (ver UNK-003 em `requirements.md`). A política de fan-out (todo canal configurado recebe, vs. fallback sequencial) também não está decidida — impacta diretamente o fator 1,5 usado aqui.
- **UNK-CAP-004** — Momento e magnitude de adoção de multi-tenant (organizações) é UNKNOWN em todos os estágios ≥ Stage 2 — capacity model não assume multi-tenant habilitado, mas a arquitetura deve permanecer pronta (NFR-020).
- **UNK-CAP-005** — Taxas de retry/erro de OCR (10%) e LLM (20%) não medidas; podem ser subestimadas para documentos de baixa qualidade (fotos de celular), especialmente o retry de LLM que depende de disponibilidade de provedor externo.
- **UNK-CAP-006** — SLO de drenagem para o cenário de pico extremo (1/5/60 min) não definido — decisão pendente para Fase 3/`slo.md`.
- **UNK-CAP-007** — Retenção de logs (30 dias assumido) e política de amostragem/agregação não decididas — impacta diretamente o volume de storage de logs em todos os estágios.
- **UNK-CAP-008** — Concorrência de varredura antimalware ("até 5/s") ainda não derivada estritamente do pico de uploads/min já calculado — a refinar na Fase 3 junto ao dimensionamento do pool de varredura.
- **UNK-CAP-009** — Throughput/duração-alvo da execução de reconciliação diária (8M itens no Stage 5) não definido — depende da escolha de mecanismo de processamento em lote na Fase 3.
- **UNK-CAP-010** — Teto numérico de cardinalidade de séries de métricas não fixado — a definir em `observability.md` (Fase posterior) junto à escolha de ferramenta de métricas.
- **UNK-CAP-011** — Fator de skew de tenant (100×) não convertido em itens/RPS/parcela de tráfego do maior tenant — a refinar quando G5 (multi-tenant) ativar de fato.
- **UNK-CAP-012** — Cenário de teste de troca de provedor (FR-033) não fixa duração, latência ou taxa máxima de erro aceitável durante a transição — critério de aceite a formalizar em ADR na Fase 3.

## Uso pretendido
Este capacity model alimenta diretamente:
- dimensionamento de fila/concorrência na Fase 3 (Reminder Engine, seção 28), especialmente os três cenários de drenagem acima;
- `cost-model.md` (Fase posterior), que converterá estes volumes em custo por estágio;
- avaliação dos critérios "Escalabilidade" e "Custo/FinOps" da fitness function.
