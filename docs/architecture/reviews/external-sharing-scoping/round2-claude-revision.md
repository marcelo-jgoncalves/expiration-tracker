# Rodada 2 — Revisão Claude (ExternalShareLink)

**Autor**: Claude (Rodada 2). **Data**: 2026-09-07. Responde aos 17 achados + calibração de checklist da Rodada 1 do Codex, ponto a ponto, nenhum silenciado.

## Minha autoavaliação da Rodada 1 (revelada só agora, depois da nota cega do Codex)

Concordo com a maioria dos achados. Nota que eu teria dado à minha própria Rodada 1, honestamente: pesquisa 7,0/10 (a lacuna de fonte primária AWS presigned/capability URL é real, deveria ter buscado antes de escrever), design 5,5/10 (achados 1, 2, 3, 6, 9, 11, 15 são bugs de design reais, não nitpicks — a Decisão 6/"CURRENT" e a ausência de transação de criação são os mais graves). O Critério 7 subponderado (5%) para uma feature de exposição externa também procede.

## Checklist recalibrado (régua v2 — nasce aqui, nunca aplicada retroativamente à nota da Rodada 1)

Reconciliação dos achados de calibração do Codex: Critério 1 dividido em dois (entropia vs. transporte), Critério 3 reformulado para ser literalmente atingível, Critério 5 amplia para integridade referencial, Critério 6 corrigido para não atribuir capacidade inexistente ao `GuestRateLimiter`, Critério 7 repesado (5%→12%), 3 critérios novos adicionados (vínculo transacional, lifecycle do tenant, criação atômica). Pesos resomados a 100%.

1. **(peso 15%) Token de alta entropia, nunca derivado de valor conhecido, comparação em tempo constante COM caminho dummy** — atende: ≥128 bits efetivos, CSPRNG, `timingSafeEqual`, E uma comparação dummy de custo equivalente quando o selector não existe (fecha achado 8).
2. **(peso 8%) Transporte do token não amplia a superfície de vazamento além do necessário** — atende: `Cache-Control: no-store`, sem `Referrer-Policy` vazando para terceiros, redaction explícita de query string nos logs de acesso (fecha achado 4 — não elimina token na URL, mas declara e mitiga o risco residual em vez de ignorá-lo).
3. **(peso 12%) Expiração obrigatória e finita, com semântica de estado literalmente verificável** — atende: `expiresAt` sempre presente, cap de 30 dias, e o campo `status` nunca afirma algo que a transição real não garante (fecha achados 9 e 10).
4. **(peso 12%) Revogação para NOVAS solicitações é imediata; janela residual declarada e limitada ao presign já emitido (≤5min)** — atende: revogação bloqueia toda nova emissão de presign no próximo request; a proposta declara explicitamente que um presign já emitido continua válido até seu próprio TTL, nunca finge revogação instantânea de bytes já autorizados (fecha achado 1, reformulação literal do Critério 3 original).
5. **(peso 12%) Sem enumeração — resposta idêntica (corpo, status, faixa de latência controlável, rate limit) para toda causa de falha de resolução** — atende: 1 erro genérico cobrindo as 5 causas + ordem de operações fixa (parse→dummy-ou-real hash→rate limit→lookup) igual em todo caminho (fecha achado 7 parcialmente, achado 8).
6. **(peso 13%) Vínculo referencial do alvo é validado transacionalmente na criação E revalidado a cada acesso — nunca um ID solto** — atende: mesmo tenant, arquivo pertence à versão pretendida, arquivo `CLEAN`/`ACCEPTED` (fecha achados 2 e 3).
7. **(peso 8%) Estado do tenant é revalidado a cada acesso anônimo, nunca só na criação** — atende: leitura anônima verifica `TenantLifecycleRecord = ACTIVE` antes de emitir presign (fecha achado 15).
8. **(peso 8%) Criação é atômica (link + ponteiro + fences), nunca dois passos com estado intermediário possível** — atende: uma `TransactWriteItems`, cap de links ativos por documento, colisão de selector tratada (fecha achado 6).
9. **(peso 7%) Rate limiting real por seletor E por IP, sem criar oracle de 429 diferenciado** — atende: mecanismo generalizado de `DocumentArchiveGuestRateLimiter.consumeBoth` (não o `GuestRateLimiter` simples, citação corrigida), 429 aplicado de forma indistinguível do 404 em timing (fecha achado 7 completo).
10. **(peso 5%) Escopo mínimo de dado exposto — resposta fechada e sanitizada, nunca objeto interno serializado** — atende: contrato de resposta explícito de campos, nunca serialização de `Document`/`DocumentType` (fecha achado 16).

