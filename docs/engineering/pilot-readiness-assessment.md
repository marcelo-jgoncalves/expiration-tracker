# Pilot Readiness Assessment — Expiration Tracker

> Entregável final do "Consolidation + Pilot Readiness Program" (`expiration-tracker-next-days-master-plan-and-ai-prompt.md`, raiz, §42). Síntese do estado real verificado — não reintroduz achado nenhum, só aponta para `docs/engineering/pilot-readiness-program.md` (o backlog item-a-item que é a fonte de evidência) e para os documentos normativos citados. Data desta síntese: 2026-08-28. **Não é aprovação final** — é o material para o Marcelo decidir GO/CONDITIONAL GO/NO-GO com informação completa, honesta sobre o que foi PROVADO vs. só DESENHADO/TESTADO EM UNIDADE (disciplina do prompt mestre §34/§43).
>
> **Addendum (2026-08-28, sessão posterior à síntese original)**: o gate #2 abaixo (`GTR-01`/`W5-01`, guest trust/identidade do solicitante) **fechou** — ver `pilot-readiness-program.md`'s seção W5-01 e `decisions-log.md` D-060. O texto abaixo não foi reescrito (registro histórico do estado no momento da síntese) — só os gates #1 (`W3-06`) e #3 (Wave 2) continuam reais e abertos.

## 1. Executive Summary

O Expiration Tracker tem hoje uma base técnica sólida — arquitetura de domínio madura, CI/CD real, observabilidade real, autenticação real (Full BFF), frontend de produção real, e um core funcional (Vencimentos/Documentos/Lembretes) implementado de ponta a ponta com testes reais. A Wave 3 deste programa (concluída nesta sessão) auditou isolamento multi-tenant em profundidade — DynamoDB, S3, filas, GSIs, transações — e **não achou nenhuma vulnerabilidade cross-tenant explorável em lugar nenhum**. Isso é uma base de confiança real, não presumida.

Ao mesmo tempo, três gates reais e específicos impedem hoje um piloto que use os dois recursos mais sensíveis do produto (documentos reais de terceiros processados por IA, e o fluxo de guest upload externo) sem risco consciente e aceito:

1. **Retenção/purga de documentos reais não funciona** (`W3-06`) — só 1 de 9 classes de retenção definidas em `privacy-lgpd.md` tem purga física real; a classe que cobre documentos reais de usuário (`USER_DOCUMENT`) tem um campo que parece implementar a purga mas não aciona nada.
2. **Guest trust/identidade do solicitante não existe** (`GTR-01`/`W5-01`) — um fornecedor externo que recebe um link de upload não vê quem está pedindo o documento, risco de phishing já nomeado desde o planejamento de interface.
3. **Nenhum drill operacional real foi executado** (`Wave 2`, W2-03 a W2-08) — feature gate, DLQ/replay, restore, load test, credential-compromise, disparo de alarme real — nenhum desses foi provado contra o ambiente real, só desenhado/testado em unidade.

Nenhum desses três gates é um problema de arquitetura errada — são lacunas de escopo não fechado ainda, todas com caminho de correção já identificado. A recomendação desta síntese (§13) é **CONDITIONAL GO para um piloto deliberadamente estreito** que não dependa dos três gates acima, não um NO-GO geral.

## 2. Pilot Scope (hipótese avaliada)

Seguindo a hipótese já sugerida pelo próprio prompt mestre (§41) e corroborada de forma independente pelos achados desta sessão:

```text
Core Expirations (Vencimentos)
+ Reminders (lembretes reais, BLOCKER-B fechado)
+ Documents (upload/leitura reais, BLOCKER-A fechado, SEM M7/IA ligado sobre documento real de terceiro)
+ um tenant/empresa por vez
+ pequeno número de usuários (single-user-per-tenant hoje, Wave 4 confirmou)
+ SEM guest workflow externo (GTR-01 aberto)
+ SEM M7 (extração/IA) sobre documento real de terceiro (W3-06 aberto)
+ Billing manual/off (M12 já bloqueado por decisão de produto, D-052)
+ Platform Admin deferred (Wave 4, gated por gatilho comercial)
```

Essa é a superfície que os gates fechados nesta sessão (Wave 3 completa, BLOCKER-A/B/C) já cobrem com evidência real. Ampliar o escopo do piloto para incluir guest workflow ou M7/IA sobre documento real de terceiro **exige fechar os gates §1.1/§1.2 primeiro**, não é uma questão de "mais cuidado" — é um gap técnico real e nomeado.

## 3. Technical Gates por categoria

