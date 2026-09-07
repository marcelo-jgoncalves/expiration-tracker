# Rodada 3 — Revisão Final Claude (ExternalShareLink)

**Autor**: Claude (Rodada 3). **Data**: 2026-09-07. Responde aos 23 achados (17 originais + 6 novos) e à calibração v2 da Rodada 2 do Codex (pesquisa 6,2/10, design 6,7/10). Verifiquei por LEITURA DIRETA do código real (não por argumento) os 3 achados de fato ("nomes de atributo errados", "IP cru no rate limiter", "auditoria é CloudWatch, não stream consultável") — todos os 3 procedem, confirmados abaixo.

## Achado real adicional que muda o design (verificado por leitura, não citado pelo Codex)

Durante a verificação, encontrei `src/modules/document-archive/application/guest-document-access-service.ts` — um precedente DIRETO e mais próximo do que `guest-token.ts`: já implementa credential/session tokens tenantless para acesso não-autenticado a `document-archive` especificamente, com a MESMA disciplina de anti-enumeração (`GuestAccessInvalidError` único) e, crucialmente, a ORDEM CORRETA já resolvida e testada em produção: **parse → rate limit ANTES do lookup (nunca depois) → lookup do ponteiro → comparação dummy-safe do secret**. Isso fecha diretamente os achados 7/8/21 (ordem contraditória) — a ordem certa é a que este precedente já usa, não a que eu inventei nas Rodadas 1-2. `ExternalShareLink` deveria seguir literalmente este precedente (`RequestAccessCredential`/`GuestSession`, `request-access-credential.ts`) em vez de `guest-token.ts` — é o precedente mais específico e mais recente (D-143) para exatamente este módulo.

## Correções de fato (achados 3, 14, 18 da Rodada 2 — verificados, todos procedem)

**Achado 3 (nomes de atributo errados) — CONFIRMADO POR LEITURA, corrigido.** `DocumentFile.scanStatus` (não `status`) — valor terminal correto é `"CLEAN"` (`document-file.ts`). `DocumentVersion.state` (não `status`) — valor correto é `"ACCEPTED"` (`document-version.ts`, `DocumentVersionState`). A `TransactWriteItems` de criação agora usa os nomes reais:
```ts
// ConditionCheck em DocumentFile: scanStatus = "CLEAN" AND documentId = <esperado> AND documentVersionId = <esperado>
// ConditionCheck em DocumentVersion: state = "ACCEPTED" AND documentId = <esperado>
```

**Achado 14/23 (IP cru persistido no rate limiter) — CONFIRMADO POR LEITURA, mas fora do escopo desta decisão.** `document-archive-guest-rate-limiter.ts` já persiste IP cru (`DOCARCHIVEGUESTIP#${ip}#RATE`) para o fluxo de guest UPLOAD existente (D-143) — é um padrão pré-existente do projeto, não algo que este design introduz. `ExternalShareLink` reusa o MESMO rate limiter (mesma justificativa de reuso da Decisão 3) e portanto herda a mesma característica — não uma regressão nova, mas também não corrigida aqui. Registro como achado de dívida técnica pré-existente NOMEADO na consolidação (não bloqueia este design, mesma disciplina de D-177→D-178: mudar comportamento de um mecanismo compartilhado por outro consumidor fora do escopo desta decisão). A pseudonimização com pepper próprio (achado 14 original) continua se aplicando SÓ ao evento de auditoria (`EXTERNAL_SHARE_LINK_*`), não ao registro operacional do rate limiter — dois mecanismos diferentes, escopos diferentes, nunca confundidos.

**Achado 13/18 (auditoria: `security-audit.ts` é CloudWatch estruturado, não um "stream consultável") — CONFIRMADO POR LEITURA, corrigido.** Removo a alegação errada ("derivável via query" nunca foi verdade — é log estruturado no CloudWatch, consultável via CloudWatch Insights, nunca uma tabela DynamoDB). Os 4 eventos (`CREATED`/`REVOKED`/`PRESIGN_ISSUED`/`TENANT_INACTIVE_BLOCKED`) continuam propostos, mas a proposta agora afirma corretamente o que eles são: trilha de auditoria operacional (CloudWatch Logs Insights), não um mecanismo de contagem em tempo real do produto — por isso `activeShareLinkCount` (abaixo) é um CONTADOR TRANSACIONAL separado, nunca derivado da auditoria.

## Checklist recalibrado (régua v3 — reintroduz auditoria como critério próprio, achado 18)

1. (peso 12%) Token de alta entropia + comparação dummy-safe, ORDEM fixa (parse→rate limit→lookup→compare), idêntica ao precedente `guest-document-access-service.ts`.
2. (peso 8%) Transporte do token declara e mitiga risco residual (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, redaction de log).
3. (peso 10%) Expiração obrigatória, finita, semântica de estado literalmente verificável (`ACTIVE|REVOKED` só, expiração sempre derivada).
4. (peso 10%) Revogação bloqueia toda NOVA emissão de presign imediatamente; janela residual do presign já emitido (≤5min) é uma propriedade sistêmica aceita do padrão de presign já usado em D-215/216/217, não uma falha exclusiva deste design.
5. (peso 10%) Sem enumeração, ordem de operações idêntica ao precedente citado no achado 21.
6. (peso 12%) Vínculo referencial validado transacionalmente com os NOMES DE ATRIBUTO REAIS na criação e revalidado a cada acesso.
7. (peso 6%) Estado do tenant revalidado a cada acesso anônimo (leitura consistente antes de emitir presign).
8. (peso 10%) Cap de links ativos por Document é ATOMICAMENTE aplicado (contador transacional, nunca "contar depois criar").
9. (peso 6%) Rate limiting reusa o precedente exato de `document-archive-guest-rate-limiter.ts`, sem inventar mecanismo novo.
10. (peso 6%) Escopo mínimo de dado exposto, DTO fechado, nomes/snapshots corretos (nunca serial响 agregado interno).
11. (peso 10%) Auditoria cobre o ciclo administrativo completo (criação/revogação/presign emitido/bloqueio por tenant inativo) como trilha CloudWatch, corretamente descrita como tal (não como stream de produto).