## Achados respondidos, ponto a ponto

**Achado 1 (revogação não fecha presign já emitido) — ACEITO, corrigido pela Decisão 7-bis.** Critério 4 recalibrado (item 4 acima) declara a janela residual como parte do contrato, não uma promessa quebrada.

**Achado 2 (nenhuma regra determinística para "exatamente um DocumentFile") — ACEITO, corrigido pela Decisão 1-bis.** `documentFileId` passa a ser **sempre resolvido e persistido no momento da criação** (nunca "ausente = resolver depois") — se o admin não especificar, o serviço resolve o `PRINCIPAL` `CLEAN` da versão `ACCEPTED` corrente NA CRIAÇÃO e grava esse `documentFileId` concreto no item. Isso também fecha a Decisão 6 original (ver achado 11).

**Achado 3 (vínculo não protegido transacionalmente) — ACEITO, corrigido pela Decisão 1-ter.** A criação passa a ser uma `TransactWriteItems` com `ConditionCheck`s: `Document.tenantId = <esperado>`, `DocumentFile.documentId = <esperado> AND status = "CLEAN"`, `DocumentVersion.status = "ACCEPTED"` — mesma disciplina de `buildVersionConditionCheck` já usada em D-220.

**Achado 4 (token em query string) — PARCIALMENTE ACEITO.** Não hà transporte melhor disponível sem introduzir um passo de troca de sessão (que é desproporcional para o escopo desta feature — nenhum precedente pesquisado, Dropbox/Google incluídos, usa outra coisa que não token na URL para o CASO "link enviado por fora do produto"). Em vez de trocar o transporte, a proposta declara e fecha o risco residual: `Cache-Control: no-store` na resposta, e a rota é registrada explicitamente na allowlist de redaction de log de acesso (mesmo mecanismo que já existe para não logar segredo de guest token — confirmar por leitura antes da implementação se esse mecanismo de redaction já existe ou precisa ser criado; se não existir, é um achado de dívida técnica pré-existente também aplicável ao guest upload, não exclusivo desta feature). Critério 2 do checklist v2 cobre isso.

**Achado 5 (shareId no path vs. selector no token, sem reconciliação) — ACEITO.** Regra explícita: o `selector` do token é a ÚNICA autoridade de resolução — a rota resolve o ponteiro pelo `selectorHash`, obtém o `shareId` real, e o `{shareId}` do path é usado SÓ para logging/rastreabilidade, nunca para lookup. Se `{shareId}` do path não bate com o resolvido pelo token, a resposta é o MESMO erro genérico (nunca um erro diferenciado) — fecha o achado sem abrir um oracle novo.

**Achado 6 (criação não desenhada, sem atomicidade) — ACEITO, corrigido pela Decisão 1-ter acima + Decisão 11 nova (cap MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT = 5).**

**Achado 7 (`GuestRateLimiter` não faz o que a proposta afirmou) — ACEITO.** Correção de fato: o mecanismo generalizado é baseado em `DocumentArchiveGuestRateLimiter.consumeBoth` (que já trata seletor + IP, confirmado por leitura mais cuidadosa nesta rodada), não o `GuestRateLimiter` simples de `subject`. Ordem de operações fixada: parse estrutural → rate limit check (selector-key OU IP, o que vier primeiro dispara 429 indistinguível de 404 em corpo) → hash do selector (real ou dummy) → lookup → comparação do secret (real ou dummy).

**Achado 8 (comparação dummy ausente) — ACEITO**, incorporado ao Critério 1 do checklist v2 e à ordem de operações do achado 7.

