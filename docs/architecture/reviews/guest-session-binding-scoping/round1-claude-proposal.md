> **Status (2026-09-12, fim de sessão)**: proposta escrita e verificada contra o código real, mas NUNCA enviada ao Codex — `codex exec` bateu limite de uso repetidamente (5+ tentativas ao longo de ~45min, mensagem idêntica de reset já vencido, sugerindo cota mais longa que o rolling window de minutos que o erro alega). Próxima sessão: rodar `codex exec --skip-git-repo-check - < docs/architecture/reviews/guest-session-binding-scoping/round1-claude-proposal.md > .../round1-output.txt` (arquivo de saída num scratchpad de sessão, não aqui) como a primeira ação da Rodada 1 real, verificar disponibilidade do Codex antes com um probe mínimo. Nenhuma linha de código foi alterada para esta decisão ainda.

Rodada 1 (proposta inicial). Decisão P0.2 da auditoria externa 2026-09-11 (`docs/engineering/reviews/external-audit-2026-09-11-critica-repositorio.md`): `GuestSession` não está vinculada ao credential/token do path.

## Contexto real (verificado no código antes de propor, não só a descrição da auditoria)

Arquivos: `src/modules/document-archive/domain/guest-session.ts`, `src/modules/document-archive/application/guest-document-access-service.ts`, `src/modules/document-archive/http/document-archive-guest-handlers.ts`.

O próprio `handleSubmitEvidence` já documenta o achado (comentário nas linhas 192-201): o cookie de sessão é global por navegador (`__Host-et_docarchive_guest_session`, `Path=/`, sem escopo por token) - duas abas com dois links de guest diferentes compartilham o mesmo cookie jar; a segunda emissão de sessão sobrescreve o cookie da primeira aba, e a chamada `uploads` da primeira aba depois resolve contra a SEGUNDA sessão/DocumentRequest, não a própria. `requireToken(req)` no path é chamado só "for route symmetry/observability" - nunca usado pra resolver ou validar nada.

`GuestSession` (domínio) JÁ carrega os 2 campos que fecham esse gap sem exigir schema/migração nova: `documentRequestId` (o request que a sessão representa) e `credentialSelectorHash` (o selectorHash do `RequestAccessCredential` que mintou esta sessão) - hoje documentado como "audit trail only, never used for authorization". `RequestAccessCredential`/`GuestSession` usam o mesmo esquema selector.secret + HMAC-SHA256(pepper) + `timingSafeEqual` (`request-access-credential.ts`/`guest-session.ts`).

## Pesquisa externa (E-014, decisão nível 5-6 que redefine um padrão já resolvido fora deste projeto): SIM

Vínculo de sessão ao recurso do path é o padrão estabelecido de defesa contra IDOR/"confused deputy" em fluxos de link-por-e-mail/token: OWASP Testing Guide (WSTG-BUSL-04, "Testing for Process Timing"/IDOR) e OWASP Session Management Cheat Sheet recomendam nunca inferir o recurso-alvo de uma mutação só do estado de sessão ambiente quando a própria URL/path já carrega um identificador de recurso - a mutação deve reprovar a identidade do recurso do path contra a sessão a cada chamada, não confiar que a sessão "deve" corresponder. Confirmando: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html (acessado 2026-09-12) e https://owasp.org/www-community/Testing_for_Insecure_Direct_Object_References (mesma data). Checklist derivado (nasce nesta Rodada 1, nunca adicionado depois):

1. (peso 50%) **Toda mutação que aceita um token de path/recurso explícito reprova esse token contra a sessão ambiente antes de agir** - nunca confia que "a sessão presente deve ser a certa".
2. (peso 30%) **A falha de vínculo colapsa no MESMO erro genérico de qualquer outra falha de guest-auth** (disciplina anti-enumeração já estabelecida neste módulo, Decision 4) - nunca um erro diferenciado "sessão não pertence a este link".
3. (peso 20%) **O mecanismo de vínculo não abre uma nova superfície de timing/enumeração** - comparação de hash de selector não-secreto não precisa de `timingSafeEqual` (já não é feito hoje pra outros lookups de selectorHash neste módulo), mas não deve vazar qual dos dois (path ou sessão) está "errado".

## Proposta de desenho

**Vínculo por `credentialSelectorHash`, não por `documentRequestId` direto.** Duas opções óbvias existiam - comparar `session.documentRequestId` contra o `documentRequestId` do credential do path, ou comparar os dois `selectorHash`. Escolho `credentialSelectorHash` porque é o campo que já existe com EXATAMENTE esse propósito documentado ("the credential's own selectorHash this session was minted from") e evita uma segunda leitura completa do `DocumentRequest`/re-verificação de secret do credential do path a cada chamada de mutação - só precisamos do SELECTOR (não do secret) do token do path pra derivar o hash e comparar.

1. `handleSubmitEvidence`/`handleConfirmUpload` (HTTP): passam a repassar o `token` do path (já extraído por `requireToken`, hoje descartado) para o service, em vez de só chamar `requireToken` por "simetria".
2. `GuestDocumentAccessService.submitEvidence`/`confirmUploadInFlight`: novo parâmetro `pathToken: string`. Após `resolveSession()`, antes de qualquer efeito colateral: `parseRequestAccessToken(pathToken)` (reaproveita o parser já existente, nunca um novo); se inválido, `GuestAccessInvalidError` (mesmo colapso genérico). Calcula `hmacRequestAccessCrypto.hash(this.pepper, parsed.selector)` e compara (`===`, não `timingSafeEqual` - não é comparação de segredo, é comparação de identificador de recurso, mesma classe que comparar 2 UUIDs) contra `resolved.session.credentialSelectorHash`. Mismatch → `GuestAccessInvalidError`, mesmo path de erro de qualquer outra falha.
3. **Nunca reautentica o secret do credential do path** - a sessão já provou posse na emissão (Decision 4); esta checagem só prova "o path que o navegador está visitando agora é o mesmo recurso que mintou a sessão presente no cookie", fechando exatamente o cenário de 2 abas da auditoria.
4. `handleGetGuestRequest`/`handleStartGuestSession`/`handleListGuestDocumentTypes` (rotas que resolvem só pelo path token, nunca por sessão) não precisam de mudança - o problema é exclusivo das 2 rotas que hoje resolvem pela sessão-cookie mas recebem um token de path que nunca comparam.

## Pergunta

O desenho fecha as 3 categorias do checklist? Algum achado bloqueante na abordagem (`credentialSelectorHash` vs. `documentRequestId`, ausência de `timingSafeEqual` na comparação, escopo das 2 rotas afetadas)?
