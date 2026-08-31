# Data Export — Rodada 1 (Proposta Claude)

## Classificação de risco

Nível 5 (`change-risk-scale.md`): nova superfície de API (novo `Action` na matriz RBAC), novo
padrão de exposição de dados em massa (todo o dataset de `ExpirationItem` de uma organização
numa única resposta). Não é nível 6 — não é um domínio de dado sensível novo (os campos já
existem, já são lidos individualmente hoje via `item:read`) nem envolve terceiro novo com acesso
a PII. Protocolo Claude↔Codex obrigatório, mínimo 3 rodadas, ≥9,0 sem arredondar.

## Pesquisa externa considerada: SIM PARCIAL

**Escopo informado por pesquisa**: (a) quem pode disparar um export de dataset inteiro
(tier RBAC) e o formato síncrono-vs-assíncrono do fluxo; (b) a mitigação de CSV/formula
injection na saída.

**Escopo interno** (nenhuma pesquisa de mercado ajudaria): quais campos exatos exportar, se
`TrackedSubject` entra no escopo v1, e o dimensionamento real de linhas por tenant deste projeto
especificamente (isso vem de `capacity-model.md`, não de benchmarking externo).

**Fontes (verificadas por fetch direto, 2026-08-30)**:
- Linear Docs, "Exporting Data" (`https://linear.app/docs/exporting-data`, fetch direto
  30/08/2026): 2 tiers claros e distintos. (1) Export de **view/issue individual** — qualquer
  Member ou Admin/Owner, síncrono/instantâneo, limitado a "up to 250 issues at a time" (Member) ou
  "up to 2,000 issues" (Admin/Owner em plano Enterprise). (2) Export de **workspace inteiro** —
  só Workspace Admin (só Owner em plano Enterprise), **assíncrono**: "we'll email you a download
  link. The link expires after 12 hours." Guests nunca podem exportar, em nenhum tier.
- OWASP CSV Injection guidance (já citada e decidida internamente antes desta rodada, não
  redescoberta agora): `roadmap-evolution/09-domain-model-csv-import.md` (Fase 2b, Claude 9,2/
  Codex 9,4, `APPROVED`) já fechou esta pergunta para QUALQUER export/relatório CSV futuro deste
  projeto — "Toda exportação/relatório CSV baixável escapa obrigatoriamente valores de risco
  (prefixo apostrophe ou equivalente testado) — requisito testável em qualquer export/relatório
  CSV futuro, não só nesta feature." Esta proposta reaproveita essa decisão já `APPROVED`, não a
  reabre.

**Representatividade**: 1 fonte só (Linear) é uma amostra fraca por si só para um padrão de
produto SaaS — mas o padrão que ela expõe (tier baixo/instantâneo/limitado vs. tier
alto/assíncrono/completo) é estrutural o bastante (a MESMA distinção aparece nos resultados de
busca não-verificados por fetch direto para Notion — export de workspace inteiro exige permissão
de Owner) que a uso aqui é como **critério de decisão qualitativa** (existe uma distinção real de
tier, não "todo export é igual"), não como número mágico a copiar. Os números exatos (250/2.000
linhas, 12h de expiração de link) são de Linear especificamente e não viram requisito deste
projeto — usados só para calibrar ORDEM DE GRANDEZA against `capacity-model.md`.

## Checklist de critérios de nota (subordinado aos eixos Segurança/AppSec, Privacidade e
Governança de Produto Multi-tenant de `joint-review-criteria.md`)

1. (peso 30%) **Tier de acesso correto** — export de dataset inteiro da organização nunca é
   `READ_ONLY_ROLES`/`WRITE_ROLES` (qualquer membro incluindo VIEWER/MEMBER); é ao menos
   `ADMIN_ROLES`, replicando tanto o padrão de mercado (Linear: workspace export é
   admin/owner-only) quanto o precedente já convergido deste projeto (ações de bulk/administração
   — convite, remoção de membro, mudança de role — já são `ADMIN_ROLES`).
2. (peso 25%) **Mitigação de CSV injection aplicada de fato, não só citada** — todo valor de
   célula que comece com `=`/`+`/`-`/`@` é escapado (prefixo apostrophe) na função de serialização
   do export, testado com um caso adversarial real, não um comentário prometendo o comportamento.
3. (peso 20%) **Proporcionalidade de infraestrutura** — o mecanismo de entrega (síncrono vs.
   fila+S3+presigned URL) é justificado pelo volume REAL esperado (`capacity-model.md`), não por
   precaução genérica; não introduzir fila/worker/bucket novo se o volume não justificar.
4. (peso 15%) **Nunca confundido com o DSR formal de LGPD** — a proposta declara explicitamente
   que este NÃO é o mecanismo `Exportação` de `privacy-lgpd.md` §3 (PRIV-003, `DataSubjectRequest`
   verificado, SLA ≤30 dias, ainda **não implementado**, escopo maior "M4+" já registrado em §7) —
   é um export de conveniência de produto, menor e mais rápido, que cobre parcialmente o mesmo
   direito de portabilidade sem substituir a obrigação formal.
