# OmniVence — Estado Atual + Próxima Ação

> Este arquivo é estado atual + próxima ação (`AGENTS.md` §2), nunca fonte normativa e nunca histórico narrativo — história detalhada vive em `docs/architecture/{session-log,decisions-log}.md`, `docs/engineering/decisions-log.md` e nas pastas `reviews/`. Cada linha abaixo deve caber em 1-3 frases: o quê + status + referência D-xxx/E-xxx para detalhe completo. **Recompactado em 2026-09-28 (quarta reconciliação — a anterior foi 2026-09-24) — o arquivo reacumulou itens resolvidos com a narrativa completa em vez de só o ponteiro que a própria regra abaixo exige.** Itens resolvidos = 1 linha, sempre. Nunca reconte a narrativa de um D-número que já tem linha completa em `decisions-log.md`.

## Branch / as-of

**Nome da aplicação (Marcelo, 2026-09-25): `OmniVence`.** `Expiration Tracker` é nome histórico. A mudança é só de identidade — repositório, recursos AWS, namespaces e identificadores técnicos permanecem (D-333).

**Não confie nesta seção sem confirmar.** `git branch --show-current` deve ser `develop`; `git log --oneline -5`/`git status`/`git pull` antes de assumir qualquer coisa abaixo como pendente ou concluído.

**Padrão de trabalho autônomo (Marcelo, 2026-09-01)**: prosseguir continuamente enquanto houver trabalho real a fazer — nunca parar para pedir "posso continuar?". Só pausar quando o próximo passo depender genuinamente de decisão exclusiva de Marcelo.

**Protocolo Claude↔Codex** (`AGENTS.md` §4) vale normalmente para toda decisão nível 5-6.

## Fase atual

`Consolidation + Pilot Readiness`, recomendação **CONDITIONAL GO**. M0-M12, Multi-User B2B (15 waves), Domínio Documental e Roadmap competitivo P0 completos. Pendências residuais não-engenharia: **E-019** (jurídico, bloqueia WhatsApp com usuário real) e validação visual final de Marcelo. Detalhe: `decisions-log.md` D-143 a D-349.

## Pendências reais que dependem de decisão ou trabalho futuro

Itens resolvidos = só ponteiro. Itens abertos mantêm o suficiente para retomar sem reler o histórico completo.

