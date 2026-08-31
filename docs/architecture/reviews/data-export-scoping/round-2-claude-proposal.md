# Data Export — Rodada 2 (Proposta Claude)

Nota da Rodada 1: Claude (auto, às cegas) 7,8/10; Codex 6,2/10. 3 achados bloqueantes/maiores
confirmados por leitura real do código, corrigidos abaixo.

## Achado #1 (bloqueante, Codex) — `queryByPk` não lista "todos os itens do tenant"

Confirmado por leitura de `expiration-item.ts`: `PK = TENANT#<tenantId>#ITEM#<itemId>` é POR ITEM,
não por tenant — `queryByPk` (usado por `ListMembersService` contra a partição COMPARTILHADA de
`Organization`) não se aplica aqui, foi um erro real de generalização da Rodada 1 (não li o
domain model antes de propor, quebrando a própria disciplina desta sessão). **Correção real**: o
acesso tenant-wide já existe, via GSI1 (`GSI1PK = TENANT#t#ITEMSTATUS#<status>`,
`queryGsi1({gsi1pk})` em `expiration-store.ts`) — é o MESMO padrão que a Wave/dashboard de
vencimentos já usa hoje para listar itens (`ItemsCollection`). Export chama `queryGsi1` uma vez
por valor de `status` relevante (`ACTIVE`, `ARCHIVED`, `RENEWED` — excluir `DELETED`, item já
soft-deletado não pertence a um export de "vencimentos ativos/históricos", mesma exclusão que a
lista de dashboard já aplica) e concatena o resultado. Nenhuma query pattern nova — reaproveita
`queryGsi1` exatamente como já existe.

## Achado #2 (maior, Codex) — sync-vs-async não provado por número real

Confirmado: `items_handler` (`infra/main.tf`) não sobrescreve `timeout_seconds`, herda o default
de 10s (`infra/modules/lambda-function/variables.tf`). **Correção**: (a) reduzir o cap de 10.000
para **2.000 itens** — não é mais um número arbitrário, é o MESMO valor que a pesquisa da Rodada 1
já tinha verificado como o teto real do tier admin/owner de export completo do Linear (não citado
como justificativa suficiente sozinho na R1 — agora é, combinado com (b)); (b) o novo handler
Lambda ganha `timeout_seconds = 30` explícito em `infra/main.tf` (mesmo padrão já usado por
`import-commit-handler`/outros handlers síncronos mais pesados que o default, nunca herdar
silenciosamente o default de 10s para um caminho que pagina múltiplas queries GSI1). 2.000 itens
× no máximo 4 queries GSI1 paginadas (uma por status) é uma margem confortável dentro de 30s, sem
inventar fila/S3/worker novo.

## Achado #3 (maior, Codex) — colunas do CSV não batem com o domain model real

Confirmado por leitura de `expiration-item.ts`: os campos reais são `name` (não `displayName`),
`category` (não `type`), sem `subjectId` no próprio item (a relação é via
`RequirementAssignment.linkedItemId`, direção reversa, sem access path para resolver hoje — fica
de fora do v1, não inventar um lookup novo). **Colunas corrigidas do v1**: `itemId`, `name`,
`category`, `description`, `dueDate`, `issueDate`, `periodicity`, `issuer`, `number`,
`assigneeUserId`, `tags` (join por `;`, já que é `string[]`), `priority`, `status`, `createdAt`,
`updatedAt`. Removido: `subjectId` (não existe no item, ver acima).

## Achado #4 (maior, Codex) — escopo estreito demais para a pergunta motivadora

