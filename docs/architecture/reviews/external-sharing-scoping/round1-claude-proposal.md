# Rodada 1 — Compartilhamento Externo Seguro (Roadmap P1 item 19, último item do backlog)

**Autor**: Claude (Rodada 1). **Data**: 2026-09-07. **Nível de risco**: 5-6 (`change-risk-scale.md`) — introduz acesso **anônimo/não-autenticado** a um recurso do tenant (postura de segurança nova, não só um novo campo de dados); nível 6 se a decisão comercial "link público sem senha é aceitável?" for tratada como parte do modelo de dado fundamental. Tratado aqui como nível 5 com uma pendência de produto nomeada explicitamente (ver seção final) — não exige ADR formal por si só (mesmo precedente de D-218/D-179: novo mecanismo, não nova stack/domínio de dado sensível — o dado exposto, Document/DocumentFile, já é PII-adjacente e já tem tratamento LGPD existente, não é uma categoria nova).

## Contexto

`docs/project/roadmap-competitivo-2026-09-01.md` linha 111 lista "Compartilhamento externo seguro — link temporário, controle de acesso e futura governança" como último item pendente do backlog P1. Confirmado por leitura direta: **nada existe hoje** para isso. O único precedente de acesso não-autenticado no sistema é o fluxo guest de UPLOAD (`GuestSubmissionService`, D-037/D-129) — mas isso é o convidado ENVIANDO um documento para o tenant, nunca o tenant COMPARTILHANDO um documento já existente para leitura externa. É o problema inverso, mas o mecanismo de token é diretamente reaproveitável (ver Decisão 3).

**Problema de produto**: um admin do tenant quer compartilhar um `Document`/`DocumentFile` específico (ex. uma apólice de seguro vigente) com um terceiro sem conta no sistema (ex. um corretor, um auditor externo, um cliente do cliente) — sem forçar esse terceiro a criar conta, e sem expor o `Document` para sempre.

## Pesquisa externa considerada: SIM

Fontes (consultadas 2026-09-07):
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html (regras de token: CSPRNG, ≥128 bits de entropia, nunca derivado de valor conhecido, comparação em tempo constante, rate limit por token/IP).
- OWASP Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html (entropia de session ID: <128 bits é quebrável por força bruta em horas).
- Dropbox Help — "How to set shared link permissions" — https://help.dropbox.com/share/set-link-permissions (senha + data de expiração + revogação imediata em links compartilhados; plano Business permite expiração obrigatória).
- Google Workspace — expiração de link (Ivy/IronVest, "Set Expiry Links & Permission Models on Google Drive, OneDrive, and Dropbox") — https://getivy.ai/blog/secure-file-sharing (achado relevante: Google historicamente só expira acesso de USUÁRIO específico, não o link inteiro — Drive expandiu expiração no nível de link/pasta para Viewer/Commenter em novembro de 2025, mudança recente, cita a limitação histórica como motivo).
- Global Cybersecurity Network — "How to Stay Safe with Shared Documents: A 2026 Guide" — https://globalcybersecuritynetwork.com/blog/how-to-stay-safe-with-shared-documents/ (recomendação de link "view-only + sign-in required" para dado sensível, expiração curta para acesso temporário tipo contratante/revisor).

**Representatividade**: a amostra combina uma norma de segurança de aplicação (OWASP, autoridade em entropia/anti-enumeration/anti-brute-force — não é opinião de vendor) com dois produtos líderes de mercado em compartilhamento de arquivo (Google Drive, Dropbox — cobrem o extremo "expira só o usuário" vs. "expira o link inteiro com senha", achado real e não trivial de divergência histórica entre eles) e uma fonte de prática de segurança geral de 2026. Não inclui Box/Notion/Figma com fonte verificável — tentei localizá-las e a busca não retornou uma página de doc oficial acessível equivalente às de Dropbox/Google dentro do orçamento desta rodada; registro isso como limitação explícita, não escondo a lacuna (regra de `research-protocol.md` — nunca inventar fonte).

**Escopo da pesquisa**: informa a postura de segurança do token em si (entropia, anti-enumeration, anti-brute-force — decisão de segurança pura, RFC/OWASP-grade) e o modelo de expiração/revogação de link (decisão de produto SaaS estabelecida, onde Dropbox/Google divergem de fato). NÃO informa decisões internas (layout de PK/SK, qual Lambda hospeda a rota) — essas seguem só o precedente já convergido deste projeto (`guest-token.ts`, D-037).

## Checklist de critérios de nota (derivado da pesquisa, pesado, subordinado aos eixos de Segurança/Governança de Produto e Arquitetura de `joint-review-criteria.md`)

