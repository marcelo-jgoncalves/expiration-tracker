# Prompt de início — próxima sessão (gerado em 2026-09-01, v2)

> Cole o texto abaixo (a partir de "Leia") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — o `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque. **Supersede `2026-09-01-session-starter-prompt.md`** (mesmo dia, sessão seguinte — os itens 1-4 daquele prompt já foram todos fechados nesta sessão).

---

Leia `NEXT_SESSION_PROMPT.md` e `AGENTS.md` inteiro antes de qualquer coisa. Confirme `git branch --show-current` (deve ser `develop`), rode `git pull`, e confirme que `develop` está sincronizado com `main` (`git fetch origin main && git diff origin/main..develop --stat` deve dar vazio).

**Padrão de trabalho autônomo (reforçado por Marcelo, 2026-09-01 — vale para toda sessão futura, não só esta): prossiga de forma totalmente autônoma e contínua enquanto houver qualquer trabalho de engenharia real e não-ambíguo a fazer. Não pare a não ser que genuinamente não haja mais nada a fazer.** Nunca pare para perguntar "posso continuar?". Qualquer coisa que dependa de uma decisão que só Marcelo pode tomar (decisão de produto/preço, ação destrutiva/irreversível, gasto real de infra novo, ou algo que o protocolo Claude↔Codex do `AGENTS.md` §4 formalmente exige elevar a ele) deve ser **adiada, não perguntada** — registre o pendente claramente em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` e siga imediatamente para a próxima frente de trabalho independente disponível. Nunca fique ocioso esperando resposta enquanto houver outra tarefa executável. Só pare de fato quando esgotar toda frente real disponível — nesse ponto, e só nesse ponto, resuma o que foi feito e o que ficou pendente de decisão dele.

Para qualquer decisão de arquitetura/segurança/dado/produto real (Type 1, nível 5-6 da escala de risco, ou qualquer coisa que o próprio Marcelo pediu para passar pelo protocolo), use o protocolo Claude↔Codex completo (pesquisa externa quando aplicável — E-014 —, mínimo 3 rodadas, nota cega, gate ≥9.0 sem arredondar, `codex exec --skip-git-repo-check "<prompt>"` em primeiro plano, nunca combinar `- < arquivo.txt` com `&`). Para decisões que o próprio scoping classificar como nível 3-4, implementação direta com julgamento de engenharia é suficiente — não assumir protocolo completo para tudo a priori (correção de governança registrada em D-161 Rodada 2: proporcionalidade real, não "protocolo em tudo").

## Estado ao final desta sessão (2026-09-01, contínua da sessão anterior no mesmo dia)

5 decisões fechadas e **mergeadas em `main`** nesta sessão, todas via protocolo Claude↔Codex quando o risco justificou:

1. **D-157 — ESLint 8→10 (root)**: migrado para flat config (`eslint.config.js`). Achado real no caminho: `eslint .` sem `--ext` no ESLint 8 nunca lintou `.ts` de verdade em CI (só achava 1 arquivo `.js`) — corrigido incidentalmente pela migração, 23 erros/9 avisos reais revelados e corrigidos. Frontend continua em ESLint 8 (bloqueio real de upstream, `eslint-plugin-jsx-a11y` sem suporte a ESLint 10 ainda — dívida EOL registrada, não esquecida).
2. **D-157b — fix de CI**: a própria migração quebrou o job `frontend` (ESLint 8 do frontend pegando o flat config do root entre diretórios) — corrigido com `ESLINT_USE_FLAT_CONFIG=false`.
3. **D-158 — `Membership.removedAt`**: campo adicionado, gravado/limpo nos 3 write paths reais (`remove-membership.ts`/`leave-organization.ts`/`accept-invitation.ts`). Destrava o relógio da purga LGPD `ACCOUNT_ACTIVE` (Prioridade 5 de D-127) — **o worker de purga em si (Membership/NotificationPreferences) ainda não foi implementado**, só o campo.
4. **D-160 — remoção completa de `UserProfile`**: fecha D-C de D-136 (hot path) de verdade, não só mais barato. 4 rodadas de protocolo (5,5→6,8→8,7→9,2) — achado real: entidade write-only sem nenhum leitor, campos duplicados de `GlobalUser`/`IdentityMapping`. `docs/architecture/{privacy-lgpd.md,data-model.md}` emendados.
5. **D-161 — Roadmap Competitivo reconciliado**: Marcelo trouxe `docs/project/roadmap-competitivo-2026-09-01.md` (26 features, P0/P1/P2) pedindo ordem de trabalho via protocolo. 3 rodadas (7,6→9,2→9,6). Reconciliação factual dos 10 itens P0 contra o código real + macro-ordem técnica + 4 decisões fundacionais escalonadas. **Puramente design/ordem — nenhum código de feature implementado ainda.**

CI 4/4 verde em todo push, suíte 1662/1662, `develop`/`main` sincronizados, confirmado ao vivo.

## Próxima ação real (não é "pergunte a Marcelo o que priorizar" — já foi decidido em D-161)

O spike de auditoria dos itens 4/9/10 de D-161 **já começou** nesta sessão, não terminou. Achados reais já registrados em `NEXT_SESSION_PROMPT.md`/`decisions-log.md` D-161 — **leia a seção "Próxima ação" de `NEXT_SESSION_PROMPT.md` para o detalhe completo antes de decidir o próximo passo**, resumo aqui:

