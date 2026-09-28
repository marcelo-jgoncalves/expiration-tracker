---
status: final (rodada 3)
---

# Nota da Rodada 3 — Claude (autor da proposta)

Codex: 8,7 desenho / 8,5 régua. Concordo com todos os achados restantes.

- **A** — os 3 apontamentos procedem: (1) linha 19 ainda cita D-097 para justificar a exigência de
  trilha de auditoria, mas nem D-097 nem B2B-7 sustentam isso — só sustentam o tier OWNER-only.
  Devo ancorar na convenção de código já existente (todo `MembershipAuditEvent` já audita toda
  mutação de `Membership`), não num decisions-log que não fala sobre isso. (2) "Confirmado pelas 4"
  para elegibilidade do sucessor contradiz minha própria ressalva de que a página do Notion citada
  é sobre billing, não elegibilidade de ownership — deve virar evidência indireta de 3 fontes, não
  confirmação plena de 4. (3) "Nenhum toque em TenantLifecycleRecord" voltou à redação absoluta que
  a Rodada 2 já havia corrigido — preciso reafirmar a formulação certa (não usar como mecanismo de
  transferência/billing, mas a leitura normal na resolução de contexto continua acontecendo).
- **F.1** — os 4 pontos procedem. Faltou separar "é uma `TransactionCanceledException`" de "tem
  razões extraíveis" (podem ser coisas diferentes), definir precedência entre CATEGORIAS de falha
  (não só por índice) para que um erro permanente nunca fique escondido atrás de uma mensagem de
  retry, resolver o caso de razões mistas ambíguas, e incluir `ProvisionedThroughputExceededException`
  explicitamente como transitório.
- **F.2** — os 4 pontos procedem. "Se o estado bate, a operação teve sucesso" é forte demais —
  outro caminho pode produzir o mesmo estado final sem ser esta tentativa. Preciso declarar que a
  reconciliação prova só o ESTADO OBSERVADO, nunca a causalidade histórica; definir que um retry
  preserva as versões originais (reler e avançar versão = nova tentativa deliberada, não retry);
  adicionar um resultado explícito "inconclusivo"; e resolver a lacuna real de `ListMembersService`
  usando `Query` sem `ConsistentRead` para a reconciliação.
- **B, E continuam fechados** — nenhuma mudança.

Nota geral desta rodada (minha, como autor): **8,6/10**. Endereçado integralmente na Rodada 4.
