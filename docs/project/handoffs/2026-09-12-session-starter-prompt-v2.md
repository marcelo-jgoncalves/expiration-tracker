# Prompt de início — próxima sessão (gerado em 2026-09-12, v2)

> Cole o texto abaixo (a partir de "Retomando") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque no momento em que foi gerado (pode já estar desatualizado quando você o usar — confirme sempre contra `NEXT_SESSION_PROMPT.md`/`git`/CI antes de agir). **Substitui `2026-09-12-session-starter-prompt.md`** (a `ExternalShareLink` slice 2/3 que aquele prompt deixava pendente foi fechada por completo ainda naquela mesma sessão, D-273 — junto com P0.3/P0.6/P2.1/P0.4/P2.3/P2.4 da auditoria externa, todos deployados em `dev` com sucesso).

---

Retomando expiration-tracker. Prossiga de forma totalmente autônoma e independente — não espere meu comando para continuar, não pare para pedir confirmação em trabalho de engenharia reversível/decisão-independente. Antes de qualquer coisa:

1. Rode `ListAgents` e `CronList` — pode haver fork/heartbeat ainda ativos de sessão anterior.
2. Leia `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação) e as últimas entradas de `docs/architecture/decisions-log.md` (D-278 em diante, incluindo D-280/D-281/D-282) para se recontextualizar — não confie em nada que eu disser sem verificar contra o código/git/CI real primeiro. `git branch --show-current` deve ser `develop`; `git pull` antes de assumir qualquer coisa como pendente.
3. **Autonomia total já concedida e reforçada nesta sessão (2026-09-12, repetidas vezes por mim)**: prossiga com todo trabalho de engenharia possível sem esperar meu comando — commit sempre que uma unidade de trabalho fechar, mas **deixe o push para o final de blocos maiores de trabalho** (não a cada commit pequeno). PR/merge `develop→main` e verificação real do deploy em `dev` (nunca assumir, sempre `gh run` real) também autônomos. Só pause para: decisão de produto/arquitetura genuinamente minha, execução destrutiva/irreversível, ou o que `AGENTS.md` §4 exige elevar a mim. Registre o pendente e siga para outra frente independente — nunca fique ocioso esperando.
4. **Protocolo Claude↔Codex** (`AGENTS.md` §4) continua obrigatório para decisões nível 5-6 (arquitetura/dados/segurança) — mas **verifique disponibilidade do Codex com um probe mínimo antes de investir numa rodada** (`echo "Reply OK" | codex exec --skip-git-repo-check -`): no fim da sessão anterior ele bateu limite de uso por 45+ minutos, bem além do horário de reset que a própria mensagem de erro alegava (provavelmente esgotado pelas 6 rodadas do protocolo P0.4) — se ainda estiver bloqueado, não fique tentando em loop, registre e siga para outra frente, retome mais tarde.
5. **Fork serial é o padrão** (um agente por vez, herda contexto), não orquestração paralela via `Workflow` — só paralelizar se eu pedir velocidade explicitamente.

## Próxima ação recomendada, em ordem — tudo decisão-independente, prossiga sem esperar

1. **P0.2 (GuestSession não vinculada ao token do path — bug de 2 abas)**: Rodada 1 do protocolo já escrita e verificada contra o código real em `docs/architecture/reviews/guest-session-binding-scoping/round1-claude-proposal.md`, nunca enviada ao Codex (bloqueio de rate limit). Rode-a assim que o Codex estiver disponível, conduza o protocolo até convergir (mínimo 3 rodadas, ≥9,0 nos dois lados sem arredondar), depois implemente: vincular `submitEvidence`/`confirmUploadInFlight` (`guest-document-access-service.ts`) ao token do path via o campo `credentialSelectorHash` que `GuestSession` já carrega (hoje só "audit trail", nunca usado pra autorização). Teste, commit, push, PR, merge, verifique o deploy real.
2. **P0.1 (CSP/CORS bloqueando upload real browser→S3)**: já investigado nesta sessão — mais mecânico do que a auditoria externa sugeria. Os 2 pontos de wiring do Terraform já existem (`var.app_origin` já é o domínio CloudFront real de `dev`; `module.document_buckets.quarantine_bucket_name` já é output). Falta um `aws_s3_bucket_cors_configuration` novo no bucket de quarentena + trocar `connect-src 'self'` da CSP da SPA para incluir o host S3 virtual-hosted-style do bucket. Detalhe completo em `NEXT_SESSION_PROMPT.md`'s seção "Próxima ação recomendada". Ainda vale rodar o protocolo (segurança/infra, nível 5-6), mas o diff real é pequeno — não trate como um projeto grande.
3. Se ambos travarem em achado que exija decisão de arquitetura mais profunda, ou terminarem: E-017 (gate de evidência ponta-a-ponta pra fechar item de ROADMAP, limite de profundidade de subagente) é o próximo item decisão-independente do full-audit round2.
4. Depois de P0.1/P0.2/E-017 — ou em paralelo, se fizer sentido pelo custo/benefício — retome os itens P2 remanescentes nomeados em `NEXT_SESSION_PROMPT.md` (supply chain já verificado nesta sessão, ver D-281).

## Pendências que dependem genuinamente de mim (não reabrir sem meu sinal)

- Item 3 do backlog P1 (busca OCR/full-text) — 3 caminhos nomeados em D-202.
- `coverage.thresholds` em `vitest.config.ts` (E-023).
- P0.7 (WhatsApp com usuário real) — jurídico/produto, não engenharia.
- **P1.1 (`RequestContext` caro)** — pedi explicitamente para mover para o **final** da fila de pendências desta vez; só trate depois de tudo o mais decisão-independente estar fechado.
- Lista completa e mais itens (Wave 1b Design System, User Validation, etc.): seção "Pendências reais que dependem de decisão de Marcelo" em `NEXT_SESSION_PROMPT.md`.

## Lições de processo desta sessão

- Rate-limit do Codex pode durar bem mais que o horário que a própria mensagem de erro alega — depois de 2-3 tentativas falhando com a mensagem idêntica, pare de tentar em loop apertado, use backoff crescente (ex. 10min → 30min → 1h) e trabalhe em outra frente enquanto espera.
- Lock de state do Terraform travado por corrida com CI concorrente (inclusive Dependabot) é artefato conhecido — `terraform force-unlock` está pré-autorizado (`AGENTS.md` §7), só confirme antes que nenhum workflow real está genuinamente em andamento.
- Nunca deixar arquivo de scratchpad de sessão (`/tmp/...`) ser a única cópia de um artefato de protocolo real — persista a proposta/rodada num arquivo do repo (`docs/architecture/reviews/<tema>-scoping/`) assim que escrita, antes mesmo de enviar ao Codex, pra nunca perder o trabalho se a sessão cortar no meio.

Se a pipeline estiver rodando, observe e corrija problemas reais (nunca assuma "passou" sem `gh run view` direto).