1. **Busca OCR/full-text** (backlog P1 item 3) — 🔴 bloqueado, escolher entre 3 caminhos em D-202.
2. `--include-cognito` de `scripts/reset-dev-data.ts` contra `dev` — postergado, não perguntar de novo até Marcelo sinalizar.
3. **WhatsApp com usuário real** — engenharia 100% fechada (D-286/D-328); resta só E-019 (jurídico).
4. Wave 1b (Design System, componentes com overlay/focus-trap) — deliberadamente por último, pedido de Marcelo.
5. User Validation (planejamento de interface) — aguarda sinal explícito dele.
6. Aplicar ao Claude for Startups Program — exige ação direta de Marcelo. Ver `docs/project/integrations-and-tooling-research-2026-09-11.md` §6.
7. P0.5 "Real System E2E" contra `dev` real — deliberadamente adiado, Marcelo 2026-09-14.
8. Versionamento completo de `Document` (item-level) — **SUSPENSO por Marcelo (2026-09-23)**, não retomar sem pedido explícito.
9. Toggle real de canal (E-mail/WhatsApp) — adiado por Marcelo (D-327), não iniciar sem pedido explícito.
10. **Um `OWNER` poder possuir mais de uma organização** — decidido (limitado por plano), não implementado; aguarda a estratégia de planos pagos fechar (D-345).
11. **Worker de entrega de e-mail (M4)** — **RESOLVIDO (2026-09-29, pedido explícito de Marcelo)**. Protocolo Claude↔Codex convergido em 5 rodadas (D-337, 9,1/9,1), desenho completo em `docs/architecture/reviews/m4-email-worker-durability-scoping/estado-final-consolidado.md`. Bug pré-existente (`RECONCILE_UNKNOWN` sem OCC) já corrigido como código real. **O mecanismo de lease único/backoff/orçamentos/condições transacionais aprovado no desenho ainda não foi implementado** — próxima ação real deste item é essa implementação, não mais rodadas de protocolo.
12. **Corrida de renovação de sessão do BFF** (achado real, scan direto de `dev` — revogação+recriação de sessão saudável em 2026-09-26) — investigação mais profunda pendente antes de propor correção via protocolo. Fila: só depois do item 11 (mesma prioridade que Marcelo já deu antes).
13. **Auditoria de segurança round3, blocos 4-5** (D-336) — bloco 4 (WhatsApp) estava bloqueado por trabalho não commitado de outra sessão, hoje desbloqueado (D-328 fechou o item 26 que o gateava). SEC-R2-01 (IAM tenant-facing residual) e SEC-R2-05 (confirmar assinatura SNS) esperam decisão de Marcelo, não são engenharia pendente.
14. **Auditoria de arquitetura de dados** (D-335) — eixo (c) módulos/fluxos e (d) retenção LGPD fechados; eixo (a) modelo físico parcial (GSI8 documentado, resto pendente); eixo (b) OCC/idempotência fora do outbox **nunca investigado** — confirmado 2026-09-28, nenhum arquivo novo na pasta de auditoria desde 2026-09-25.
15. **D-348 (transferência de titularidade de organização)** — desenho convergido e **backend implementado por completo** (serviço, Action, auditoria, rota HTTP, testes) em 2026-09-28. Não construído: step-up authentication (adiamento formalizado, gatilho: primeiro usuário real ou outra ação `OWNER_ROLES` ganhar step-up primeiro) e a UI de frontend.
16. **D-349 (disclosure de IA em A07/A12)** — desenho convergido e **implementado por completo** (leitura, confirmação HTTP de A12 que nunca existira, componente de disclosure no frontend) em 2026-09-28. Não construído: confirmar/rejeitar uma sugestão pela própria interface (as rotas existem, os botões não).
17. Múltiplos owners/admins por organização por tier de plano — **decidido por Marcelo (2026-09-28): não criar sub-limite**, papel livremente atribuível dentro do teto de usuários já existente (`docs/project/pesquisa-owners-admins-por-plano-2026-09-28.md`). Mecânica de pagador/downgrade de organização ainda sem resolução técnica (D-346 §5.3) — não bloqueia nada hoje, ninguém pediu.
18. **Tela de Requisitos** — Marcelo mencionou ter adicionado um protótipo em `prototype/novasTelas` para o efeito de borda dos cards de filtro e a seção "Visão por situação"; o arquivo nunca chegou ao disco (confirmado 2026-09-28). Aguardando ele reenviar ou apontar o caminho certo.
19. Itens 0-9 (numeração de sessões anteriores), 11, 19-26, 28-29, 31-33, 35, 37-39 (numeração antiga) — todos **RESOLVIDOS**, ver `decisions-log.md` D-315 a D-344 pelo tópico; não recontados aqui.
20. **D-350 (latência de carregamento de dados)** — UI implementada/deployada, desenho A+B implementado/deployado em `dev`, e **validação pós-deploy executada de verdade (2026-09-29)**: `docs/architecture/reviews/lambda-latency-validation-scoping/resultado-execucao.md`. Sourcemap confirmado íntegro contra os ZIPs reais (3 handlers testados). `bff-handler` (único com amostra "depois" natural suficiente): -18,1% de mediana de `Duration` quente, mas não significativo estatisticamente (`p=0,103`, n pequeno) — **sem diferença mensurável confirmada**, sem regressão, sem erro. Os outros 4 handlers de A ficaram **inconclusivos** por falta de tráfego natural na janela "depois" (2 nunca tiveram tráfego nem no "antes"); smoke funcional aprovado nos 4 via rajada sintética. Nenhum rollback acionado. **Pendência real**: repetir a coleta natural (sem rajada) depois de alguns dias de uso, pra ter amostra suficiente e um veredito estatístico de verdade nos 4 handlers que ficaram inconclusivos e reforçar a confiança do resultado de `bff-handler`.

## Próxima ação recomendada

**Pedido explícito de Marcelo (2026-09-29): resolver em sequência os itens 11/12/13/14/18 (trabalho técnico genuinamente aberto) + 15/16 (trabalho parcial de frontend).** Item 18 (Tela de Requisitos) continua bloqueado por ele mesmo (protótipo nunca chegou ao disco) - pular e seguir, não travar a fila por causa dele. Ordem recomendada (mais antigo/mais arriscado primeiro, fork serial): 11 (M4) → 12 (corrida BFF) → 13 (auditoria segurança) → 14 (auditoria dados) → 15/16 (UI D-348/D-349) → checar 18 por último (só pra ver se Marcelo já mandou o protótipo).

### Prompt sugerido para retomar esta fila