1. **(peso 25%) Token de alta entropia, nunca derivado de valor conhecido, comparação em tempo constante** — atende: ≥128 bits efetivos por segredo, CSPRNG, `timingSafeEqual`; não atende: qualquer token derivado de ID sequencial/timestamp/hash de email.
2. **(peso 20%) Expiração obrigatória e finita — nunca "para sempre" por omissão** — atende: todo link tem `expiresAt` calculado no momento da criação, sem opção de "nunca expira"; não atende: expiração opcional/nula permitida.
3. **(peso 15%) Revogação manual imediata, sem esperar o TTL** — atende: um admin pode invalidar o link antes da expiração natural, efeito imediato na próxima tentativa de acesso; não atende: só expiração passiva.
4. **(peso 15%) Sem enumeração — resposta idêntica para token inexistente/expirado/revogado/malformado** — atende: 1 erro genérico, sem vazar em qual dessas 4 categorias a falha caiu, mesmo padrão de `GuestTokenInvalidError`; não atende: mensagens/status diferenciados por causa.
5. **(peso 10%) Escopo mínimo de dado exposto — nunca listagem/busca, só o recurso explicitamente compartilhado** — atende: o visitante externo enxerga exatamente 1 `Document`/`DocumentFile` (nunca o Subject inteiro, nunca outros Documents do mesmo tipo); não atende: qualquer navegação lateral alcançável pelo link.
6. **(peso 10%) Rate limiting por token/IP contra força bruta** — atende: mesmo mecanismo de `GuestRateLimiter` já existente aplicado ao novo fluxo; não atende: endpoint sem limite de tentativas.
7. **(peso 5%) Auditoria de acesso — todo acesso bem-sucedido e nem toda falha é observável depois** — atende: `SecurityAuditEvent` novo (ou reuso da taxonomia fechada existente) registra pelo menos os acessos bem-sucedidos com timestamp; não atende: acesso anônimo sem trilha nenhuma.

## Decisões propostas

**Decisão 1 — Entidade nova `ExternalShareLink`**, co-localizada na partição do `Document` compartilhado (mesma convenção de `DossierExportRun` na partição do Subject, D-216):

```ts
export type ExternalShareLinkStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export interface ExternalShareLink extends EntityKey {
  SK: `SHARE#${string}`;           // shareId (ULID)
  entityType: "ExternalShareLink";
  tenantId: string;
  documentId: string;
  documentFileId?: string;         // se ausente, aponta para a versão CURRENT do Document no momento do acesso (Decisão 6)
  selectorHash: string;            // mesmo par selector.secret de guest-token.ts — Decisão 3
  secretHash: string;
  status: ExternalShareLinkStatus;
  createdByUserId: string;
  expiresAt: string;               // ISO, SEMPRE presente — Critério 2
  purgeAfterTtl: number;           // epoch seconds, TTL físico — mesmo padrão de GuestTokenPointer
  revokedAt?: string;
  revokedByUserId?: string;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

Ponteiro de lookup tenantless (mesma exceção estrutural de `GuestTokenPointer`/`IdentityMapping` — o lookup acontece ANTES de `tenantId` ser conhecido): `SHARELINK#<selectorHash>` / `POINTER`, apontando para `{tenantId, documentId, shareId}`.

**Decisão 2 — Cap de expiração: máximo 30 dias, default 7** — `MAX_EXTERNAL_SHARE_TTL_DAYS = 30`, `DEFAULT_EXTERNAL_SHARE_TTL_DAYS = 7`. Fecha o Critério 2 por construção (a rota de criação rejeita `ttlDays` ausente ou > 30 com 400). Racional: nenhuma fonte pesquisada trata "sem expiração" como aceitável para link público; 30 dias é o teto observado como "expiração longa" nos precedentes verificados (Dropbox Business permite configurar, não pesquisado o teto exato deles — registrado como limitação; 30 dias escolhido por analogia ao teto já usado neste projeto para outro artefato temporário, `report_exports`/D-215, 30 dias de retenção de bucket).

**Decisão 3 — Token reaproveitando literalmente `guest-token.ts`** (mesmo módulo, não uma cópia): `issueGuestToken`/`parseGuestToken`/`secretMatches`/`hmacGuestTokenCrypto` já implementam exatamente o Critério 1 (`randomBytes(16)`/`randomBytes(32)` = 128/256 bits, `timingSafeEqual`, pepper via HMAC) — generalizo o módulo removendo o nome "Guest" do que é puramente mecânica de token (proponho renomear para `opaque-token.ts` em `src/shared/`, promovendo o mecanismo de `src/modules/subject/domain/` para compartilhado, já que agora tem 2 consumidores reais em módulos diferentes: `subject` e `document-archive`). Zero reimplementação de criptografia — risco de segurança mais alto do design inteiro (rolar hash/entropia própria) é eliminado por reuso.

**Decisão 4 — RBAC**: `docarchive:share-link-create`/`docarchive:share-link-revoke`/`docarchive:share-link-list` novas, `ADMIN_ROLES` exclusivamente (mesmo tier de `docarchive:dossier-export`, D-216 Decisão 10 — compartilhar dado do tenant para fora é decisão de administração, não operação de dia-a-dia como `docarchive:create`). O ACESSO do visitante externo (rota GET pelo token) nunca passa por `authorize()`/`RequestContext` — mesmo padrão do guest upload (D-037), validado só pelo token.

