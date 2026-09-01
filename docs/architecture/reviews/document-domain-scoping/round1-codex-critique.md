# Document Domain — Rodada 1 (Crítica Codex)

**Nota da régua (E-014): 2,5/10 — contestada.** **Nota do design: 4,8/10. Nota final da rodada: 4,6/10. Resultado: REABRIR.**

Transcrição completa da crítica do Codex preservada em `docs/architecture/reviews/document-domain-scoping/round1-codex-critique-full.txt` (saída bruta do `codex exec`). Resumo dos achados bloqueantes usado para orientar a Rodada 2:

## E-014 (régua)
- Faltam URLs reais (só domínios), sem data/representatividade justificada.
- `SIM PARCIAL` declarado sem dizer qual subdecisão é externa vs. interna.
- Checklist só sob Decisão 1 (prometido também para 4, ausente); Decisão 1 mistura critérios de state machine com critérios de armazenamento (Decisão 2).
- Pesos não rastreáveis às fontes (ex.: "upload nunca pula RECEIVED" com peso 20% sem fonte que sustente).
- Fontes de segurança são blogs/vendors, não normas primárias (OWASP/RFC) — faixa "15-30min" mal aplicada (é timeout de sessão, não de link de coleta documental; falta considerar vazamento de token em URL/Referer/logs).
- Pesquisa de versionamento (Mongo/Cosmos) sustenta separar current/history mas não valida o desenho físico proposto.
- Folderless DMS irrelevante para recorrência/review/remoção — citado fora de contexto.

## Por decisão (achados que bloqueiam ≥9)
1. **State machines**: proposta é enumeração de estados, não grafo (falta comando/ator/precondição/efeito transacional/concorrência/idempotência). "Passa por RECEIVED na mesma transação" não é observável no DynamoDB se o item só persiste em ACCEPTED — contradiz o próprio requisito de auditabilidade. "Member responsável pelo Document" presume ACL por owner que o RBAC real (tenant-wide, `authorize()`) não implementa hoje. Faltam DRAFT, correção/reenvio, remoção, concorrência entre revisores, idempotência de aceite, WF18 (unknown outcome).
2. **Armazenamento current/superseded**: não cobre todos os access patterns aprovados (review queue, requirements por subject, requests por status, dashboard). GSI1 "análogo" não especifica SK/projeção/discriminador. `DOCSTATUS#<validity>` mistura validade derivada do relógio com índice persistido sem mecanismo de reindexação. Transação de aceite sem fences OCC concretos. Contradiz Decisão 7 (permite remover REJECTED, quebrando "append-only").
3. **DocumentReview entidade**: exemplo dado não prova multiplicidade real (são reviews de versões diferentes, não da mesma). Fonte de verdade duplicada entre `Version.state` e `Review.decision` não resolvida.
4. **Guest/magic link — bloqueio crítico**: momento de consumo do token indefinido (GET vs submit); TTL de 20min contradiz Request com prazo de dias; falta separar credencial-de-convite (revogável, longa) de capability de upload (curta, escopada); hash sozinho não permite lookup eficiente (precisa selector+secret); falta consumo condicional atômico (TOCTOU); `security-audit.ts` não aceita esses eventos (taxonomia fechada, achado factual real); `OPENED` no GET é enganoso (scanners de e-mail). Sem checklist E-014 próprio.
5. **Requirement/evidência**: `satisfiedByVersionId` único presume 1:1 não confirmado pelos docs funcionais; falta função de derivação determinística completa (6 estados); `NOT_APPLICABLE` não é derivável, é fato persistido — contradiz "tudo é derivado".
6. **Arquivo↔Version**: falta lifecycle (quando principal existe, troca, remoção, concorrência); adicionar complemento após aceite muta "histórico append-only" sem decisão.
7. **Archive/remove/delete**: contradiz J9 diretamente (remoção de REJECTED apaga o que J9 exige preservar). "Nunca foi ACCEPTED" insuficiente (evidência de abuso/resposta de guest). D-127 "reaproveitado" sem mapear entidades novas à máquina de estados real.
8. **Recorrência**: `seriesId=null` na correção perde causalidade de ciclo — nada em J21 exige isso; melhor manter `seriesId`+`occurrenceId`+`parentRequestId`+tipo. Pode ser arquitetura prematura (4º núcleo/Premium futuro) sem justificar irreversibilidade agora.
9. **Permissão IA/Viewer**: reintroduz ACL por responsável (mesmo problema da Decisão 1); decide unilateralmente "flag booleana" para download do Viewer quando A1 foi deixado deliberadamente aberto como questão de produto — isso é decisão de produto não aprovada, não arquitetura.

## Direção aproveitável (não descartar)
Document duradouro, Version histórica, ponteiro corrente transacional, review como conceito explícito, evidência ligada a Version (não Document genérico), série de requests — a espinha dorsal está certa; falta fechar cada decisão no nível de detalhe transacional/estado exigido.