**Achado 9 (`EXPIRED` sem transição real) — ACEITO, corrigido pela Decisão 1-quater.** `status` passa a ter só 2 valores persistidos: `ACTIVE | REVOKED`. Expiração é sempre DERIVADA em leitura (`expiresAt < now()`), nunca um terceiro estado persistido — remove a classe de bug inteira (nenhum reconciliador necessário). `purgeAfterTtl` continua sendo `expiresAt + margem de retenção de auditoria` (proponho 30 dias de margem, mesma retenção já usada em `report_exports`/D-215), não `expiresAt` cru — um link expirado continua consultável para fins de auditoria/lista por um tempo antes do TTL físico apagar.

**Achado 10 (contradição "rejeita ausente" vs. "default 7") — ACEITO, erro de redação real.** Regra corrigida: `ttlDays` é OPCIONAL no corpo da requisição; ausente → default 7; presente e > 30 → 400; presente e ≤ 0 → 400. Nunca "rejeita ausente".

**Achado 11 (semântica CURRENT amplia acesso sem novo consentimento) — ACEITO POR COMPLETO, muda a Decisão 6 original.** A pendência de produto #1 da Rodada 1 (congelar vs. CURRENT) é resolvida aqui a favor de **congelar sempre** — não é mais uma pendência aberta de produto, é uma decisão de engenharia de segurança: a Decisão 1-bis (achado 2) já resolve `documentFileId` para um valor concreto no momento da criação, então "CURRENT" nunca existiu como opção real depois dessa correção. Isso reduz as pendências de produto da Rodada 1 de 2 para 1 (só a senha continua pendente — ver abaixo).

**Achado 12 (pendência de senha é material demais para não bloquear) — DISCUTO, não aceito integralmente.** O design aqui proposto é explicitamente "capability bearer sem segundo fator" — mesma postura que Dropbox/Google tratam como o CASO BASE (link "quem tem, acessa"), com senha como camada OPCIONAL adicional em produtos mais maduros (achado real da pesquisa: Dropbox oferece senha como feature de plano Business, não como obrigatoriedade universal). Proponho registrar isso como escopo explícito do design — v1 é bearer-token puro, sem senha — e a pendência de produto vira "adicionar camada de senha opcional é uma fatia FUTURA nomeada, não um bloqueador do v1", desde que o Marcelo confirme essa leitura antes da implementação real (mantida como pendência de produto na consolidação final, mas não bloqueia o fechamento do protocolo — concordo com o Codex que a arquitetura precisa DECLARAR essa postura explicitamente em vez de tratá-la como incidental, o que faço aqui).

**Achado 13 (auditoria incompleta, contadores sem writer) — ACEITO, corrigido pela Decisão 10-bis.** Removo `lastAccessedAt`/`accessCount` do item `ExternalShareLink` (evita contenção OCC por acesso e evita campo enganoso sem writer). Em vez disso, 4 eventos na taxonomia fechada: `EXTERNAL_SHARE_LINK_CREATED`, `EXTERNAL_SHARE_LINK_REVOKED`, `EXTERNAL_SHARE_LINK_PRESIGN_ISSUED` (renomeado de `ACCESSED` — nome afirma exatamente o que o sistema sabe: um presign foi emitido, não que o S3 foi de fato baixado, mesma disciplina de "nunca afirmar causa que o sistema não revelou" de D-191), e `EXTERNAL_SHARE_LINK_TENANT_INACTIVE_BLOCKED` (achado 15). Contagem de acessos, se necessária no futuro, é derivável do stream de auditoria via query, nunca um contador denormalizado sem writer certo.

**Achado 14 (IP hash subespecificado) — ACEITO, corrigido pela Decisão 10-ter.** HMAC com pepper PRÓPRIO (`EXTERNAL_SHARE_IP_AUDIT_PEPPER`, nunca o mesmo pepper do token — domínios criptográficos separados, achado aceito). IP confiável = `event.requestContext.identity.sourceIp` do API Gateway (nunca um header `X-Forwarded-For` do cliente, que é falsificável) — mesmo padrão que qualquer outro rate-limiter/IP-based control deste projeto já deveria seguir (achado de dívida técnica pré-existente potencialmente aplicável a `DocumentArchiveGuestRateLimiter` também — fora do escopo desta decisão, nomeado na consolidação).

