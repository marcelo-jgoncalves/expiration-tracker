# Data Export — Rodada 3 (Proposta Claude, tréplica obrigatória)

Nota da Rodada 2: Claude (auto, às cegas) 8,6/10; Codex 8,1/10. Todos os achados bloqueantes da
Rodada 1 confirmados corrigidos pelo Codex; 6 achados novos (implementabilidade, não conceito),
corrigidos abaixo. `AGENTS.md` §4 exige esta 3ª rodada mesmo com ambos já perto de 9,0 na R2.

## Achado #1 (maior, Codex) — cap de 2.000 não é global entre as 3 queries GSI1

Correto — `queryGsi1({gsi1pk, limit})` é por-status, um `limit: 2000` por chamada permitiria até
6.000 no total. **Correção**: orçamento decrescente explícito. Pseudocódigo da decisão (não é só
prosa vaga — isto é o contrato que a implementação real deve seguir):

```
budget = 2000
rows = []
for status in [ACTIVE, ARCHIVED, RENEWED]:  # ordem fixa, determinística
  page = queryGsi1({ gsi1pk: key(tenantId, status), limit: budget + 1 })  # +1 detecta estouro
  if rows.length + page.length > 2000:
    throw ValidationError("export exceeds 2000-item cap", { statusWhereExceeded: status })
  rows.push(...page)
  budget = 2000 - rows.length
return rows
```

Pedir `budget + 1` (não `budget`) é o que permite detectar "excedeu" sem precisar de uma segunda
query de contagem separada — se a página trazer mais que o orçamento restante, rejeita
imediatamente, nunca lê o tenant inteiro antes de decidir.

## Achado #2 (maior, Codex) — cap por item não basta, falta cap de bytes

Confirmado por leitura do schema (`schemas/api/create-item-request.v1.json`): `description` até
2.000 chars, `name` 200, `tags` até 20×50 — uma linha no pior caso passa de várias centenas de
bytes para poucos KB, e 2.000 linhas nesse cenário poderiam se aproximar do teto de 6 MB.
**Correção**: cap duplo, o que disparar primeiro decide. Byte guard: acumular
`Buffer.byteLength(serializedRow, "utf-8")` a cada linha serializada (já depois do quoting
RFC4180 do achado #7 da R2, que pode DOBRAR o tamanho de um campo com aspas internas — o guard
mede o valor JÁ SERIALIZADO, nunca o valor bruto) e rejeitar (mesmo `ValidationError`) se o total
ultrapassar **4 MB** (margem de segurança abaixo do teto de 6 MB de resposta síncrona de Lambda,
nunca o próprio 6 MB como linha de corte — margem para overhead de header/framing HTTP).

## Achado #3 (maior, Codex) — contrato HTTP atual não suporta corpo não-JSON

Confirmado: `toApiGatewayResult()` (`http-adapter.ts`) sempre serializa `body` como JSON e fixa
`content-type: application/json` — usado por todo handler existente, não pode mudar de
comportamento sem regressão ampla. **Correção**: função nova, aditiva,
**`toApiGatewayCsvResult(response: { statusCode: number; csv: string; filename: string })`**, ao
lado da existente (nunca substituindo-a), retornando
`headers: {"content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"<filename>\""}`
e `body: response.csv` (string crua, não JSON-serializada). O handler HTTP do export é o único
call site desta função nova — todo outro handler continua usando `toApiGatewayResult()` sem
mudança.

## Achado #4 (médio, Codex) — "mesma exclusão do dashboard" é falso

Confirmado por leitura de `item-handlers.ts`: `requireDashboardStatus()` aceita `DELETED`
explicitamente como valor válido (default é `ACTIVE`, mas `DELETED` não é bloqueado) — a alegação
de precedente estava errada. **Correção de justificativa** (decisão em si mantida): excluir
`DELETED` do export é uma escolha PRÓPRIA desta decisão, não herdada — um item soft-deletado não é
mais "rastreado ativamente", incluí-lo confundiria um export cujo propósito é dar visibilidade do
que a organização está gerenciando agora (ou geriu, para `ARCHIVED`/`RENEWED`). Residual explícito:
se o Marcelo quiser incluir `DELETED` (ex.: para um cenário de auditoria/backup completo), isso é
um parâmetro futuro (`?includeDeleted=true`), fora do v1.

## Achado #5 (médio, Codex) — divergência real entre fetches da fonte GitHub

O Codex reportou que a página confirma "organization owners" como role exigida; meu fetch direto
(repetido 2 vezes, pedindo explicitamente para citar toda menção a role) não encontrou essa frase
na página. Não consigo reconciliar essa divergência sem uma terceira ferramenta de fetch neutra —
**decisão**: descartar a fonte GitHub inteiramente desta proposta (nem para tier, nem para
sync/async) em vez de arbitrar uma divergência entre 2 fetches que não concordam, já que a
decisão de tier (`ADMIN_ROLES`) e de sync já não dependiam dela isoladamente (Linear + a
justificativa interna de assimetria de disclosure do achado #6 da R2 seguem de pé, suficientes
sozinhas). Pesquisa final desta decisão: `SIM PARCIAL`, 1 fonte externa verificada por fetch
direto (Linear) + justificativa interna — mais fraco que o "2 fontes" que a R2 alegava, mas
honesto sobre o que realmente está verificado.