> Resolva em sequência (fork serial, uma frente de cada vez, não paralelizar sem eu pedir velocidade):
>
> 1. **M4 (worker de entrega de e-mail, item 11)** — Rodada 2 do protocolo Claude↔Codex nunca rodou desde a Rodada 1 (D-337, 6,8/10, `docs/architecture/reviews/m4-email-worker-durability-scoping/`). Antes de propor qualquer mecanismo novo, corrija primeiro o bug pré-existente que o Codex achou na Rodada 1: `RECONCILE_UNKNOWN` em `dynamodb-notification-store.ts` usa `store.update()`/`PutCommand` sem condição, podendo sobrescrever um `ACCEPTED`/`DELIVERED` já persistido - sem isso corrigido, nenhum mecanismo de fencing novo é seguro. Considere a sugestão do Codex (dispensar o segundo lease, uma única transação OCC consumindo o ponteiro pendente e criando o outbox atomicamente) em vez de espelhar literalmente `DocumentPurgeWorker` (e-mail não é idempotente como deletar do S3). Nível 5-6, protocolo obrigatório (`AGENTS.md` §4), mínimo 3 rodadas.
> 2. **Corrida de sessão do BFF (item 12)** — achado real de scan direto em `dev` (revogação+recriação de sessão saudável em 2026-09-26). Investigação mais profunda ainda pendente antes de propor correção - não pule direto pra uma correção sem entender a causa raiz primeiro.
> 3. **Auditoria de segurança round3, blocos 4-5 (item 13, D-336)** — bloco 4 (WhatsApp) estava bloqueado por trabalho não commitado de outra sessão, já desbloqueado (D-328 fechou o item que gateava). Retome de onde a auditoria parou.
> 4. **Auditoria de arquitetura de dados, eixo (b) (item 14, D-335)** — OCC/idempotência fora do outbox nunca foi investigado (eixos (c) e (d) já fechados, eixo (a) parcial). Foque só no eixo (b) nesta rodada.
> 5. **D-348 (item 15)** — backend completo (serviço/Action/auditoria/rota HTTP/testes). Falta a UI de frontend de transferência de titularidade de organização. Step-up authentication continua formalmente adiado (não implementar agora, gatilho já registrado).
> 6. **D-349 (item 16)** — leitura/disclosure de IA já implementados em A07/A12. Falta só os botões de confirmar/rejeitar uma sugestão pela própria interface (as rotas HTTP já existem, D-193/D-349).
>
> Ao final de cada item, aplicar a skill `/task-checklist` antes de considerar concluído (DoD por item). Itens de nível 5-6 (M4) exigem o protocolo Claude↔Codex completo antes de implementar; itens de nível 3-4 (BFF, auditorias, D-348/D-349 UI) não exigem protocolo, mas ainda passam pela checklist. Ao terminar todos, checar rapidamente se `prototype/novasTelas` (item 18, Tela de Requisitos) já recebeu o arquivo que Marcelo mencionou - se sim, seguir para essa tela; se não, deixar como está e reportar o que foi concluído.

**Regras permanentes**: `terraform apply` NUNCA roda localmente (só via CD); `plan`/`validate`/`fmt`/`test` locais liberados. Antes de PR `develop`→`main`: sempre rodar suíte e2e completa sem filtro e conferir o CI real do PR. Paralelização multi-agente: default é fork serial, só paralelizar se Marcelo pedir velocidade explicitamente. `docs/engineering/task-completion-checklist.md`/skill `/task-checklist` — uso obrigatório ao fim de toda tarefa.

## Programa de Performance — ENCERRADO (Marcelo, 2026-09-19/21)

Escada 10k→100k→500k encerrada, não retomar sem novo pedido explícito. Detalhe: `decisions-log.md` D-299 a D-310, `docs/engineering/performance/TODO.md`. Backlog registrado, não implementado: `dispatch-outbox-relay-processor.ts` processa lotes sequencialmente (~14/s) — risco se 100k/500k reproduzirem o gargalo.

**Achados incidentais registrados, não bloqueantes**: gate `Authenticated k6 smoke` com flakiness de cold start; ADOT descarta lotes de trace sob carga sustentada; `cd.yml`'s `on.workflow_run.branches` não restringe de fato o branch do deploy (contornável com dispatch manual, `if` do job merece reforço com `head_branch` explícito).

## Status de evidência (não presumir E2E sem checar)

A maioria dos mecanismos do roadmap está `IMPLEMENTED`/`UNIT TESTED` e confirmada `Active` contra `dev`, mas **nem todo mecanismo tem prova E2E de ponta a ponta pelo gatilho real** — nomeado individualmente onde relevante em `decisions-log.md`. Não assumir E2E PROVEN sem checar.

## Links para histórico (não reler por padrão — só sob demanda)

- `docs/architecture/session-log.md` — linha do tempo compacta, uma entrada por sessão.
- `docs/architecture/decisions-log.md` / `docs/engineering/decisions-log.md` — toda decisão com nota Claude/Codex e status (D-0xx / E-0xx).
- `docs/architecture/reviews/` — artefatos de cada rodada Claude↔Codex por tema.
- `docs/project/handoffs/` — prompts de handoff de sessões anteriores, superseded por este arquivo.
- `docs/frontend/` — planejamento de interface + `interface-quality-standard.md` + `prototype/`.
- `docs/architecture/multi-user-b2b-wave-tracker.md` — detalhe fatia-a-fatia do Multi-User B2B.