5. (peso 10%) **Isolamento multi-tenant** — a query do export nunca vaza dado de outro tenant;
   usa o mesmo padrão de resolução de `tenantId`/`RequestContext` de todo outro endpoint
   (`resolver.resolve()`), nunca um parâmetro de tenant vindo do cliente.

## Decisão proposta

### Escopo do dado

**V1 cobre só `ExpirationItem`** (o "vencimento" central do produto, o que o Marcelo perguntou
literalmente — "todos os vencimentos registrados"), não `TrackedSubject`/`RequirementAssignment`.
Campos exportados: `itemId`, `displayName`, `type`, `dueDate`, `status`,
`assigneeUserId`(sem resolver e-mail — vazaria PII de outro usuário sem necessidade), `subjectId`
(referência, sem resolver nome — mesma razão), `tags`, `createdAt`, `updatedAt`. Export de
`TrackedSubject`/documentos fica para uma extensão futura, decisão própria não tomada aqui —
registrar como residual, não como escopo implícito desta aprovação.

### RBAC

Nova action `export:create`, tier **`ADMIN_ROLES`** (não `OWNER_ROLES` — não há razão para ser
mais restrito que `membership:invite`/`membership:remove`, que já são `ADMIN_ROLES`; não há
razão externa nem interna para elevar a `OWNER_ROLES`, que este projeto reserva para config.
externa/reputacional do tenant, `authorization.ts`'s comentário — export de dado interno não se
encaixa nessa classe).

### Síncrono, não assíncrono — v1 sem fila/S3/worker novo

`capacity-model.md`'s premissa base (`Itens por usuário ativo: 8`, ASSUMPTION) implica que mesmo
uma organização com 50 membros ativos teria ~400 `ExpirationItem` — um CSV de poucas centenas de
KB, muito abaixo de qualquer limiar que justifique o padrão assíncrono (fila+S3+presigned URL)
que `roadmap-evolution/09` usa para IMPORT (que lida com até 5.000 linhas de entrada de terceiro,
volume estruturalmente maior e menos controlado que um export do próprio dataset da organização).
Handler síncrono real, resposta HTTP É o arquivo (`Content-Disposition: attachment`,
`Content-Type: text/csv`), sem persistência em S3, sem TTL/link para gerenciar. Cap defensivo:
rejeitar (erro `VALIDATION`, mensagem explícita) acima de 10.000 itens numa única organização —
número redondo, ordem de grandeza acima do pior caso realista projetado em `capacity-model.md`
para o Stage atual do produto, evitando que uma query sem paginação trave o handler Lambda se um
tenant outlier crescer muito antes do próximo milestone de escala; recalibrar quando telemetria
real existir (mesma disciplina de `capacity-model.md`'s próprio "recalibrar com dado real assim
que houver").

### Mitigação de CSV injection

Novo módulo compartilhado `src/shared/csv/csv-export-sanitizer.ts` (não dentro de `expiration/`
especificamente, já que `roadmap-evolution/09` explicitamente disse "requisito testável em
qualquer export/relatório CSV futuro" — outros exports futuros reaproveitam o mesmo utilitário,
nunca uma cópia por módulo): função pura que recebe uma string e prefixa apóstrofo (`'`) se o
primeiro caractere (após trim) for `=`, `+`, `-`, ou `@` — mesma técnica que Microsoft
Excel/Google Sheets tratam como "texto literal, nunca fórmula" ao reabrir. Aplicada a TODO valor
de célula antes da serialização CSV, nunca condicional a um whitelist de campo (um campo hoje
"seguro" pode não ser amanhã se o schema mudar).

### Decisão que pertence ao Marcelo, não a este protocolo

Se o export deve ser **gratuito/imediato para todo plano** ou **limitado por plano/rate-limited**
(ex.: só planos pagos, ou N exports/dia) é uma decisão de produto/pricing, não de engenharia —
esta proposta assume "disponível para todo ADMIN/OWNER, sem limite de plano" como default v1
(mais simples, sem gate de billing que não existe ainda no produto — M12 billing está bloqueado
por D-052), mas registra explicitamente que Marcelo pode reverter esse default sem precisar
reabrir o protocolo (é um judgment call de produto, não uma decisão de arquitetura/segurança).

## Residuais não resolvidos nesta rodada (implementação real)

Formato exato do nome de arquivo, ordenação das linhas, se o header CSV é traduzido (pt-BR) ou
em inglês técnico, cobertura de teste completa (unit do sanitizer + G-V3, contract test do
schema de resposta) — decisões de implementação, ficam para a sessão que construir isto. XLSX
continua fora de escopo (mesma decisão já `APPROVED` de `roadmap-evolution/09`, "XLSX depois, não
simultâneo").
