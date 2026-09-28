# Pesquisa — número de owners/admins por plano na concorrência (2026-09-28)

**Pedido por:** Marcelo, 2026-09-28, complementar à pendência já registrada em
`docs/project/planos-precos-2026-09-27.md` §19 ("Múltiplos owners/admins por organização +
transferência de titularidade — pendência de produto... a contagem exata de owners/admins por tier
pago ainda precisa ser definida"). Objetivo: descobrir como a concorrência trata o número de
owners/admins por tier de plano, para adequar os planos do OmniVence.

**Declaração de pesquisa externa (protocolo E-014, `docs/engineering/research-protocol.md`): SIM.**
Modelo de papéis (owner/admin/member) e sua relação com tier de pricing é um padrão que outras
empresas SaaS já resolveram extensivamente — vale a mesma disciplina de fonte+data usada em
`pesquisa-concorrencia-2026-09-27.md`.

**Método**: busca web direcionada, 8 produtos reais, todos com fonte+data. Prioridade aos 2
precedentes diretos já usados em D-345/D-346 (Remindax, VendorJot — mesmos concorrentes/segmento
já validado para "organizações incluídas por tier"), complementados por 6 produtos SaaS B2B
mainstream com modelo de papéis maduro e documentado publicamente (a pesquisa de concorrência
direta de 2026-09-27 não tinha, nas 36 linhas levantadas, nenhuma que documentasse publicamente
sua política de owners/admins por tier — daí a necessidade de ampliar a amostra para produtos fora
do segmento direto, mesma lógica já usada em D-345/D-346 para o eixo de "organizações incluídas").

## Achado principal — nenhum dos 8 produtos pesquisados vende "número de owners/admins" como eixo de tier

| Produto | O que a fonte diz sobre owners/admins | Fonte | Data |
|---|---|---|---|
| **Remindax** (precedente direto, D-345/D-346) | Múltiplas contas de usuário/empresa por plano, mas nenhuma menção a limite específico de *quantos* podem ser admin/owner dentro dos usuários incluídos — o eixo pago é número de itens/empresas, não papel | [remindax.com/pricing](https://www.remindax.com/pricing) | 2026-09-28 |
| **VendorJot** (precedente direto, D-345/D-346) | Busca não encontrou página de pricing com detalhe de papéis — mesma lacuna: não documentado publicamente | busca agregada, página oficial não retornada | 2026-09-28 |
| **Notion** | Todo workspace tem ao menos 1 Owner; qualquer membro pode ser promovido a Owner, sem limite numérico ligado ao tier. Diferença real por tier: o papel **"Membership Admin"** (gerencia membros sem acessar config geral) só existe no plano **Enterprise** — tier mais caro ADICIONA um papel administrativo mais granular, não reduz nem cobra por owner | [Who's who in a Notion workspace](https://www.notion.com/help/whos-who-in-a-workspace), [Manage members, admins & guests](https://www.notion.com/help/add-members-admins-guests-and-groups) | 2026-09-28 |
| **Slack** | Exatamente **1 Primary Owner** por workspace (papel único, não escalável por tier), que pode nomear **Workspace Owners** e **Workspace Admins** em número **ilimitado**, restrito só pelo total de membros pagos. Em Enterprise Grid, existem múltiplos **Org Owners** no nível da organização (acima do workspace) — mais papéis à medida que o tier sobe, nunca um teto numérico de admins comuns | [Understand the Primary Owner role](https://slack.com/help/articles/360038161033-Understand-the-Primary-Owner-role), [Types of roles in Slack](https://slack.com/help/articles/360018112273-Types-of-roles-in-Slack) | 2026-09-28 |
| **monday.com** | Sem menção a limite de admins por plano nas fontes consultadas — admin é um papel atribuível a qualquer seat pago, sem contagem própria | [monday.com pricing](https://monday.com/pricing) | 2026-09-28 |
| **GitHub** | "Organization owners" não têm limite numérico documentado nem no Free nem no Team/Enterprise — qualquer membro pode ser promovido a owner; Enterprise adiciona um papel acima disso ("enterprise owner"), de novo um papel A MAIS no tier caro, não uma restrição no tier barato | [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) | 2026-09-28 |
| **Asana** | Enterprise/Enterprise+ adicionam controles administrativos mais granulares (SCIM, contas de serviço, controle de admin por projeto/equipe) — de novo, tier caro = MAIS controle administrativo, nenhuma fonte menciona limite de quantos podem ser admin em nenhum tier | [Asana subscriptions & pricing](https://help.asana.com/s/article/asana-subscriptions-and-pricing) | 2026-09-28 |
| **HubSpot** | Confirmação explícita e direta: **"HubSpot does not limit the number of super admins"** — a recomendação de manter 2-3 é prática de segurança operacional do próprio produto/consultores, não uma restrição técnica nem de pricing. Super Admin só exige que a pessoa já ocupe um seat pago do tier | [How Many Super Admins HubSpot Allows?](https://mpiresolutions.com/blog/how-many-super-admins-hubspot/), [HubSpot user permissions guide](https://knowledge.hubspot.com/user-management/hubspot-user-permissions-guide) | 2026-09-28 |

## Conclusão — padrão real e consistente nas 8 fontes

**Nenhum dos 8 produtos pesquisados usa "número de owners/admins permitidos" como alavanca paga de
tier.** O padrão que se repete, sem exceção nas fontes encontradas:

1. **O papel (Owner/Admin/Member) é atribuível livremente a qualquer seat já pago** — não existe
   preço por "seat de admin" separado de "seat de membro comum" em nenhuma das 8 fontes. O teto
   real é sempre o número TOTAL de usuários incluídos no tier (eixo que o OmniVence já tem:
   2/5/15/ilimitado) — nunca um sub-teto de quantos desses usuários podem ser Owner/Admin.
2. **Tier mais caro tipicamente ADICIONA papéis/granularidade administrativa nova** (Notion
   "Membership Admin" só no Enterprise; GitHub "enterprise owner" acima do org owner; Asana
   controles de admin por projeto/equipe no Enterprise) — o padrão de mercado é "mais caro = mais
   controle fino", não "mais caro = mais pessoas podem ser dono".
3. **Único limite numérico real encontrado é qualitativamente diferente do que a pendência
   original perguntava**: Slack limita a exatamente **1 Primary Owner** por workspace (não por
   tier — vale em todos os tiers igualmente) — esse é o papel mais próximo do `OWNER` único que o
   OmniVence já modela (protegido por `ownerCount`/last-owner). Não há segundo exemplo de um
   produto limitando o número de OWNERS a um teto por tier > 1 (ex. "Free permite 1 owner, Pro
   permite até 3").
4. **HubSpot é o caso mais explícito**: confirma por escrito que não há limite técnico de
   super-admins em NENHUM plano — a única barreira é o custo agregado de seats pagos (cada
   super-admin precisa de um seat pago), não uma regra de "X admins no tier Y".

## Consequência recomendada para os planos do OmniVence

**Não introduzir um sub-limite de "N owners/admins por tier"** — nenhuma fonte pesquisada sustenta
essa mecânica como padrão de mercado, e ela adicionaria uma segunda dimensão de contagem
(usuários totais E papéis administrativos) que a concorrência pesquisada não usa. Proposta
alinhada ao padrão real encontrado:

- **Manter o teto de usuários por tier já proposto** (2/5/15/ilimitado, `planos-precos-2026-09-27.md`
  §3) como o único eixo de contagem de pessoas — qualquer usuário dentro desse teto pode ser
  promovido a `ADMIN` livremente (já suportado hoje por `ChangeMembershipRoleService`), sem
  cobrança ou limite adicional por papel.
- **Manter exatamente 1 `OWNER` "verdadeiro" com poder de transferir/encerrar a organização**,
  protegido por `ownerCount`/last-owner (já implementado) — mesmo padrão do Slack Primary Owner,
  válido em todos os tiers igualmente, não como diferencial pago.
- **Múltiplos `ADMIN`s continuam ilimitados dentro do teto de usuários do tier** — já é o
  comportamento atual do sistema (`ADMIN_ROLES`/`OWNER_ROLES` em `authorization.ts`), nenhuma
  mudança de código necessária para isto especificamente.
- **Transferência de titularidade** (a outra metade da pendência original) é tratada em paralelo
  no protocolo Claude↔Codex de design (`docs/architecture/reviews/organization-ownership-transfer-scoping/`,
  em andamento) — este documento não decide a mecânica de transferência, só a contagem de
  owners/admins por tier.
- **Possível diferencial de tier alinhado ao padrão real encontrado** (não obrigatório, registrado
  como ideia a avaliar, não decisão): reservar um papel administrativo mais granular (ex.
  "gerencia membros mas não config de billing/organização", equivalente ao Notion Membership Admin)
  para os tiers Profissional/Premium, em vez de limitar quantos podem ser `ADMIN` comum. Isto seria
  uma ADIÇÃO de capacidade nos tiers caros, coerente com o padrão de mercado, não uma restrição nos
  tiers baratos.

## Limitações desta pesquisa

- Amostra de 8 produtos, 2 diretos do segmento (Remindax/VendorJot, sem dado público específico
  encontrado) + 6 SaaS B2B mainstream fora do segmento direto — ampliação necessária porque a
  pesquisa de concorrência direta de 2026-09-27 (36 concorrentes) não tinha nenhuma linha
  documentando publicamente política de owners/admins por tier.
- "Nenhuma fonte encontrada gating owners/admins por tier" é uma ausência nas fontes consultadas,
  não uma prova de que nenhum produto no mercado faz isso (mesma ressalva já usada em
  `pesquisa-concorrencia-2026-09-27.md` para outras ausências).
- GitHub/Slack Enterprise citam papéis adicionais (enterprise owner, org owner) sem preço público
  específico — tratados aqui só como evidência do PADRÃO qualitativo (mais tier = mais papel, não
  mais teto), não como dado de preço.

## Decisão sobre o protocolo Claude↔Codex

**Marcelo decidiu diretamente (2026-09-28) dispensar o protocolo `AGENTS.md` §4 para este
resultado** — condições da exceção formal de `docs/engineering/ai-governance.md` §2 satisfeitas:
(1) escolha feita diretamente pelo responsável final, não um agente propondo e outro validando;
(2) dispensa registrada explicitamente aqui, não implícita; (3) alternativa tecnicamente viável
permanece registrada acima ("Possível diferencial de tier alinhado ao padrão real encontrado") mesmo
sem debate formal em rodada. A recomendação (não criar sub-limite de owners/admins por tier;
manter o teto de usuários já existente como único eixo de contagem) é adotada como registrada
neste documento, sem rodada Claude↔Codex.