## Achado #6 (médio, Codex) — `timeout_seconds = 30` sem margem contra o teto de integração do
API Gateway HTTP API

Confirmado (conhecimento de plataforma AWS, não pesquisa de mercado): o teto de timeout de
integração de uma HTTP API é 30s, fixo, não aumentável. Um Lambda com `timeout_seconds = 30`
exato corre risco de o API Gateway cortar a conexão na mesma janela que o Lambda ainda processa,
produzindo um 5xx genérico do API Gateway em vez do erro estruturado do próprio handler.
**Correção**: `timeout_seconds = 25` (margem de 5s abaixo do teto de 30s do API Gateway,
consistente com a margem de segurança já aplicada ao cap de bytes no achado #2 acima — margem
antes de um teto de plataforma, não exatamente no teto).

## Resumo final da decisão (Rodada 3, incorpora R1+R2+R3)

- Action RBAC: `item:export`, tier `ADMIN_ROLES` (justificativa: assimetria de disclosure,
  achado #6 da R2 — não precedente de bulk-action).
- Acesso a dado: `queryGsi1` por status `ACTIVE`/`ARCHIVED`/`RENEWED` (nunca `DELETED`, decisão
  própria explícita, achado #4 da R3), com orçamento decrescente explícito entre as 3 chamadas
  (achado #1 da R3) — nunca um `limit` fixo repetido por chamada.
- Caps: 2.000 itens **E** 4 MB de payload serializado, o que disparar primeiro rejeita com
  `ValidationError` (achados #2 da R2/R3).
- Handler: `timeout_seconds = 25` (achado #6 da R3), resposta via `toApiGatewayCsvResult()` nova
  e aditiva, nunca reaproveitando/alterando `toApiGatewayResult()` (achado #3 da R3).
- Colunas do CSV: `itemId`, `name`, `category`, `description`, `dueDate`, `issueDate`,
  `periodicity`, `issuer`, `number`, `assigneeUserId`, `tags` (join `;`), `priority`, `status`,
  `createdAt`, `updatedAt` — verificado contra `expiration-item.ts` real (R2).
- Serialização: `src/shared/csv/csv-export-writer.ts`, `serializeCsvRow()` único, RFC4180 quoting
  + prefixo apóstrofo de mitigação de fórmula juntos, nunca 2 mecanismos separados (R2).
- Pesquisa: `SIM PARCIAL`, 1 fonte externa verificada (Linear, fetch direto 2×) — GitHub descartada
  por divergência de fetch não reconciliável (R3, achado #5), registrada honestamente, não
  escondida.
- Escopo: só `ExpirationItem` (`item:export`) — `TrackedSubject`/documentos ficam para uma v2 com
  protocolo próprio, nunca escopo implícito desta decisão (R2).
- Distinção do DSR formal de LGPD (PRIV-003, ainda não implementado, "M4+"): mantida sem mudança
  desde a R1, nunca contestada pelo Codex nas 3 rodadas.
- Decisão de produto explicitamente fora deste protocolo: grátis/imediato vs. limitado por plano
  — default v1 é "disponível a todo ADMIN/OWNER sem gate de billing" (M12 bloqueado por D-052),
  revertível pelo Marcelo sem reabrir o protocolo (R1, mantido).

## Notas finais do Codex (Rodada 3, fechamento 9,1/9,1 — não bloqueantes, incorporadas como
residual explícito)

- `queryGsi1` é eventualmente consistente por design (`data-model.md` §3) — este export é uma
  conveniência de produto, nunca um snapshot legal/contábil fortemente consistente; a distinção
  já explícita do DSR formal (achado #4 do checklist da R1) cobre essa diferença, mas a
  implementação real deve deixar isso explícito também em qualquer texto voltado ao usuário
  ("pode não refletir mudanças dos últimos segundos"), não só na documentação interna.
- Nome do arquivo exportado (`filename` do novo adapter) deve ser gerado internamente
  (ex.: `tenantId`+data), nunca interpolar `Organization.displayName`/dado fornecido por
  usuário sem sanitização — evita risco de header injection via `Content-Disposition`.
- O guard de 4 MB conta o CSV final serializado (header + todas as linhas + terminadores CRLF),
  nunca só a soma das linhas de dado isoladamente — detalhe de implementação, registrado aqui
  para não ser esquecido.

## Residuais não resolvidos nesta rodada (implementação real, não arquitetura)

Nome exato do arquivo exportado, ordenação das linhas dentro de cada status, header traduzido
(pt-BR) vs. técnico, suíte de teste completa (unit do writer + G-V3 no cap duplo + contract test
do novo adapter) — decisões de implementação para a sessão que construir isto. XLSX permanece
fora de escopo (`roadmap-evolution/09`, decisão já `APPROVED` anterior).