**Achado 15 (tenant lifecycle não revalidado na leitura anônima) — ACEITO, corrigido pela Decisão 5-bis.** A rota de acesso do visitante, antes de emitir presign, faz um `GetItem` de `TenantLifecycleRecord` e confirma `status = ACTIVE` — falha colapsa no mesmo erro genérico 404 (nunca um erro diferenciado que revelaria "tenant existe mas está inativo").

**Achado 16 (metadados podem vazar dado tenant-controlled não sanitizado) — ACEITO, corrigido pela Decisão 5-ter.** Contrato de resposta fechado e explícito:
```json
{ "documentTypeName": "string, sanitizado com sanitizeFormulaInjection (reuso do helper de D-217) mesmo não sendo CSV/XLSX — defesa em profundidade contra render futuro em planilha",
  "documentIssuedDate": "YYYY-MM-DD ou null",
  "fileName": "string, sanitizado",
  "downloadUrl": "presign S3, TTL 5min" }
```
Nunca serializa `Document`/`DocumentType`/`DocumentVersion` inteiros — um serializer dedicado, não um `JSON.stringify` do agregado.

**Achado 17 (sem rota/cap/paginação de listagem) — ACEITO, corrigido pela Decisão 11.** Rota `GET /document-archive/documents/{documentId}/share-links` nova (RBAC `docarchive:share-link-list`, `ADMIN_ROLES`), paginada via GSI1 (mesmo índice de listagem já usado por `DocumentType`/`RequirementTemplate`), cap `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT = 5` (rejeita criação de um 6º link ativo para o mesmo Document com 400 — força revogar antes de criar outro, evita acúmulo ilimitado de ponteiros tenantless).

## Modelo de dados revisado (substitui a Decisão 1 da Rodada 1 por completo)

```ts
export type ExternalShareLinkStatus = "ACTIVE" | "REVOKED"; // achado 9 — EXPIRED nunca persistido

export interface ExternalShareLink extends EntityKey {
  SK: `SHARE#${string}`;
  entityType: "ExternalShareLink";
  tenantId: string;
  documentId: string;
  documentTypeId: string;      // denormalizado na criação, para exibir documentTypeName sem 2ª leitura
  documentVersionId: string;   // congelado na criação (achado 11) — nunca CURRENT
  documentFileId: string;      // SEMPRE resolvido e concreto na criação (achado 2) — nunca opcional
  selectorHash: string;
  secretHash: string;
  status: ExternalShareLinkStatus;
  createdByUserId: string;
  expiresAt: string;
  purgeAfterTtl: number;       // expiresAt + 30 dias de margem de auditoria (achado 9)
  revokedAt?: string;
  revokedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

Ponteiro tenantless inalterado da Rodada 1: `SHARELINK#<selectorHash>` / `POINTER` → `{tenantId, documentId, shareId}` (o `shareId` no ponteiro é a autoridade — achado 5).

## Decisões 1-bis a 11 (substituem/complementam as decisões numeradas da Rodada 1 conforme mapeado acima)

Todas as correções acima são normativas para a Rodada 3 — nenhuma decisão da Rodada 1 sobrevive sem a correção citada no achado correspondente. Decisões 2, 4, 8 da Rodada 1 (RBAC, token reuso, anti-enumeração) permanecem como estavam, só refinadas pelos achados 1/5/7/8 acima.

## Pendência de produto remanescente (reduzida de 2 para 1)

**Única pendência real**: confirmar que "v1 sem senha, camada de senha opcional como fatia futura nomeada" (resposta ao achado 12) é a leitura correta do apetite de risco do Marcelo para este produto, dado que o dado exposto (apólices/contratos) é sensível. Não bloqueia o fechamento do protocolo Claude↔Codex (design completo assumindo essa postura como v1), mas bloqueia a IMPLEMENTAÇÃO real até confirmação explícita — mesma disciplina do task brief desta sessão.
