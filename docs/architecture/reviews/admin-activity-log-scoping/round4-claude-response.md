# Rodada 4 — Tréplica Claude — Admin Activity/Audit Log View

Nota cega Rodada 3: Claude (auto, antes de ver Codex) 8,9. Codex: 8,10. Aceito os 4 achados —
todos reais, dois deles (#2 idempotência, #3 fail-open) eram erros de fato, não só de redação.

## 1. Cursor — corrigido

Erro real na Rodada 3: inventei semântica própria ("item após o último") em vez de usar
`LastEvaluatedKey` como o DynamoDB já o define. Correção: cada campo do cursor composto
(`expirationLek`/`organizationLek`/`subjectLek`/`tenantLek`) é literalmente o
`LastEvaluatedKey` bruto devolvido pela `Query` daquela partição na página anterior —
serializado (base64 do JSON), sem transformação — e devolvido verbatim como
`ExclusiveStartKey` na chamada seguinte. Zero semântica nova: é exatamente o contrato padrão
do DynamoDB, aplicado 4 vezes em paralelo.

Sobre o achado de "paginação global instável": aceito que a Rodada 3 não CORRIGIU isso, só
evitou piorar. Correção agora: isso não é um bug a resolver, é um trade-off explicitamente aceito
e documentado — nenhuma outra list view paginada do produto (items, subjects, members) usa
snapshot isolation entre páginas; este feed segue exatamente a mesma consistência eventual já
aceita em todo o resto do sistema. Declarar `snapshotUpperBound` (timestamp de corte fixo no
início da sessão de paginação) FICA como opção de v2 se o comportamento observado em produção
mostrar necessidade real — não adicionar complexidade especulativa a um design ainda não
implementado, mesmo princípio de proporcionalidade de `docs/engineering/principles.md` #1.

## 2. Idempotência do export — corrigida (erro real, não só de redação)

Aceito o achado: hash de `(tenantId, actor, dia-UTC)` colapsa exports legítimos repetidos no
mesmo dia — um ADMIN que exporta de manhã e de novo à tarde depois de novos itens vencerem
perderia o segundo registro de auditoria. Isso é errado, descartado.

Design correto: `exportRequestId` é gerado UMA VEZ por requisição HTTP, no início do handler
(`crypto.randomUUID()`, mesmo padrão que `this.ids.newAuditEventId()` já usa em
`expiration-service.ts`) — não derivado de nada além de "esta invocação específica". A
preocupação real de idempotência não é "duplicar exports legítimos" (que devem, cada um, gerar
seu próprio evento), é apenas o caso estreito de retry de INFRAESTRUTURA da MESMA requisição
(cliente ou API Gateway reenviando a mesma tentativa após timeout, antes de qualquer resposta
chegar ao chamador). Para esse caso estreito, adotar o padrão REST já estabelecido (Stripe
Idempotency-Key, mesma classe pesquisada no research-protocol): handler aceita um header
opcional `Idempotency-Key` do cliente; se presente, usa-o como `exportRequestId` (condição de
unicidade real contra retry); se ausente, gera um UUID novo por requisição e não tenta
deduplicar (aceitável — a maioria dos clientes desta API hoje não implementa retry-safe idempotency
key, mesmo estado atual de todos os outros handlers de escrita do sistema, nenhum exige esse
header hoje). Nenhum colapso por ator/dia.

## 3. Fail-open — corrigido (erro real de nomenclatura E de sequência)

Aceito: chamei de "falha-fechado" um comportamento que é literalmente fail-open (a resposta é
enviada mesmo se a auditoria falhar) — contradição direta nos meus próprios termos, corrigida.
Sequência também corrigida: o handler (1) autoriza, (2) consulta os itens, (3) serializa o CSV
em memória (`buildExportCsv()`), (4) monta o corpo da resposta HTTP, (5) TENTA gravar o
`TenantAuditEvent` (condicional, `exportRequestId` como parte da SK), (6) envia a resposta —
o passo 5 acontece ANTES do envio real ao cliente (não depois, como a Rodada 3 alegou
incorretamente), mas é fail-open: se o passo 5 falhar (throttling, erro transiente), o handler
loga erro via `SecureLogger` (com `correlationId` real de infraestrutura, não o
`exportRequestId` lógico) e segue para o passo 6 de qualquer forma — o cliente nunca vê uma
falha de exportação por causa de um problema de auditoria. Termo correto: **fail-open por
design, documentado como tal**, não fail-closed.

## 4. Checklist E-014 — URLs completas

Erro real: `docs.github.com/...` era abreviação, não âncora verificável. URLs completas:
- https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization (critério 1 e 2 — acesso restrito a owners/audit-log role; formato actor+ação+data)
- https://www.notion.com/help/audit-log (critério 1 e 2 — acesso restrito a workspace owners/compliance admins; ordem cronológica com filtros)

Linear permanece removido (achado da Rodada 2, mantido). Slack não usado como âncora nesta
versão final — a fonte (api.slack.com/admins/audit-logs) descreve a API, não confirma
diretamente os 2 critérios pesados sem uma segunda leitura que este protocolo já gastou rodadas
suficientes verificando; 2 fontes independentes e verificadas bastam para os 2 critérios
pesados restantes (não é necessário inflar a lista de fontes para parecer mais completo).

## Fechamento

Os 4 achados da Rodada 3 corrigidos com mudança real de design/linguagem, não só polimento.
Não há achado novo introduzido por essas correções (cursor: contrato DynamoDB puro sem
invenção; idempotência: padrão REST estabelecido, escopo do problema corrigido para o caso
estreito real; fail-open: nomenclatura e sequência corrigidas, comportamento em si já estava
certo desde a Rodada 2; E-014: só precisava de URLs completas, critérios já corretos desde a
Rodada 3).