1. **M7/extração confirmado 100% acoplado ao `Document` antigo (M6)**, não ao novo `document-archive` de D-143 — confirma a decisão fundacional #3 (fronteira M7↔`DocumentVersion`) como real.
2. **Achado que muda a classificação da decisão fundacional #1 (`DocumentFile`)**: o design já existe por completo em D-143 §6 (`estado-final-consolidado.md` do `document-domain-scoping`) — N arquivos por Version, 1 PRINCIPAL, imutabilidade pós-ACCEPTED, scan PENDING/CLEAN/INFECTED. Os contadores (`pendingFileScans`/`infectedFileScans`) **já existem** em `document-version.ts`. Só falta implementar a entidade `DocumentFile` em si (adiada deliberadamente como "follow-up slice" quando o Núcleo 1 fechou). **Provavelmente nível 3-4 (implementação direta de decisão já aprovada), não nível 5** — confirmar com scoping rápido antes de decidir se ainda precisa de protocolo completo.
3. **Ainda não re-verificado nesta continuação**: o estado real do item 9 (guest upload) — D-161 registrou "guest upload só cria metadados, nunca recebe/presigna arquivo real", mas isso não foi re-confirmado ao vivo depois do achado sobre `DocumentFile` acima.

Depois de terminar o spike: implementar `DocumentFile` (se o scoping confirmar nível 3-4, direto; se nível 5, Rodada 1 do protocolo) é o próximo item real da macro-ordem de D-161 (item 10 da lista — Storage — vem logo depois da auditoria, antes de Document Types/OCR/Templates/etc.). Ver a macro-ordem completa e as outras 3 decisões fundacionais em `docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md`.

**Wave 1b (Design System) continua deliberadamente por último** — pedido explícito de Marcelo, não mudou. **D-D do hot path** (`EphemeralTelemetryMutation`) segue sem nenhuma investigação nova, nomeado como precisando de sessão dedicada com teste adversarial obrigatório.

Se o spike revelar que ALGUM dos 10 itens P0 (ou uma das 4 decisões fundacionais) depende de uma decisão de produto que só Marcelo pode tomar — registre e siga para o próximo item da macro-ordem, não fique parado esperando resposta.

## Padrões operacionais validados nesta sessão (repita-os)

- **Protocolo Claude↔Codex funcionou bem em rodadas curtas e focadas** (1-4 rodadas) quando o prompt de cada rodada incluía trechos exatos de código/config já lidos, não paráfrase — o Codex corrigiu achados factuais reais (bug de GSI2 nunca gravado, campo `tenantId` já removido de `IdentityMapping`, M7 acoplado ao modelo antigo) que só apareceram porque o contexto tinha citação literal, não resumo.
- **Antes de aceitar "já implementado"/"quase pronto" na sua própria leitura, force uma segunda leitura via Codex** — nesta sessão, minha primeira reconciliação do roadmap competitivo (itens 4/9/10) foi otimista demais; o Codex, com o mesmo código disponível, achou gaps estruturais reais que eu tinha deixado passar. Rodadas de protocolo não são só para decidir — são para checar seu próprio trabalho de investigação.
- **Rode a suíte completa de gates você mesmo antes de cada push** (`typecheck`, `lint --max-warnings=0`, `npm test`, `check-boundaries`, `check-docs`, `validate-schemas`, `build:lambdas`) — não confie só no CI remoto antes de decidir que está pronto para PR.
- **G-V3 ao vivo, sempre**: reintroduza a mutação real no código (não um stub), rode o teste, confirme que falha, só então reverta antes do commit — feito em D-158/D-160 desta sessão, pegou exatamente o tipo de bug que teste "verde por acidente" deixaria passar.
- **Capture o `databaseId` do run de CI ANTES do push/trigger, espere um `databaseId` diferente aparecer, só então faça polling desse run específico** — nunca faça polling de "existe um run completo" genérico (`AGENTS.md` §4, achado recorrente de sessões anteriores, continua válido).
- **PRs sequenciais, nunca paralelos, quando tocam `decisions-log.md`/`NEXT_SESSION_PROMPT.md`** — evita conflito de merge.
- **CD aplica sozinho em todo push a `main`** — depois de mergear, confirme via `aws ... --profile claude-dev` em vez de rodar `terraform apply` manualmente, quando a mudança tocar infra real.
- **Arquivos soltos na raiz** (Marcelo às vezes solta documentos de planejamento direto na raiz do projeto) são pegos pelo `check-docs` (`ROOT_MD_ALLOWLIST`) — mova para `docs/project/` e registre na seção "Material trazido pelo Marcelo, ainda não avaliado" de `NEXT_SESSION_PROMPT.md` antes de continuar, mesmo que o conteúdo pareça repetido/duplicado (confirme por diff/checksum antes de assumir).

## Leitura obrigatória antes da próxima ação

`AGENTS.md` §2 → `NEXT_SESSION_PROMPT.md` (seção "Próxima ação", já atualizada com os achados do spike) → `docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md` (macro-ordem completa + as 4 decisões fundacionais) → `docs/architecture/reviews/document-domain-scoping/estado-final-consolidado.md` §6 (design já aprovado de `DocumentFile`, ponto de partida real da decisão fundacional #1).
