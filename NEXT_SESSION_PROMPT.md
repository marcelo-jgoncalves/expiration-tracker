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
12. **Corrida de renovação de sessão do BFF — RESOLVIDO (2026-09-29, D-351)**. Causa raiz real: `BffAuthService.refresh()`'s caminho `INVALID_GRANT` usava `sessionStore.update()` sem condição — sob lease de 5s expirada por uma chamada Cognito lenta, uma resposta atrasada podia sobrescrever cegamente uma sessão saudável já renovada por outra requisição de volta pra revogada. Corrigido com `updateConditional`, teste de regressão novo confirmado.
13. **Auditoria de segurança round3 — COMPLETA (2026-09-29, D-336)**. Blocos 4-5 fechados: 1 achado real registrado (falta de teto agregado por número de destino no cooldown de reenvio do WhatsApp phone confirmation — só relevante quando E-019 liberar o canal, risco zero hoje), Bloco 5 sem achado. R3-01/R3-02 (blocos 1-3) continuam pendência real de sessão dedicada (sistema distribuído de reminder scan). SEC-R2-01 (IAM tenant-facing residual) e SEC-R2-05 (confirmar assinatura SNS) esperam decisão/ação de Marcelo, não são engenharia pendente.
14. **Auditoria de arquitetura de dados** (D-335) — eixos (c)/(d) fechados desde 2026-09-25; **eixo (b) CONCLUÍDO em 2026-09-29** (1 achado real corrigido: `IdempotencyStore.complete()` usava `update()` sem condição, mesma classe de D-337/D-351, não exploitável hoje mas hardened por consistência; 2 fakes de teste corrigidos). Eixo (a) (modelo físico completo) continua parcial (GSI8 documentado, resto pendente).
15. **D-348 (transferência de titularidade de organização)** — **RESOLVIDO (2026-09-29)**: backend (2026-09-28) e UI de frontend (2026-09-29) ambos implementados por completo. Não construído: step-up authentication (adiamento formalizado, gatilho: primeiro usuário real ou outra ação `OWNER_ROLES` ganhar step-up primeiro).
16. **D-349 (disclosure de IA em A07/A12)** — **RESOLVIDO (2026-09-29)**: leitura + confirmação HTTP de A12 (2026-09-28) e botões de confirmar/rejeitar na interface (2026-09-29) todos implementados. Achado real corrigido no processo: o contrato de leitura nunca expunha `ExtractionRun.version`, adicionado `runVersion` (mudança aditiva, nível 2).
17. Múltiplos owners/admins por organização por tier de plano — **decidido por Marcelo (2026-09-28): não criar sub-limite**, papel livremente atribuível dentro do teto de usuários já existente (`docs/project/pesquisa-owners-admins-por-plano-2026-09-28.md`). Mecânica de pagador/downgrade de organização ainda sem resolução técnica (D-346 §5.3) — não bloqueia nada hoje, ninguém pediu.
18. **Tela de Requisitos (A11) — segunda rodada RESOLVIDA (2026-09-30)**: hero + 6 cards já vinham do D-352; esta rodada adicionou o dropdown "Todos os fornecedores" (client-side, sem endpoint novo, `supplierFilter` sobre os hits já buscados pelas 5 queries de status) + contador de resultados no Toolbar, e o campo "Observação" (opcional) no modal "Novo requisito" (`Requirement.notes`/`CreateRequirementInput.notes` já existiam no contrato, só não estavam expostos). `typecheck`/`lint`/suíte completa (58 arquivos/487 testes) verdes; teste novo cobrindo o filtro por fornecedor. Nível 3 (wiring de campo já existente no contrato + filtro client-side), protocolo Claude↔Codex não obrigatório.
22. **Pendência nova (Marcelo, 2026-09-30): animação de carregamento (`InitialLoading`, `AsyncStates.tsx`) maior e centralizada na tela** — hoje é um spinner pequeno inline (`ui-inline-loading`/`ui-spinner`, texto ao lado), usada em ~25 telas (D-350). Marcelo quer maior e no centro da tela. Não implementado ainda — avaliar impacto nas telas que já embutem `InitialLoading` num layout específico (algumas podem já centralizar via container pai) antes de mudar o componente compartilhado.
23. **Pendência nova (Marcelo, 2026-09-30): avaliar se o "hero" roxo do topo das telas é de fato um componente reutilizável.** Já existe `OmniHero` (`src/components/OmniHero.tsx`) usado em 5 telas (Vencimentos, Fornecedores, Membros, Atividade, Requisitos) — a pendência é uma auditoria real: confirmar que toda tela que deveria usá-lo já usa (nenhuma reimplementação paralela), e que a API cobre as variações reais de conteúdo sem gambiarra por tela. Não iniciado.
24. **Pendência nova (Marcelo, 2026-09-30): aplicar o estilo do protótipo à tela de Revisões (`ReviewQueue.tsx`), respeitando a fonte do projeto** — não importar a família de fonte do arquivo de protótipo, usar `var(--font-family-sans)` (`tokens.css`, hoje `"Plus Jakarta Sans Variable"`). Arquivo copiado a pedido de Marcelo para `prototype/novasTelas/OmniVence-revisoes-prototipo.html` (fonte: `prototype/ui_kits_2/webapp/screens-package-2/standalone/08 - Fila de Revisao.html`, um kit mais antigo). **Achado real ao copiar**: diferente dos outros arquivos de `novasTelas/` (HTML estático autocontido), este é um export de sandbox Babel/React com `<script type="text/babel" src="<uuid>">` apontando para arquivos externos que não vieram junto — o HTML sozinho não renderiza fora do editor original, e usa `JetBrains Mono` (não `Plus Jakarta Sans`) em parte do CSS. Antes de usar como referência visual real: confirmar com Marcelo se este é de fato o protótipo pretendido ou se um export mais recente/completo (mesmo padrão do de Requisitos) ainda vai chegar.
19. Itens 0-9 (numeração de sessões anteriores), 11, 19-26, 28-29, 31-33, 35, 37-39 (numeração antiga) — todos **RESOLVIDOS**, ver `decisions-log.md` D-315 a D-344 pelo tópico; não recontados aqui.
20. **D-350 (latência de carregamento de dados)** — UI implementada/deployada, desenho A+B implementado/deployado em `dev`, e **validação pós-deploy executada de verdade (2026-09-29)**: `docs/architecture/reviews/lambda-latency-validation-scoping/resultado-execucao.md`. Sourcemap confirmado íntegro contra os ZIPs reais (3 handlers testados). `bff-handler` (único com amostra "depois" natural suficiente): -18,1% de mediana de `Duration` quente, mas não significativo estatisticamente (`p=0,103`, n pequeno) — **sem diferença mensurável confirmada**, sem regressão, sem erro. Os outros 4 handlers de A ficaram **inconclusivos** por falta de tráfego natural na janela "depois" (2 nunca tiveram tráfego nem no "antes"); smoke funcional aprovado nos 4 via rajada sintética. Nenhum rollback acionado. **Pendência real**: repetir a coleta natural (sem rajada) depois de alguns dias de uso, pra ter amostra suficiente e um veredito estatístico de verdade nos 4 handlers que ficaram inconclusivos e reforçar a confiança do resultado de `bff-handler`.
21. **D-353/D-354 (expansão de posicionamento além de "fornecedores") — CONVERGIDO (2026-09-29/30, 6 rodadas, Codex 9,2/Claude 9,3)**. Pesquisa de mercado de 5 nichos adjacentes + contabilidade, com o mesmo teste aplicado a todos (qual trabalho recorrente fica manual, por que alguém pagaria por ferramenta nova). Recomendação: construção civil é a hipótese mais forte, RH é alternativa válida, frotas menor prioridade (nenhum descartado), seguros/condomínios/imobiliárias despriorizados (não inviáveis), contabilidade continua em comparação ativa (não vencedora provada). **Próximo passo é decisão/ação de Marcelo** (entrevistas reais em construção civil E contabilidade) — não é mais item de engenharia ou protocolo. Ver `docs/architecture/reviews/expansao-vertical-alem-fornecedores/estado-final-consolidado-pesquisa-nichos.md` e `docs/project/pesquisa-nichos-adjacentes-2026-09-29.md`. **Recalibrado por meta real de renda (~R$5k/mês, ~35-85 clientes, não domínio de mercado)** — reforça, não contradiz, a recomendação de profundidade em 1-2 nichos.

## Próxima ação recomendada

Item 18 (Tela de Requisitos, segunda rodada) está resolvido. Próximas ações reais, nenhuma bloqueada por decisão de Marcelo: item 22 (`InitialLoading` maior/centralizado) e item 23 (auditoria de reuso do `OmniHero`) — ambas pendências novas de UI, nível 1-2 esperado, calibrar pela escala de risco antes de codar.

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