### 3.1 Segurança / Isolamento multi-tenant

**Status: PROVADO, não só desenhado.** Wave 3 completa (W3-01 a W3-05) auditou DynamoDB (PK/SK/GSI/transações), S3 (quarentena/clean/import/extraction-transient), filas SQS/EventBridge, e a cadeia de resolução de identidade (`RequestContextResolver`/`authorize()`). Resultado: **zero vulnerabilidade cross-tenant explorável encontrada** — todo acesso é escopado por `tenantId` derivado server-side (nunca de DTO de cliente), toda chave física exige `tenantId` obrigatório, 13 testes novos fecham gaps de cobertura que antes dependiam só de "isolamento por construção" sem prova executável. Único achado real corrigido: gap latente no redactor de log (`guestToken`/`cognitoSub` ausentes da denylist), fechado. Detalhe: `docs/engineering/pilot-readiness-program.md` §Wave 3.

### 3.2 LGPD / Privacidade

**Status: NOT READY para dado pessoal real em volume, READY para piloto sem documento real de terceiro.** `privacy-lgpd.md` define 9 classes de retenção — só `EXTRACTION_TRANSIENT` tem enforcement real de ponta a ponta (worker + lifecycle S3, testado). As outras 8, incluindo `USER_DOCUMENT` (documentos reais), não têm purga física funcionando (`W3-06`, achado de maior severidade desta sessão). DSR (acesso/exportação/exclusão) é 100% design-only (`W3-07`) — a exclusão hoje é só um flip de status por entidade, nunca uma cascata real, e a purga física nunca dispara de qualquer forma. `legalHold` não existe em código. Nenhum gatilho objetivo de RIPD disparou ainda (`W3-09`) — o mais próximo é uso de IA sobre documento real de titular, que só acontecerá quando `extraction_pipeline_enabled` for ligado para cliente real. Região AWS de produção segue não decidida (`W3-08`, ambiente `dev` real usa `us-east-1` como exceção explicitamente não-vinculante). Inventário de subprocessadores tecnicamente correto após correção de uma linha desatualizada (e-mail via SES, não "não escolhido").

### 3.3 Identity / RBAC

**Status: READY para single-tenant, NOT READY para multi-usuário/B2B.** Autenticação real via Full BFF (Cognito, cookies opacos, PKCE) — `APPROVED AS FRONTEND PRODUCTION FOUNDATION`, protocolo Claude↔Codex completo. `tenantId` hoje é literalmente `userId` (confirmado contra código real, `W4-01`) — não há Organization/Membership implementado, gated por decisão de negócio já registrada (`AGENTS.md` §1, gatilho comercial que não disparou). Isso é aceitável para um piloto single-tenant-per-user; bloqueia qualquer piloto que precise de múltiplos usuários por empresa cliente.

### 3.4 Operações

**Status: NOT PROVEN.** M7 teve uma verificação E2E real única contra `dev` (achou e corrigiu 2 bugs reais), mas nenhum dos drills sistemáticos do programa foi executado: feature gate on/off, reminder pipeline sob falha/retry, DLQ/replay sem duplicar side effect, restore real medindo RPO/RTO observado, load test contra o modelo de capacidade, exercício de credencial comprometida, e prova de que os alarmes críticos realmente disparam. Todos ficam `NOT STARTED` em `docs/engineering/pilot-readiness-program.md` Wave 2 (W2-03 a W2-08) — não porque foram esquecidos, mas porque envolvem ações reais contra `dev` (ligar gates, injetar falha) que esta sessão tratou como merecendo escopo/aprovação explícita antes de executar, dado o potencial de custo real (chamadas Textract/Bedrock) e mudança de comportamento do ambiente compartilhado.

### 3.5 Frontend / Design System

**Status: PROVISIONAL, explicitamente.** Visual Language + Design System Foundation implementado e aplicado às 5 superfícies do Core Expiration slice, protocolo Claude↔Codex completo (16 rodadas, o mais longo já executado neste repositório) — mas o próprio status é `APPROVED ... PROVISIONAL PENDING USER VALIDATION`, e User Validation está **suspensa por pedido explícito do Marcelo**, não teve nenhuma sessão com usuário real ainda. Um novo protótipo standalone diverge de propósito do Design System vigente (o Marcelo já sinalizou que vai atualizá-lo formalmente) — Wave 1 deste programa está deliberadamente parada até essa atualização acontecer, para não fazer trabalho descartável.

## 4. Known Limitations (não exaustivo — ver backlog para lista completa)