## Correção do cap atômico (achado 6/17/22 — cap de 5 links ativos)

Abandonado o "Query GSI1 e contar" (não atomicamente aplicável, achado 22 confirmado). Novo mecanismo: contador embutido no próprio item `Document` — `Document.activeExternalShareLinkCount: number` (novo campo, default 0) — incrementado/decrementado na MESMA `TransactWriteItems` que cria/revoga o `ExternalShareLink`:
- **Criação**: `Update Document SET activeExternalShareLinkCount = activeExternalShareLinkCount + 1 WHERE activeExternalShareLinkCount < 5` (ConditionExpression, mesma mecânica de contador atômico com teto que o projeto já usa para outros caps, ex. `RequirementTemplate` embutido) + `Put ExternalShareLink` + `Put SHARELINK pointer` — 3 ações na mesma transação, nunca 2 passos.
- **Revogação**: `Update Document SET activeExternalShareLinkCount = activeExternalShareLinkCount - 1` + `Update ExternalShareLink SET status = REVOKED` — mesma transação.
Isso fecha o achado 22 por construção: duas criações concorrentes nunca ultrapassam 5, porque a condição do contador é avaliada pelo DynamoDB dentro da MESMA transação que grava o novo link — exatamente a garantia que "contar antes" não dava.

## Correção da ordem anti-enumeração (achados 7/8/21)

Ordem única, sem contradição, copiada literalmente do precedente `guest-document-access-service.ts`: **parse estrutural → `rateLimiter.consumeBoth({requestKey: selectorHash-do-token-recebido, ip})` (rate limit ANTES do lookup, usando o hash do selector RECEBIDO mesmo que não exista no banco — isso é o que evita o oracle: a chave de rate-limit é derivada do input, não de um registro existente) → lookup do ponteiro pelo `selectorHash` → comparação `timingSafeEqual` do secret (dummy-safe: se o ponteiro não existe, compara contra um hash dummy de mesmo comprimento, nunca retorna cedo)**. `429` é aceito como MENOS informativo que teria sido um oracle de existência (rate limit acontece pela CHAVE DERIVADA DO INPUT, idêntica para token real ou forjado com o mesmo selector) — mesma garantia que o precedente já entrega em produção, não uma garantia nova mais forte inventada aqui.

## Correção de metadados (achado 16/20 — `documentTypeName`)

`documentTypeNameSnapshot: string` — copiado do `DocumentType.displayName` no momento da CRIAÇÃO do link (mesmo padrão `labelSnapshot` de `DocumentTypeFieldOption`, D-218 Decisão 4) — nunca relido depois. Um rename do `DocumentType` depois da criação do link não muda o que o visitante externo vê (mesma tolerância a "órfão" já aceita em D-218). `sanitizeFormulaInjection` mantido como defesa em profundidade ADICIONAL (não a única sanitização) — a resposta JSON também nunca inclui HTML não-escapado (o consumidor é uma página HTML servida pelo mesmo domínio de compartilhamento, escapamento de output é responsabilidade do template dessa página, nomeado explicitamente como responsabilidade de quem implementar o frontend público desta rota).

## Correção de transporte (achado 4)

`Cache-Control: no-store` E `Referrer-Policy: no-referrer` ambos obrigatórios na resposta da rota pública (não um dos dois). Redaction de log: nomeado explicitamente como possível achado de dívida técnica pré-existente a confirmar na implementação (se a allowlist de redaction de log HTTP do projeto já existe genericamente por rota ou precisa ganhar suporte a "redigir querystring inteira" — decisão de implementação, não de design, já que não muda o contrato/dado exposto).

## Fechamento da pendência de senha (achado 12 — resolvida, não mais uma pendência bloqueante)

Verificação adicional por leitura: o precedente MAIS próximo e MAIS recente deste mesmo módulo (`guest-document-access-service.ts`, D-143) já aceita acesso não-autenticado a `document-archive` (fluxo de upload, categoria de dado igualmente sensível — Documents de Subjects reais) com token bearer puro, sem segunda camada de senha, como uma decisão de produto JÁ tomada e já em produção. Aplicar a mesma postura para o fluxo INVERSO (leitura em vez de escrita) é consistência com uma decisão de produto já convergida internamente, não uma decisão nova que exige nova consulta a Marcelo — a pesquisa externa (Dropbox/Google tratando bearer-link como caso base, senha como camada opcional de plano superior) é reforço externo, não a única base da decisão. **Resolvido**: v1 é bearer-token puro por decisão de consistência de produto já estabelecida; senha/PIN opcional nomeada como fatia FUTURA não bloqueante, sem pendência aberta a Marcelo.

## Nota sobre a corrida residual do achado 1 (revogação vs. presign em voo)

Aceita como propriedade sistêmica do padrão de presign já usado em D-215/216/217 (Critério 4 do checklist v3) — qualquer rota deste projeto que emite presign de 5 minutos tem a mesma janela residual entre "ler status" e "emitir a URL". Resolver isso exigiria download mediado (proxy de bytes pela Lambda, abandonando presign) — mudança arquitetural que afetaria TODAS as rotas de download existentes, fora do escopo desta decisão. Declarado explicitamente como limitação aceita, não como bug não resolvido.
