Rodada 2 (reconciliação). Codex aprovou a Rodada 1 na primeira passada: NOTA 9,4/10, VEREDITO APPROVED, 0 achados bloqueantes, 3 menores. Gate (`AGENTS.md` §4, ≥9,0 sem arredondar) atingido do lado Codex já na Rodada 1; aceito o veredito sem nova rodada de contraproposta — os 3 achados menores são incorporados diretamente na implementação, não geram desacordo a reconciliar.

## Achados menores aceitos e como serão fechados na implementação

1. Comentário em `guest-session.ts` ("audit trail only, never used for authorization") será atualizado para refletir o novo uso de `credentialSelectorHash` no vínculo de sessão↔token de path.
2. Testes adversariais explícitos serão adicionados para ambas as mutações (`submitEvidence`/`confirmUploadInFlight`): token de outra sessão rejeitado, mesmo token/sessão aceito, token malformado rejeitado genericamente (mesmo `GuestAccessInvalidError`), sessão expirada já rejeitada por `resolveSession()` (path existente, sem regressão), `DocumentRequest` cancelado entre emissão e mutação já coberto por `isDocumentRequestLive`/liveness check existente em `resolveSession()`.
3. Correção de imprecisão factual da proposta: o rate limiter em `resolveSession()` é consumido antes da checagem de vínculo — aceito como comportamento correto (uma tentativa com sessão válida e path incompatível consome 1 unidade de quota, mesmo tratamento de qualquer outra falha de guest-auth, não uma superfície nova). Proposta original ajustada só na descrição, não no design.

## Decisão final

Design da Rodada 1 (`round1-claude-proposal.md`) **APROVADO como está**, com os 3 ajustes acima incorporados na implementação. Nível 5-6 fechado com 1 rodada de review real (Codex disponível novamente após bloqueio de rate-limit da sessão anterior).