- `W2-01-DECISION`: M7 nunca atualiza `ExpirationItem.dueDate` automaticamente mesmo quando o pipeline de IA confirma um valor de alta confiança — decisão de produto pendente (auto-escrever vs. nunca auto-confirmar).
- `W3-06-DECISION`: purga física de documento real não funciona (ver §3.2).
- `W5-01-DECISION`: identidade do solicitante ausente no guest flow (ver §3.2/GTR-01).
- Nenhum teste com leitor de tela real (NVDA/VoiceOver) foi executado — `REQUIRED` antes de Pilot per `visual-language-and-design-system.md`.
- Baselines de regressão visual gravadas em `win32`, CI roda em `ubuntu-latest` — projeto Playwright `visual` não está no CI ainda (cobertura funcional equivalente existe via outro teste).
- Acesso direto ao `execute-api` do BFF (bypassando CloudFront) precisa de mitigação (header estático + WAF) antes de produção pública real.
- Sem cross-region DR (RPO≤5min via PITR mono-região, risco aceito conhecido, CON-002 de `architecture-fase3-consolidada.md`).
- Bedrock model/região seguem placeholder — decisão de modelo real não tomada.

## 5. Legal / Human Actions necessárias (a IA não pode decidir isto)

1. Decisão de região AWS de produção (bloqueia SCP/allowlist de transferência internacional).
2. Parecer jurídico formal sobre transferência internacional, DPA, RIPD, DPO — antes de lançamento comercial (`privacy-lgpd.md` §5).
3. `W2-01-DECISION`, `W3-06-DECISION`, `W5-01-DECISION` (ver §4) — decisões de produto/escopo, não correção mecânica.
4. Sinal explícito do Marcelo para retomar User Validation (continua pausada por pedido dele).
5. Atualização formal do Design System a partir do novo protótipo standalone (Wave 1 aguardando).
6. Confirmação de DPA efetivamente assinado com AWS além do padrão contratual (nunca verificado legalmente por esta auditoria técnica).

## 6. Evidence (índice, não repetição)

Toda evidência citada nesta síntese está em `docs/engineering/pilot-readiness-program.md` (Waves 0-5, item-a-item, com citação arquivo:linha por achado) e nos documentos normativos que ele referencia (`docs/architecture/privacy-lgpd.md`, `docs/frontend/README.md`, `NEXT_SESSION_PROMPT.md`). Nenhuma alegação nesta síntese é nova — é consolidação, não pesquisa original.

## 7. GO / CONDITIONAL GO / NO-GO

**Recomendação: CONDITIONAL GO — tecnicamente pronto para um Piloto Controlado no escopo estreito do §2, NÃO pronto para escopo mais amplo até os 3 gates do §1 fecharem.**

Justificativa: o objetivo deste programa nunca foi `PUBLIC PRODUCTION READY` (prompt mestre §43) — é chegar honestamente a `TECHNICALLY READY FOR CONTROLLED PILOT — WITH EXPLICIT PRODUCT/LEGAL LIMITATIONS` ou identificar exatamente o que ainda impede isso. Para o escopo estreito (Vencimentos + Lembretes + Documentos, um tenant, sem guest, sem IA sobre documento real de terceiro), os gates que importam — isolamento multi-tenant, autenticação, o core funcional — estão provados com evidência real, não presumidos. Para qualquer escopo mais amplo que inclua guest workflow ou processamento de IA sobre documento real de terceiro, a resposta honesta é `NOT READY` até `W3-06-DECISION`/`W5-01-DECISION` serem resolvidas — não é uma questão de confiança, é ausência real de mecanismo.

A lacuna mais séria para QUALQUER escopo de piloto, mesmo o estreito, é a ausência total de evidência operacional real (§3.4/Wave 2) — nenhum drill foi executado. Isso não bloqueia começar um piloto controlado e pequeno, mas é uma dívida real que deveria ser paga antes de qualquer aumento de escala ou de confiança operacional sobre o sistema (por exemplo, antes de aceitar SLA formal com o primeiro cliente).

**Pergunta final do programa (prompt mestre §44), respondida com honestidade**: esta rodada de trabalho reduziu risco real — achou e fechou uma vulnerabilidade de retry morta na ASL, achou e fechou um gap de redação de log, provou (não presumiu) isolamento multi-tenant em 5 áreas que não tinham prova antes, e — o mais valioso — trocou 3 suposições implícitas ("provavelmente está tudo bem") por 3 fatos verificados e nomeados (`W3-06`, `W5-01`, ausência de drill operacional) que agora podem ser decididos conscientemente em vez de descobertos por acidente depois.