Aceito parcialmente: a proposta nunca alegou resolver portabilidade LGPD completa (isso já estava
explícito na R1, achado #4 do próprio checklist da R1 confirma isso como critério atendido). Mas
o Codex está certo que "export de conveniência" merece um nome mais preciso do que "data export"
genérico. **Correção de enquadramento, não de escopo**: renomear a feature/rota para deixar
explícito que é uma exportação de **itens/vencimentos rastreados** (não "os dados da conta"),
tanto no nome da action RBAC (`item:export`, não `export:create` — mais específico, e mais
consistente com o padrão `<recurso>:<ação>` já usado em toda a matriz) quanto na documentação
voltada ao usuário. `TrackedSubject` continua fora do v1 (residual explícito, não escopo
implícito) — se o Marcelo quiser um export mais completo (itens + fornecedores + documentos) isso
vira uma v2 com escopo próprio, não expande esta decisão silenciosamente.

## Achado #5 (maior, Codex) — pesquisa fraca (1 fonte verificada por fetch direto)

Aceito. Fetch direto adicional feito nesta rodada:

- GitHub Docs, "Exporting member information for your organization"
  (`https://docs.github.com/en/organizations/managing-membership-in-your-organization/exporting-member-information-for-your-organization`,
  fetch direto 30/08/2026, URL real localizada via busca — a primeira URL tentada nesta rodada
  era um palpite e voltou 404, corrigida antes de citar, nunca inventada às cegas): confirma
  **exportação síncrona** ("You can download a CSV or JSON file containing the membership
  information report") — reforça a decisão síncrona desta proposta com uma segunda fonte direta,
  cobrindo dev-tooling (GitHub) além de produtividade/PM (Linear), reduzindo o viés de nicho
  único que a R1 admitia como fraqueza. **Honestidade sobre o limite desta fonte**: o fetch direto
  da página NÃO confirma qual role pode disparar o export (a página descreve o "como", não o
  "quem pode") — o resumo do buscador alegava "organization owners", mas isso NÃO foi confirmado
  pelo conteúdo real da página, então **não é usado como base da decisão de tier**, só como
  confirmação do padrão síncrono. Mesma disciplina já registrada em `research-protocol.md`
  ("uma afirmação de pesquisa sem fonte verificável é tratada como não verificada").
- A decisão de tier RBAC (`ADMIN_ROLES`) continua apoiada só na fonte Linear (verificada,
  admin/owner-only para export de workspace completo) + na justificativa interna do achado #6
  abaixo (assimetria de disclosure) — não em GitHub, cuja fonte não confirma o tier real.

## Achado #6 (médio, Codex) — precedente de RBAC superestimado

Aceito, correção de justificativa (não de decisão — `ADMIN_ROLES` continua certo): a proposta da
R1 implicava "toda ação em massa já é admin-only" citando convite/remoção/troca-de-role, mas
`import:create`/`import:commit` (também em massa, até 5.000 linhas) são `WRITE_ROLES`, não
admin-only — a generalização era falsa. **Justificativa corrigida**: o que diferencia export não
é "é uma ação em massa", é que export é um ato de **divulgação/disclosure** de dado que outros
membros já criaram (um `MEMBER` exportando veria itens de `assigneeUserId` de outros membros, que
hoje só vê individualmente navegando a lista) — import só grava dado novo que o próprio ator
está autorizado a criar de qualquer forma (mesmo nível de acesso de `item:create`). É essa
assimetria leitura-em-massa-de-terceiro vs. escrita-própria que justifica `ADMIN_ROLES`, não um
padrão geral de "bulk = admin" que o próprio código já contradiz.

## Achado #7 (médio, Codex) — sanitizer subespecificado (RFC4180, CRLF, delimitador)

Aceito. Confirmado por leitura: este projeto não tem dependência de biblioteca CSV externa (nem
para import, que usa `src/modules/import/application/csv-parser.ts` próprio) — nenhuma lib de
CSV *writer* existe hoje. **`src/shared/csv/csv-export-writer.ts`** (renomeado de
"sanitizer" para refletir o escopo real, mais amplo) expõe UMA função,
`serializeCsvRow(values: string[]): string`, responsável por AMBAS as garantias juntas (nunca 2
módulos separados que alguém pode esquecer de compor): (1) escapar prefixo de fórmula (`=`/`+`/
`-`/`@` → prefixo apóstrofo) por valor; (2) quoting RFC4180 real — envolver em aspas duplas
qualquer valor contendo vírgula/aspas dupla/CR/LF, duplicando aspas internas
(`"` → `""`); delimitador fixo `,`, terminador de linha fixo `\r\n` (RFC4180 canônico, evita
ambiguidade de LF-vs-CRLF entre Excel/Sheets). Teste unitário cobre os 2 casos adversariais juntos
(valor com fórmula E vírgula na mesma célula), não isolados.

## Verificação adicional — limite de payload síncrono (fator não coberto pela R1)

2.000 itens × ~15 colunas curtas gera um CSV bem abaixo de qualquer limite de payload relevante:
o teto de resposta síncrona de invocação Lambda é 6 MB (limite de plataforma AWS, não deste
projeto) e o teto de payload de resposta do API Gateway HTTP API é 10 MB — uma linha CSV típica
desta entidade (nomes/categorias curtos, sem campo de texto livre grande) fica na casa de
150-300 bytes; 2.000 linhas ficam entre 300-600 KB, duas ordens de grandeza abaixo do teto mais
apertado (6 MB). Não é um dado de pesquisa de mercado (é constante de plataforma AWS já conhecida
deste projeto por outras integrações síncronas), citado aqui só para fechar a lacuna que a
auto-avaliação às cegas desta rodada identificou.

## Resumo da decisão revisada (substitui a Rodada 1 nos pontos acima, mantém o resto)

- Action RBAC: **`item:export`** (renomeado de `export:create`), tier `ADMIN_ROLES`, justificativa
  por assimetria de disclosure (achado #6), não por precedente de bulk-action.
- Acesso a dado: `queryGsi1` uma vez por status `ACTIVE`/`ARCHIVED`/`RENEWED` (achado #1), cap
  **2.000 itens** (achado #2), `timeout_seconds = 30` no handler novo (achado #2).
- Colunas do CSV: lista corrigida contra o domain model real (achado #3).
- Escopo: renomeado para "exportação de itens/vencimentos" explicitamente, `TrackedSubject`
  permanece residual explícito para v2 (achado #4).
- Pesquisa: 2 fontes diretas (Linear + GitHub), a segunda usada honestamente só para o padrão
  síncrono (não para o tier, que a página não confirma) — achado #5.
- Serialização: módulo único `csv-export-writer.ts` com quoting RFC4180 real + mitigação de
  fórmula juntos (achado #7).

Mantido sem mudança da Rodada 1: distinção explícita do DSR formal de LGPD (checklist #4 da R1,
não contestado pelo Codex); decisão de produto (grátis vs. limitado por plano) permanece do
Marcelo, não decidida aqui.