**Decisão 5 — O que o visitante externo pode ver**: exatamente o conteúdo de 1 `DocumentFile` (download presigned) + metadados mínimos de exibição (nome do documento, nome do tipo, data de emissão se houver) — NUNCA listagem de outros Documents do Subject, NUNCA busca, NUNCA navegação para o Subject/Requirement pai. Fecha o Critério 5. Rota nova: `GET /external-share/{shareId}?token=<selector.secret>` (sem prefixo `/document-archive`, já que não passa pela allowlist autenticada do BFF — rota pública direta na API Gateway, mesmo padrão do guest upload que já tem rotas fora do BFF).

**Decisão 6 — Versão do arquivo servida**: por padrão o link aponta para a versão CURRENT do `Document` no momento de cada acesso (não congela a versão na criação) — decisão de produto assumida (compartilhar "a apólice vigente", não um snapshot pontual), sinalizada explicitamente como candidata a pendência do Marcelo na seção final, já que a alternativa (congelar `documentFileId` no momento da criação, mesmo padrão `scopeHash` de `DossierExportRun`) é igualmente defensável e muda a semântica do produto.

**Decisão 7 — Revogação manual imediata**: `PATCH /document-archive/documents/{documentId}/share-links/{shareId}/revoke`, `status: ACTIVE→REVOKED` via `executeTenantBusinessMutation` com OCC (`ConditionExpression: version = expectedVersion AND status = "ACTIVE"`). A rota de acesso do visitante relê o item fresco a cada request (nunca cacheia `status`) — fecha o Critério 3.

**Decisão 8 — Anti-enumeração**: um único erro genérico (`ExternalShareLinkInvalidError`, mesmo padrão de `GuestTokenInvalidError`) para token malformado, selector inexistente, secret errado, `status != ACTIVE`, ou `expiresAt` no passado — nenhuma dessas 5 causas é diferenciável pela resposta HTTP (sempre 404 genérico, nunca 410/403 diferenciado). Fecha o Critério 4.

**Decisão 9 — Rate limiting**: reuso do mecanismo `GuestRateLimiter` (generalizado junto com Decisão 3, já que a lógica de "N tentativas por janela por IP/selector" não é específica de guest upload) aplicado à rota de acesso — fecha o Critério 6.

**Decisão 10 — Auditoria**: acesso bem-sucedido emite evento na taxonomia fechada de `security-audit.ts` (`EXTERNAL_SHARE_LINK_ACCESSED`, novo, com `shareId`/`documentId`/IP hash — nunca IP cru, mesma disciplina de PII já aplicada a outros eventos dessa taxonomia). Fecha o Critério 7. Falhas de acesso (token inválido) deliberadamente NÃO auditadas individualmente no MVP (volume potencialmente alto de tentativas de força bruta geraria ruído — rate limiting já cobre o vetor de ataque; abrir auditoria de falha é candidato a fatia futura se houver sinal real de abuso).

## Composição com o modelo existente

`ExternalShareLink` não modela nem duplica RBAC de `Requirement`/`DocumentFile` — é uma porta de acesso paralela e estritamente mais restrita (1 Document, read-only, sem navegação), nunca uma segunda forma de autenticação para o app principal. Segue o mesmo fencing transacional OCC de D-211-221 (toda mutação de `ExternalShareLink` via `executeTenantBusinessMutation`, `version` incrementado a cada mudança de `status`).

## Pendência de produto nomeada (não bloqueia o design, mas exige decisão do Marcelo antes da implementação)

1. **Congelar versão vs. servir sempre a versão CURRENT (Decisão 6)** — trade-off de produto genuíno, não uma questão de engenharia: um link "vivo" que sempre mostra o documento mais recente é mais útil operacionalmente (ex. corretor sempre vê a apólice vigente) mas semanticamente mais parecido com "acesso contínuo" do que "compartilhamento de um documento específico"; um link congelado é mais previsível/auditável mas pode ficar desatualizado no dia seguinte a uma renovação. Ambas são defensáveis; a escolha certa depende de como Marcelo imagina o caso de uso real do produto, não de um critério técnico.
2. **Link sem senha é aceitável para este produto?** — o design acima trata o token de alta entropia como suficiente (mesma postura de Dropbox/Google para link "quem tem o link acessa"), mas não oferece camada de senha adicional (que Dropbox Business oferece como opção). Dado que o dado exposto (documentos como apólices/contratos) é sensível, perguntar explicitamente se "quem tem o link" deve bastar, ou se o produto quer exigir também uma senha/PIN definida pelo admin como segunda camada, é uma escolha de postura de segurança-produto que cabe a Marcelo, não uma decisão de engenharia pura.

Estas duas pendências não bloqueiam o fechamento do protocolo Claude↔Codex (o design é completo e coerente assumindo as escolhas atuais como default) — são registradas para decisão explícita antes de qualquer implementação real, conforme instrução do task brief desta sessão.
