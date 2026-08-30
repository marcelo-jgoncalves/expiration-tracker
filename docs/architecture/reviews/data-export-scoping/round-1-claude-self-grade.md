# Data Export — Rodada 1, Auto-avaliação às cegas (Claude)

Escrita ANTES de invocar o Codex — não vi nenhuma crítica dele ainda.

**Nota: 7,8/10**

## O que atende bem

- Tier RBAC (`ADMIN_ROLES`) tem justificativa dupla (pesquisa externa + precedente interno já
  convergido), não uma escolha arbitrária.
- Decisão síncrono-vs-assíncrono é fundamentada em número real (`capacity-model.md`), não em
  precaução genérica — evita reinventar a infraestrutura pesada de import para um problema
  estruturalmente menor.
- Mitigação de CSV injection reaproveita uma decisão já `APPROVED` (`roadmap-evolution/09`) em
  vez de redebater — proporcional.
- Distingue explicitamente este export de conveniência do DSR formal de LGPD (PRIV-003) — evita a
  armadilha real de "construímos export, LGPD está resolvido" quando não está.

## Onde a proposta é mais fraca (motivos reais para não ir mais alto)

1. **Cap de 10.000 itens é um número escolhido por mim, sem verificação real de quanto tempo um
   Lambda levaria para escanear/serializar isso** — "ordem de grandeza acima do pior caso" é uma
   alegação sem medição. Se o Codex pedir um número diferente ou uma verificação real (ex.: qual
   o timeout do Lambda handler síncrono hoje, `infra/main.tf`), a proposta pode precisar de ajuste.
2. **Não verifiquei se `queryByPk`/o padrão de leitura de `ExpirationItem` já suporta paginação
   real ou se uma leitura de "todos os itens da organização" é uma nova query pattern não
   coberta pelo modelo físico existente** — assumi que dá, mas não li o store real
   (`dynamodb-expiration-store.ts`) para confirmar. Risco real de a Rodada 2 achar que isso não é
   tão simples quanto pareceu.
3. **A representatividade da pesquisa é honestamente fraca** — 1 fonte verificada por fetch
   direto (Linear) é pouco. Notion foi citado só via snippet de busca, não fetch direto — isso
   viola a própria disciplina que `research-protocol.md` exige ("nunca inventar ou adivinhar uma
   fonte", e fetch direto é o padrão preferido). Marquei isso explicitamente na proposta em vez
   de esconder, mas é uma fraqueza real, não só uma nota de rodapé.
4. **Não decidi se a resposta síncrona precisa de streaming (para não materializar tudo em
   memória) ou se um buffer simples é aceitável no volume esperado** — isso é uma lacuna de
   design técnico real, não só um "residual de implementação" como classifiquei.
5. **`assigneeUserId` sem resolver e-mail no export é uma escolha de privacidade defensável, mas
   pode ser inútil na prática** (um ADMIN olhando o CSV não sabe quem é `user_01ABC...`) — não
   ofereço nenhuma alternativa (ex.: resolver display name mas nunca e-mail) nem explico por que
   optei pelo extremo mais conservador sem meio-termo.

Estes 5 pontos, principalmente #2 (não verificado por leitura real de código, indo contra a
própria disciplina "ler o código real antes de propor" desta sessão) e #3 (pesquisa fraca), são
motivo suficiente para não passar de 7,8. Nota deliberadamente abaixo de 8,0 — não é uma proposta
pronta para fechar, é uma proposta honesta sobre suas próprias lacunas.
