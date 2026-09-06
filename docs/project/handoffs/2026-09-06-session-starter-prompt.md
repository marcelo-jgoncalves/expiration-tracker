# Prompt de início — próxima sessão (gerado em 2026-09-06)

> Cole o texto abaixo (a partir de "Continue") como a primeira mensagem da próxima sessão sobre o `expiration-tracker`. Este arquivo é histórico/handoff (`AGENTS.md` §5) — `NEXT_SESSION_PROMPT.md` é a fonte de estado real, este arquivo só empacota o prompt de arranque no momento em que foi gerado (pode já estar desatualizado quando você o usar — confirme sempre contra `NEXT_SESSION_PROMPT.md`/`git`/CI antes de agir).

---

Continue o trabalho autônomo no expiration-tracker.

Estado atual (confirme com git antes de assumir qualquer coisa):
- Branch `develop`, HEAD em `143f409` (D-213/D-214), PR #247 mergeado em `main`, CI verde.
- Item 15 do backlog P1 (relatórios agendados): fatias 1-2/4 + CRUD de assinatura
  IMPLEMENTADAS e mergeadas (D-211 entidades+GSI8+outbox; D-212 scheduler+claim
  transacional, verificado ao vivo; D-213 CRUD create/get/list/delete). Fatias 3-4
  ainda pendentes — dá pra criar/listar assinaturas, mas nenhum e-mail real é
  entregue ainda.
- D-214 (achado nesta sessão, sem relação com o item 15): bug de relógio real vs.
  injetado em 2 métodos de busca (`ExpirationService`/`DocumentArchiveService`), já
  corrigido e mergeado.

Antes de qualquer coisa: leia `NEXT_SESSION_PROMPT.md` e `docs/architecture/README.md`
(`AGENTS.md` §2), depois `decisions-log.md` D-204/D-211 a D-214 para o detalhe completo.

Próxima ação real: fatia 3 de D-204 (worker de entrega SQS consumindo
`SQS_REPORT_SUBSCRIPTION_DELIVERY_V1` + rota de download autenticada) — agora
testável ponta a ponta de verdade, já que dá pra criar uma assinatura real via
D-213 e o scheduler (D-212) já reivindica no próximo tick. Alternativas, a seu
critério: item 16 (dossiê PDF/Excel, design já aprovado D-205) ou escopar os
itens 18-19.

NÃO toque no item 14 (busca OCR/full-text) — segue bloqueado (D-202) esperando
decisão do Marcelo entre os 3 caminhos nomeados.

Siga o padrão de autonomia e o protocolo Claude↔Codex já estabelecidos em
`AGENTS.md` — trabalhe de forma contínua, commit/push/PR/merge incremental sem
esperar confirmação (dev-only, sem produção), só pare para decisão que seja
genuinamente do Marcelo.
